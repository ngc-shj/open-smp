# Plan: identity-appmgmt-labeling-v2

Date: 2026-07-25
Cycle: 2 (successor to `e2e-playwright-bootstrap`)
Base branch: `feature/e2e-playwright-bootstrap` @ `ad30a0c`
Contract numbering: C18– (C1–C17 are locked in prior cycles)
Scope-out numbering: SC23– (SC1–SC22 belong to prior cycles)

---

## Project Context

- **Type**: web app (pnpm monorepo — Fastify API, Next.js 15 web, BullMQ worker, Postgres 16 with RLS)
- **Test infrastructure**: unit (Vitest) + integration (Vitest + Testcontainers, `postgres:16` / `redis:7` pinned) + E2E (Playwright against the live compose stack) + CI (GitHub Actions, 5 gates)
- **Current gate baseline** (all green at `ad30a0c`): `pnpm lint` / `pnpm typecheck` / `pnpm test:unit` (99) / `pnpm test:integration` (89) / `pnpm test:e2e` (27) / `bash e2e/scripts/assert-seed-preserved.sh`

### Verification Environment Constraints

Carried forward from the predecessor cycle; each is cited by ID from the Phase-3 Environment Verification Report.

| ID | Constraint | Consequence for this plan |
|----|------------|---------------------------|
| VE1 | No live Google Workspace tenant is available. | Any contract depending on a real GWS sync is `blocked-deferred`. This plan adds no connector code, so only C22's "credentials actually work" property is affected — see C22 acceptance, which deliberately asserts *storage* properties, not *provider-accepted* properties. |
| VE2 | Resolved for covered flows by the E2E suite (cycle 1). | New pages in this plan MUST ship E2E specs (see R42 member-set derivation below) or they inherit VE2 again. |
| VE3 | Integration tests require Docker (Testcontainers). | Available locally and in CI. `verifiable-local` + `verifiable-CI`. |
| VE4 | E2E requires the compose stack up (`docker compose up -d --build`). | Available locally; CI boots it in the `e2e` job. `verifiable-local` + `verifiable-CI`. |
| VE5 | **No git remote is configured; CI has never executed.** | Every CI-gate claim is parity-by-construction (identical commands run locally), never observed-green-in-CI. Any contract whose only proof would be a CI run is `blocked-deferred` with the manual-test plan as the Tier-2 artifact (R35). |

---

## Objective

Close the three feature gaps the MVP left open, in one cycle, because all three land on the same two files (`apps/api/src/routes/accounts.ts`, `apps/web/src/app/accounts/page.tsx`) and splitting them would mean touching those files three times with three separate review cycles.

