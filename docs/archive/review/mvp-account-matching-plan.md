# Plan: mvp-account-matching

Open-source SaaS Management Platform (open-smp) — MVP slice: Google Workspace +
HR CSV ingestion, identity-account matching, orphan/ghost account detection.

Revision: round 4 (incorporates round-1 findings F1-F8, S1-S8, T1-T7;
round-2 findings F9, S9-S12, T8-T11; round-3 findings S13, T12, T13).

## Project Context

- **Type**: service (TypeScript monorepo: API + worker + web + packages)
- **Test infrastructure**: none yet (greenfield repo). This plan establishes:
  Vitest (unit + integration), Testcontainers (Postgres, Redis), GitHub Actions CI.
  Reviewers may evaluate the *planned* test strategy but must not demand
  test infrastructure beyond what this plan introduces.
- **Verification environment constraints**:
  - **V1 — Google Workspace Admin SDK**: `users.list` requires a real Workspace
    tenant with a service account + domain-wide delegation. No free-tier
    substitute exists. Live-API paths are `blocked-deferred` locally;
    fixture-based connector tests are `verifiable-local`.
    Anti-Deferral cost-justification: standing up a paid Workspace sandbox
    tenant (~3,000 JPY/mo + admin setup) is not justified for plan-stage
    verification; a recorded-fixture harness plus a documented manual test
    script against the author's own tenant covers the gap before first release.
    Fixture-drift bound (RT1): fixtures are re-recorded on every `googleapis`
    dependency bump, and the manual test script is run at least quarterly with
    the run date logged inside `docs/manual-tests/google-workspace-sync.md`.
  - **V2 — Postgres RLS cross-tenant isolation**: `verifiable-local` via
    Testcontainers (two sessions, two tenant GUCs).
  - **V3 — BullMQ/Redis**: `verifiable-local` via Testcontainers Redis.
  - **V4 — Next.js UI E2E**: no E2E infrastructure in MVP (SC8). UI verification
    is manual against docker-compose; classified `blocked-deferred` with
    cost-justification: Playwright setup deferred until UI exceeds one page.

## Objective

Prove the core value hypothesis of open-smp: given a Google Workspace account
inventory and an HR master CSV, the matching engine links accounts to
identities with rule-based confidence scoring and surfaces
**orphan** (no matching identity) and **ghost** (identity left the company,
account still active) accounts, with full audit evidence, runnable via
`docker compose up`.

If matching precision on real data is inadequate, downstream features
(cost, workflows, more connectors) are worthless — this MVP is the gate.
The objective is gated numerically: see Go/No-Go rows C4 (corpus precision
≥ 0.95, CI-enforced) and M1 (real-data evaluation).

## Requirements

### Functional

- FR1: Import HR master CSV (employee id, emails, name, status, leave date) into `identities`.
- FR2: Sync Google Workspace users into `saas_accounts` via Admin SDK Directory API.
- FR3: Match identities ⇔ accounts via an ordered rule pipeline with confidence
  scores; persist results to `account_links` with per-link evidence.
- FR4: List accounts by link status (`matched` / `orphan` / `ghost` / `ambiguous`)
  in the web UI and via API.
- FR5: Record every sync and match run in `discovery_events` (audit trail:
  source, timestamp, evidence).
- FR6: Multi-tenant from day one: all data partitioned by `tenant_id`, enforced
  by Postgres RLS.

### Non-functional

- NFR1: `docker compose up` boots Postgres, Redis, API, worker, web with seed data.
- NFR2: Sync of 10,000 accounts completes < 5 min (API pagination + backoff).
- NFR3: All collector jobs idempotent — re-running a sync never duplicates rows.
- NFR4: No secrets in the repo; connector credentials via env vars only.
  Redis requires authentication (`requirepass` or ACL) in every deployment
  shape including docker-compose; the queue is never reachable unauthenticated.
- NFR5: AGPL-3.0, monorepo layout per the agreed structure (`apps/`, `packages/`).

## Technical Approach

- **Stack**: TypeScript, Fastify (API), BullMQ + Redis (collector worker),
  Drizzle ORM + Postgres 16 (RLS), Next.js + shadcn/ui (web), pnpm workspaces.
  Container images pinned identically for local Testcontainers and CI:
  `postgres:16`, `redis:7`.
- **Tenant isolation**: RLS policies keyed on `current_setting('app.tenant_id')`;
  the app connects as a non-superuser role without `BYPASSRLS`. Every request
  handler resolves the tenant from the session and runs queries through a
  `withTenant(tenantId, fn)` helper that sets the GUC on the pooled connection
  within a transaction.
- **Concurrency design — no isolation-level dependence (probe waiver)**:
  all writes are idempotent upserts guarded by schema-level unique constraints
  (`ON CONFLICT ... DO UPDATE`). The design deliberately does NOT depend on
  `SERIALIZABLE`/`REPEATABLE READ`, advisory locks, or `SELECT ... FOR UPDATE`.
  Duplicate-sync races resolve via unique constraints, not transaction
  isolation. Therefore the plan-stage real-DB isolation probe is not required.
  If any later contract introduces an isolation-level dependence, that contract
  must add the probe before locking.
- **Matching**: pure-function rule pipeline (`packages/matcher`) — deterministic,
  no I/O — so precision can be measured against fixture corpora offline.
- **Auth (MVP)**: single local admin user per tenant, email + password
  (argon2id), server-side session cookie (SameSite=Lax, HttpOnly, Secure),
  login rate-limited, tenant-scoped login via tenant slug (C7), Origin-header
  verification on all non-GET routes (C6). OIDC/Keycloak is SC7.

## Contracts

### C1 — Database schema + RLS (packages/schema)

Tables (all with `tenant_id uuid NOT NULL` unless noted):

- `tenants(id, slug UNIQUE, name, created_at)` — no `tenant_id` column; root table.
  `slug` is the login-time tenant discriminator (C7).
- `identities(id, tenant_id, employee_id, primary_email, secondary_emails text[], display_name, status identity_status, left_at timestamptz NULL)`
- `saas_apps(id, tenant_id, key, display_name)`
- `saas_accounts(id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin bool, last_activity_at timestamptz NULL, last_synced_at timestamptz)`
  - `last_activity_at`: provider-reported last real activity (GWS `lastLoginTime`); NULL when the provider has none.
  - `last_synced_at`: start time of the sync run that last observed this account.