1. **SC11 — identity detail page**: `accounts.link.identityId` is rendered today but links nowhere. Give it a destination.
2. **SC14 — SaaS app management UI**: registered apps can be created and listed but never edited, deleted, or re-credentialed.
3. **labeling-v2 (SC12/SC13/SC15)** — label audit trail, label filtering, bulk labeling. The audit trail is the security-load-bearing part: a label is a *review-suppression control* (it moves an account out of the operator's "needs attention" set), and today a compromised session can suppress review with no trace.

Plus one carried-over defect: **SC-CR1** (CSV newline escaping), which labeling-v2 owns because it owns note semantics.

---

## Requirements

### Functional

| ID | Requirement |
|----|-------------|
| FR1 | An operator can navigate from a matched/ghost account row to a page describing the linked identity, and see every SaaS account attributed to that identity. |
| FR2 | An operator can rename a registered SaaS app, replace its stored credentials, and delete an app that has no accounts. |
| FR3 | Every label mutation (set, change, clear) writes an immutable audit record naming the actor, the account, and the before/after label state. |
| FR4 | An operator can filter the accounts list by label kind, including "unlabeled". |
| FR5 | An operator can apply one label to many accounts in a single action. |
| FR6 | A label note containing a newline cannot corrupt the CSV export. |

### Non-functional

| ID | Requirement |
|----|-------------|
| NFR1 | Every new API route is tenant-isolated by RLS, session-gated, Origin-gated, and rate-limited — no exceptions (see R42 member-set derivation). |
| NFR2 | Audit records are append-only from the application's perspective: no API path updates or deletes a `discovery_events` row. |
| NFR3 | The S5 payload projection continues to withhold raw provider blobs from `GET /api/events` regardless of `DISCOVERY_STORE_RAW`. |
| NFR4 | No credential plaintext, ciphertext, or key material appears in any API response, audit payload, or log line. |
| NFR5 | The E2E suite remains re-runnable: `assert-seed-preserved.sh` must still pass after a full run. |

---

## Technical Approach

### Key findings that shape the design (all verified against the tree, not assumed)

**A. `identities` has no read API at all.** The table is written by `apps/api/src/routes/hr-import.ts:183` and `apps/api/src/seed.ts:217`, and read only as a `LEFT JOIN` inside `apps/api/src/routes/accounts.ts:130`. SC11 is therefore not "add a page" — it needs a new read surface (C18).

**B. The events payload projection would silently erase the audit trail.** `apps/api/src/routes/events.ts:24-37` (`projectPayload`) reduces every payload to `{counts?, runId?}`. That guard exists for S5 — raw GWS blobs carry phone numbers and org units — and it must stay. But a label-audit event's entire content (actor, account, before/after) lives outside `{counts, runId}` and would be dropped. The fix is to make the projection **kind-aware allowlist** rather than a single shape (C21): `sync_raw` keeps today's aggressive projection; audit kinds project their own declared field set. This is the central design decision of labeling-v2.

**C. Deleting a SaaS app cannot work as-is.** Measured against the live database, not inferred:

```
$ docker compose exec -T postgres psql -U opensmp -d opensmp \
    -c "SELECT conname, confdeltype FROM pg_constraint WHERE contype='f' ORDER BY confrelid::regclass;"
 account_labels_tenant_id_fkey       | c   (CASCADE)
 account_links_identity_id_fkey      | a   (NO ACTION)
 saas_accounts_saas_app_id_fkey      | a   (NO ACTION)   <-- blocks app delete
 account_labels_saas_account_id_fkey | c   (CASCADE)
 account_links_saas_account_id_fkey  | a   (NO ACTION)
 sessions_user_id_fkey               | a   (NO ACTION)
 account_labels_created_by_fkey      | n   (SET NULL)
```

`saas_accounts_saas_app_id_fkey` is `NO ACTION`, so `DELETE FROM saas_apps` raises `23503` whenever any account references it. **Decision (user-confirmed): delete only when the app has zero accounts; otherwise 409.** Rationale: a label is an audit-relevant review-suppression control and a link is matcher output; cascading them away on a mis-click destroys evidence that no other record reproduces. The E2E unblock (SC17) is still satisfied because a freshly registered app has zero accounts.

**D. The string `rotate` is forbidden in `apps/api/src/routes/`.** `apps/api/test/no-rotation-route.test.ts:12` enforces `/rotate|runrotationsweep|rotate-credentials/i` against every route file, because key rotation is a shell-authorized CLI (`apps/worker/src/rotate-credentials.ts:146-154`, `ROTATE_CONFIRM=yes`) and must never gain an HTTP surface. C22 is therefore specified as **credential replacement** (operator supplies new plaintext credentials), which is a different operation from key rotation (re-encrypting existing plaintext under a new key version) and must not be named as if it were the same thing.

**E. `discovery_events` is ordered by `id` (a random UUID), not by time.** `apps/api/src/routes/events.ts:75` uses `ORDER BY id` with a UUID keyset cursor. For sync/match events this was tolerable; for an audit trail, "show me what happened, in order" is the entire point, and UUIDv4 ordering is arbitrary. C20 adds a chronological index and switches the audit-facing read path to `(created_at, id)` ordering.

**F. `AccountLink.status` is typed `string`, not `LinkStatus`** (`packages/api-types/src/index.ts:9`). Pre-existing looseness; noted so no contract here assumes narrowing exists.

**G. Adding an API type requires two edits.** `apps/web/src/lib/api-types.ts:6-22` is an explicit re-export list, not `export *`.

### Architecture decisions

| Decision | Choice | Why not the alternative |
|---|---|---|
| Audit storage | Reuse `discovery_events` with new `kind` values | A dedicated `audit_log` table is the textbook answer, but `discovery_events` already has RLS, a tenant policy, an events UI, and an API. A second table would duplicate all four for one writer. Revisit if audit grows retention/export requirements (SC26). |
| Audit atomicity | Same transaction as the label mutation | R9: fire-and-forget dispatch inside a transaction scope is the failure mode being avoided; writing the event *in* the transaction is the safe direction — either both land or neither does. An audit record for a mutation that rolled back is worse than none. |
| Payload projection | Kind-aware allowlist (C21) | A blanket `passthrough` would regress S5. A separate audit-only endpoint would fork the events UI. |
| Bulk labeling | One request, one transaction, all-or-nothing | Per-account requests would produce partial application under the 60/min mutation limit and a torn audit trail. |
| App delete | Refuse when non-empty (409) | User-confirmed. See finding C above. |
| CSV newline | Reject at the API boundary **and** keep the quoted-field export correct | Boundary rejection alone leaves already-stored notes (measured: 0 rows, see C24) unhandled; export-escaping alone leaves the API accepting input the UI cannot round-trip. Both, per SC-CR1's "settle the input-vs-API asymmetry as a whole". |

### Concurrency / isolation

No contract in this plan depends on an isolation level, advisory lock, or `SELECT … FOR UPDATE`. All multi-statement work runs inside the existing `withTenant` helper (`packages/schema/src/db.ts:18-36`), which opens a plain `BEGIN`, sets `app.tenant_id` transaction-locally, and commits — default `READ COMMITTED`. The one read-then-write sequence (C23 bulk labeling: verify account ownership, then upsert labels) is wrapped in a single `withTenant` call so R5's TOCTOU window is closed by the transaction, not by an isolation upgrade. **No plan-stage real-DB isolation probe is required** because no contract asserts a concurrency-control primitive beyond "these statements are in one transaction."

---

## Contracts

### C18 — `GET /api/identities/:identityId`

**Signature**
```
GET /api/identities/:identityId
  params: { identityId: string (uuid) }
  200 -> IdentityDetailResponse
  400 -> { error: 'invalid_params' }
  404 -> { error: 'not_found' }
  rate limit: LIST_RATE_LIMIT
```

```ts
export type IdentityDetailResponse = {
  identityId: string;
  employeeId: string;
  primaryEmail: string;
  secondaryEmails: string[];
  displayName: string;
  status: 'active' | 'left';
  leftAt: string | null;
  accounts: IdentityAccountItem[];      // capped at PAGE_SIZE (I18.5)
  accountsTruncated: boolean;           // true when the cap was hit
};

export type IdentityAccountItem = {
  accountId: string;
  appKey: string;
  appName: string;
  email: string | null;
  displayName: string | null;
  accountStatus: string;
  isAdmin: boolean;
  lastActivityAt: string | null;
  linkStatus: string;
  confidence: number;
  label: AccountLabel | null;
};
```

**Invariants**
- **I18.1 (schema-enforced)**: cross-tenant reads are impossible — `identities` carries `tenant_isolation` RLS (`packages/schema/migrations/0001_init.sql:100-103`) and the query runs inside `withTenant`. A wrong-tenant `identityId` yields zero rows → 404, never a leak.
- **I18.2 (app-enforced)**: `confidence` is `Number()`-coerced before serialization. The pg driver returns `numeric(3,2)` as a **string** (`apps/api/src/routes/accounts.ts:31-35`); shipping it raw makes the UI's `.toFixed()` throw. Verified by a `typeof` assertion in the integration test (D9 lesson from cycle 1).
- **I18.3 (app-enforced)**: `accounts` lists exactly the accounts whose `account_links.identity_id` equals this identity. Orphan/ambiguous accounts have `identity_id IS NULL` (schema check at `0001_init.sql:67`) and therefore can never appear here.
- **I18.4 (app-enforced) — the join direction is pinned (round-1 FN-F4).** The query is driven **from `account_links`**:

  ```sql
  FROM account_links al
  JOIN saas_accounts sa ON sa.id = al.saas_account_id
  JOIN saas_apps sap ON sap.id = sa.saas_app_id
  LEFT JOIN account_labels lbl ON lbl.saas_account_id = sa.id
  WHERE al.identity_id = $1
  ```

  This is not stylistic. `IdentityAccountItem` declares `linkStatus: string` and `confidence: number` as **non-nullable**, which is only sound when a link row is guaranteed to exist. Driving instead from `saas_accounts` with a `LEFT JOIN account_links` — the natural shape to copy from `accounts.ts:127-131`, which is what an implementer will reach for — makes both columns nullable, and `Number(null)` silently yields `0` rather than erroring: a wrong confidence value, not a crash. The forbidden pattern below catches the missing `Number()` coercion but cannot catch the nullability, so the join is pinned here instead.

- **I18.5 (app-enforced) — the account list is capped (round-1 SEC-F6).** `accounts` is `LIMIT`ed to `PAGE_SIZE` (50, the same constant every other list surface uses — `accounts.ts:18`, `events.ts:10`) and the response carries `accountsTruncated: boolean` so the page can say "showing the first 50". The draft returned an unbounded array behind `LIST_RATE_LIMIT` (240/min) while giving C23's identical concern an explicit cap — an inconsistency in the same plan. The bound here is set by matcher output, not by anything the API controls: a mis-tuned matcher or a hostile HR import can attribute many accounts to one identity, turning 240 req/min into an unbounded row-fetch multiplier that the Next page then renders server-side. No cursor is offered (an identity with >50 accounts is a data-quality signal, not a browsing use case); if that changes, it becomes a normal keyset page like the others.

**Forbidden patterns**
- `pattern: SELECT .* FROM identities(?![\s\S]{0,400}withTenant)` — reason: every identity read must be inside a tenant-scoped transaction.
- `pattern: confidence: row\.[a-z_]*confidence(?!.*Number)` — reason: numeric-as-string must be coerced (I18.2).

**Acceptance criteria**

> **Fixtures are constructed, not seeded (round-2 TEST-F7).** The first draft phrased these against `E001`/`E002`/`gws-user-001` — `apps/api/src/seed.ts` fixtures for the *demo* tenant, which the E2E stack consumes. But C18's criteria run at the **integration** tier, and `api.integration.test.ts` never invokes the seeder (grep: no `runSeed`/`seed(` call); every test hand-inserts into its own `randomUUID` tenant. Naming demo fixtures there invites either a wasted attempt to reach them or a fifth copy of the seed facts, which R2/RT3 exist to prevent. Criteria are therefore stated by shape.

- An **active identity with one matched account** returns `status: 'active'`, `leftAt: null`, and exactly that one account with `linkStatus: 'matched'`.
- A **left identity with one ghost account** returns `status: 'left'`, a non-null `leftAt`, and one account with `linkStatus: 'ghost'`.
- A syntactically valid but foreign-tenant uuid returns 404 with no row disclosure.
- A non-uuid `identityId` returns 400 before any DB access.
- `typeof body.accounts[0].confidence === 'number'`.
- **Cap and `accountsTruncated` (round-2 FN-F3, Major).** The first draft declared I18.5's cap in the type, the invariant, and the consumer walkthrough but gave it **no acceptance criterion** — and both seeded criteria exercise one-account identities where `accountsTruncated` is trivially `false`. An implementer who omitted the `LIMIT` would ship an unbounded array (re-opening SEC-F6) with every stated criterion still green. This is the identical shape round-1 TEST-F7 flagged for I23.6, which received a `generate_series` fixture; I18.5 needs the same treatment:
  - Integration tier: seed one identity with **60** linked accounts (`generate_series` over `saas_accounts` + `account_links`), assert `accounts.length === 50` **and** `accountsTruncated === true`.
  - Boundary: exactly **50** linked accounts asserts `accounts.length === 50` and `accountsTruncated === false` — the case that distinguishes "capped" from "happens to be 50", which is the whole reason the boolean exists rather than inferring from length.
  - Red-proof (RT7): removing the `LIMIT` makes the 60-account assertion fail on `accounts.length`.

**Consumer-flow walkthrough**
- **Consumer 1 — identity detail page** (`apps/web/src/app/identities/[identityId]/page.tsx`, C25): reads `{ displayName, employeeId, primaryEmail, secondaryEmails, status, leftAt }` to render the header block, and `accounts[]` — using `{appName, email, displayName, accountStatus, isAdmin, lastActivityAt, linkStatus, confidence, label}` for the table rows and `accountId` as the React key. It reads `accountsTruncated` to render a "showing the first 50" note (I18.5) — without this field the page cannot distinguish "this identity has exactly 50 accounts" from "the list was cut off", which is why the boolean is in the contract rather than inferred from `accounts.length`. It constructs no URLs from these fields.
- **Consumer 2 — accounts list deep link** (`apps/web/src/app/accounts/page.tsx:110`, C25): does *not* consume this response; it only *produces* the link target from the already-present `item.link.identityId`. No new field is needed on `GET /api/accounts` — verified: `identityId` is already in `AccountLink` (`packages/api-types/src/index.ts:12`) and already selected (`apps/api/src/routes/accounts.ts:122`).
- **Consumer 3 — E2E spec** (`e2e/specs/identity.spec.ts`, C26): reads the rendered page, not the JSON. It asserts on `displayName`, the `status` chip, and the presence of the seeded account row by email.

---

### C19 — Label audit event emission

**Signature** — no new HTTP route. Existing handlers gain a same-transaction event write.

```ts
// apps/api/src/audit.ts (new module)
export const AUDIT_SOURCE = 'label';

export type LabelAuditKind = 'label_set' | 'label_cleared';

export type LabelAuditPayload = {
  actorUserId: string;
  saasAccountId: string;
  before: { kind: AccountLabelKind; note: string | null } | null;
  after: { kind: AccountLabelKind; note: string | null } | null;
};

export async function recordLabelAudit(
  tx: PoolClient,
  tenantId: string,
  kind: LabelAuditKind,
  payload: LabelAuditPayload,
): Promise<void>;
```

**Invariants**
- **I19.1 (app-enforced, R9)**: `recordLabelAudit` takes the caller's `tx`, never a pool. The event and the label mutation commit together or roll back together. There is no `await`-less dispatch anywhere in this path.
- **I19.2 (app-enforced)**: `before` is captured **inside the same transaction, before/by the write**. A `before` read outside the transaction would race a concurrent relabel.

  **Required handler change for DELETE (round-1 SEC-F3, Major).** The first draft described C19 as handlers merely "gaining a same-transaction event write." That is not implementable for `DELETE …/label` as the handler stands: `apps/api/src/routes/account-labels.ts:87-98` checks only that the **saas_account** exists (`:88`), then issues an unconditional `DELETE FROM account_labels` (`:93`) and returns `true`. It never reads the label row and never inspects `rowCount`. So there is no source for `before`, and the `found` boolean is `true` whether or not a label was actually removed — meaning a naive implementation either fabricates `label_cleared` events for no-op deletes (poisoning the trail the plan calls security-load-bearing) or suppresses all of them.

  The DELETE must become `DELETE FROM account_labels WHERE … RETURNING kind, note`, with `before` set from the returned row and **emission skipped entirely when `rowCount === 0`**. The 204 response is unchanged in both cases (the endpoint stays idempotent); only the audit behavior differs.

  For `PUT`, the existing `ON CONFLICT DO UPDATE` (`:49-53`) similarly returns only the *new* values, so the prior row must be read (`SELECT kind, note … `) inside the same transaction before the upsert.
- **I19.3 (app-enforced)**: `kind` is `label_cleared` **iff** `after === null`. Enforced by construction (two call sites, one per verb) and asserted in tests.
- **I19.4 (schema-enforced by C27, plus app-level defense in depth)**: no path mutates an emitted event. `packages/schema/migrations/0001_init.sql:159-167` currently grants `SELECT, INSERT, UPDATE, DELETE` on a 7-table group that includes `discovery_events`, so append-only was application discipline only. **C27 revokes `UPDATE, DELETE` in this branch** (round-1 SEC-F5 — the first draft deferred this as SC29 on a cost premise the tree contradicts). After C27 the database itself rejects an audit mutation regardless of which code path attempts it. The app-level guards remain as defense in depth: the forbidden pattern below, and the RLS tenant policy for cross-tenant access.

**Forbidden patterns**
- `pattern: recordLabelAudit\([^,]*pool` — reason: I19.1, the audit write must join the caller's transaction.
- `pattern: (UPDATE|DELETE)[\s\S]{0,40}discovery_events` anywhere under `apps/api/src/` — reason: I19.4. The DB grant permits it (measured), so this pattern is the only thing standing between the codebase and a mutable audit trail.
- `pattern: (note|password|credential|private_key)` inside `apps/api/src/audit.ts` beyond the declared payload shape — reason: NFR4 keeps secrets out of audit payloads. (`note` *is* in the payload by design — see the security note below — so this pattern is a review prompt, not a mechanical block.)

**Security note (deliberate)**: the payload records the note text. The note is operator-authored free text about *why* an account was suppressed from review; an audit trail that omits it cannot answer "what justification was given". It is not secret material. It is length-capped at 500 (`0003_account_labels.sql:11`) and, per C24, may not contain newlines.

**Acceptance criteria**
- `PUT …/label` on an unlabeled account writes exactly one row: `source='label'`, `kind='label_set'`, `before: null`, `after: {kind, note}`, `actorUserId` = the session user.
- `PUT …/label` on an already-labeled account writes `before` = the prior `{kind, note}` (not null) and `after` = the new one.
- `DELETE …/label` writes `kind='label_cleared'`, `after: null`, and **`before` deep-equals the removed label's `{kind, note}`** — asserted on the field's contents, not merely on the event's existence. `before` is the entire evidentiary content of a clear record; an assertion that only checks the row appeared would pass against a `before: null` bug.
- `DELETE …/label` on an account with **no** label returns 204 and writes **no** event, proven by asserting the `discovery_events` count is unchanged (an audit row would falsely record a suppression that never existed).
- A `PUT` that fails (404 unknown account) writes no event — proven by asserting `count(*)` on `discovery_events` is unchanged (RT8: denial paths assert the mutation did not happen, not just the status).

**Consumer-flow walkthrough**
- **Consumer 1 — `GET /api/events`** (`apps/api/src/routes/events.ts`, via C21): reads `{source, kind, payload, created_at}`. Under C21 it projects `payload` through the `label` allowlist, emitting `{actorUserId, saasAccountId, before, after}` verbatim. It performs no derivation on these fields beyond serialization.
- **Consumer 2 — events page** (`apps/web/src/app/events/page.tsx`, C21): today renders `payload.counts` only (`:55`). It gains an audit column that reads `{before, after}` to render a "known_shared → service_account" style transition string, and `saasAccountId` is **not** rendered as a link (the accounts list is keyed by status/cursor, not by id — there is no per-account page to link to; adding one is SC25).
- **Consumer 3 — integration test**: reads the raw `discovery_events` row (bypassing projection) to assert the stored shape, and separately reads `GET /api/events` to assert the projected shape. Both are required — C21's allowlist is exactly the kind of code where stored-vs-served can silently diverge (R40).

---

### C20 — Chronological ordering for the events read path

**Signature** — migration + query change, no API shape change.

```sql
-- packages/schema/migrations/0004_discovery_events_created_at_idx.sql
CREATE INDEX discovery_events_tenant_created_idx
  ON discovery_events (tenant_id, created_at DESC, id DESC);
```

```
GET /api/events
  query: { cursor?: string, source?: string }   -- cursor: opaque composite, NOT a uuid
  ordering: created_at DESC, id DESC
```

**`?source=` filter (round-1 FN-F3, Major).** The first draft wrote audit events into the same undifferentiated list as sync events with no way to filter them. `discovery_events.source` is the provider/app key everywhere else (`apps/worker/src/sync.ts:151` passes `app.key`; `match.ts:126` uses `'matcher'`), and C19 sets `source = 'label'` — but with no filter, and with `sync_completed` + `sync_raw` rows accumulating on every sync, label audits get buried. Scenario S3 ("security reviewer opens `/events`, finds the `label_set` entry") would be unreachable at any realistic data volume: the audit trail would be *written* but not *readable*, which defeats the security purpose the plan gives for building it.

The fix is small — the existing builder at `events.ts:61-67` already appends parameterized conditions, so `source` is one more `$n` predicate. Validated as `z.string().min(1).max(64).optional()` at the boundary; unknown values return an empty page rather than an error (a nonexistent source is not a client error, and erroring would leak which sources exist).

This is deliberately `source`, not `kind`: `source='label'` selects the whole audit family in one predicate and stays correct when a future audit kind is added, whereas a `kind` filter would need updating for each new kind (R12).

**Cursor encoding (locked — round-1 FN-F1, Critical).**

> The first draft said only "the cursor becomes an opaque composite" and named `events.ts:75` (`ORDER BY id`) as the site to change. It missed that `apps/api/src/routes/events.ts:8` validates the cursor as `z.string().uuid()`. No composite encoding is a valid uuid, so **every "Load more" would have 400'd** — and `apps/web/src/app/events/page.tsx:17-19` turns a non-ok response into `throw new Error(...)`, i.e. a rendered error page, not graceful degradation. Worse, the draft's acceptance criteria ("a malformed cursor returns 400") would have passed against the unchanged schema while the happy path was broken. Locked concretely below.

Encoding: `base64url(JSON.stringify({ t: <created_at ISO-8601>, id: <uuid>, s: <source|null> }))`.

**The cursor is filter-scoped (round-2 FN-F1, Major).** The `?source=` filter and the composite cursor were designed in the same round and their interaction was left unspecified. The consequence is concrete and silent: the cursor encodes a *position*, the filter is read from the *current request*, so resuming a `label`-filtered position inside an unfiltered set omits every non-`label` event newer than that position — no 400, no empty page, just missing rows in an audit UI whose entire purpose (S3) is "show me what happened, in order."

Verified this is the **default** path, not an edge case: `apps/web/src/app/events/page.tsx:73` builds `href={`/events?cursor=…`}` and carries no other params, so following "Load more" under `?source=label` drops the filter outright. (Contrast `accounts/page.tsx:145`, which does preserve `status`.) The first draft's C20 Consumer-1 walkthrough claimed the events page "requires no page change beyond URL-encoding" — that was true before `?source=` existed and is false now.

Resolution: **bind the filter into the cursor** (`s`) and reject a mismatch with 400, rather than relying on the UI to preserve the param. Both fixes are needed anyway — C25 must also add `source` to the Load-more href (below) — but binding makes the API correct regardless of what any consumer does, which is the property that survives a future caller who forgets. The `s` field participates in `decodeCursor`'s totality check: present and either `null` or a string ≤64 chars.

This mirrors I23.6 for the accounts list, which C23 states as an invariant *and* proves with a 60-row integration criterion; C20 now has both for its own filter×cursor pair.

Schema change at `events.ts:8` — the `.uuid()` validator is replaced, and the value validation it used to provide moves into a total decoder:

```ts
const eventsQuerySchema = z
  .object({
    cursor: z.string().max(512).optional(),   // 512, not 256 — see the round-4 note
    source: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/).optional(),
  })
  .strict();

type EventCursor = { t: string; id: string; s: string | null };
// Total: returns null for anything that is not a well-formed cursor.
// Never throws, so a hostile cursor cannot produce a 500 (I20.2).
function decodeCursor(raw: string): EventCursor | null;
```

> **Round-3 correction (FN-F1 Major, FN-F2 / SEC-F3).** Round 2 updated this contract's prose — the encoding, the totality rules, the binding semantics, and every acceptance criterion — but left this normative block at its round-1 state, and all three round-3 experts caught the divergence. Two concrete consequences for anyone implementing from the block, which is the block's whole purpose: (a) the schema is `.strict()` and had **no `source` key**, so the contract as literally written rejects every `?source=` request with 400 — making C20's own filter unreachable and its `?source=` criteria unsatisfiable; (b) `EventCursor` omitted `s`, so an implementer copying it ships the cursor **without** the round-2 filter binding, silently reinstating the defect that fix exists to close. Both are corrected above. Lesson recorded for Phase 2: when a round rewrites a contract's prose, the contract's fenced blocks are part of the contract and must be re-read, not assumed to still agree.

`decodeCursor` returns `null` unless **all** of: base64url decodes; the result parses as JSON; the value is an object with **exactly** the keys `t`, `id`, and `s`; `id` passes uuid validation; `t` parses as a valid date; `s` is `null` or a string ≤64 chars. The cap bounds decode work before any parsing runs. ("Exactly the keys" rather than "has the keys" is deliberate — it is what keeps the decoded value out of any merge sink.)

**The cap is 512, and `source` is constrained to a slug charset — the second half is what actually settles it (rounds 4–5, SEC-F2 then SEC-F1).**

This bound was derived twice from sampled inputs and was wrong both times. Round 3 measured ASCII only (196 chars) and called 256 settled. Round 4 found non-ASCII overflows it, measured five scripts, and called 512 settled on "the worst case (CJK at 367)". Round 5 found that was not the worst case either — measured:

```
ASCII      s=64  -> 196 chars   ok
CJK        s=64  -> 367 chars   ok at 512
C0 control s=64  -> 623 chars   REJECTED even at 512
slug-only  s=64  -> 196 chars   ok, permanently
```

C0 control characters JSON-escape to the six-character `\u00XX` form (only `\b \t \n \f \r` get two-character short forms), so 64 of them produce 384 payload characters against CJK's 192 UTF-8 bytes. The failure mode is the same each time: **the API mints a cursor and then 400s its own replay** — a self-inflicted denial on the pagination path.

The recurring defect is not the number; it is deriving a bound from a *sample* of the validator's domain rather than from the domain itself. So the fix constrains the domain: `source` is now `.regex(/^[a-z0-9_-]+$/)`. Every real `source` value is a slug (`google-workspace`, `matcher`, `label` — verified across all five `INSERT INTO discovery_events` sites), so this rejects nothing legitimate, makes the encoded cursor trivially ASCII-bounded at 196 against 512 forever, and independently narrows SC30's `source`-collision surface. The 512 cap stays as defense in depth.

Still unreachable today regardless (`key` is pinned by `z.literal('google-workspace')`); SC30 is what would make it reachable, and SC30 already carries the related collision constraint.

**The SQL comparison predicate is part of the contract (round-2 SEC-F2, Major).** The draft locked the encoding, the validation, the ordering, and the index — but never the WHERE clause that consumes the decoded cursor, which is where the defect lands. Required form, a **row-wise comparison** so it stays a single term:

```sql
(created_at, id) < ($n, $m)
```

Not the expanded disjunction. The reason is mechanical: `apps/api/src/routes/events.ts:60-64` accumulates predicates into `conditions: string[]` and emits `conditions.join(' AND ')`. Pushing the naive expansion `created_at < $n OR (created_at = $n AND id < $m)` into that array yields

```sql
WHERE tenant_id = $1 AND created_at < $n OR (created_at = $n AND id < $m)
```

— `AND` binds tighter than `OR`, so the second disjunct is **unqualified by tenant**. RLS still blocks the rows, so this is not an exploitable leak in this codebase; it is a one-token defect in a security-sensitive builder whose only remaining guard would be RLS, in the very contract whose round-1 Critical was about this same cursor. The row-wise form has no `OR` and therefore cannot be mis-joined. If the expanded form is used for index-plan reasons, it MUST be parenthesized as a single term.

**Enforcement — an executed test, not a regex (round-3 SEC-F1, Major).**

> Round 2 added the forbidden pattern `conditions\.push\([^)]*\bOR\b(?![^)]*\))`. The round-3 security expert reported it is **unsatisfiable**, and a direct test confirms it is worse than that — it matches **nothing at all**:
>
> ```
> [proposed] [reviewer's fix]
>   miss        miss     conditions.push(`created_at < $${n} OR (created_at = $${n} AND id < $${m})`)   <- THE defect
>   miss        MATCH    conditions.push(`a < $1 OR b = $2`)
>   miss        miss     conditions.push(`(created_at, id) < ($1, $2)`)                                 <- safe
>   miss        miss     conditions.push(`(a < $1 OR b = $2)`)                                          <- safe
> ```
>
> The negative lookahead can never hold inside a call that closes with `)`. And the reviewer's own proposed replacement, while an improvement, still misses the naive expansion — the real predicate contains `$${n}` and inner parens, so any `[^)]*`-based scan stops early. **Regex is the wrong tool for this shape**, and a guard that reads as protection while matching nothing is worse than no guard: it invites exactly the false confidence that let three grep-based claims fail earlier in this review.

Replaced with an **executed source test**, following the repo's own precedent for turning a grep into a gate (`apps/api/test/no-rotation-route.test.ts:12-23`, and the same treatment I19.4 already received): read `apps/api/src/routes/events.ts` as text, extract each `conditions.push(...)` argument, and assert that any argument containing ` OR ` is fully parenthesized as a single term. Red-proof (RT7): rewrite the cursor predicate as the bare disjunction and confirm the test fails.

The contractual predicate itself is unchanged and remains the primary control — the row-wise `(created_at, id) < ($n, $m)` form contains no `OR` and therefore cannot be mis-joined at all. This test guards against a future edit reintroducing the disjunction.

**Superseded — assert on the built clause, not on source text (round-4 SEC-F1 + TEST-F3, Major).**

The source-scanning test was measured, not assumed, and it fails the same way its regex predecessor did. Two independent executions agreed:

```
CAUGHT  naive expansion (THE defect)      silent  row-wise (safe)
CAUGHT  bare OR                           silent  parenthesized OR (safe)
silent  hoisted variable  <-- MISSED      silent  helper call      <-- MISSED
silent  array spread      <-- MISSED      silent  index assignment <-- MISSED
```

It catches the literal reintroduction and stays correctly quiet on safe forms — strictly better than the regex, which matched nothing at all. But hoisting the predicate into a variable or a helper is an ordinary refactor, and after it the guard goes silent while the defect stays reachable. The security expert put the root cause exactly: **moving from regex to an executed test changed the mechanism but not the coupling** — both bind to the syntax of one authoring idiom rather than to the property being protected. This was the third such guard in this review; a fourth brittle source scan is not worth writing.

**Replacement — assert the property, at the layer where it exists.** The invariant is about the *built* WHERE clause, so test that: extract `conditions.join(' AND ')` (a pure string the route already computes) and assert it contains no ` OR ` at paren depth zero. Verified across all four clause shapes:

```
CAUGHT  tenant_id = $1 AND created_at < $2 OR (created_at = $2 AND id < $3)     <- the defect
clean   tenant_id = $1 AND (created_at, id) < ($2, $3)                          <- row-wise
clean   tenant_id = $1 AND (created_at < $2 OR (created_at = $2 AND id < $3))   <- parenthesized
clean   tenant_id = $1 AND source = $2 AND (created_at, id) < ($3, $4)          <- with filter
```

This is authoring-independent by construction: a hoisted variable, a helper, or a spread all produce the same clause, so all three blind spots close. It requires the predicate-building step to be callable from a test — extracting it from the handler into an exported `buildEventsWhere(...)` in `events.ts`, which is a small refactor the route benefits from anyway. Red-proof (RT7): swap the row-wise form for the bare disjunction and confirm the test fails.

The contractual predicate remains the primary control regardless — the row-wise form contains no `OR` and cannot be mis-joined at all — and RLS blocks the actual leak. This test is the second layer, and it now guards the property rather than a spelling of it.

**Malformed vs. out-of-range — the two cases must behave differently (round-1 SEC-F8):**
- **Malformed** (`decodeCursor` returns `null`) → **400** `{error: 'invalid_query'}`.
- **Well-formed but pointing at nothing this tenant can see** (including a cursor minted in another tenant) → **200 with an empty page**, never 400. A well-formed foreign cursor must be indistinguishable from a well-formed exhausted one; a 400 there would confirm to an attacker that the cursor is syntactically theirs but not semantically, which is a cross-tenant probing oracle. RLS already makes the rows invisible — the response must not leak what RLS hid.
- Note `''` (empty string) is falsy and today short-circuits the cursor predicate at `events.ts:63`, silently returning page one. Under the new schema `''` is still optional-and-falsy, so it continues to mean "no cursor". That is deliberate and must be asserted, not left to chance.

**Invariants**
- **I20.1 (app-enforced)**: the cursor encodes `(created_at, id)`. A bare-uuid cursor cannot express a stable position in a `created_at`-ordered set when timestamps tie.
- **I20.2 (app-enforced)**: cursor parsing is total — a malformed or attacker-supplied cursor returns 400, never a 500 and never an unfiltered full-table read. (RS3: validate at the boundary.)
- **I20.3**: ordering is DESC (newest first). An audit trail read oldest-first buries the most recent action behind every historical one.

**Forbidden patterns**
- `pattern: ORDER BY id\b` in `apps/api/src/routes/events.ts` — reason: replaced by `(created_at DESC, id DESC)`; the old ordering is the defect.

**Acceptance criteria** (rewritten — round-1 TEST-F2 showed the draft's version was neither constructible nor falsifiable)

> The draft asked for "three events with controlled `created_at`" plus a tie "across a cursor boundary". Two problems. (a) `created_at` defaults to `now()`, which is `transaction_timestamp()` — constant *within* a transaction but distinct across transactions, so a tie cannot simply be "seeded deliberately"; it must be written with an explicit literal (or produced by C23's bulk path, which writes all its audit rows in one transaction and therefore *does* tie). (b) A cursor boundary requires ≥51 rows, since `nextCursor` is emitted only when `hasMore` (`events.ts:82-85`) at `PAGE_SIZE = 50` — with three events the cursor is always `null` and the boundary property is never exercised. Both halves are constructible at the integration tier, where each test seeds its own `randomUUID` tenant and inserts `discovery_events` by direct SQL (`api.integration.test.ts:450-462` already does this).

- **Ordering**: three events inserted with explicit distinct `created_at` literals return newest-first — asserted on the exact id sequence, not merely on the count.
- **Tie-break within a page**: three rows inserted in one transaction with an explicit *shared* `created_at` return in strict `id DESC` order among the tied set. Asserted on the id sequence.
- **Tie-break across a cursor boundary**: 51+ rows inserted via `generate_series` with a controlled `created_at` sequence arranged so a tie straddles positions 50/51. Fetch page 1, follow `nextCursor`, then assert **both**:
  - `new Set([...page1Ids, ...page2Ids]).size === 51` — no duplicate and no omission;
  - the concatenated `[...page1Ids, ...page2Ids]` is in non-increasing `(created_at, id)` order (round-2 TEST-F5). Set-equality alone cannot see an inverted tie-break at the seam: a predicate comparing `id >` instead of `id <` within the tied group still yields 51 distinct ids while returning the tied members in the wrong relative order. The within-a-page case already asserts on the id sequence; the boundary case must too, since ordering across the seam is the property the case is named for.
- **Cursor round-trip (happy path — absent from the draft entirely)**: page 1's `nextCursor` fed back as `?cursor=` returns page 2 with no overlap and no gap. This is the criterion that would have caught FN-F1 (the `.uuid()` schema making every second page 400).
- **Malformed cursor** → 400: `'not-a-cursor'`, a valid base64url of non-JSON, a JSON object missing `id`, a JSON object whose `id` is not a uuid, **a JSON object missing `s`**, and **a JSON object carrying an extra key** beyond `{t, id, s}` (round-3 FN-F4). The last two matter specifically: `s` is what makes the round-2 binding real, and the first four cases are all passed by a decoder that ignores `s` entirely. The binding criterion below tests a *mismatch* between a well-formed bound cursor and the request — not a *structurally absent* `s` — so without these two cases the "exactly the keys" totality rule (the stated defense against a merge sink) has no proof obligation.
- **Empty cursor** (`''`) → page one, not an error (it is falsy and short-circuits the predicate; asserted so the behavior is pinned rather than incidental).
- **Well-formed foreign cursor** → 200 with an empty page, **not** 400 — indistinguishable from a well-formed exhausted cursor (SEC-F8).
- **`?source=` filter**: with both a `label`-sourced and a `google-workspace`-sourced event present, `?source=label` returns only the former; `?source=nonexistent` returns an empty page with 200.
- **Filter×cursor binding (round-2 FN-F1)**: a cursor minted under `?source=label` and replayed **without** `source` (or with a different `source`) returns **400**, not a silently-unfiltered page. Constructed with >50 `label` events plus interleaved `google-workspace` events so the mismatch would actually skip rows if unbound — a fixture with too few rows makes this pass vacuously, since `nextCursor` is only emitted when `hasMore`.
- **Filter×cursor happy path**: paging through a filtered set with the cursor replayed under the *same* `source` returns the filtered remainder with no gap and no duplicate — asserted by set equality over the union, the same shape as the tie-break criterion.
- `EXPLAIN` shows the new index used for the tenant-scoped ordered scan. *(Evidence recorded in the manual-test doc; not asserted in CI — query-plan stability is not worth pinning.)*

**Consumer-flow walkthrough**
- **Consumer 1 — events page** (`apps/web/src/app/events/page.tsx`): reads `{items, nextCursor}` and passes `nextCursor` back verbatim in `?cursor=`. It treats the cursor as **opaque** — no parsing, comparison, or construction — and `encodeURIComponent` is already applied at `:73`, so the composite encoding itself needs no page change.

  **But the page DOES change (round-2 FN-F1).** Its Load-more href is `` href={`/events?cursor=${encodeURIComponent(nextCursor)}`} `` (`:73`) — it carries no other params, so `?source=` is dropped on page 2. The page must (a) read `searchParams.source`, (b) forward it to the API alongside the cursor in `fetchEvents` (`:7-11` currently builds a `URLSearchParams` with only `cursor`), and (c) preserve it in the Load-more href. The first draft asserted this consumer needed no change beyond URL-encoding, which was true only before `?source=` was added in the same round. C25 lists the corresponding `events/page.tsx` edits.
- **Consumer 2 — E2E `events.spec.ts`**: asserts on rendered rows; does not construct cursors.

**Migration note (R24)**: this migration is purely additive (`CREATE INDEX`) — no column addition, no constraint tightening, no backfill. The additive/strict split R24 requires does not apply.

---

### C21 — Kind-aware payload projection

**Signature**
```ts
// apps/api/src/routes/events.ts
function projectPayload(kind: string, payload: unknown): ProjectedPayload;
```

**The widened wire type — locked (round-1 FN-F2, Major).** The first draft said the type "MUST widen to a discriminated shape" without saying what the shape is, which is not a contract. Three concrete obstacles the draft left to the implementer, each of which forces a different resolution:

1. `DiscoveryEventListItem.kind` is `kind: string` (`packages/api-types/src/index.ts:49`), not a union — **a discriminated union keyed on `string` does not narrow in TypeScript**.
2. Narrowing `kind` to a closed union makes every producer a member of that class. The producers are raw SQL literals with no type linkage: `sync_completed` / `sync_raw` / `sync_failed` (`apps/worker/src/sync.ts:151,158,179`) and `match_completed` (`apps/worker/src/match.ts:126`).
3. If `payload` becomes a union, `event.payload.counts` at `apps/web/src/app/events/page.tsx:54` — an existing, untouched line — stops compiling, failing the `pnpm typecheck` gate.

Resolution: **do not narrow `kind`, and keep `payload` a single open shape with all fields optional.** A union would buy narrowing the events page does not need (it renders per-column, not per-variant) at the cost of items 2 and 3.

```ts
export type DiscoveryEventPayload = {
  counts?: object;
  runId?: string;
  actorUserId?: string;
  saasAccountId?: string;
  before?: { kind: AccountLabelKind; note: string | null } | null;
  after?: { kind: AccountLabelKind; note: string | null } | null;
};

export type DiscoveryEventListItem = {
  id: string;
  source: string;
  kind: string;            // deliberately NOT narrowed — see obstacle 2
  payload: DiscoveryEventPayload;
  createdAt: string;
};
```

`counts` stays optional, so `events/page.tsx:54`'s existing truthiness check (`event.payload.counts ? … : '—'`) compiles unchanged. `DiscoveryEventPayload` is a new exported name and must be added to the explicit re-export list at `apps/web/src/lib/api-types.ts:6-22` (finding G — that list is not `export *`).

Trade-off stated plainly: this shape permits `{actorUserId}` on a `sync_completed` event at the type level. The type is not the guard — `projectPayload`'s allowlist is, and it is tested per-kind (acceptance criteria below). Buying type-level exclusivity would cost a narrowed `kind` union that four raw-SQL producers have no way to satisfy.

Allowlist:

| kind | projected fields |
|---|---|
| `sync_completed`, `match_completed`, `sync_failed` | `counts`, `runId` (unchanged from today) |
| `sync_raw` | `counts`, `runId` (unchanged — this is the S5-critical case) |
| `label_set`, `label_cleared` | `actorUserId`, `saasAccountId`, `before`, `after` |
| *anything else* | `counts`, `runId` — the **existing** restrictive default |

**Invariants**
- **I21.1 (app-enforced, S5)**: an unknown `kind` falls through to the restrictive default, never to passthrough. Fail-closed: a future event kind that nobody added to the allowlist leaks nothing.
- **I21.2 (app-enforced)**: `sync_raw`'s projection is byte-identical in behavior to today's. This is the whole point of S5 and the one case where a regression is a privacy incident.
- **I21.3 (app-enforced)**: projection never mutates its input.

**Forbidden patterns**
- `pattern: payload: (row\.payload|payload)([,;\s}]|$)` in `apps/api/src/routes/events.ts` — reason: the unprojected payload must never reach the serializer (this is the original S5 forbidden pattern, preserved verbatim from C6).
- `pattern: default:\s*return payload` — reason: I21.1, the default must be restrictive.

**Acceptance criteria**

> **Round-1 correction (SEC-F1, Critical).** The plan originally designated the existing test at `api.integration.test.ts:441` as C21's S5 regression guard and instructed the implementer not to modify it. That test inserts **`kind: 'sync_completed'`** (`:451`), not `sync_raw`. Under today's kind-blind projection the distinction is irrelevant — one shape covers every kind — but C21 is precisely the change that makes kind load-bearing, so the designated guard would exercise only the `sync_completed` branch while `sync_raw` (the only kind that ever carries provider PII — sole writer `apps/worker/src/sync.ts:158`) went untested. The guard was vacuous for the one kind it was named to protect, and the "do not modify" instruction locked the gap in. Criteria below are rewritten accordingly.

- **NEW test, `sync_raw` specifically — fixture must match the real producer (round-2 FN-F5 / SEC-F4).** The first rewrite specified `{rawAccounts: […], counts, runId}`, a shape no producer emits: `rawAccounts` was copied from the *existing* `sync_completed` test (`api.integration.test.ts:458`), which invents it as a synthetic secret. Verified against the sole `sync_raw` writer (`apps/worker/src/sync.ts:155-160`): the real payload is **`{runId, accounts: rawPayloads}`** — key `accounts`, and **no `counts` key at all**.

  The fixture must therefore be `{runId, accounts: [{email, phone, orgUnit}]}`, asserting the serialized body contains `runId` and **not** `accounts`, `phone`, `orgUnit`, or the raw email. The allowlist drops any non-allowlisted key regardless of name, so the wrong-key version would still have passed and still reddened — this is fidelity, not vacuity. But it matters: `accounts` is precisely the key an implementer might be tempted to let through for `sync_raw`, and a guard that never names it teaches the wrong production shape to whoever reads it next. The provider blob it stands in for is `RawAccount.raw` (`packages/connectors/core/src/index.ts:20`).
- **Existing test unchanged**: `api.integration.test.ts:443-471` (`kind: 'sync_completed'`) must continue to pass unmodified — it is the unchanged-behavior check for *that* branch, not the S5 guard.
- A `label_set` event serves all four audit fields.
- An event with `kind: 'some_future_kind'` and a payload containing `{secret: 'x', counts: {n:1}}` serves `{counts:{n:1}}` and not `secret`.
- Red-proof (RT7), **two separate proofs required**: (a) making the `sync_raw` branch permissive must turn the new `sync_raw` test red — this is the proof that matters, and asserting it against the default branch instead would repeat the original defect; (b) flipping the default branch to passthrough must turn the unknown-kind test red.

**Consumer-flow walkthrough**
- **Consumer 1 — `DiscoveryEventListItem`** (`packages/api-types/src/index.ts:46-52`): today declares `payload: { counts?: object; runId?: string }`. This is a **strict-consumer mismatch (R40)**: the web page is typed against it, so audit fields would be invisible to TypeScript even though the server sends them. The type MUST widen to a discriminated shape covering both variants, and `apps/web/src/lib/api-types.ts:6-22` must re-export any new name (finding G). Round-trip obligation: one test feeds actual server output through the actual consumer type.
- **Consumer 2 — events page** (`:55`): reads `payload.counts` behind a truthiness check today, so it degrades gracefully for audit events; the audit column added in C19's walkthrough reads `payload.before/after` behind the same kind discriminant.

---

### C22 — SaaS app management API

**Signature**
```
PATCH /api/saas-apps/:saasAppId
  body: { displayName?: string(1..200), credentials?: Record<string,string> }   .strict()
  200 -> SaasAppListItem
  400 -> { error: 'invalid_params' | 'invalid_body' }
  404 -> { error: 'not_found' }
  rate limit: MUTATION_RATE_LIMIT

DELETE /api/saas-apps/:saasAppId
  204 -> (no body)
  400 -> { error: 'invalid_params' }
  404 -> { error: 'not_found' }
  409 -> { error: 'app_has_accounts', accountCount: number }
  rate limit: MUTATION_RATE_LIMIT
```

**Invariants**
- **I22.1 (app-enforced, NFR4)**: no response body, error message, or log line contains any part of `credentials`, `credentials_enc`, or a key. The 200 body is exactly `SaasAppListItem` — `{id, key, displayName}`, the same shape `GET` already returns. Existing precedent and test: `api.integration.test.ts:294` ("saas-apps credential non-leak").
- **I22.2 (app-enforced) — AAD corrected (round-1 SEC-F4, Major).** Credential replacement re-encrypts with a **fresh nonce** under the current key version. The AAD is **`{tenantId, saasAppId, keyVersion}`**, not `{tenantId, saasAppId}` as the first draft stated: `buildAad` (`packages/crypto/src/index.ts:67-78`) concatenates `tenantId`, `0x00`, `saasAppId`, `0x00`, and a 4-byte big-endian `keyVersion`. `CredentialContext` (`:7-10`) carries only the first two; `keyVersion` is threaded separately.

  The correction is load-bearing, not cosmetic. `encryptCredentials` always selects the max key version (`:85`), so a replacement performed after a key rollout lands on the **new** version — which means the PATCH must persist **`credentials_enc` AND `credentials_key_version` in the same UPDATE**, exactly as the create path does (`routes/saas-apps.ts:52-53`). Updating the ciphertext alone — a natural narrowing, since the draft framed replacement as "re-encrypt under the current key" and never mentioned the version column — pairs new-version ciphertext with a stale version number, and decryption then fails the GCM tag check for two compounding reasons (wrong key, wrong AAD). The app's credentials become permanently undecryptable, which the sync path surfaces only at the next run.
- **I22.2b (app-enforced)**: the write is a single `UPDATE` setting both columns. A two-statement form would leave a window where the row is internally inconsistent.
- **I22.3 (app-enforced)**: `PATCH` with neither field is a 400, not a silent no-op that returns 200.
- **I22.4 (app-enforced)**: `DELETE` counts referencing `saas_accounts` **inside the same transaction** as the delete. Counting outside the transaction is a TOCTOU (R5): a sync completing between count and delete turns a "0 accounts, safe" decision into a `23503`.
- **I22.5 (app-enforced)**: the `23503` foreign-key error is still caught and mapped to 409 as a defense-in-depth backstop, narrowly scoped to `saas_accounts_saas_app_id_fkey` — mirroring the existing narrowly-scoped 23505 handling at `routes/saas-apps.ts:62-72`. I22.4 should make it unreachable; if it fires, the transaction guard has a hole.
- **I22.6 (structural, D)**: no file under `apps/api/src/routes/` contains `rotate`/`runRotationSweep`/`rotate-credentials` (case-insensitive). Credential *replacement* (new plaintext from an operator) is a distinct operation from key *rotation* (re-encrypting existing plaintext under a new key), and the naming must not blur them. Enforced by the existing test `apps/api/test/no-rotation-route.test.ts:12`.
- **I22.7 (known limitation, documented not fixed — round-1 FN-F6)**: deleting an app while a sync job for it is queued or in flight makes that job fail **without a `sync_failed` audit event**. Verified: `apps/worker/src/sync.ts:92` assigns `appKey` *after* `loadSaasApp(tx, job.saasAppId)` returns, so a deleted app makes the load throw first, leaving `appKey === null`; the failure-path handler at `:174` is guarded by `if (appKey !== null)` and therefore writes nothing. No rows are orphaned and nothing is corrupted — the job simply fails silently from the operator's view.

  In practice the window is narrow, because C22 only permits deleting **zero-account** apps: it requires a freshly-registered app whose first sync is still in flight. Not fixed here (it is a worker-side audit gap, not a C22 defect, and fixing it means resolving `appKey` from the job payload before the load — a change to sync's failure semantics that belongs with the worker, not with an app-management contract). **C26 obligation**: `apps.spec.ts` must not interleave sync and delete for the same app, or E2E debugging will chase a job failure with no trace. Recorded as SC31.

**Forbidden patterns**
- `pattern: (?i)rotate` in `apps/api/src/routes/**` — reason: I22.6, enforced by an existing test.
- `pattern: credentials_enc` appearing in any `reply.send` argument — reason: I22.1.
- `pattern: DELETE FROM saas_accounts` — reason: the user-confirmed design refuses non-empty deletes; cascading account deletion is explicitly not implemented.

**Acceptance criteria**
- `PATCH {displayName}` renames without touching `credentials_enc` — asserted by reading the ciphertext bytes before and after and confirming they are **identical** (a rename must not re-encrypt).
- `PATCH {credentials}` changes `credentials_enc` while `key` and `id` are unchanged, and — the assertion that actually proves correctness — **both `credentials_enc` and `credentials_key_version` are re-read from the row**, and the blob decrypts to the submitted plaintext using **the version read back from the row** (not the version the test just encrypted with). Written the draft's way ("decrypts under AAD `{tenantId, saasAppId}`"), a test author passes the version they encrypted with and the assertion passes against a row carrying a stale `credentials_key_version` — the exact corruption I22.2 exists to prevent (round-1 SEC-F4).
- **Multi-version case — requires a harness change, or it is vacuous (round-2 TEST-F2, Major).** With a key map containing versions 1 **and** 2 and the stored row on version 1, a `PATCH {credentials}` must leave the row on version **2** and still decrypt. This is the proof SEC-F4 added as the one thing that fails when `credentials_key_version` is not written — but as first specified it could not do that job. Measured: `api.integration.test.ts:115` hard-codes `encryptionKeys: new Map([[1, Buffer.alloc(32, 7)]])` inside `beforeEach`, and `buildApp` is called exactly once in the whole file (grep: 1 occurrence). Since `encryptCredentials` selects `Math.max(...keys.keys())` (`packages/crypto/src/index.ts:85`), a one-entry map makes every PATCH land on version 1 and the criterion degenerates to "1 stays 1" — passing identically whether or not the implementation writes the version column.

  **C26 obligation**: this case must build a second app instance with `buildApp({...deps, encryptionKeys: new Map([[1, k1], [2, k2]])})`, `await` its `ready()`, and close it — a per-test deps override the harness does not currently support. In-repo precedent for a multi-version map: `apps/worker/test/rotation.integration.test.ts:22-25`. Without this the criterion ships green and proves nothing.
- `PATCH {}` → 400.
- `DELETE` on an app with zero accounts → 204, row gone.
- `DELETE` on the seeded `google-workspace` app (4 accounts) → 409 with `accountCount: 4`, and — RT8 — `saas_apps`, `saas_accounts`, `account_links`, and `account_labels` row counts are all **unchanged** afterwards.
- `PATCH`/`DELETE` on another tenant's `saasAppId` → 404 (RLS makes the row invisible; the handler must not distinguish "wrong tenant" from "absent").
- **I22.5's `23503` backstop needs its own obligation (round-3 TEST-F2, Minor).** The 409 criterion above is satisfied by I22.4's count-inside-the-transaction path alone, so an implementer who omits the error-mapping catch block entirely passes every other stated criterion — the same declared-but-unexercised shape as round-2's `accountsTruncated` and round-1's I23.6. The reviewer correctly rejected the obvious test on constructibility (RT2): forcing a real `23503` means winning the very TOCTOU race I22.4 closes, which is not deterministically reproducible at the integration tier. **Discharge**: a source-level assertion that the narrowly-scoped catch exists — constraint name **`saas_accounts_saas_app_id_fkey`**, rethrowing otherwise — following `no-rotation-route.test.ts`'s precedent, the same discharge C20's `OR` guard and I19.4 now use. Marginal value for a defense-in-depth backstop, but it costs a few lines and closes the last invariant in the plan with no proof obligation.

> **Round-4 correction (TEST-F1, Major).** This discharge originally named `saas_apps_saas_app_id_fkey`, which **does not exist**. Postgres names a foreign key after the *referencing* table, so the constraint on `saas_accounts.saas_app_id` (`0001_init.sql:44`) is `saas_accounts_saas_app_id_fkey`. Re-measured against the live database: `SELECT conname FROM pg_constraint WHERE contype='f' AND confrelid='saas_apps'::regclass` returns exactly one row, `saas_accounts_saas_app_id_fkey`. The plan states the correct name at line 83 and in I22.5 above; only this round-3 discharge had it wrong.
>
> The consequence is worse than a typo, because the discharge is a **source-matching** test: it would have been red against a correct implementation, and an implementer who instead wrote the handler to match the plan's string would ship a catch that can never fire. That is an inverted-polarity guard — the third time this review has produced a guard that reads as protection while providing none (the two dead regexes were the others). Same corrective as before: the assertion must be red-proven by deleting the catch block, which is what would have surfaced the wrong name immediately.
- Both routes appear in `app.apiRoutes` with `hasRateLimit: true`, and are picked up by the existing 401 and 403 sweeps (`api.integration.test.ts:132,151`) automatically.

**Consumer-flow walkthrough**
- **Consumer 1 — `SaasAppManager` component** (`apps/web/src/components/SaasAppManager.tsx`, C25): reads the 200 body `{id, key, displayName}` to update the row after a rename, calls `router.refresh()` on success (matching `SaasAppForm.tsx:88`). On 409 it reads `{error, accountCount}` and renders "Cannot delete — N accounts are still attributed to this app." — `accountCount` is *required* for that message, which is why it is in the contract rather than a bare `{error}`.
- **Consumer 2 — apps page** (`apps/web/src/app/apps/page.tsx`): unchanged data flow; it already fetches `GET /api/saas-apps` and re-renders on `router.refresh()`.
- **Consumer 3 — E2E `apps.spec.ts`** (C26): **cannot** register a throwaway app — see the SC17 correction below (`UNIQUE (tenant_id, key)` + the `google-workspace` key literal mean the demo tenant holds exactly one app, the seeded one). The E2E spec is scoped to what is reachable: rename the seeded app and restore its name in `afterEach`, and assert the delete attempt on it yields the 409 message with its account count. The full create→delete→re-create cycle is verified at the integration tier instead (C26).

---

### C23 — Label filtering and bulk labeling

**Signature**
```
GET /api/accounts
  query: { status?, app?, cursor?, label? }   .strict()
  label: 'known_shared' | 'service_account' | 'external_collaborator' | 'none' | 'any'

POST /api/accounts/labels/bulk
  body: { accountIds: string[](1..100, uuid, unique), kind: AccountLabelKind, note?: string(1..500) }  .strict()
  200 -> { updated: number }
  400 -> { error: 'invalid_body' }
  404 -> { error: 'not_found', missing: string[] }
  rate limit: MUTATION_RATE_LIMIT
```

**Invariants**
- **I23.1 (app-enforced)**: `label=none` means "no `account_labels` row" (`lbl.kind IS NULL` against the existing `LEFT JOIN` at `routes/accounts.ts:131`); `label=any` means any row exists. Both are expressed as SQL predicates on the already-joined table — no second query, no N+1.
- **I23.2 (app-enforced, R5)**: bulk labeling is one transaction: verify every `accountIds` member exists in this tenant, then upsert all. A partially applied bulk operation with a partial audit trail is the failure mode this closes.
- **I23.3 (app-enforced)**: all-or-nothing. If any id is missing (or belongs to another tenant — indistinguishable under RLS, by design), the response is 404 listing the missing ids and **zero** labels are written.
- **I23.4 (app-enforced, R4/C19)**: bulk labeling emits **one audit event per account**, not one per request. An operator suppressing 50 accounts in one click must leave 50 traces; a single "bulk" record would let the per-account before-state vanish. All emissions share the transaction (I19.1).
- **I23.5 (app-enforced)**: `accountIds` is capped at 100 and deduplicated at the schema level. Uncapped, this is an unbounded-work endpoint behind a 60/min limit.
- **I23.7 (app-enforced) — set-based SQL, not per-id statements (round-1 FN-F9).** The existence check, the label upsert, and the audit inserts are each **one statement over the whole array** (`= ANY($1::uuid[])` for the check; `INSERT … SELECT … FROM unnest($1::uuid[])` for the writes). A per-id loop inside the transaction would issue up to ~300 statements per request, and at `MUTATION_RATE_LIMIT` (60/min, `apps/api/src/rate-limits.ts:5`) that is ~18,000 statements/minute from a single caller. The draft's forbidden pattern blocked per-id *transactions* but permitted per-id *statements*, so the cap alone did not bound the work. Set-based SQL also makes I23.2's atomicity trivially true rather than something the loop has to preserve.
- **I23.6 (app-enforced)**: pagination interacts correctly with filtering — `nextCursor` is derived from the filtered result set, not the unfiltered one.

  **The accounts cursor is deliberately NOT filter-bound, unlike C20's (round-3 FN-F3).** C20 binds `source` into its cursor and 400s on mismatch, on the stated grounds that it "makes the API correct regardless of what any consumer does". That argument applies verbatim here, so the asymmetry needs a reason rather than silence. The reason: the events cursor was being rebuilt from scratch this cycle anyway (a bare uuid → a composite), so binding cost one field; the accounts cursor is an untouched `sa.id >` keyset (`accounts.ts:99-102`) carrying **three** filters (`status`, `app`, and the new `label`), and binding all three means redesigning a cursor this plan otherwise does not change — a larger blast radius than the defect warrants. The exposure is bounded differently too: `accounts/page.tsx:145` already preserves `status`, and C25 adds `label` to the same href, so the UI cannot drop a filter mid-pagination. A direct API caller who replays a cursor under different filters gets a correctly-paged *different* query rather than silently missing rows, because the accounts cursor is a plain id keyset with no ordering tied to the filtered set. Recorded as a decision; revisit if the accounts cursor is ever rebuilt.

**Forbidden patterns**
- `pattern: for (const .*accountIds.*)[\s\S]{0,200}withTenant` — reason: I23.2, per-id transactions defeat atomicity.
- `pattern: label = '\$\{` or any interpolation into the label predicate — reason: parameterized queries only (the existing route builds `$n` placeholders at `routes/accounts.ts:88-105`; follow it).

**Acceptance criteria**
- `?label=none` on the seeded tenant returns all 4 accounts (measured: `account_labels` has 0 rows).
- After labeling one account, `?label=none` returns 3 and `?label=any` returns 1.
- `?label=known_shared` returns only accounts with that kind.
- `?label=bogus` → 400 (`.strict()` + enum).
- `?status=orphan&label=none` composes both predicates (the existing status filter must keep working — regression risk on a shared query builder).
- Bulk with 3 valid ids → `{updated: 3}`, 3 label rows, **3** audit events.
- Bulk with 2 valid + 1 unknown uuid → 404, `missing` names the unknown one, and **0** label rows and **0** audit events were written (RT8).
- Bulk with 101 ids → 400 before any DB access.
- Bulk with a duplicated id → 400 (uniqueness at the schema level, so the "updated" count can never disagree with the input length).
- **I23.6 proof — filter × pagination, integration tier (round-1 TEST-F7).** The draft declared I23.6 as an invariant and gave it **no acceptance criterion at all**, which is the shape of an invariant that ships unimplemented. It is not testable at the E2E tier — 4 seeded accounts against `PAGE_SIZE = 50` means `hasMore` is never true and `nextCursor` is always `null` — but it is straightforward at the integration tier, where each test seeds its own tenant: insert 60 `saas_accounts` via `generate_series`, label a known subset, then assert `?label=none` returns exactly `PAGE_SIZE` items and that following `nextCursor` yields the remainder **with no unlabeled account missing and no labeled account present**. That last clause is what falsifies "cursor derived from the unfiltered ordering" — an unfiltered cursor skips ahead by the filtered-out rows and drops results silently.

**Consumer-flow walkthrough**
- **Consumer 1 — accounts page** (`apps/web/src/app/accounts/page.tsx`, C25): reads `searchParams.label`, passes it through to `GET /api/accounts`, and renders a filter control whose links preserve the existing `status` param. It reads `{items, nextCursor}` exactly as today; the shape is unchanged.
- **Consumer 2 — `BulkLabelBar` component** (C25): reads the selected `accountId`s from client state and posts them; on 200 reads `{updated}` for the confirmation message and calls `router.refresh()`; on 404 reads `{missing}` to tell the operator which rows went stale (the realistic cause is a concurrent re-sync, and "3 of your selections no longer exist" is actionable where a bare 404 is not).
- **Consumer 3 — `assert-seed-preserved.sh`** (`e2e/scripts/assert-seed-preserved.sh:54-60`): asserts the orphan account's `.label` is literal `null`. Any E2E spec exercising bulk labeling MUST clear its labels in teardown, or this gate fails (NFR5). This is a real constraint on C26, not a note.

---

### C24 — Note newline handling (SC-CR1 closure)

**Signature**
```ts
// apps/api/src/routes/account-labels.ts + the C23 bulk schema
// .optional() is PRESERVED — see the round-4 note below.
note: z.string().min(1).max(500).regex(/^[^\r\n]*$/, ...).optional()

// apps/web/src/lib/csv-export.ts — CHANGED (I24.2, round 4).
// csvField gains a newline strip between neutralize and quote:
function csvField(value: string): string {
  return quoteCsvCell(stripNewlines(neutralizeCell(value)));
}
function stripNewlines(value: string): string {
  return value.replace(/[\r\n]/g, ' ');
}
```

> **Round-5 correction (FN-F1).** These two lines previously read "UNCHANGED. No edit to this file." — round 4 rewrote I24.2 to require the export-side strip but fixed only the `.optional()` half of this block, leaving its other half asserting the opposite of the prose twelve lines below. The two halves of C24 were mutually unsatisfiable: every downstream criterion (the three-column strip criterion, I24.3's composition assertion, the re-measured four-case pin) assumes the edit happened. **Third recurrence of the same defect class** — a fenced block left at an earlier round's state while its prose moved on — in the contract that round 4 changed most.
>
> **Ordering is load-bearing and non-obvious**: the strip must run *after* `neutralizeCell`. `"\rlead"` neutralizes to `"'\rlead"` (the `\r` is still in first position when `neutralizeCell` inspects it), then strips to `"' lead"`. Reversing the two silently disables `\r` neutralization, because a stripped `\r` is no longer a dangerous first character — the CSV-injection defense would degrade with no test failing unless the pin's third row is present.

**Measured behavior of the current exporter (round-1 FN-F7 + TEST-F6, both correct that the original criterion was unfalsifiable — but both were wrong about what today's code does).**

The first draft specified a `quoteCsvCell` change with no stated defect and a red-proof that could not run. The functionality reviewer concluded the exporter is already correct and the real problem is the consumer's `split('\r\n')`; the testing reviewer asserted today's code yields 3 records for a newline note, so a record-count test would be red-then-green. **Neither is exactly right.** Probed against the real functions:

```
note "a\nb"    -> csv.split('\r\n').length === 2   (header + 1 record — NO defect)
note "a\r\nb"  -> csv.split('\r\n').length === 3   (record split in two — THE defect)
note "\rlead"  -> csv.split('\r\n').length === 2   (neutralizeCell prepends ' — no defect)
```

So the defect is **narrow and specific**: only a `\r\n` *pair* inside a note breaks the one-record-per-line contract. A bare `\n` is harmless because the exporter joins with `\r\n` and nothing splits on `\n` alone; a leading bare `\r` is harmless because `\r` is in `DANGEROUS_FIRST_CHARS` (`csv-export.ts:6`) so `neutralizeCell` prepends `'` and it is no longer in first position. This is why the original "red-proof by reverting the quoteCsvCell change" was impossible — there is no correct `quoteCsvCell` change to revert.

**Invariants (rewritten accordingly)**
- **I24.1 (app-enforced) — this is the fix.** The API rejects any `\r` or `\n` in `note` with 400. Applied to **both** write paths — `PUT …/label` and the C23 bulk endpoint (R42-C: the class is "every endpoint accepting a note"). Rejecting the whole class rather than only `\r\n` keeps the rule statable in one regex and leaves no "which newline is safe?" reasoning for a future reader.
- **I24.2 (app-enforced) — the exporter DOES change, because `note` was the wrong target (round-4 SEC-F3, [Adjacent], Major in effect).**

  The plan spent three rounds hardening the one field that was already the least exposed. Measured across the export's attacker-influenced columns:

  ```
  displayName    -> 3 records  <-- SPLIT
  matchedValue   -> 3 records  <-- SPLIT
  candidates     -> 3 records  <-- SPLIT
  note           -> 2 records  (guarded by I24.1)
  ```

  `note` is operator-authored, capped at 500, entered through a single-line `<input>` (`LabelControl.tsx:120-128`), and now newline-rejected at the API. The other three are **provider- and HR-supplied and stored verbatim**: `apps/worker/src/sync.ts:51-65` upserts `display_name` straight from the connector with no sanitization, and `apps/api/src/routes/hr-import.ts:197` does the same for identity display names; `matchedValue`/`candidates` derive from those. A hostile or merely sloppy Google Workspace directory entry — or an HR CSV cell containing a CRLF — splits the export today, with no API call required.

  So SC-CR1's stated goal, settling the input-vs-API asymmetry "as a whole", is **not met by I24.1 alone**. Boundary rejection is the right tool for `note` (operator-authored, a newline there is always a mistake) and the wrong tool for `displayName` (rejecting a sync because a provider record contains a control character would break ingestion over data the operator does not control).

  **The fix is therefore at the export boundary**: `csvField` strips `\r` and `\n` from every cell — replacing each with a space — after `neutralizeCell` and **before** `quoteCsvCell`, preserving I24.3's ordering invariant (quoting stays last). This makes the one-record-per-line contract structural rather than dependent on every upstream writer behaving. `note` keeps its API-level guard as defense in depth: a newline that never enters the database cannot be exported at all.

  The earlier "no source change to `quoteCsvCell`" wording is **superseded** — but note the change is to `csvField`, not to `quoteCsvCell`, so I24.3's "quoting is last" invariant is untouched.
- **I24.3 (RS6, escape ordering) — restated as the real invariant (round-1 SEC-F7).** The property is **not** "neutralizeCell prepends a single quote"; it is **"`quoteCsvCell` is the final transformation applied to any cell — nothing runs on its output."** Verified in the current code: `csvField` composes `quoteCsvCell(neutralizeCell(value))` (`csv-export.ts:20-22`), and the `candidates` path (`:52`) neutralizes early but is still re-run through `csvField` at `:69`, so quoting remains last on every path. Stated this way, the invariant survives edits the narrower phrasing would have permitted — e.g. adding a post-quoting newline-to-space replacement to satisfy a record-count goal would satisfy the old wording and break RS6.

**Forbidden patterns**
- `pattern: z\.string\(\)\.min\(1\)\.max\(500\)(?!\.regex)` — reason: I24.1. **Scope: `apps/api/src/routes/**` unconditionally** (round-1 FN-F5). The first draft scoped this to "label route files", but C23's bulk endpoint's schema does not live in `account-labels.ts`, so the guard covered one of the two members while claiming both.
- `pattern: quoteCsvCell\([^)]*\)\.replace` — **a review prompt only, NOT a mechanical guard (round-5 FN-F3).** Measured:

  ```
  missed  quoteCsvCell(neutralizeCell(value)).replace(/[\r\n]/g, ' ')   <- the REALISTIC form
  CAUGHT  quoteCsvCell(v).replace(/[\r\n]/g, ' ')
  missed  const q = quoteCsvCell(neutralizeCell(value)); return q.replace(…)
  ```

  `[^)]*` stops at the inner `)` of `neutralizeCell(value)`, so the form matching the actual call site is invisible — the identical failure the round-3 security expert diagnosed for C20's regex. **Sixth mechanical guard to fail this way**, and the timing is pointed: I24.2 names "adding a post-quoting newline-to-space replacement" as exactly the edit this guard exists to prevent, and C24 now asks an implementer to add a newline-to-space replacement to `csvField`.

  The property is already covered without it: the acceptance criterion below asserts `csvField` composes as `quoteCsvCell(strip(neutralizeCell(v)))` directly, which is authoring-independent — the plan's own established corrective (assert the property at the layer where it exists, not a spelling of it). The pattern stays as a cheap reviewer hint; it must not be described as making the invariant mechanical.

**Measured residual data (Anti-Deferral rule 6 — read-only measurement, count only)**
```
$ docker compose exec -T postgres psql -U opensmp -d opensmp \
    -c "SELECT count(*) FROM account_labels;"
 0
```
Zero stored labels, therefore zero stored notes, therefore **no backfill or migration is required** for existing data. (Measured 2026-07-25 against the live dev stack; CI and fresh installs start empty by construction.)

**Acceptance criteria**
- `PUT …/label` with `note: "a\r\nb"` → 400, and the label is **not** written (RT8: assert the `account_labels` row is absent, not merely the status).
- Same three assertions for `note: "a\nb"` and `note: "a\rb"` — the guard rejects the whole class, so all three must 400.
- Same for the C23 bulk endpoint, including that **zero** labels and **zero** audit events were written.
- `note: "a b"` (ordinary space) still succeeds — the guard must not over-reject. This is the case that fails if the regex is written too broadly.
- **A `PUT …/label` body with NO `note` at all still succeeds (round-4 FN-F1).** `note` is `.optional()` in the shipped schema (`account-labels.ts:19`), and the first draft of C24's signature block dropped `.optional()` while adding `.regex(...)`. An implementer copying that block — the block's purpose — would have made `note` **required**, a breaking change to a live endpoint that **no other criterion catches**, because every other C24 and C19 criterion supplies a note and `LabelControl.tsx:61` always sends one when non-empty. This criterion exists specifically to falsify that regression; it is red the moment `.optional()` is lost.
- **Export-side stripping, unit tier (round-4 SEC-F3) — the criterion that closes SC-CR1.** `buildAccountsCsv` on an item whose `displayName` is `"Ev\r\nil"` yields `csv.split('\r\n').length === 2`, and the cell reads `"Ev  il"` — **two** spaces, since `\r\n` is two characters and each is replaced individually (round-5: the draft said one space here while the pin table twelve lines below correctly annotated "two chars → two spaces"; an implementer writing the assertion from this line would have gone red against a correct implementation). Same assertion for `matchedValue` and for a `candidates` entry — the provider/HR-supplied columns stored verbatim (`sync.ts:51-65`, `hr-import.ts:197`), which is why they cannot be guarded at the API boundary the way `note` can.

  **Scope note (round-5 SEC):** the split is not confined to those three. Every cell splits pre-fix — `email`, `appName`, `ruleId`, `linkStatus`, `label.kind`, and `lastSyncedAt` included. The fix is per-cell inside `csvField`, so it covers all of them **and any column added later**; the three named above are simply the ones with a realistic hostile-input path today. Do not read the three-column framing as the fix's scope.

  **Red-proof (RT7)**: remove the strip from `csvField` and each assertion turns red at `length === 3`. A real red-proof over a real change, unlike the withdrawn `quoteCsvCell` one.
- **I24.3 after the change — the two ordering violations are NOT equally testable, and only one is worth a test (round-5 TEST-F1).**

  The draft said "assert `csvField` composes as `quoteCsvCell(strip(neutralizeCell(v)))`". That criterion **cannot be written**: `csvField` and `quoteCsvCell` are module-private (`csv-export.ts:15,20`); only `neutralizeCell` and `buildAccountsCsv` are exported. Measured what each violation actually does, through the public surface:

  ```
  A = quote(strip(neutralize(v)))   <- the contract
  B = strip(quote(neutralize(v)))   <- RS6 violation: strip AFTER quoting
  C = quote(neutralize(strip(v)))   <- strip BEFORE neutralizing

  A vs B: identical on every input tested  -> NOT behaviorally observable
  A vs C: differs on 4 of 10 inputs        -> observable, and it is a security regression
          "\rlead"  -> A: "' lead"   C: " lead"     (the ' prefix is gone)
          "\r=cmd"  -> A: "' =cmd"   C: " =cmd"     (formula neutralization LOST)
  ```

  **B is unobservable** because newline-stripping is invariant under quote-escaping — escaping only touches `"`, so stripping before or after produces identical bytes. No assertion over the current transformation set can distinguish it. The reviewer verified this independently and I reproduced it. B therefore has **no test**, and the honest statement is that I24.3's RS6 half is enforced by review, not by a gate — the forbidden pattern below misses the realistic form, so nothing mechanical covers it either. Recorded rather than papered over; it is a forward-looking invariant (its purpose is to catch *the next* post-quoting transformation), and its value does not depend on being testable today.

  **C is observable and is the dangerous one**, because it silently disables `neutralizeCell` for every `\r`-leading cell — including `"\r=cmd"`, which is a live CSV-injection vector (S4). **This is the criterion to write**, and it is constructible through `buildAccountsCsv` alone: a cell of `"\r=cmd"` must export as `"' =cmd"`, retaining the `'`. Red-proof (RT7): move the strip ahead of `neutralizeCell` and this turns red.

  So the discharge is: one real test for the observable, security-relevant ordering; an explicit acknowledgement that the other ordering is untestable with today's transformations; and no pretence that the forbidden pattern covers either.
- **Regression pin, unit tier** (I24.2's original four cases — now pinning `note`'s behavior specifically, since export-side stripping makes the split unreachable for every column):

  Measured **after** the I24.2 strip is in place (re-run, not carried over — the earlier table described the pre-fix exporter):

  | note | records | cell |
  |---|---|---|
  | `"a\r\nb"` | 2 | `"a  b"` (two chars → two spaces) |
  | `"a\nb"` | 2 | `"a b"` |
  | `"\rlead"` | 2 | `"' lead"` (neutralize prepends `'`, then the `\r` is stripped) |
  | `"a\rb"` | 2 | `"a b"` |

  All four now yield one record, which is the point: the strip makes the contract hold regardless of which character arrived. The pin's job changes accordingly — it no longer documents "which newline is dangerous" (none are, post-fix) but locks the **cell contents**, so a future edit that drops the strip, changes it to deletion instead of substitution, or removes `\r` from `DANGEROUS_FIRST_CHARS` (visible in the third row's `'` prefix) turns red. Note the pre-fix table this replaces reported `"a\r\nb"` → 3; that measurement was correct for the exporter as it stood and is what identified the defect.
- Red-proof (RT7): removing `.regex(...)` from either note schema makes the corresponding 400 test fail. **No red-proof is claimed for `quoteCsvCell`** — there is no change to it (see the measured behavior above); the unit test is a pin, and a pin's falsifiability is demonstrated by mutating the exporter (e.g. joining rows with `\n` instead of `\r\n`), not by reverting a change that does not exist.
- The existing `apps/web/test/csv-export.test.ts` cases continue to pass unmodified — **verified by execution, not by reading**: the round-5 functionality and testing reviewers each applied the `csvField` strip to the real file and ran the suite (20/20 green across 2 files), then reverted. Seven assertions there split on `\r\n` (`:70,99,106,111,118,131,144` — the draft counted six, missing `:144`), and none involves a cell containing a newline, which is why the strip is invisible to them.

**Consumer-flow walkthrough**
- **Consumer 1 — `CsvExportButton`** (`apps/web/src/components/CsvExportButton.tsx`): calls `buildAccountsCsv(items)` and triggers a download. Reads no individual field; unaffected by the change beyond correctness.
- **Consumer 2 — `LabelControl`** (`apps/web/src/components/LabelControl.tsx:120-128`): a single-line `<input>`, which cannot produce a newline. It gains no new error branch for this case, because it cannot trigger it — but the API's 400 for `invalid_body` is already handled by the generic `!res.ok` branch at `:46-49`, so a direct-API newline is not a crash path in the UI either.
- **Consumer 3 — E2E `accounts.spec.ts:87-100`**: parses the downloaded CSV by splitting on `\r\n`. With I24.1 in force this stays valid for anything the API accepts.

---

### C25 — Web UI

**Signature** — new/changed files:
```
apps/web/src/app/identities/[identityId]/page.tsx   (new — server component)
apps/web/src/components/SaasAppManager.tsx          (new — client)
apps/web/src/components/BulkLabelBar.tsx            (new — client)
apps/web/src/components/LabelFilter.tsx             (new — server-rendered links)
apps/web/src/app/accounts/page.tsx                  (changed — deep link, filter, selection)
apps/web/src/app/apps/page.tsx                      (changed — manager rows)
apps/web/src/app/events/page.tsx                    (changed — audit column, ?source= forwarding + href)
apps/web/src/lib/api-types.ts                       (changed — re-export new names)
apps/web/src/lib/csv-export.ts                      (changed — csvField newline strip; owned by C24/I24.2)
```

> **Round-5 correction (FN-F2).** `csv-export.ts` was missing from this list. C24 requires the edit and C26 already lists `apps/web/test/csv-export.test.ts` as changed — so the *test* was scheduled while the *source it tests* was not, and combined with the stale "UNCHANGED" comment in C24's own block (FN-F1), **no contract in the plan actually scheduled the `csvField` edit**. It existed only in I24.2's prose. Round-1 FN-F8 established exactly this failure mode: an obligation stated only in prose gets dropped in Phase 2.

**Invariants**
- **I25.1 (R8)**: new components match existing conventions — Tailwind class vocabulary from the sibling components, errors as `<p role="alert">` (`SaasAppForm.tsx:190`), `router.refresh()` after mutation, `401 → router.push('/login')`.
- **I25.2 (R26)**: every control with a `disabled` attribute also carries a visible disabled style (`disabled:opacity-50`, as at `LabelControl.tsx:137`).
- **I25.3 (R23)**: no mid-stroke input mutation — text inputs do not reformat/trim while typing. `LabelControl` trims only at submit (`:61`); follow that.
- **I25.4 (NFR4)**: the credential-replacement form follows `SaasAppForm.tsx:6-14`'s explicit rule — caught errors are **classified, never read for `.message`**, so private-key text cannot reach an error overlay. This is a deliberate anti-idiom with a comment explaining it; the new component must repeat it, not "fix" it.
- **I25.5 (R7)**: the identity deep link is a real `<a href>` (Next `<Link>`), so it is reachable by `getByRole('link')` and by keyboard — not an onClick div.

**Forbidden patterns**
- `pattern: catch \([a-z]+\)[\s\S]{0,120}\.message` in `SaasAppManager.tsx` — reason: I25.4.
- `pattern: onClick=\{[^}]*router\.push` where a `<Link>` would do — reason: I25.5.

**Acceptance criteria**
- The accounts table's identity cell renders a link to `/identities/<id>` **only** when `link.identityId` is non-null; orphan/ambiguous rows render the existing dash and no link.
- The identity page renders 404-appropriate UI for an unknown id (Next `notFound()`), not a thrown 500.
- Label filter links preserve the current `status` tab.
- **Load-more links preserve every active filter — both pages (round-2 FN-F6 + FN-F1).** The draft covered only the filter→link direction and missed the pagination→filter direction, which is the UI-tier counterpart of I23.6:
  - `accounts/page.tsx:145` currently builds `href={`/accounts?status=${status}&cursor=…`}` — it preserves `status` and drops everything else, so C23's new `?label=` would be lost on page 2 (API pages the filtered set correctly; the page then requests page 2 unfiltered).
  - `events/page.tsx:73` currently builds `href={`/events?cursor=…`}` with no other params at all, so C20's new `?source=` would be lost. For events this is doubly covered — the cursor is filter-scoped (C20), so a dropped `source` now yields a 400 rather than silently-wrong rows — but the href must still carry it, or "Load more" simply breaks under an active filter.
  - Both pages must also forward the filter to the API in their fetch helpers (`events/page.tsx:7-11` builds a `URLSearchParams` with only `cursor`).
- Selecting rows enables the bulk bar; selecting none leaves it disabled **with a visible cue** (I25.2).
- Apps page shows rename / replace-credentials / delete affordances per row.

**Consumer-flow walkthrough** — these are UI leaves; their consumers are the E2E specs in C26, enumerated there.

---

### C26 — Tests

**Signature** — new/changed test files:
```
apps/api/test/api.integration.test.ts        (changed — C18/C19/C20/C21/C22/C23/C24/C27 cases)
apps/api/test/audit-append-only.test.ts      (new — I19.4 forbidden-pattern grep as an executed gate)
apps/web/test/csv-export.test.ts             (changed — C24 newline regression pins)
e2e/specs/identity.spec.ts                   (new)
e2e/specs/apps.spec.ts                       (changed — rename + restore, delete 409)
e2e/specs/labeling.spec.ts                   (changed — filter + bulk + audit visibility)
e2e/scripts/assert-seed-preserved.sh         (changed — label==null for all 4 seeded accounts)
```

**Obligations derived elsewhere in this plan that land here** (round-1 FN-F8: the draft stated these in the R42 section and never entered them into the contract that owns test changes, so they would have been dropped in Phase 2):

| Source | Obligation |
|---|---|
| R42-A | **No new rate-limit sweep.** `T-L9` at `api.integration.test.ts:1150-1170` already asserts `hasRateLimit`; the four new routes are covered automatically. Confirm the sweep's route count grows by 4. Do not add a second sweep and do not modify T-L9. |
| R42-A | Generalize the sweeps' URL substitution from the hardcoded `:saasAppId`/`:jobId` chain (`:143`, `:158`, `:172`) to a generic `:param` → uuid replacement. Hygiene, not a defect — the literal colon segment currently still routes (probed). **Same edit**: widen the `route.method as 'GET' \| 'POST'` casts on those lines (round-2 FN-F7). C22 adds the first `PATCH` route, making the cast assert something false about its own input. It will not fail typecheck (it is a cast over a `string`) and `app.inject` accepts any method, so the sweeps keep working — but an implementer is editing those exact lines anyway. |
| R42-B | The page↔spec membership check must glob `apps/web/src/app/**/page.tsx`, not `*/page.tsx` — the single-star form does not match the nested `identities/[identityId]/page.tsx`, i.e. it would miss exactly the page this plan adds. |
| I19.4 | Turn the append-only forbidden pattern into an executed unit test, following the established in-repo precedent (`apps/api/test/no-rotation-route.test.ts:12-23` greps route sources; `api.integration.test.ts:643-666` does the same for tenantId schemas). ~15 lines, no new infrastructure. Complements C27's privilege test at the source-code level. |
| I26.5 | Extend `assert-seed-preserved.sh` to all four seeded accounts' labels, red-proven. |

**Component → spec mapping** (round-1 TEST-F8 — the draft left three new components with no test assignment; note `apps/web` has no jsdom/Testing Library, so component unit tests are not constructible and E2E assignment is the correct discharge, not an Anti-Deferral entry):

| Component | Covering spec + assertion |
|---|---|
| `SaasAppManager` | `apps.spec.ts` — rename the seeded app and restore in `afterEach`; delete attempt shows the 409 message with its account count |
| `BulkLabelBar` | `labeling.spec.ts` — select rows, apply a label, assert the confirmation count; API-driven teardown clears exactly those accounts |
| `LabelFilter` | `labeling.spec.ts` — from `?status=orphan`, clicking the "unlabeled" filter lands on `?status=orphan&label=none` and the orphan row is still shown (proves the filter composes with the status tab rather than replacing it) |
| identity page (C25) | `identity.spec.ts` — deep link from a matched account row navigates to the identity page; the seeded account is listed |

**Invariants (the testing rules that bind this plan)**
- **I26.1 (RT7)**: every new assertion gets an executed red-proof. Red-proofs run on a **throwaway `git worktree` under the scratchpad**, never on the real tree (cycle-1 RT7 lesson; symlink `e2e/node_modules` so Playwright runs).
- **I26.2 (RT8)**: every denial-path test asserts the mutation did not occur, not merely the status code. Explicitly required by C19, C22, C23, C24 acceptance criteria above.
- **I26.3 (D9)**: numeric columns are asserted with `typeof`, not just value equality.
- **I26.4 (RT1)**: no mock stands in for a real API shape — integration tests run against Testcontainers, E2E against the live stack.
- **I26.5 (NFR5) — rewritten (round-1 TEST-F3, Major).** The draft said "follow `labeling.spec.ts:17-26`". That pattern is (a) **single-account** — it inspects only the orphan — and (b) **UI-driven** — it navigates and clicks, so it fails exactly when the page or session is already broken. Neither property survives what C26 adds: a bulk-labeling spec labels *several* of the 4 seeded accounts, three of which that teardown never touches.

  The consequence is a **silent** failure, which is what makes it Major. Verified against the gate: `e2e/scripts/assert-seed-preserved.sh:54-60` checks `.label == null` for the **orphan account only** — `alice.tanaka`, `bob.suzuki`, and `shared.mailbox` are checked for link status (`:49-52`) but never for labels. So a bulk spec that leaves `alice.tanaka` labelled **passes the gate**, poisons the shared stack, and the next run's `?label=none` returns 3 instead of 4 — against which C23's acceptance criteria are written. The gate that exists to catch this is green while it happens.

  Three obligations replace the draft's one-liner:
  1. **API-driven teardown, not UI-driven** — with three requirements the first rewrite omitted (round-2 TEST-F1, Major). Mutating specs clear via `request.delete()` against `/api/accounts/:id/label`: no page render, survives a mid-test UI failure, and safe to call whether or not a label is present. Precise semantics (round-4 FN-F2 — the first rewrite's "idempotent (204 on no-op)" parenthetical was loose): the handler checks whether the **saas_account** exists (`account-labels.ts:87-91`), not whether a label exists, so it returns **204 when the account exists** — label present or not — and **404 when the account is gone**. Both are acceptable teardown outcomes, which is why the obligation below says "204 (or 404)". But as first written the teardown would not have worked at all:
     - **Account ids must be derived.** The specs work from *emails* (`seed-facts.ts` exposes `SEEDED_ACCOUNTS.orphan.email`; `labeling.spec.ts:10` locates rows by email regex) and there is no seeded-account-id fixture. The teardown must first `GET /api/accounts` and map email → `accountId`.
     - **The `Origin` header is mandatory.** Verified at `apps/api/src/app.ts:56-64`: the scope-level `onRequest` hook rejects every non-GET `/api` request whose `Origin` does not equal `deps.appOrigin`, with no exemptions. Playwright's `request` context inherits `storageState` cookies but does **not** set `Origin`, so a bare `request.delete()` 403s. It must send `Origin: <baseURL>`.
     - **The teardown asserts its own response.** A fire-and-forget clear that 403s is exactly the silent poisoning obligation 2's gate exists to catch — but the gate only fires at the *end* of the run, after the damage. The teardown must assert 204 (or 404) so the failure names itself at the point it happens.
  2. **Extend the gate** (`assert-seed-preserved.sh`) on **two** axes — the second added in round 3 (TEST-F1, Major):
     - **Labels**: assert `.label == null` for **all four** seeded emails, not just the orphan. Red-proof (RT7): label one seeded account by hand, run the gate, confirm it fails naming that account, then clear it.
     - **The seeded app's `displayName`**: assert `GET /api/saas-apps` still returns `SAAS_APP_DISPLAY_NAME`. C26 has `apps.spec.ts` rename the seeded app and restore it in `afterEach` — and `afterEach` is exactly the mechanism that does not run when a spec crashes mid-test. **This leak is worse than a leaked label, because the seeder does not repair it**: `apps/api/src/seed.ts:172-181` looks up `(tenant_id, key)`, and on a hit returns the existing id immediately without re-applying `display_name`. So a leaked rename survives every subsequent `docker compose up` and every seed re-run, permanently, until someone edits the database by hand. The next run's first apps assertion (`apps.spec.ts:12`, `getByRole('cell', {name: SAAS_APP_DISPLAY_NAME})`) then fails with a "cell not found" that names neither the cause nor the run that caused it. Constructible with the gate's existing machinery: it already holds a session cookie (`:34`), and `GET /api/saas-apps` (`saas-apps.ts:79-97`) needs no `Origin`. Red-proof: rename the app by hand, run the gate, confirm it fails naming `displayName`, then restore.
  3. **Specs record what they mutated** and clear exactly those accounts. "Follow the existing pattern" is not sufficient instruction for a multi-account mutation.
- **I26.6 (R42, page↔spec membership)**: derived below; every page under `apps/web/src/app/*/page.tsx` has a corresponding spec.

**Acceptance criteria**
- **Unit + integration + e2e all green, with the counts stated as targets, not as "grows" (round-2 TEST-F9).** A growth assertion with no number passes for any non-zero delta — including one where half the specified cases were never written. The baseline is pinned (99 / 89 / 27), so the deltas must be too. Phase 2 records the per-contract case counts as it implements and states the final three numbers here before the gate is called green; a delta that disagrees with the sum of the per-contract counts is itself a finding. (This criterion is not "the suite is bigger"; it is "every acceptance criterion in C18–C24 and C27 has a corresponding executed test".)
- `assert-seed-preserved.sh` green after a full e2e run — now asserting labels on all four seeded accounts (I26.5).
- Two consecutive full e2e runs green (the login-rate-limit budget check from cycle 1 — D4).
- **Login budget — recomputed; the round-1 arithmetic was wrong (round-2 TEST-F3, Major).** The first version counted two logins and claimed "one of margin". Both halves were wrong: it undercounted the sources and credited margin that does not exist. The real set, enumerated from the tree rather than from `auth.spec.ts` alone:

  | # | Site | When |
  |---|---|---|
  | 1 | `.github/workflows/ci.yml:88-93` — curl login gate | CI only, before the suite |
  | 2 | `e2e/global-setup.ts:65` — UI login fallback | whenever the saved session does not validate (**the normal case on a fresh CI stack**) |
  | 3–4 | `e2e/specs/auth.spec.ts:11,22` — valid + invalid | every run |
  | 5 | `e2e/scripts/assert-seed-preserved.sh:21` — curl login | after the suite; **I26.5 obligation 2 keeps it** |

  That is **5 of 5** on a clean CI run before `retries: 1` is considered — not 4 of 5 with margin. `auth.spec.ts:6` already documents "1 setup + 2 here = 3 POSTs/run", which the round-1 count contradicted.

  Whether the limiter actually trips depends on whether the whole sequence lands inside one 60-second window. Today it probably does not, because `playwright install --with-deps chromium` (`ci.yml:139-140`) sits between site 1 and the suite and takes far longer than a minute — but that is **accident, not design**, and this plan is simultaneously adding a "two consecutive full e2e runs" criterion that doubles every one of these. The binding constraint is `LOGIN_IP_RATE_LIMIT` (5/min, `rate-limits.ts:11`), not the 20/hour account bucket.

  Recorded as a constraint with the margin claim **withdrawn**: there is no headroom. Any future login-performing test, or any change that moves the CI steps closer together, must raise `LOGIN_IP_RATE_LIMIT` first. **C26 obligation**: when running the two-consecutive-runs check locally, allow ~60 s between runs (the cycle-1 D4 guidance in `e2e-howto.md`), and treat a 429 in `auth.spec.ts` as the limiter working, not as a suite defect.

---

### C27 — Schema-enforced append-only audit trail

Promoted in-branch from the withdrawn SC29 (round-1 SEC-F5, Anti-Deferral rule 7).

**Signature**
```sql
-- packages/schema/migrations/0005_discovery_events_append_only.sql
REVOKE UPDATE, DELETE ON discovery_events FROM opensmp_app;
```

**Invariants**
- **I27.1 (schema-enforced)**: `opensmp_app` cannot `UPDATE` or `DELETE` any `discovery_events` row. `SELECT` and `INSERT` are retained — both are required (the events API reads, the worker and C19 write).
- **I27.2 (corrected — round-2 FN-F2, Major)**: no *application* code depends on the revoked privileges — every `discovery_events` write in `apps/` and `packages/` production source is an `INSERT` (7 sites). **But test code does, and the grep that justified this invariant could not have found it.**

  The justifying pattern was `(UPDATE|DELETE)[[:space:]]+[^;]*discovery_events` — a literal-table-name search. `packages/schema/test/rls.integration.test.ts` runs its cross-tenant matrix over `MEMBER_TABLES` (`:12-21`), which **includes `discovery_events`** (`:17`), via `` tx.query(`UPDATE ${table} SET tenant_id = tenant_id WHERE id = $1`) `` (`:266`) and `` `DELETE FROM ${table} WHERE id = $1` `` (`:286`). Template interpolation over an array is invisible to any literal-name grep, so the "re-verified after" pass repeated the same blind method and returned the same false clean. This is the round's second instance of a confident claim resting on an unsound search — the first was the retracted `hasRateLimit` claim (SEC-F2).

  **Measured on the live DB** (inside a transaction, rolled back — no production change):

  ```
  BEGIN; REVOKE UPDATE, DELETE ON discovery_events FROM opensmp_app;
  SET LOCAL ROLE opensmp_app; UPDATE discovery_events SET tenant_id = tenant_id WHERE id = …;
  -> SQLSTATE 42501 insufficient_privilege
  ROLLBACK;
  ```

  Postgres checks **table privilege before the RLS policy**, so those two `it.each` cases stop returning `rowCount === 0` (RLS filtered it away) and start raising `42501` — the `withTenant` wrapper propagates the throw and both tests go red. This is not mis-scoping; it is the correct revoke colliding with a test that asserts a *no-op* where the database will now assert a *denial*.

  **C26 obligation**: `rls.integration.test.ts` must treat `discovery_events` as an expected-denial member for the UPDATE and DELETE matrices rather than an expected-zero-rowcount member. The SELECT and INSERT matrices are unaffected (those privileges are retained). Splitting `MEMBER_TABLES` into "mutable members" and "append-only members" is the shape that keeps both properties asserted rather than dropping `discovery_events` from the matrix — dropping it would silently stop testing its RLS isolation, trading one gap for another.

  **The class is now bounded by method, not by pattern (round-3 SEC-F2).** Since a literal-name grep failed here once, the round-3 search covered the *class* rather than re-running the same shape: template-interpolated SQL returns 8 hits tree-wide, all in `rls.integration.test.ts`, of which exactly two are UPDATE/DELETE (`:266`, `:286`) — the two named above. One further construct could hide statements from any raw-SQL search: **Drizzle is a live dependency** (`packages/schema/package.json`, imported at `db.ts:2` and `tables.ts:16`), and an ORM generates SQL no grep over source strings can see. Traced and recorded: `createDb` (`db.ts:9`) has **zero callers anywhere in the tree** (`grep -rn createDb` returns only its own definition), so Drizzle emits no statements today and the class is genuinely closed. **This zero-caller status is load-bearing for I27.2** — a future contract that adopts `createDb` for writes would silently reopen the UPDATE/DELETE class. Recorded so that adoption is a decision rather than an accident.
- **I27.3 (R16, dev/CI parity)**: the revoke must hold under *both* role setups. Local dev and CI both run migrations as the owner and connect the app as `opensmp_app` (`apps/api/test/api.integration.test.ts:88-95` builds the app pool with `username='opensmp_app'`), so the privilege test exercises the same role in both environments. A test asserting a *denial* must run as the app role — asserting it as the owner would pass vacuously since the owner is never subject to the revoke.

**Forbidden patterns** (widened — round-2 SEC-F3)
- `pattern: GRANT[\s\S]{0,80}(UPDATE|DELETE|ALL)[\s\S]{0,80}discovery_events` in any migration after 0005.
- `pattern: GRANT[\s\S]{0,40}ALL[\s\S]{0,60}ON ALL TABLES IN SCHEMA` in any migration after 0005.
- `pattern: ALTER DEFAULT PRIVILEGES[\s\S]{0,120}GRANT[\s\S]{0,40}(ALL|UPDATE|DELETE)` in any migration after 0005.

Reason: the first draft's pattern covered only the explicit `GRANT UPDATE|DELETE … discovery_events` form. A realistic future "add a table, grant it" migration written as `GRANT ALL ON discovery_events`, `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO opensmp_app`, or an `ALTER DEFAULT PRIVILEGES` clause would silently restore both privileges and the original pattern would not fire. The `42501` acceptance criteria below catch a regression at test time regardless, so these patterns are defense in depth on a control that is itself defense in depth — but they cost nothing and the schema-level control is the one the plan now relies on.

**Acceptance criteria**
- As `opensmp_app`, `UPDATE discovery_events SET kind = 'x'` raises SQLSTATE `42501` (insufficient_privilege). Asserted on the **error code**, not on a message string.
- As `opensmp_app`, `DELETE FROM discovery_events` raises `42501`.
- As `opensmp_app`, `INSERT INTO discovery_events (…)` still succeeds, and `SELECT` still returns rows — the revoke must not break the writers this plan depends on. This is the criterion that fails if the revoke is written too broadly (e.g. revoking `INSERT` by mistake).
- **`rls.integration.test.ts` is updated and green** — its UPDATE/DELETE matrices must treat `discovery_events` as an expected-denial member (I27.2). The first draft's criterion said "the full existing integration suite (89 tests) still passes"; that was **unsatisfiable as written** (round-2 FN-F2) — two of those 89 assert `rowCount === 0` on exactly the statements this revoke now forbids. The honest criterion: 89 tests still pass *after* the two are converted from expected-no-op to expected-denial, and the conversion is itself red-proven (revert the migration → the denial assertions fail).
- The rest of the integration suite passes unchanged — sync, match, and events all touch this table via `INSERT`/`SELECT` only.
- Red-proof (RT7): removing the `REVOKE` line from the migration makes the two `42501` assertions fail.

**Consumer-flow walkthrough**
- **Consumer 1 — `recordLabelAudit`** (C19): performs `INSERT` only; unaffected.
- **Consumer 2 — worker sync/match** (`apps/worker/src/sync.ts:150,157,178`, `match.ts:125`): `INSERT` only; unaffected.
- **Consumer 3 — `GET /api/events`** (`apps/api/src/routes/events.ts:70-78`): `SELECT` only; unaffected.
- **Consumer 4 — RLS integration test** (`packages/schema/test/rls.integration.test.ts`) — **this suite IS affected; the first draft's claim that it is not was wrong (round-2 FN-F2).** It inserts `discovery_events` rows (`:81,165`) — unaffected, `INSERT` is retained — **but it also runs `UPDATE` and `DELETE` matrices over `MEMBER_TABLES` (`:12-21`, which includes `discovery_events` at `:17`) as `opensmp_app`**, asserting `rowCount === 0` at `:269` and `:289`. Measured: those two cases will raise `42501` instead, because privilege is checked before RLS. See I27.2 for the correction and the required test change. C27 cannot be considered done until this suite is updated and green.

---

## R42 Member-Set Derivations

Universally-quantified invariants in this plan, each with its code-derived member set.

### R42-A — "every API route is rate-limited" (NFR1, RS2)

Defining primitive:
```bash
grep -rnE "app\.(get|post|put|patch|delete)\(" apps/api/src --include="*.ts"
```
Current members (13) and their status — **derived from code, not from the prompt**:

| Route | Rate limit | Note |
|---|---|---|
| `GET /healthz` (`app.ts:47`) | none | outside `/api`; no session, no Origin gate. Intentional (liveness probe). |
| `POST /api/auth/login` (`login.ts:24`) | `LOGIN_IP_RATE_LIMIT` + account bucket | Multi-line config; a naive one-line grep misses it. Verified by reading `login.ts:26-31`. |
| `POST /api/auth/logout` (`logout.ts:7`) | `MUTATION_RATE_LIMIT` | |
| `POST /api/hr-import` (`hr-import.ts:108`) | `MUTATION_RATE_LIMIT` | |
| `POST` / `GET /api/saas-apps` (`saas-apps.ts:18,79`) | MUTATION / LIST | |
| `POST /api/sync/:id`, `POST /api/match`, `GET /api/jobs/:id` (`sync-match.ts:11,31,44`) | MUTATION ×2, LIST | |
| `GET /api/accounts` (`accounts.ts:77`) | `LIST_RATE_LIMIT` | |
| `PUT` / `DELETE /api/accounts/:id/label` (`account-labels.ts:24,76`) | `MUTATION_RATE_LIMIT` ×2 | |
| `GET /api/events` (`events.ts:50`) | `LIST_RATE_LIMIT` | |

**Set A \ set B is empty** — no existing `/api` route lacks a limit. Routes added by this plan and the limit each must carry: `GET /api/identities/:id` → LIST; `PATCH` / `DELETE /api/saas-apps/:id` → MUTATION; `POST /api/accounts/labels/bulk` → MUTATION. **Indirect members considered**: none — there is no route-generating helper, no wildcard mount, and no raw `fastify.route({...})` form in the tree (verified: the grep above is exhaustive for this codebase's single registration idiom).

**Backstop — it already exists. (Round-1 correction, SEC-F2.)**

> The plan originally asserted, under a "measured" heading, that no test reads `hasRateLimit` and that RS2 was therefore enforced by review alone. **That was wrong, and it was not measured** — the grep behind it stopped at the two sweeps near `:133`/`:152` and never scanned the rest of the file. The security reviewer caught it; re-verified directly: `apps/api/test/api.integration.test.ts:1150-1170` is `T-L9: rate-limit config sweep`, which iterates every `app.apiRoutes` entry and asserts `route.hasRateLimit === true` (`:1166`), with an RT7 strip-and-confirm-red proof recorded in its comment. The claim is retracted in full.

Consequence for this plan: **RS2 is already gated, and the four routes added here inherit that gate automatically** — a new route that omits `config.rateLimit` fails T-L9 without anyone writing a new test. No C26 obligation is derived. The implementer must **not** add a second sweep, and must not read the retracted paragraph as licence to rewrite or displace T-L9.

Process note carried into Phase 2: two "measured" claims in this plan's first draft (this one and the C21 guard in SEC-F1) were in fact asserted from a partial grep. Every remaining "measured, not assumed" claim was re-verified after round 1; where a claim survived, the verification is cited inline.

**Second observation — the sweeps' URL substitution is incomplete but currently harmless.** `api.integration.test.ts:143` and `:158` substitute only `:saasAppId` and `:jobId`; `:saasAccountId` (the two existing label routes) is left as a literal colon segment, and this plan would add `:identityId` in the same shape.

Probed rather than assumed — a throwaway Fastify app with `PUT /api/accounts/:saasAccountId/label`:

```
/api/accounts/:saasAccountId/label -> 200     (literal colon segment MATCHES the param route)
/api/accounts/abc/label            -> 200
```

Fastify treats the literal `:saasAccountId` as an ordinary path segment value, so the route does match and the 401/403 assertions are real, not vacuous. The sweeps are sound today. It is still worth generalizing the substitution to `:param` → uuid, because the *next* route to need it may be one whose handler parses the param before the gate runs (a uuid-shaped 400 would then preempt the 401/403 under test, and the sweep would pass for the wrong reason). **C26 obligation (Minor, hygiene not defect)**: generalize the substitution; no red-proof required beyond the existing sweeps continuing to pass, since this changes test inputs rather than adding an assertion.

### R42-B — "every page has an E2E spec" (I26.6)

```bash
ls apps/web/src/app/*/page.tsx        # 5 today
ls e2e/specs/                          # 8 today
```
| Page | Spec |
|---|---|
| `accounts` | `accounts.spec.ts`, `labeling.spec.ts`, `sync.spec.ts`, `session-expiry.spec.ts` |
| `apps` | `apps.spec.ts` |
| `events` | `events.spec.ts` |
| `import` | `import.spec.ts` |
| `login` | `auth.spec.ts` |

Adding `identities/[identityId]/page.tsx` makes the member set 6; `identity.spec.ts` is the matching member. **Note the glob gap**: `apps/web/src/app/*/page.tsx` does **not** match a nested dynamic route (`identities/[identityId]/page.tsx`). The check must use `apps/web/src/app/**/page.tsx` (excluding the root `page.tsx` and `layout.tsx`), or the new page is invisible to exactly the check meant to catch it. This is a defect in the inherited R42-B derivation, corrected here.

### R42-C — "every note-accepting endpoint rejects newlines" (I24.1)

```bash
grep -rn "note" apps/api/src/routes/ --include="*.ts"
```
Members: `PUT /api/accounts/:id/label` (`account-labels.ts:19`) and the new `POST /api/accounts/labels/bulk` (C23). Two members; both carry the guard. No other route accepts a `note`.

---

## Testing Strategy

| Tier | Scope | What it proves here |
|---|---|---|
| Unit (Vitest) | `csv-export.ts` newline behavior; audit payload construction if extracted as a pure function | C24's export correctness without a DB |
| Integration (Testcontainers, real Postgres + RLS) | All of C18–C24's API acceptance criteria | Tenant isolation, transaction atomicity, audit emission counts, denial-path non-mutation, numeric coercion |
| E2E (Playwright, live stack) | C25's rendered behavior | The deep link actually navigates; the 409 message actually appears; bulk labeling actually applies; audit rows actually surface on the events page |
| Shell gate | `assert-seed-preserved.sh` | The suite left the seed intact (NFR5) |

**Specific high-risk cases that must not be omitted** (each maps to a rule):
- Cross-tenant 404 on every new route (RLS; not merely "returns 404 for garbage input").
- Bulk failure writes zero labels **and** zero events (RT8).
- `sync_raw` projection unchanged (I21.2 — the S5 privacy invariant; the existing test at `api.integration.test.ts:441` is the guard and must pass unmodified).
- Rename does not re-encrypt; credential replacement decrypts back to the submitted plaintext (I22.2).
- Events tie-break ordering with identical `created_at` (I20.1's total ordering — I20.2 is cursor totality).
- Two consecutive full E2E runs (login budget, D4).

---

## Considerations & Constraints

### Risks

| Risk | Mitigation |
|---|---|
| C21 regressing S5 (privacy incident, the worst outcome in this plan) | The existing projection test must pass **unmodified**; fail-closed default; explicit unknown-kind test with a secret-bearing payload. |
| C20's cursor change breaking the events page | Cursor is opaque to the consumer (verified at `events/page.tsx:29`); malformed-cursor behavior is specified, not left to chance. |
| Bulk labeling leaving the E2E stack dirty and breaking `assert-seed-preserved.sh` for every later run | I26.5 teardown obligation, following `labeling.spec.ts:17-26`'s conditional pattern. |
| Three features in one plan producing an unreviewably large diff | Contracts are independently testable; Phase 2 implements and verifies per contract, not in one pass. |
| The `rotate` string guard being tripped by natural naming | I22.6 makes it a contract, and an existing test enforces it. |

### Scope contract (out of scope)

| ID | Item | Owner |
|---|---|---|
| SC23 | Pagination **E2E** (`PAGE_SIZE=50` needs a >50-row fixture; the 4-account seed cannot express it — `hasMore` is never true, so `nextCursor` is always `null`). Inherited from SC22. | Remains deferred at the E2E tier, **with a stated answer rather than an open re-evaluation** (round-1 TEST-F7): the filter×pagination invariant I23.6 is proven at the **integration** tier instead (see C23 acceptance), where a 60-row fixture costs one `generate_series` INSERT. The E2E gap is now scoped to "does the Load more button render and navigate", which the 4-account seed genuinely cannot exercise. |
| SC24 | Editing an existing label's note inline from the identity detail page. | A future cycle; the accounts page already provides label editing. |
| SC25 | Per-account detail page (would let the audit trail link `saasAccountId` to something). | Future cycle; C19's walkthrough documents why the field is rendered as text for now. |
| SC26 | Audit retention / export (`discovery_events` grows unboundedly; SC10 from cycle 1 covers retention generally). | Inherits SC10's owner. |
| SC27 | Bulk *clearing* of labels (this plan does bulk set only). | Future cycle; the per-account clear path exists. |
| SC28 | Editing a SaaS app's `key` (immutable by design — it is part of the unique constraint and the AAD-adjacent identity of the app). | Not planned; recorded so its absence is deliberate. |
| SC29 | ~~Schema-enforced append-only audit~~ — **withdrawn; promoted in-branch as C27** (round-1 SEC-F5). | See C27. |
| SC30 | Widening the `saas_apps` POST `key` schema beyond `z.literal('google-workspace')`, which is what actually blocks SC17. | A future cycle; it is an API/security change, not a test change. **Carries a security constraint discovered here (round-2 SEC-F5)**: `discovery_events.source` is `app.key` for sync events (`sync.ts:151`) and `'label'` for audit events (C19), so a widened `key` schema MUST exclude reserved audit sources. Otherwise an operator with app-registration rights could register `key = 'label'` and its sync events would be indistinguishable from audit records under `?source=label` — burying or forging-adjacent the audit view. Unreachable today (the literal pins `key`, SC28 makes it immutable), which is exactly why it must be recorded against the contract that would unlock it. |
| SC31 | Worker-side: a sync job whose `saas_app` was deleted mid-flight fails with no `sync_failed` event (`sync.ts:92` resolves `appKey` after the load, so the `:174` guard suppresses the audit write). | A worker cycle. See I22.7 — narrow window, no corruption, and fixing it changes sync's failure semantics rather than C22's. |

**Why SC29 was withdrawn (round-1 SEC-F5, Major).** The first draft deferred the `REVOKE` with a cost argument claiming the verification "spans three packages and needs its own integration coverage under both the dev role and the CI role." The security reviewer challenged that premise and it does not survive contact with the tree. Re-verified directly:

```
$ grep -rnE "(UPDATE|DELETE)[[:space:]]+[^;]*discovery_events|discovery_events[^;]*(SET |DELETE)" \
    --include="*.ts" apps packages
(no matches)
$ grep -rn "discovery_events" --include="*.ts" apps packages | grep -ic insert
7
```

Every write to `discovery_events` anywhere in the tree is an `INSERT` — seven of them. There is no `UPDATE` and no `DELETE` to break. The "verification" the draft priced at multiple packages plus new integration coverage is the grep above. And the migration precedent already exists: `0003_account_labels.sql:25` issues a standalone per-table `GRANT`, so a new migration needs to touch no applied file.

Anti-Deferral rule 7 applies squarely: `discovery_events` is the one uncovered member of a security-boundary class (audit-trail integrity), and this plan is what makes its contents security-relevant. The draft's mitigating argument — "this plan does not *introduce* the weakness" — is true but not responsive, and the draft conceded the operative point itself ("this plan is the first to store security-relevant content there"). Deferring a known same-class hole out of a branch that exists to build the control is exactly what rule 7 forbids. Promoted to C27 below.

### Out-of-scope items that this plan deliberately closes

- **SC-CR1** (CSV newline) → closed by C24, **but only after round 4 corrected what "closed" required**. Cycle 1 framed the defect as a `note` problem and asked that the input-vs-API asymmetry be settled "as a whole"; rounds 1–3 of this review hardened `note` alone. Round 4 measured the other export columns and found `displayName`, `matchedValue`, and `candidates` all split the export — and those are provider/HR-supplied and stored verbatim (`sync.ts:51-65`, `hr-import.ts:197`), so they are *more* exposed than the operator-authored `note` ever was, not less. The closure is therefore two-part: boundary rejection for `note` (I24.1, where a newline is always a mistake) **and** export-side stripping for every cell (I24.2, where upstream data cannot be dictated). Only the pair actually settles the asymmetry as cycle 1 asked.

  The grep marker `TODO(labeling-v2)` was recorded in the cycle-1 code review but **never inserted into source** (verified: `grep -rn "TODO(labeling-v2)"` returns nothing). With the defect now closed at both ends the missing marker is moot rather than outstanding debt — though it is worth noting the marker's absence is *why* the scope drifted: a grep-able marker on `csvField` would have pointed at the exporter, not at `note`.
- **SC17 — NOT unblocked. (Round-1 correction, TEST-F4, Major.)** The first draft claimed C22's DELETE unblocks the E2E app-registration happy path. It does not, and the reason is structural: `saas_apps` has `UNIQUE (tenant_id, key)` (`0001_init.sql:38`) and the POST body schema pins `key: z.literal('google-workspace')` (`apps/api/src/routes/saas-apps.ts:11`). **One tenant can therefore hold exactly one app, and the demo tenant's is the seeded one.** Registering a throwaway app cannot succeed — it 409s, which is precisely what `e2e/specs/apps.spec.ts:16-27` already asserts as the expected outcome. And the seeded app cannot be deleted to make room, because it has 4 accounts and C22 returns 409 by design. The register→delete→re-register loop is closed against itself at the E2E tier.

  **Resolution (option (c) of the reviewer's three)**: the full create → rename → replace-credentials → delete → re-create cycle is verified at the **integration tier**, where `api.integration.test.ts` seeds a `randomUUID`-slugged tenant per test and the unique constraint is per-tenant, making a throwaway app trivially registrable. The E2E tier covers only what is reachable against the shared demo tenant: rename the seeded app and rename it back (in `afterEach`, not inline — a mid-test failure would otherwise leave `display_name` permanently changed, **and the seeder never repairs it**: `seed.ts:172-181` returns the existing app id on a `(tenant_id, key)` hit without re-applying `display_name`, unlike `ensureIdentities` at `:220-226` which does carry `DO UPDATE SET display_name`), plus assert the 409 on deleting it.

  **Round-4 correction (TEST-F2, Minor):** this paragraph previously added "and neither `apps.spec.ts:12` nor `assert-seed-preserved.sh` checks display name, so it would fail silently." That was the *justification for* round-3's TEST-F1 fix and is now **false** — I26.5 obligation 2 makes the gate assert the seeded `displayName`. A leaked rename now fails loudly at the gate. The `afterEach` requirement stands anyway (fail at the point of damage, not at the end of the run), but the risk assessment an implementer reads here must not be the pre-fix one. Same prose-vs-fix divergence class as round 3's headline finding, one section away from where that fix landed.

  **E2E credential prohibition (round-4 TEST, folded in).** The E2E tier must **not** exercise credential replacement against the shared stack. The scoping is stated in three places but was never an obligation, and the gap is genuinely invisible if Phase 2 drifts: the gate cannot inspect ciphertext, and a corrupted `credentials_enc` would surface only at the next sync — against a GWS tenant VE1 says does not exist. The full credential cycle belongs to the integration tier, where each test owns its tenant.

  SC17 therefore **remains deferred**, now with its blocking cause identified rather than assumed away. Lifting it requires widening the `key` schema beyond the literal — a real API change with security implications, not a test change. Recorded as SC30.

---

## User Operation Scenarios

**S1 — Investigating a ghost account.** Operator opens `/accounts?status=ghost`, sees Bob Suzuki's account, clicks the identity link, lands on the identity page showing `status: left`, `leftAt: 2024-03-31`, and every account still attributed to Bob. *Edge case*: an identity with zero accounts (possible after a re-sync removes accounts) must render an empty table with a message, not a crash.

**S2 — Suppressing a batch of service accounts.** Operator filters `/accounts?status=orphan&label=none`, selects 12 rows, applies `service_account` with a note. *Edge cases*: one selected account was deleted by a concurrent sync → 404 with `missing`, nothing applied; selecting more than 100 → the UI must prevent it rather than surfacing a raw 400.

**S3 — Auditing a suspicious suppression.** Security reviewer opens `/events`, sees newest-first entries, finds `label_set` showing `null → known_shared` by a specific `actorUserId` on a specific account. *Edge case*: the actor's user row was deleted → `created_by` is `SET NULL` in `account_labels` (`0003:12`), but the audit payload stores `actorUserId` as a **value in jsonb**, not a foreign key, so the audit trail survives user deletion. This is a deliberate property of the design and must be stated in the implementation.

**S4 — Rotating a leaked service-account key.** Operator obtains a new GWS service-account JSON, opens `/apps`, uses "Replace credentials", pastes the new JSON. *Edge cases*: malformed JSON → client-side pre-flight rejects before any request (following `SaasAppForm.tsx:63-67`); the error must never echo the pasted key material (I25.4). *Note*: this is credential **replacement**, not key rotation — the encryption key version is unchanged unless a rollout is in progress (I22.2, finding D).

**S5 — Decommissioning a SaaS app.** Operator deletes an app registered by mistake (0 accounts) → succeeds. Operator tries to delete the live Google Workspace app (4 accounts) → 409 with "4 accounts are still attributed to this app", nothing deleted.

---

## Go/No-Go Gate

| ID | Subject | Status |
|-----|---------|--------|
| C18 | `GET /api/identities/:identityId` — identity detail read API | **locked** |
| C19 | Label audit event emission (same-transaction, per-account) | **locked** |
| C20 | Chronological ordering + filter-bound composite cursor for events | **locked** |
| C21 | Kind-aware payload projection (preserves S5) | **locked** |
| C22 | SaaS app PATCH / DELETE (rename, replace credentials, empty-only delete) | **locked** |
| C23 | Label filtering + bulk labeling | **locked** |
| C24 | Note newline rejection + export-side newline stripping (SC-CR1) | **locked** |
| C25 | Web UI (identity page, app manager, bulk bar, filter) | **locked** |
| C26 | Tests across unit / integration / E2E | **locked** |
| C27 | Schema-enforced append-only audit (`REVOKE UPDATE, DELETE` on `discovery_events`) | **locked** |

**All contracts remain `pending` after round 3.**

| Round | Findings | Critical | Major | Minor |
|---|---|---|---|---|
| 1 | 28 | 2 | 11 | 15 |
| 2 | 21 | 0 | 9 | 12 |
| 3 | 9 | 0 | 3 | 6 |
| 4 | 8 | 0 | 2 | 6 |

- **Round 1** invalidated several load-bearing claims in the draft, including two the orchestrator had marked "measured".
- **Round 2** verified those fixes and scrutinised C27 as fresh code. Two experts independently found C27 breaks the existing RLS suite; one expert retracted its own round-1 finding after re-deriving the orchestrator's CSV measurement.
- **Round 3** found all three Majors in the *documentation* of already-correct designs — C20's fenced block had not been updated alongside its prose, and the round-2 forbidden pattern matched nothing. The underlying designs were independently re-verified as correct, several by direct measurement (privilege-before-RLS on a throwaway DB, the row-wise predicate's index usage via `EXPLAIN`).

- **Round 4** found **no design defects**. Both Majors were defects in *earlier rounds' fixes* — a constraint name that does not exist (mine, round 3) and a source-scanning guard that misses ordinary refactors (the security expert's own). Its most consequential finding was [Adjacent]: the CSV newline defect was never really about `note`; three rounds had hardened the best-protected field while `displayName`/`matchedValue`/`candidates` — provider- and HR-supplied, stored verbatim — split the export unguarded.
- **Round 5** produced **no Major and no design finding**. All five Minors were stale or imprecise statements in C24, the contract round 4 changed most. Two experts patched `csvField` into the real tree, ran the web suite green (20/20), and reverted; a third re-probed Postgres privileges on a throwaway database. Two experts explicitly declined to manufacture findings.

## Convergence — reached at round 5

**All ten contracts are `locked`.** The termination condition is met in substance: round 5 returned zero Criticals, zero Majors, and zero design findings across all three perspectives, and every Minor is applied. What remained were documentation defects, which are now corrected.

Three things are worth carrying into Phase 2 rather than leaving in this table:

1. **Six mechanical guards failed across five rounds** — three greps that returned empty and were read as evidence of absence, two regexes that matched nothing, and one source scan defeated by ordinary refactors. Every one was caught by an independent expert, never by the author. The diagnosis stabilized: *a guard bound to how code is written fails silently the first time someone writes it differently.* Every load-bearing guard in this plan now asserts a property at the layer where that property exists — the built WHERE clause, the database privilege, the exported CSV cell, the validator's domain. Where a property genuinely cannot be tested (I24.3's RS6 half), the plan says so rather than implying a gate.
2. **The recurring documentation defect was a fenced block left behind by a prose rewrite** — it recurred in rounds 3, 4, and 5, each time in the contract that round had changed most. Phase 2 should treat a contract's fenced blocks as part of the contract, not as illustration.
3. **Two claims marked "measured" in the first draft were not measured**, and a third bound was derived twice from sampled inputs. Where this plan now says "measured", the measurement is either quoted inline or reproducible from the stated command.

Phase 2 may begin.