- `account_links(id, tenant_id, saas_account_id, identity_id NULL, status link_status, confidence numeric(3,2), rule_id text, evidence jsonb, computed_at)`
- `discovery_events(id, tenant_id, source, kind, payload jsonb, created_at)`
- `users(id, tenant_id, email, password_hash, created_at)` — local admin auth (C7)
- `sessions(id, user_id, tenant_id, expires_at, created_at)`
- `credential_keys` is NOT a table — key versions live in env (C9); `saas_apps`
  gains `credentials_enc bytea` + `credentials_key_version int` (C9).

Enums:

- `identity_status`: `'active' | 'left'` — the complete value set. The HR CSV
  `status` column maps: `active → active`, `left/retired/退職 → left`; any other
  value is rejected per-row at the import boundary (C6), never persisted.
- `link_status`: `'matched' | 'orphan' | 'ghost' | 'ambiguous'`.
- `account_status`: `'active' | 'suspended' | 'archived'`.

**Invariants**

- [schema-enforced] `UNIQUE (tenant_id, saas_app_id, external_id)` on `saas_accounts` — sync idempotency anchor.
- [schema-enforced] `UNIQUE (tenant_id, employee_id)` on `identities` — CSV import idempotency anchor.
- [schema-enforced] `UNIQUE (tenant_id, saas_account_id)` on `account_links` — one current link per account.
- [schema-enforced] `CHECK (confidence >= 0 AND confidence <= 1)` on `account_links`.
- [schema-enforced] enums above; invalid states unrepresentable.
- [schema-enforced] `CHECK ((status IN ('orphan','ambiguous')) = (identity_id IS NULL))` on `account_links` — orphan and ambiguous links never claim a single identity; matched/ghost always do (F2).
- [schema-enforced] `CHECK ((status = 'left') = (left_at IS NOT NULL))` on `identities` — status and leave date can never disagree (F4).
- [schema-enforced] RLS enabled + tenant policy on every tenant-scoped table.
  Every policy defines BOTH `USING` (read/target visibility) AND `WITH CHECK`
  (written-row validation) on the tenant predicate — `USING` alone leaves
  cross-tenant INSERT open (T8).
  - **Member-set derivation (R42)**: the class "tenant-scoped table" is defined
    by the presence of a `tenant_id` column. Derivation command (Phase 2/3):
    `rg -l "tenant_id" packages/schema/src/tables/` → member set; cross-check
    against `rg -l "pgPolicy|enableRLS" packages/schema/src/tables/`.
    Any member in the first set missing from the second is a Critical finding.
    Current (plan-stage) member set: `identities`, `saas_apps`, `saas_accounts`,
    `account_links`, `discovery_events`, `users`, `sessions` (7 tables;
    `tenants` excluded — root table, protected by C7 authz instead).
- [app-enforced] All queries execute inside `withTenant()`; no viable
  schema-enforced equivalent exists for "GUC always set" (RLS itself is the
  schema-enforced backstop: an unset GUC yields zero rows, fail-closed —
  `current_setting('app.tenant_id', true)` returns NULL on unset, and the
  policy comparison `tenant_id = NULL::uuid` is never true).

**Forbidden patterns**

- pattern: `BYPASSRLS` — reason: app role must never bypass tenant isolation.
- pattern: `sql.raw(` — reason: unparameterized SQL forbidden; Drizzle builders or `sql` tagged template only.
- pattern: `SET app.tenant_id` (without `set_config`/parameter binding) — reason: GUC must be set via parameterized `set_config($1)`, never string concatenation.

**Acceptance criteria**

- Migration applies cleanly on Postgres 16; `\d+` shows RLS enabled on all 7 member tables.
- Integration test (RT8-conformant, mutation-absence asserted): a session with
  tenant A's GUC (a) reads zero tenant-B rows on SELECT, and (b) UPDATE/DELETE
  targeting tenant-B rows affects zero rows, verified by re-querying the rows
  under tenant B's own GUC and asserting they are unchanged — across all 7
  member tables (T3).
- Integration test: session with no GUC set reads zero rows (fail-closed).
- Integration test (T8): a session with tenant A's GUC attempting
  `INSERT ... tenant_id = <tenant-B-uuid>` is rejected by the `WITH CHECK`
  clause, verified by re-querying under tenant B's GUC that no such row
  exists — across all 7 member tables.
- Coverage note (T12): the three tests above are deliberately split but
  together exercise the complete RLS policy surface — `USING` via the SELECT
  and UPDATE/DELETE assertions, `WITH CHECK` via the INSERT assertion, and the
  fail-closed default via the no-GUC assertion.

**Consumer-flow walkthrough** (persisted shapes)

- Producer of `identities` is the C6 `/api/hr-import` handler (see C6 for the
  row→column mapping and upsert clause); producers of `saas_accounts` /
  `account_links` / `discovery_events` are the C5 jobs.
- Consumer C4 matcher (packages/matcher) reads `identities { primary_email, secondary_emails, display_name, status, left_at }` and `saas_accounts { id, email, display_name, account_status }` to compute links.
- Consumer C6 API (apps/api routes) reads `account_links { saas_account_id, identity_id, status, confidence, rule_id, evidence, computed_at }` joined to `saas_accounts { email, display_name, account_status, is_admin, last_activity_at, last_synced_at }`, `saas_apps { key, display_name }`, and `identities { display_name }` (LEFT JOIN via `account_links.identity_id`; yields `link.identityName`, NULL whenever `identity_id IS NULL` — i.e. for orphan/ambiguous rows, consistent with F2) to build the account-list response (F9).
- Consumer C5 worker reads `saas_apps { id, key, credentials_enc, credentials_key_version }` to resolve and decrypt (via C9) the connector to run.

### C2 — Connector interface (packages/connectors/core)

```ts
interface ConnectorContext { credentials: Record<string, string>; logger: Logger; signal: AbortSignal }

interface RawAccount {
  externalId: string;      // provider-stable ID (GWS: user.id, NOT email)
  email: string | null;
  displayName: string | null;
  accountStatus: 'active' | 'suspended' | 'archived';
  isAdmin: boolean;
  lastActivityAt: string | null;  // ISO 8601
  raw: unknown;            // provider payload, stored in discovery_events only
}

interface SaaSConnector {
  id: string;                            // e.g. 'google-workspace'
  authKind: 'oauth2' | 'apikey' | 'scim';
  listUsers(ctx: ConnectorContext): AsyncIterable<RawAccount>;
}

class ConnectorError extends Error { kind: 'auth' | 'rate_limit' | 'transient' | 'fatal'; retryable: boolean }
```

**Invariants**

- [app-enforced] `listUsers` yields every user exactly once per run; pagination handled inside the connector.
- [app-enforced] Connectors never log or persist credentials (`credentials` object never serialized).

**Forbidden patterns**

- pattern: `console.log` — reason: structured logger only; prevents accidental credential/PII dump.
- pattern: `credentials` inside any `JSON.stringify` call — reason: credential leak into logs/events.

**Acceptance criteria**

- Type-level: a connector missing `listUsers` fails compilation.
- `RawAccount` validated at the worker boundary with zod before persistence; unknown `accountStatus` values rejected (fail fast).

**Consumer-flow walkthrough**

- Consumer C5 worker (apps/worker) reads `{ externalId, email, displayName, accountStatus, isAdmin, lastActivityAt }` to upsert `saas_accounts` — `lastActivityAt` maps to `saas_accounts.last_activity_at`; `last_synced_at` is worker-stamped with the run start time, not a `RawAccount` field (F1) — and reads `{ raw }` only to write the `discovery_events` payload when `DISCOVERY_STORE_RAW=true`.
- Consumer C4 matcher does NOT consume `RawAccount` directly — it reads persisted `saas_accounts` rows (single source of truth; re-match without re-sync is possible).

### C3 — Google Workspace connector (packages/connectors/google-workspace)

```ts
class GoogleWorkspaceConnector implements SaaSConnector {
  constructor(cfg: { serviceAccountJson: string; impersonateAdminEmail: string; customerId?: string })
  listUsers(ctx: ConnectorContext): AsyncIterable<RawAccount>  // Admin SDK users.list, pageSize=500
}
```

- Auth: service-account JWT with domain-wide delegation, scope
  `https://www.googleapis.com/auth/admin.directory.user.readonly` (read-only; least privilege).
- Pagination via `pageToken`; 429/5xx retried with exponential backoff + jitter,
  max 5 attempts, then `ConnectorError('rate_limit'|'transient', retryable)`.
- Maps: `user.id → externalId`, `user.primaryEmail → email`,
  `user.suspended/archived → accountStatus`, `user.isAdmin || user.isDelegatedAdmin → isAdmin`,
  `user.lastLoginTime → lastActivityAt`.

**Invariants**

- [app-enforced] `externalId` is the immutable GWS user id — never the email (emails get renamed; identity continuity would break).

**Forbidden patterns**

- pattern: `admin.directory.user` scope without `.readonly` suffix — reason: MVP is read-only; write scope violates least privilege.

**Acceptance criteria**

- Fixture test: 3-page recorded response yields all users exactly once (verifiable-local, V1).
- Fixture test: 429 then success → retried, no duplicate yields.
- Manual test script `docs/manual-tests/google-workspace-sync.md` documents the
  live-tenant verification procedure and logs each run date (blocked-deferred,
  V1; quarterly cadence + re-record-on-googleapis-bump per V1's fixture-drift bound).

**Consumer-flow walkthrough**

- Sole consumer is C5 worker via the `SaaSConnector` interface — same field set as C2's walkthrough; no additional fields required.

### C4 — Matching engine (packages/matcher)

```ts
type MatchRule = {
  id: string;                 // 'exact-email' | 'alias-normalized' | 'secondary-email' | 'name-domain'
  match(identity: IdentityView, account: AccountView): { confidence: number } | null;
}

function matchAccounts(
  identities: IdentityView[],
  accounts: AccountView[],
  rules: MatchRule[],         // ordered, first hit wins per account
): LinkResult[]

type LinkResult = {
  saasAccountId: string;
  identityId: string | null;  // ALWAYS null for status 'orphan' and 'ambiguous'
  status: 'matched' | 'orphan' | 'ghost' | 'ambiguous';
  confidence: number;         // 0 when orphan
  ruleId: string | null;
  evidence: { rule: string; matchedValue: string; candidates?: string[] } | null;
}
```

- Rule order (first hit wins): `exact-email` (1.0) → `alias-normalized` (0.9;
  lowercase, strip `+tag`, provider-aware dot-stripping) → `secondary-email`
  (0.85) → `name-domain` (0.5, requires unique candidate).
- Status derivation — exhaustive over `identity_status ∈ {active, left}` (F4);
  values outside the enum cannot reach the matcher (rejected at the C6 import
  boundary, unrepresentable in the DB):
  - rule hit + identity `status = 'active'` → `matched`
  - rule hit + identity `status = 'left'` + account `accountStatus = 'active'` → `ghost`
  - rule hit + identity `status = 'left'` + account suspended/archived → `matched` (already offboarded)
  - no rule hit → `orphan` (`identityId = null`)
  - ≥2 identities hit at equal top confidence → `ambiguous`, `identityId = null`,
    tied candidates listed in `evidence.candidates` (F2)
- Pure function: no I/O, no clock, no randomness — `computed_at` stamped by the caller.

**Invariants**

- [app-enforced] Deterministic: same inputs → same output (property test).
- [app-enforced] Every input account appears in the output exactly once.
- [app-enforced] `identityId === null` ⟺ `status ∈ {orphan, ambiguous}` (mirrors C1's CHECK).
- [schema-enforced] Persisted via C1's unique + CHECK constraints.

**Forbidden patterns**

- pattern: `new Date()` or `Date.now()` inside packages/matcher — reason: purity; timestamps are caller-supplied.
- pattern: `toLowerCase()` on raw email without going through `normalizeEmail()` — reason: normalization must be single-sourced (R1/R17).

**Acceptance criteria**

- Golden-corpus fixture (≥40 cases: aliases, +tags, case, renamed accounts,
  retired employees, shared mailboxes, duplicate HR rows) with expected
  statuses. **Corpus labeling rule for old-surname cases (T7-A)**: a case where
  the old address is present in the identity's `secondary_emails` is labeled
  `matched`-expected (the `secondary-email` rule is designed to catch it); a
  case where HR data carries no old address is labeled `orphan`-expected and
  tagged `known-gap` in the fixture, documenting the accepted MVP limitation.
  Labels are therefore unambiguous by construction. `known-gap` cases are
  capped at 25% of the corpus, and the precision report additionally prints the
  non-known-gap subset precision as a separate CI-visible number so
  rule-pipeline skill cannot erode behind guaranteed-pass dilution (T9).
- **Precision gate (T1)**: the test suite computes precision =
  correct-status-count / corpus-size and FAILS when precision < 0.95.
  `known-gap` cases count toward the denominator with their `orphan` label
  (they pass when the engine emits `orphan` as documented). The threshold is a
  CI gate from the first corpus commit; raising the corpus size never lowers
  the threshold.
- Property test: output length === input accounts length; no account dropped or duplicated.

**Consumer-flow walkthrough**

- Consumer C5 worker reads `LinkResult { saasAccountId, identityId, status, confidence, ruleId, evidence }` to upsert `account_links` (all fields present in C1 shape; the null-identity rule matches C1's CHECK).
- Consumer C6 API reads persisted links (see C1 walkthrough) — `evidence` and `rule_id` surface in the UI "why matched" panel; for `ambiguous` rows the UI renders `evidence.candidates`, never a single identity name (F2).

### C5 — Collector worker (apps/worker)

```ts
// BullMQ queues
queue 'sync-saas'   job { tenantId: string; saasAppId: string }
queue 'match-links' job { tenantId: string }

async function runSync(job): Promise<{ upserted: number; runId: string }>
async function runMatch(job): Promise<{ links: number; runId: string }>
```

- `runSync`: resolve connector by `saas_apps.key`, decrypt credentials via C9 →
  stream `listUsers` → zod-validate each `RawAccount` → upsert `saas_accounts`
  (`ON CONFLICT (tenant_id, saas_app_id, external_id) DO UPDATE` setting
  `email, display_name, account_status, is_admin, last_activity_at` from the
  `RawAccount` and `last_synced_at = run start time` (F1)) →
  append one `discovery_events` row per run (kind `sync_completed`, payload:
  counts + runId; NOT per-account raw payloads by default — see privacy note).
- `runMatch`: load identities + accounts → `matchAccounts` → upsert
  `account_links` (`ON CONFLICT (tenant_id, saas_account_id) DO UPDATE`) →
  `discovery_events` row (kind `match_completed`).
- Jobs carry `tenantId` explicitly; worker wraps all DB work in `withTenant(job.data.tenantId, ...)`.
- **Enqueue trust boundary (S7)**:
  - [app-enforced] The API is the SOLE enqueuer. `job.data.tenantId` is set
    exclusively from `SessionContext.tenantId` — never from any request body,
    query, or header value.
  - Redis connections require authentication (NFR4); the queue is never
    network-reachable without credentials, including in docker-compose.
- BullMQ concurrency 1 per queue per tenant (jobId = `${queue}:${tenantId}:${saasAppId ?? ''}` — BullMQ dedupes identical active jobIds); duplicates collapse, and unique constraints are the backstop.
- **Sync→match ordering (F6)**: the two queues are serialized per-tenant only
  within themselves; `runMatch` concurrent with an in-flight `runSync` reads a
  partially-synced snapshot. Accepted MVP limitation, mitigated in the primary
  flow: the C8 UI enqueues `match-links` only after the sync job it triggered
  reports `state = completed`. Direct API users may enqueue both concurrently
  and can observe stale links until the next match run; results remain
  idempotent and self-heal on re-match. (`runSync` does not auto-enqueue
  `match-links` in MVP — keeps the R13 surface at zero.)
- Privacy: `RawAccount.raw` is persisted only when `DISCOVERY_STORE_RAW=true`
  (default false) — raw GWS payloads contain org unit, phone, etc. beyond MVP need.

**Invariants**

- [app-enforced] Re-running any job with the same inputs converges to the same DB state (NFR3).
- [schema-enforced] Idempotency anchored on C1 unique constraints.
- [app-enforced] Worker never processes a job without setting the tenant GUC.
- [app-enforced] `job.data.tenantId` originates only from `SessionContext.tenantId` (S7).

**Forbidden patterns**

- pattern: `db.transaction` spanning a `queue.add` call — reason: fire-and-forget dispatch inside a transaction scope (R9).
- pattern: `queue.add('sync-saas'` inside `runSync` or any failure handler — reason: re-entrant dispatch loop (R13); scheduling lives only in the API layer.
- pattern: `tenantId` read from `req.body`, `req.query`, or `req.headers` anywhere in an enqueue path — reason: job tenant must come from the session only (S7).

**Acceptance criteria**

- Integration test (Testcontainers PG+Redis): running the same sync twice
  produces identical row counts and `last_synced_at` monotonicity.
- Integration test: job for tenant A writes zero rows visible to tenant B
  (asserted by querying under tenant B's GUC after the run).
- Route-table sweep test (S7): programmatically iterate every API route schema
  and assert none accepts a `tenantId` field in body or query.

**Consumer-flow walkthrough**

- Consumer C6 API reads job return shape `{ upserted | links, runId }` from BullMQ job status endpoint to display sync progress; both fields are in the return contract.
- Consumer `discovery_events` UI (C8, list view) reads `{ source, kind, payload.counts, created_at }` — all present in the C5-written payload.

### C6 — API (apps/api, Fastify)

```
POST /api/auth/login          { tenantSlug, email, password } → 200 set-cookie | 401
POST /api/auth/logout         → 204
POST /api/hr-import           multipart CSV → 200 { imported, skipped, errors[] }   (synchronous)
POST /api/saas-apps           { key: 'google-workspace', displayName, credentials } → 201
POST /api/sync/:saasAppId     → 202 { jobId }
POST /api/match               → 202 { jobId }
GET  /api/jobs/:jobId         → { state, result }
GET  /api/accounts?status=orphan|ghost|matched|ambiguous&app=&cursor=
       → { items: AccountListItem[], nextCursor }
GET  /api/events?cursor=      → { items: DiscoveryEventListItem[], nextCursor }

type AccountListItem = {
  accountId: string; appKey: string; appName: string;
  email: string | null; displayName: string | null;
  accountStatus: string; isAdmin: boolean;
  lastActivityAt: string | null; lastSyncedAt: string;
  link: { status: string; confidence: number; ruleId: string | null;
          identityId: string | null; identityName: string | null;
          evidence: object | null } | null;
}

type DiscoveryEventListItem = {
  id: string; source: string; kind: string;
  payload: { counts?: object; runId?: string };  // projected — never raw account blobs (S5)
  createdAt: string;
}
```

- **Two independent scope-root gates (S2/S9)** — deliberately NOT one fused
  preHandler, because they have different member sets:
  - **Origin gate**: every non-GET request under `/api` — ZERO route
    exemptions, `/api/auth/login` included — is rejected with 403 when the
    `Origin` header is absent or does not exactly match the configured
    `APP_ORIGIN`. Login-CSRF (a cross-site form POST that logs the victim into
    an attacker session, so later uploads land in the attacker's tenant) is in
    scope of this gate. Defense-in-depth per OWASP CSRF Prevention guidance
    that SameSite=Lax must not be the sole control.
  - **Session-auth gate**: every route except `/api/auth/login` requires a
    valid session (Fastify `preHandler` registered at the API scope root, not
    per-route).
- **Universal invariants + member-set derivation (R42)** — two distinct
  classes, same defining primitive (Fastify route registration), derivation
  command (Phase 2/3):
  `rg -n "\.(get|post|put|patch|delete)\(" apps/api/src/routes/`:
  - Origin gate member set: all non-GET routes (plan-stage: the 6 POST routes
    enumerated above; 0 exempt).
  - Session-auth gate member set: all routes (plan-stage: 9 routes; 1 exempt:
    login).
- Rate limits (RS2): `/api/auth/login` 5/min/IP + 20/hour per account bucket;
  mutation routes 60/min/session; list routes 240/min/session.
  **Account-bucket keying (S12)**: the login account bucket is keyed on a hash
  of the raw submitted `tenantSlug + ':' + email` string — never on resolved
  tenant/user ids — so bucket accrual is identical whether or not the slug or
  email exists, extending RS1's equal-work-regardless-of-existence principle
  to the rate limiter.
- Input validation (RS3): zod schemas on every body/query; unknown JSON fields
  rejected; CSV handling per the hr-import contract below.
- **`/api/hr-import` contract (F3/F5/T2 — synchronous, 200 OK)**:
  - Runs synchronously inside the request: streaming CSV parse, all row
    upserts inside ONE transaction wrapped in `withTenant(session.tenantId)`.
    No queue involvement (10 MB cap keeps request time bounded; 202/jobId
    semantics are reserved for the two genuinely async routes).
  - Upload cap 10 MB; UTF-8 required (BOM accepted and stripped); any other
    encoding → 400 naming the expected encoding. CRLF and LF both accepted.
  - Column mapping (header row required, extra columns ignored with warning):
    `employee_id → identities.employee_id` (required),
    `email → primary_email` (required, ≤320 chars),
    `secondary_emails → secondary_emails` (optional, `;`-separated),
    `name → display_name` (required, ≤200 chars),
    `status → status` (required; `active → 'active'`, `left → 'left'`; any
    other value rejects the ROW, reported in `errors[]`),
    `left_at → left_at` (required iff status=left, ISO 8601 date; the C1 CHECK
    `(status='left') = (left_at IS NOT NULL)` is validated per-row before write).
  - Upsert clause: `ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
    primary_email, secondary_emails, display_name, status, left_at` — the HR
    CSV is the authoritative master: a re-import fully overwrites these columns,
    including reverting `left_at` to NULL when status returns to `active`
    (re-hire case).
  - Per-row errors collected (max 100 reported) without aborting valid rows;
    invalid rows counted in `skipped`.
- `credentials` for saas_apps encrypted via the C9 module before persistence;
  never returned by any GET endpoint.
- `GET /api/events` projection (S5): `payload` is projected to
  `{ counts, runId }` server-side regardless of `DISCOVERY_STORE_RAW` — raw
  per-account blobs are never serialized to any API response in MVP.

**Invariants**

- [app-enforced] Origin gate (non-GET, zero exemptions) and session-auth gate (login-exempt) are two separately registered scope-root preHandlers — new routes are covered by both by default (fail-closed registration pattern); the login exemption exists only on the session-auth gate (S9).
- [app-enforced] Session cookie: HttpOnly, Secure, SameSite=Lax; session TTL 24h, sliding.
- [schema-enforced] `sessions.expires_at` checked in the auth plugin query (`WHERE expires_at > now()`).

**Forbidden patterns**

- pattern: `preHandler` on individual routes as the auth mechanism — reason: opt-in auth is fail-open for forgotten routes; must be scope-level.
- pattern: `credentials` in any GET response serializer — reason: secret exposure.
- pattern: `password` in any log statement — reason: RS4.
- pattern: `payload` passed unprojected to the events serializer — reason: raw-blob PII leak (S5).

**Acceptance criteria**

- Integration test: unauthenticated request to every non-login route → 401 (test iterates the route table programmatically, not a hardcoded list — stays complete as routes are added).
- Integration test: non-GET request with missing or mismatched `Origin` → 403 on every mutation route (programmatic iteration over ALL non-GET routes, no exemptions) (S2).
- Dedicated test, independent of the login-exempt 401 sweep: `POST /api/auth/login` with missing or mismatched `Origin` → 403 (S9).
- Integration test: login rate limit returns 429 on 6th attempt/min.
- Integration test (T13, discriminates the S12 keying property): 5 failed
  logins against bucket key A (`slugX:userX`) do NOT cause a 429 on the first
  attempt against bucket key B (`slugX:userY`), for slugs/emails that do NOT
  exist — proving the bucket is derived pre-resolution from raw input; a
  resolved-id keying implementation fails this test because unresolvable
  inputs would share (or lack) a bucket.
- Integration test: GET /api/saas-apps response contains no `credentials` key.
- hr-import tests (T2): (a) duplicate `employee_id` rows → second upserts over
  first, per-row warning present in response; (b) UTF-8-with-BOM accepted, BOM
  stripped; (c) Shift_JIS bytes → 400 naming UTF-8; (d) row exceeding
  email/name length caps → that row rejected into `errors[]`, remaining rows
  imported; (e) status=left without left_at → row rejected.
- Integration test: GET /api/events with `DISCOVERY_STORE_RAW=true` and raw
  payloads persisted → response contains no raw account fields (S5).

**Consumer-flow walkthrough**

- Consumer C8 web account list reads `AccountListItem { accountId, appKey, appName, email, displayName, accountStatus, isAdmin, lastActivityAt, lastSyncedAt, link.status, link.confidence, link.ruleId, link.identityId, link.identityName, link.evidence }` — renders table + evidence popover. Field justifications (F7): `appKey` is the stable value for the app-filter dropdown (`?app=` param) and the CSV-export app column; `link.identityId` backs the identity deep-link planned for the accounts table (renders as link target; informational until the identity detail page ships post-MVP, tracked in SC11); `link.identityName` renders the matched identity's display name in the table and is produced by the C1 walkthrough's LEFT JOIN to `identities.display_name` (NULL for orphan/ambiguous rows — the UI then renders nothing or `evidence.candidates` per F2) (F9); `lastActivityAt` drives the "last activity" column, `lastSyncedAt` the data-freshness footer.
- Consumer C8 sync page reads `{ jobId }` from POST /api/sync then polls `GET /api/jobs/:jobId { state, result }` — sufficient to render progress and to gate the follow-up match enqueue (F6).
- Consumer C8 import page reads `{ imported, skipped, errors[] }` from the synchronous hr-import response to render the import report (F3).
- Integration tests (RT5) consume the same shapes via real HTTP against the Fastify instance.

### C7 — Auth module (apps/api/src/auth)

```ts
type Session = { id: string; userId: string; tenantId: string; expiresAt: string }
type SessionContext = { userId: string; tenantId: string }

async function createUser(tenantId: string, email: string, password: string): Promise<User>  // argon2id
async function verifyLogin(tenantSlug: string, email: string, password: string): Promise<Session | null>
async function requireSession(req): Promise<SessionContext>  // throws 401
```

- **Tenant-scoped login (S8)**: `verifyLogin` first resolves `tenantSlug` via
  `tenants.slug` (no RLS on the root table; slug is the discriminator), then
  looks up `users WHERE tenant_id = $1 AND email = $2`. Login is deterministic
  even when the same email exists in multiple tenants; a credential valid in
  tenant B can never mint a session scoped to tenant A.
- Timing-safe shape (RS1), tenant-scoped: when the slug does not resolve OR the
  user is not found within the tenant, `verifyLogin` still executes exactly one
  argon2 verification against a static dummy hash — unknown-slug,
  unknown-email, and wrong-password all traverse the same work profile.
- argon2id parameters: memory 19 MiB, iterations 2, parallelism 1 — target is
  the OWASP Password Storage Cheat Sheet minimum for argon2id; exact values
  MUST be re-verified against the cheat sheet at implementation time (S3, see
  acceptance criteria).
- Session id: 32 random bytes (crypto.randomBytes), stored hashed (SHA-256) in
  `sessions` — DB leak does not yield usable cookies.

**Invariants**

- [app-enforced] `verifyLogin` performs constant-shape work whether or not the tenant/user exists (dummy-hash verify) — prevents enumeration timing oracle (RS1).
- [app-enforced] User lookup at login is always tenant-scoped (S8).
- [schema-enforced] `users` unique on `(tenant_id, email)`; `tenants.slug` unique.

**Forbidden patterns**

- pattern: `bcrypt` — reason: argon2id is the chosen primitive; two hash schemes in one codebase is drift.
- pattern: a `users` query filtering on `email` without `tenant_id` in the same WHERE clause — reason: cross-tenant account confusion (S8).
- pattern: `===` comparison of session tokens — reason: lookup is by SHA-256 hash; direct token equality is forbidden.

**Acceptance criteria**

- Unit test: wrong password, unknown email, and unknown tenant slug all return null and all execute exactly one argon2 verify (call-count asserted via injected hasher).
- Integration test: two tenants seeded with the same email and different passwords — each credential logs into its own tenant only; tenant-B credential with tenant-A slug → 401 (S8).
- Integration test: session expired → 401; session row deleted → 401.
- Implementation-time gate (S3): the merged code records the OWASP Password
  Storage Cheat Sheet permalink and retrieval date in a comment adjacent to the
  argon2id constants; PR review checks the constants against that source. A
  mismatch between code constants and the cited source is a Major finding in
  Phase 3.

**Consumer-flow walkthrough**

- Consumer: every C6 route's auth preHandler reads `SessionContext { userId, tenantId }` — `tenantId` feeds `withTenant()` and all job enqueues (S7); both fields present in the declared type (F8).

### C8 — Web UI (apps/web, Next.js)

- Pages: `/login` (tenant slug + email + password), `/accounts` (default filter
  `status=orphan`), `/events`.
- `/accounts`: table (app, email, name, account status, admin badge, last
  activity, link status chip, confidence) + evidence popover; filter tabs
  orphan / ghost / ambiguous / matched; CSV export of current filter
  (client-side). Ambiguous rows render `evidence.candidates`, never a single
  identity name (F2). Data-freshness footer shows `lastSyncedAt`.
- Sync flow: trigger sync → poll job state → enqueue match only after
  `state = completed` (F6).
- Server components fetch via the C6 API with the session cookie; no separate
  API client credential.

**Invariants**

- [app-enforced] No direct DB access from apps/web — API is the only data path.

**Forbidden patterns**

- pattern: `drizzle` import inside apps/web — reason: web must consume the API only; second data path would bypass authz.
- pattern: `dangerouslySetInnerHTML` — reason: account names/emails are attacker-influenced (a malicious SaaS display name is untrusted input); default React escaping only.

**Acceptance criteria**

- CSV export neutralization (S4): unit test — any exported cell value beginning
  with `=`, `+`, `-`, `@`, TAB (0x09), or CR (0x0D) is prefixed with `'` before
  serialization; applied to all attacker-influenced fields (`email`,
  `displayName`, `appName`, `evidence.matchedValue`, `evidence.candidates`).
- Export wiring test (T11): a second unit-level test calls the ACTUAL export
  function (not the sanitizer helper) with a fixture `AccountListItem` in which
  every attacker-influenced field starts with a dangerous character, and
  asserts the entire resulting CSV output is neutralized — so a future column
  added to the export cannot silently bypass the sanitizer.
- Manual test script `docs/manual-tests/ui-orphan-list.md` (V4, blocked-deferred for automation; manual path documented).
- Seeded docker-compose demo shows ≥1 orphan and ≥1 ghost account (backstopped in CI by the compose smoke job, T6 — see Testing Strategy).

**Consumer-flow walkthrough**

- C8 is a terminal consumer (renders to humans); its field needs are recorded in C6's walkthrough and satisfied there.

### C9 — Credential encryption module (apps/api/src/crypto) (S1/S6)

```ts
function encryptCredentials(plaintext: Uint8Array, ctx: { tenantId: string; saasAppId: string }): { blob: Uint8Array; keyVersion: number }
function decryptCredentials(blob: Uint8Array, keyVersion: number, ctx: { tenantId: string; saasAppId: string }): Uint8Array  // throws on auth failure
```

- Algorithm: AES-256-GCM via Node `crypto.createCipheriv`.
- **Nonce (S6)**: 96-bit nonce generated per encryption via
  `crypto.randomBytes(12)` — never a counter, never fixed, never derived.
  Blob layout: `nonce (12B) || tag (16B) || ciphertext`.
- **AAD (S1)**: `utf8(tenantId) || 0x00 || utf8(saasAppId) || 0x00 || uint32(keyVersion)` —
  a ciphertext moved to another tenant's row, another app's row, or re-labeled
  to another key version fails the auth-tag check loudly.
- **Key management**: `ENCRYPTION_KEYS` env holds `version:base64key` pairs
  (current-highest version encrypts; all listed versions decrypt).
  `saas_apps.credentials_key_version` records the version per row.
- **Rotation (S10)**: rotation = add a new version (it becomes current), then
  run the eager re-encryption sweep — an operator CLI that walks every
  `saas_apps` row with a non-current `credentials_key_version` and re-encrypts
  it in place (decrypt + encrypt only; no connector run required) — in
  addition to opportunistic lazy re-encryption on successful decrypt.
  **Sweep execution model (S13)**: the sweep enumerates tenants from the
  `tenants` root table (no RLS) and loops `withTenant(tenantId, ...)` per
  tenant — it never uses a `BYPASSRLS` role (C1's forbidden pattern has no
  carve-out; the sweep obeys it). The retirement-gate count is the sum of the
  per-tenant counts collected inside the same loop.
  **Sweep invocation authorization (S13)**: the sweep is a CLI in apps/worker
  invoked from an operator shell (`pnpm rotate-credentials`) — it is never
  exposed as an HTTP endpoint or enqueued from the API; possession of deploy
  shell access + `ENCRYPTION_KEYS` env is the authorization boundary, and the
  CLI refuses to run unless `ROTATE_CONFIRM=yes` is set.
  **Key-retirement gate**: a key version may be removed from `ENCRYPTION_KEYS`
  only after the per-tenant `SELECT count(*) FROM saas_apps WHERE
  credentials_key_version = N` counts sum to 0; the sweep is what makes this
  reachable for inactive connectors. Removing a still-referenced version
  silently shreds those credentials — the gate makes that operator error
  impossible by procedure.
  Safe-use bound stated: random 96-bit nonces keep collision probability
  negligible up to ~2^32 encryptions per key — orders of magnitude above this
  workload; rotation exists for key-compromise recovery, not bound exhaustion.
- **In-memory lifecycle (S11 — accurately scoped)**: the decrypted plaintext
  buffer is zeroed (`buf.fill(0)`) after the run completes or fails (R39).
  The parsed credential object required by C2 (`Record<string, string>`)
  necessarily materializes immutable JS strings (including the PEM private
  key) that JS-level code cannot zero; their lifetime is GC-dependent. The
  residual exposure is therefore heap-dump/core-dump forensics on the worker
  process during and shortly after a run — accepted for MVP and documented
  here so R39 review is not misled by the buffer-zeroing step alone.

**Invariants**

- [app-enforced] One random nonce per encryption; nonce never persisted separately from its blob.
- [schema-enforced] `credentials_key_version int NOT NULL` on `saas_apps`.

**Forbidden patterns**

- pattern: `createCipheriv` with a literal/constant/zero IV argument — reason: GCM nonce reuse is catastrophic (S6).
- pattern: `ENCRYPTION_KEY` (singular) — reason: versioned `ENCRYPTION_KEYS` only; unversioned key blocks rotation.

**Acceptance criteria**

- Unit test: encrypting the same plaintext twice yields different blobs (proves per-message random nonce).
- Unit test: flipping any byte of nonce, tag, or ciphertext → decrypt throws.
- Unit test: decrypt with a different `tenantId`, different `saasAppId`, or different `keyVersion` in AAD → throws (S1).
- Unit test: rotation — blob encrypted under version 1 decrypts while version 2 is current; new encrypts carry version 2.
- Integration test (S10/S13): with TWO seeded tenants each holding rows on an
  old key version, one sweep run re-encrypts the rows of BOTH tenants (proves
  the per-tenant `withTenant` loop covers all tenants, not just one), the
  retirement-gate sum returns 0, and all swept rows still decrypt correctly
  under the current version — executed without any `BYPASSRLS` grant on the
  test role.
- Static check (S13): route-table sweep asserts no HTTP route invokes the
  rotation sweep; `rg 'rotate' apps/api/src/routes/` is empty.

## Go/No-Go Gate

| ID | Subject | Status |
|----|---------|--------|
| C1 | DB schema + RLS tenant isolation | locked |
| C2 | Connector interface (core) | locked |
| C3 | Google Workspace connector | locked |
| C4 | Matching engine (corpus precision ≥ 0.95, CI-enforced) | locked |
| C5 | Collector worker (BullMQ) | locked |
| C6 | API (Fastify) incl. hr-import contract | locked |
| C7 | Auth module (tenant-scoped login) | locked |
| C8 | Web UI | locked |
| C9 | Credential encryption module | locked |
| M1 | Real-data matching evaluation: run against the author's real GWS tenant + HR export; documented target (T10): real-tenant precision ≥ 0.90 (within 5 points of the corpus gate) AND zero Critical mislinks (an account linked to the wrong person); measured values + mislink severity reviewed against this bar by the repo owner before any post-MVP feature work begins (T1; blocked-deferred per V1, executed via the manual test script) | bar locked — execution post-implementation (does not gate Phase 1→2) |

## Testing Strategy

- **Unit (Vitest)**: matcher golden corpus (≥40 labeled cases, precision gate
  ≥ 0.95 per C4) + property tests; email normalization table-driven tests;
  auth timing-shape test; C9 crypto tests; C8 CSV-export neutralization test.
- **Integration (Vitest + Testcontainers, images pinned `postgres:16` / `redis:7`
  identical to CI — T4)**: RLS cross-tenant matrix with mutation-absence
  assertions incl. foreign-tenant INSERT vs `WITH CHECK` (V2, T3, T8); sync
  idempotency; API route auth + Origin sweeps (programmatic route-table
  iteration; Origin sweep exemption-free, plus the dedicated login-Origin test
  — S9); rate-limit 429; credentials-absence in responses; hr-import row-level
  cases (T2); events-payload projection (S5); tenant-scoped login matrix (S8);
  route-schema tenantId sweep (S7); C9 re-encryption sweep test (S10).
- **Connector fixtures**: recorded GWS `users.list` responses (sanitized,
  synthetic data only — RS4) under `packages/connectors/google-workspace/fixtures/`;
  re-recorded on every `googleapis` bump, manual live run quarterly (V1, T5).
- **CI (GitHub Actions)**: lint (eslint) → typecheck (tsc) → unit → integration
  (services: postgres:16, redis:7) → **compose smoke job (T6)**: `docker compose
  up -d`, poll the API health endpoint until 200 (timeout 120 s), run the seed
  script, then `curl /api/accounts?status=orphan` and `?status=ghost` asserting
  ≥1 item each — automating NFR1 and C8's seeded-demo criterion. Single
  workflow file; no duplicated config (R33).
- **Explicitly not in MVP**: E2E browser tests (V4/SC8), live-API contract tests (V1).
- Mocking policy: mock at system boundaries only (Google API HTTP layer via
  recorded fixtures); real Postgres/Redis in integration tests — never mock the
  DB for RLS/SQL validation (RT1).

## Considerations & Constraints

- Matching precision on real data is the go/no-go metric for the whole product;
  the corpus gate (≥ 0.95) guards regressions, and M1 gates the product
  decision on real data. Old-surname handling beyond secondary-email data is
  out of MVP scope — `known-gap` corpus cases quantify it.
- GWS API quotas: Directory API default 2,400 queries/min/project — 10k users at
  pageSize 500 = 20 calls; NFR2 is comfortably met without quota work.
- `numeric(3,2)` caps confidence precision at 2 decimals — sufficient for rule
  constants (1.0/0.9/0.85/0.5).
- Postgres connection pooling: MVP uses node-postgres pool directly (no
  PgBouncer). `withTenant` sets the GUC via `set_config(..., true)` (transaction-local)
  inside a transaction, so pooled-connection GUC leakage across tenants cannot occur.
  If a pooler is introduced later (SC9), the GUC strategy must be re-probed.

### Scope Contract

| ID | Deferred item | Owner / tracking |
|----|---------------|------------------|
| SC1 | Browser extension (MV3 shadow-IT detection) | future plan `extension-shadow-it` |
| SC2 | Connectors beyond Google Workspace (M365, Slack, SCIM, ...) | future plans per connector; C2 interface is the extension point |
| SC3 | OAuth token audit (`admin.directory.tokens.list` shadow-IT discovery) | future plan `gws-token-audit` |
| SC4 | Provisioning / deprovisioning workflows | future plan |
| SC5 | License & cost module (`licenses`, `entitlements` tables) | future plan; tables intentionally absent from C1 |
| SC6 | Hierarchical (parent-child) tenants | future plan; MVP is flat multi-tenant |
| SC7 | OIDC / Keycloak SSO for the app itself | future plan; MVP local auth (C7) |
| SC8 | E2E browser test infrastructure | future plan, triggered when UI > 1 page |
| SC9 | External connection pooler (PgBouncer) support | future plan; requires GUC strategy re-probe |
| SC10 | `discovery_events` retention/expiry policy | future plan; MVP retains indefinitely, raw blobs excluded from API responses (S5) and off by default |
| SC11 | Identity detail page (target of `link.identityId` deep-link) | future plan; field shipped in the API shape now to avoid a breaking change (F7) |

## User Operation Scenarios

1. **Initial setup**: admin runs `docker compose up`, opens `/login`, signs in
   with tenant slug + seeded admin, uploads HR CSV (2,000 rows), registers the
   GWS service account JSON, triggers sync, waits for completion, triggers
   match, opens `/accounts?status=orphan`.
2. **Retired employee (ghost)**: HR CSV marks employee left 2024-03-31; GWS
   account still active → appears under ghost tab with evidence
   `exact-email` + `left_at`.
3. **Alias mismatch**: HR has `taro.yamada@corp.example`, GWS primary is
   `t.yamada+admin@corp.example` — caught by `alias-normalized` only if the
   normalized forms collide; otherwise surfaces as orphan → drives rule tuning.
4. **Shared mailbox**: `info@corp.example` matches no identity → orphan; admin
   marks it known-shared (post-MVP annotation; MVP leaves it in orphan list —
   accepted noise, quantified by the corpus).
5. **Duplicate HR rows**: same `employee_id` twice in CSV → second row upserts
   over the first, per-row warning in the import report.
6. **CSV with BOM / CRLF / Shift_JIS**: importer accepts UTF-8 (with BOM) and
   rejects other encodings with a 400 naming the expected encoding
   (fail fast at the boundary; Shift_JIS support tracked post-MVP if demanded).
7. **Re-hire**: employee returns; HR CSV flips status back to `active` with
   empty `left_at` → re-import overwrites the row (HR is authoritative), next
   match run moves their account from ghost back to matched.
8. **Same email in two tenants**: `admin@corp.example` exists in tenants A and
   B with different passwords — each logs in deterministically via their tenant
   slug; neither credential works against the other slug (S8).
