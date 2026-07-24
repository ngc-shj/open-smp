# Plan: import-labeling-saasapp-ui

Date: 2026-07-24
Branch: `feature/import-labeling-saasapp-ui` (based on `feature/mvp-account-matching` @ 4fc4f91 — NOT `main`; the MVP branch is unmerged and this work builds directly on it. Recorded as a process deviation from the triangulate Step 1-7 default.)
Predecessor plan: `docs/archive/review/mvp-account-matching-plan.md` (contracts C1–C9, scope-outs SC1–SC11). This plan continues both numbering sequences: contracts start at **C10**, scope-outs at **SC12**. Citations of C1–C9/SC1–SC11 refer to the predecessor plan.

## Project context

- Type: `web app + service` (pnpm monorepo — Fastify API, BullMQ worker, Next.js 15 web, Drizzle-mirrored Postgres 16 schema with RLS)
- Test infrastructure: `unit + integration` (Vitest; integration via Testcontainers postgres:16 / redis:7) `+ CI/CD` (GitHub Actions committed, not yet executed — repo has no remote)
- Verification environment constraints (Phase 1 reviewers must classify each contract's manual-test path against these; Phase 3 cites by ID):
  - **VE1** — Real Google Workspace sync requires a paid GWS tenant + domain-wide-delegated service account. Not available locally. Any path exercising a *live* connector sync is `blocked-deferred` (unchanged from the MVP plan; sync behavior itself is out of scope here). The `/apps` registration form is testable with dummy credentials because POST `/api/saas-apps` encrypts and stores without contacting Google → `verifiable-local`.
  - **VE2** — No browser-automation/E2E infra exists (SC8 deferred, see Scope contract). UI acceptance paths are `verifiable-local` **manually** via `docker compose up` + browser, following the manual-test scripts this plan requires. Anti-Deferral cost-justification for keeping SC8 deferred is recorded under SC8 in the Scope contract section.
  - **VE3** — All API/DB/worker paths are `verifiable-local` via the existing Testcontainers integration suite; no external service required.
- Concurrency probe assessment: no contract in this plan depends on a transaction isolation level, lock, or concurrency-control primitive beyond single-statement `INSERT ... ON CONFLICT DO UPDATE` upserts, which are atomic at the statement level under Postgres default `read committed` and are already the established pattern in this codebase (`hr-import.ts:174`, `match.ts:74`). The stack connects via `pg` Pool directly (no PgBouncer/proxy — SC9 explicitly defers poolers). No plan-stage real-DB probe is required; if a reviewer disputes this, the probe target would be the `account_labels` upsert under two concurrent writers.

## Objective

Close the three operational gaps left by the MVP so the core loop (import HR → match → review orphans/ghosts) is fully drivable from the browser:

1. **CSV import UI** — a `/import` page that uploads the HR CSV to the existing `POST /api/hr-import`, renders the per-row error/warning report, and triggers + monitors `POST /api/match`. Today this requires hand-built `curl` commands.
2. **Manual labeling** — classify an orphan (or any) account as `known_shared` / `service_account` / `external_collaborator` with an optional note, persisted so it **survives re-matching**, surfaced in the accounts list and CSV export. This is the post-MVP annotation explicitly deferred by the predecessor plan's User Scenario 4.
3. **SaaS app registration UI** — an `/apps` page listing registered apps and a form for registering the Google Workspace connector (today `POST /api/saas-apps` via curl only).

## Requirements

Functional:
- F1: Upload a UTF-8 HR CSV from the browser; display `imported`/`skipped` counts and per-row `errors`/`warnings`; then run matching and observe completion without leaving the page.
- F2: Set, change, and remove a label on any SaaS account from the accounts page; label kind rendered in the list; label + note included in CSV export; label untouched by subsequent match runs.
- F3: List registered SaaS apps and register a new Google Workspace app (display name, pasted service-account JSON, admin email to impersonate, optional customer ID). Duplicate registration is rejected with a clear message.

Non-functional:
- N1: All new API routes carry a rate-limit config and live under the existing `/api` scope gates (Origin check + session auth) — nothing bypasses `app.ts`.
- N2: All new tenant-scoped data is under RLS with the exact policy pattern of C1; tenant ID is only ever taken from the session (S7), never from the client.
- N3: Credentials submitted through `/apps` are never rendered, logged, or echoed back after submission; the GET list response continues to exclude credential columns.
- N4: All user-supplied strings that reach the UI render through React text nodes (no `dangerouslySetInnerHTML`); all that reach CSV export pass the existing `csvField()` neutralization (S4).
- N5: Web bundle remains free of server code: new wire types go through `packages/api-types` (type-only) and the `apps/web/src/lib/api-types.ts` barrel (C8 invariant, D6 pattern).

## Technical approach

- **Label persistence: separate `account_labels` table, not a column on `account_links`.** The match worker upserts `account_links` on every run with `ON CONFLICT ... DO UPDATE SET identity_id, status, confidence, rule_id, evidence, computed_at` (`apps/worker/src/match.ts:74-80`) and owns that table's row lifecycle. A label column there would survive the *current* upsert but couples label lifetime to matcher implementation details (a future `DELETE`-and-rewrite refactor would silently drop labels). A dedicated table that the matcher never touches is immune by construction, and the "matcher never touches it" property is grep-enforceable (forbidden pattern in C10). Label is per SaaS account: `UNIQUE (tenant_id, saas_account_id)`.
- **Label kinds as a Postgres enum** (`account_label_kind`: `known_shared` | `service_account` | `external_collaborator`) — schema-enforced value set, mirroring how `link_status` is done. Note is optional free text, length-capped both app-side (zod `.max(500)`) and schema-side (`CHECK (char_length(note) <= 500)`).
- **API**: one new route module `apps/api/src/routes/account-labels.ts` (PUT/DELETE `/accounts/:saasAccountId/label`), plus two surgical extensions: `GET /accounts` gains a `LEFT JOIN account_labels` and a `label` field per item; `POST /saas-apps` maps unique-violation (Postgres error `23505`) to `409 { error: 'duplicate_key' }` instead of today's unhandled 500.
- **Web**: two new pages (`/import`, `/apps`) + one new client component on the existing accounts page (`LabelControl`), following the established split — server components fetch via `apiGetJson`/`apiFetch` (`apps/web/src/lib/api-server.ts`) and redirect to `/login` on 401; client components fetch relative `/api/*` through the Next rewrite (Origin gate compatible) in the style of `login/page.tsx` and `SyncControl.tsx`. Tailwind utility classes, named exports, no form library.
- **CSV upload from the browser**: `FormData` with the file appended as field name `file`; the browser sets the multipart boundary; the existing `@fastify/multipart` limits (10 MB) and `hr-import` validation are unchanged. The Next rewrite proxies multipart bodies unmodified.
- **No worker or matcher changes.** The only worker-adjacent assertion is a new integration test proving labels survive `runMatch`.

## Contracts

### C10 — Schema: `account_labels` table (migration `0003_account_labels.sql` + `tables.ts` mirror)

**Signatures / DDL (authoritative shape, exact SQL wording free):**

```sql
CREATE TYPE account_label_kind AS ENUM ('known_shared', 'service_account', 'external_collaborator');

CREATE TABLE account_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  saas_account_id uuid NOT NULL REFERENCES saas_accounts(id) ON DELETE CASCADE,
  kind account_label_kind NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, saas_account_id)
);
-- + the exact C1 RLS block: ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ... USING/WITH CHECK
--   (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- + GRANT SELECT, INSERT, UPDATE, DELETE ON account_labels TO opensmp_app;
```

`packages/schema/src/tables.ts`: add `accountLabels` Drizzle mirror table + add it to `tenantScopedTables` (member set grows 7 → 8).

**Invariants:**
- *Schema-enforced*: one label per account (`UNIQUE (tenant_id, saas_account_id)`); label kind restricted to the enum; note ≤ 500 chars (`CHECK`); label rows die with their account (`ON DELETE CASCADE` on `saas_account_id`); tenant isolation (RLS `USING`/`WITH CHECK`, identical predicate to C1's other 7 tables — empty-GUC hardening via `NULLIF` included).
- *App-enforced*: matcher/worker never read or write `account_labels` (see forbidden patterns); `updated_at` bumped on upsert by the C11 route.
- **Member-set derivation (R42) — "every tenant-scoped table is RLS-protected and listed in `tenantScopedTables`"**: defining primitive is a `tenant_id uuid` column in a `CREATE TABLE`. Derivation: `rg -n "tenant_id uuid" packages/schema/migrations/*.sql` → after this migration: `identities`, `saas_apps`, `saas_accounts`, `account_links`, `discovery_events`, `users`, `sessions`, `account_labels` (8; `tenants` itself is the root and excluded by design, as documented at `tables.ts:179`). Each member must have the RLS block in SQL and an entry in `tenantScopedTables`. No indirect members: no raw-SQL table creation exists outside `packages/schema/migrations/`.

**Forbidden patterns:**
- `pattern: account_labels` in `packages/matcher/**` and `apps/worker/src/**` — reason: label lifecycle must be invisible to matching; this grep is the enforcement of the "survives re-matching by construction" design.
- `pattern: DROP TABLE|DELETE FROM account_labels` in `packages/schema/migrations/0003*` — reason: migration is purely additive (R24).

**Acceptance criteria:**
- `runMigrations` applies 0003 idempotently on a fresh DB and on a DB already at 0002.
- Integration: as `opensmp_app` with tenant-A GUC set, tenant B's label rows are invisible (SELECT) and unwritable (INSERT with tenant B's id fails `WITH CHECK`); with empty/unset GUC, zero rows visible.
- `packages/schema/test` RLS member-set test (if present) extended to 8 tables; `tenantScopedTables` export contains `accountLabels`.

### C11 — Label API + accounts-list extension (`apps/api/src/routes/account-labels.ts`, `accounts.ts`, `packages/api-types`)

**Signatures:**

```ts
// packages/api-types/src/index.ts (additions)
export type AccountLabelKind = 'known_shared' | 'service_account' | 'external_collaborator';
export type AccountLabel = { kind: AccountLabelKind; note: string | null };
export type AccountLabelResponse = { accountId: string; kind: AccountLabelKind; note: string | null };
// AccountListItem gains:  label: AccountLabel | null;

// apps/api/src/routes/account-labels.ts
export function registerAccountLabelsRoute(app: FastifyInstance, deps: AppDeps): void;
// PUT    /accounts/:saasAccountId/label   body { kind, note? }  → 200 AccountLabelResponse | 400 | 404
// DELETE /accounts/:saasAccountId/label                         → 204 | 400 | 404
```

- Params zod: `{ saasAccountId: z.string().uuid() }` strict → 400 `{ error: 'invalid_params' }`.
- PUT body zod: `{ kind: z.enum([...]), note: z.string().min(1).max(500).optional() }` strict → 400 `{ error: 'invalid_body' }`. Absent note stores NULL; an explicit empty-string note is rejected 400 by `.min(1)` — this boundary is intentional and test-covered (T-L3). (Round-1 SEC-F4.)
- Both routes: `config: { rateLimit: MUTATION_RATE_LIMIT }`; `tenantId`/`userId` from `req.sessionContext` only.
- PUT flow inside one `withTenant`: `SELECT id FROM saas_accounts WHERE id = $1` — no row → 404 `{ error: 'not_found' }` (RLS makes cross-tenant indistinguishable from nonexistent); else upsert `INSERT ... ON CONFLICT (tenant_id, saas_account_id) DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note, updated_at = now()` and return the row. `created_by` is deliberately NOT in the `DO UPDATE SET` list: it preserves the ORIGINAL setter (matching its name and the non-bumped `created_at`), which is the attribution SC12's future audit history builds on; `updated_at` alone tracks the last edit. (Round-1 FN-F3.)
- DELETE flow inside one `withTenant`: same existence check → 404; `DELETE FROM account_labels WHERE tenant_id = $ AND saas_account_id = $` → 204 whether or not a label row existed (idempotent).
- `GET /accounts` (`accounts.ts`): add `LEFT JOIN account_labels lbl ON lbl.saas_account_id = sa.id`, select `lbl.kind AS label_kind, lbl.note AS label_note`, map to `label: row.label_kind === null ? null : { kind, note }`. `kind`/`note` are text — no numeric-string coercion hazard (contrast `link_confidence`, D9).

**Invariants:**
- *App-enforced*: S7 — no tenant/user identifier read from client input; rate limit present on every new route (member-set below); 404 (not 403) for cross-tenant probes, matching RLS-backed non-disclosure.
- *Schema-enforced*: everything listed under C10 (the route relies on, and never re-implements, the UNIQUE/CHECK/RLS constraints).
- **Member-set derivation (R42) — "every route registration carries a rate-limit config"**: defining primitive `rg -n "app\.(get|post|put|delete)\(" apps/api/src/routes`. Current members (10): logout, saas-apps POST/GET, sync POST, match POST, jobs GET, accounts GET, login POST, hr-import POST, events GET — all carry `config.rateLimit` today. This plan adds 2 members (label PUT/DELETE), both `MUTATION_RATE_LIMIT`. Post-change set: 12/12 with explicit config.

**Forbidden patterns:**
- `pattern: req\.body.*tenantId|tenantId.*req\.body` in `apps/api/src/routes/account-labels.ts` — reason: S7.
- `pattern: label` additions in `apps/api/src/routes/accounts.ts` query without going through `withTenant` — enforcement: the file must contain exactly one `tx.query` call site as today (no second query path).

**Acceptance criteria:** see Testing strategy (integration tests T-L1…T-L8).

**Consumer-flow walkthrough:**
- Consumer 1 — accounts page server component (`apps/web/src/app/accounts/page.tsx`): reads `item.label?.kind` to render a label chip next to the status chip, and passes `item` (including `label`) into `LabelControl` and `CsvExportButton`. Needs `label.kind`, `label.note` — both present in shape.
- Consumer 2 — `LabelControl` client component (C14): reads `accountId` to build the `PUT/DELETE /api/accounts/${accountId}/label` URL, reads `label?.kind`/`label?.note` to prefill its form and decide set-vs-clear affordance. All present (`accountId` already in `AccountListItem`).
- Consumer 3 — `buildAccountsCsv` (`apps/web/src/lib/csv-export.ts`, C14): reads `item.label?.kind ?? ''` and `item.label?.note ?? ''` into two new columns; both routed through `csvField()` (note is attacker-influenceable → S4 neutralization mandatory). Present in shape.
- Consumer 4 — `LabelControl` PUT response: reads `AccountLabelResponse.kind`/`note` only to confirm success before `router.refresh()`; `accountId` echoes the path param. Sufficient.
- Consumer 5 — integration tests: assert full shape incl. `typeof` checks (D9 discipline). No additional fields required.

### C12 — Import page (`apps/web/src/app/import/page.tsx`) + NavBar entries

**Signatures:**

```ts
// apps/web/src/app/import/page.tsx  — 'use client'; default-exported page component (Next.js requires default export for pages)
// State machine: idle → uploading → uploaded(HrImportResponse) → matching(jobId) → done | failed
// apps/web/src/components/NavBar.tsx — add links: /import ("Import"), /apps ("Apps")
```

- Upload: `<input type="file" accept=".csv,text/csv">` → `FormData.append('file', file)` → `fetch('/api/hr-import', { method: 'POST', body: formData })` (no manual Content-Type; browser sets boundary; Next rewrite proxies; Origin gate satisfied same-origin).
- Response rendering: `imported` / `skipped` counts; `errors` and `warnings` tables (`row`, `message`) rendered as React text nodes. API error strings (`'file must be UTF-8 encoded'`, `'malformed CSV'`, `'too many rows (max 20000)'`, `'file exceeds 10MB limit'`, `'file is required'`) mapped to user-facing messages (R37) with the raw error string preserved in smaller print for support.
- Match trigger: button enabled after a successful import (also usable standalone) → `POST /api/match` → `202 { jobId }` → poll `GET /api/jobs/${jobId}` every 1.5 s, bounded by a 120 s wall-clock timeout — both reusing `SyncControl.tsx`'s existing constants (`POLL_INTERVAL_MS = 1500`, `POLL_TIMEOUT_MS = 120_000`), which are factored out into a shared module (e.g. `apps/web/src/lib/polling.ts`); `SyncControl.tsx` itself MUST be retrofitted in the same change to import from that module (its local `const` declarations are removed), so exactly one copy of each constant exists repo-wide (R2; round-2 FN-F1). Poll until `state` ∈ {`completed`, `failed`} OR the timeout fires; timeout transitions to a terminal timed-out state with a user-visible message ("Matching is taking longer than expected — check Events or retry") and a retry affordance (R38; round-1 FN-F1/FN-F2). On `completed` show a link to `/accounts`.
- 401 on any fetch → `router.push('/login')` (client-side counterpart of the server-component `redirect`).

**Invariants** (app-enforced): no `dangerouslySetInnerHTML` (error messages embed CSV-derived attacker-controlled text, e.g. `unknown status "<payload>"`); no `@open-smp/schema`/drizzle import in `apps/web` (C8); polling loop must terminate via terminal job state, the 120 s wall-clock timeout, or component unmount cleanup (`clearInterval`/abort) — never solely via server-reported state; poll interval/timeout constants imported from the shared module, not re-declared.

**Forbidden patterns:**
- `pattern: dangerouslySetInnerHTML` in `apps/web/src/**` — reason: C8/S4.
- `pattern: from '@open-smp/schema'` in `apps/web/src/**` — reason: C8 no-server-code invariant.
- `pattern: Content-Type.*multipart` in `apps/web/src/app/import/**` — reason: hand-setting the multipart header drops the boundary and breaks upload; the browser must set it.
- `pattern: POLL_INTERVAL_MS\s*=|POLL_TIMEOUT_MS\s*=` in `apps/web/src/**` outside `apps/web/src/lib/polling.ts` — reason: R2 — the shared module is the single declaration site; a local re-declaration (including the pre-existing one in `SyncControl.tsx`, which this change removes) reintroduces the duplicate-constant smell.

**Acceptance criteria:** manual script `docs/manual-tests/ui-import.md` covering: happy path (fixture CSV → counts render → match → completed → accounts link); error CSV (bad status value → row-numbered error table); non-UTF-8 file (Shift_JIS fixture → mapped message); oversized file rejection; unauthenticated access redirects to login. Classification: VE2 `verifiable-local` (manual).

**Consumer-flow walkthrough:** this page is a pure consumer; produced shapes are pre-existing (`HrImportResponse`, `{ jobId }`, `JobState`). Walkthrough: page reads `imported`, `skipped`, `errors[].row/message`, `warnings[].row/message` (all present in `HrImportResponse`); reads `jobId` from match 202 body (present); reads `state` from `JobState` (present; `result` intentionally unused). No producer change needed → no new shape to lock.

### C13 — SaaS apps page (`apps/web/src/app/apps/page.tsx` + `SaasAppForm`) + duplicate-key 409

**Signatures:**

```ts
// apps/web/src/app/apps/page.tsx — server component; apiGetJson<SaasAppListResponse>('/saas-apps'); 401 → redirect('/login')
// apps/web/src/components/SaasAppForm.tsx — 'use client'; export function SaasAppForm(): JSX.Element
// packages/api-types additions:
export type SaasAppListItem = { id: string; key: string; displayName: string };
export type SaasAppListResponse = { items: SaasAppListItem[] };
export type SaasAppCreateResponse = { id: string; key: string; displayName: string };
// apps/api/src/routes/saas-apps.ts POST: on Postgres unique violation → 409 { error: 'duplicate_key' }
// Scoped catch: err.code === '23505' AND err.constraint === 'saas_apps_tenant_id_key_key'
// (the UNIQUE (tenant_id, key) constraint's name); anything else rethrows. Matching on
// code alone would mis-map future unique constraints on the same insert path. (Round-1 SEC-F3.)
```

- Form fields: Display name (text); Service account JSON (textarea, paste of the downloaded key file); Admin email to impersonate (email input); Customer ID (optional text). `key` is fixed to `'google-workspace'` (the only registered connector — `apps/worker/src/connectors.ts:27`); rendered as a disabled select for forward compatibility.
- Client-side pre-validation: `JSON.parse` the textarea; must be an object containing string `client_email` and `private_key` (the two fields `GoogleWorkspaceConnector` reads, `google-workspace/src/index.ts:123`); on failure show inline error without submitting.
- Submit body: `{ key: 'google-workspace', displayName, credentials: { serviceAccountJson: <raw textarea string>, impersonateAdminEmail, ...(customerId ? { customerId } : {}) } }` — exactly the record shape `buildGoogleWorkspaceConnector` consumes (`apps/worker/src/connectors.ts:10-21`). Values are strings → passes the existing `z.record(z.string(), z.string())`.
- Responses: 201 → clear ALL form state (esp. credentials textarea) + `router.refresh()`; 409 → "This app is already registered for your tenant"; 400 → validation message; 401 → `router.push('/login')`.
- The existing `saas_apps` list on the page shows `displayName` + `key` only (the GET shape has nothing else — by design).

**Invariants:**
- *App-enforced (API)*: 23505 mapping is scoped to the `saas_apps` insert only (not a blanket error handler); response bodies on every path remain free of `credentials`-derived data.
- *App-enforced (web)*: credential inputs are never written to `console.*`, never persisted to `localStorage`/`sessionStorage`; inputs carry `autoComplete="off"`; form state is cleared on success. N3.
- *App-enforced (web, error surfaces — round-1 SEC-F2/F7)*: every user-visible or thrown error message in `SaasAppForm.tsx` comes from a fixed string table keyed by failure class / HTTP status (`invalid_json`, `missing_fields`, 400, 401, 409, network). The message construction MUST NOT interpolate: the raw textarea value or any substring of it, the `JSON.parse` exception's own `message` (parsers echo input snippets), or the request body. This closes the leak path where a pasted service-account private key reaches a React error overlay, a future `window.onerror`/error-tracking hook, or a support screenshot — surfaces the console/storage bans do not cover. **Intentional idiom divergence (round-2 FN-F2)**: the rest of the codebase narrows caught errors with `err instanceof Error ? err.message : ...` (e.g. `SyncControl.tsx:59`); `SaasAppForm.tsx` deliberately breaks from that convention — caught values are classified and DISCARDED, never read for their message. The file must carry a short comment stating this so a future maintainer does not "fix" it back to the codebase idiom and silently reopen the leak.
- *Schema-enforced*: `UNIQUE (tenant_id, key)` (pre-existing) is what the 409 surfaces.

**Forbidden patterns:**
- `pattern: console\.(log|error|warn|info|debug)` in `apps/web/src/components/SaasAppForm.tsx` — reason: N3, credential values must not reach the console even on error paths.
- `pattern: localStorage|sessionStorage` in `apps/web/src/components/SaasAppForm.tsx` — reason: N3.
- `pattern: JSON\.stringify\((body|credentials)` in `apps/web/src/components/SaasAppForm.tsx` — reason: SEC-F7 — serializing the request body/credentials into any string risks echoing the private key into UI error state.
- `pattern: (err|error|e)\.message` in `apps/web/src/components/SaasAppForm.tsx` — reason: SEC-F2 — caught-exception messages (esp. `JSON.parse`) can echo input snippets; error text must come from the fixed string table only.
- `pattern: credentials` in `apps/web/src/app/apps/page.tsx` — reason: the server component must not handle credential data at all (form is client-only, list shape has no credentials).

**Acceptance criteria:** integration test T-S1 (duplicate POST → 409, body `{ error: 'duplicate_key' }`, first row unchanged); existing no-credential-leak test still green; manual script `docs/manual-tests/ui-saas-apps.md`: register with dummy-but-well-formed SA JSON → appears in list; malformed JSON → inline error, no request sent (verify via devtools network tab); duplicate → 409 message; credential textarea empty after success. VE1 note: live sync with real credentials remains `blocked-deferred`; registration itself is `verifiable-local`.

**Consumer-flow walkthrough:**
- Consumer 1 — `/apps` server component: reads `items[].id` (React key), `items[].key`, `items[].displayName`. All in `SaasAppListResponse`.
- Consumer 2 — `SaasAppForm`: reads only the status code + `error` field of failure bodies; success body unused beyond confirmation. Sufficient.
- Consumer 3 — (pre-existing) `SyncControl` on `/accounts` consumes saas-app ids for sync triggering — unchanged by this plan; the new page does not replace it. No new field needed.
- The wire types formalize shapes that already exist at runtime (`saas-apps.ts:18,57`); producer emits them today. `SaasAppListItem`/`SaasAppCreateResponse` move into `api-types` so web imports the single source (N5, D6 pattern) — API file switches its local types to these imports.

### C14 — Accounts page label UI + CSV export columns (`LabelControl.tsx`, `accounts/page.tsx`, `csv-export.ts`)

**Signatures:**

```ts
// apps/web/src/components/LabelControl.tsx — 'use client'
export function LabelControl({ accountId, label }: { accountId: string; label: AccountLabel | null }): JSX.Element;
// accounts/page.tsx: render label chip (label.kind, humanized) + <LabelControl .../> per row; pass items (now incl. label) to CsvExportButton unchanged
// csv-export.ts: CSV_HEADER += ['label', 'labelNote']; row fields += [item.label?.kind ?? '', item.label?.note ?? ''] — both through csvField()
```

- `LabelControl` behavior: compact popover/inline form (kind `<select>` with the three kinds + humanized labels, note `<input maxLength={500}>`, Save, and Clear shown only when a label exists). Save → `PUT /api/accounts/${accountId}/label`; Clear → `DELETE`; both then `router.refresh()` (server component re-fetches, chip/CSV data update). 401 → `router.push('/login')`; 404 → "Account no longer exists — refresh"; disabled+spinner while in flight.
- Rendered on every row regardless of link status (labeling is not restricted to orphans — a ghost service account is a legitimate labeling target); the *scenario* driving the feature is orphan review.
- Kind display strings: `known_shared` → "Known shared", `service_account` → "Service account", `external_collaborator` → "External collaborator" — defined once in a small map used by both chip and select (R2).

**Invariants** (app-enforced): note flows API → list → CSV only through `csvField()` (S4); no local mutation of the `items` prop (refresh-driven state); `maxLength` on the note input mirrors, but does not replace, the API/schema caps.

**Forbidden patterns:**
- `pattern: toFixed|Number\(` additions in `LabelControl.tsx` — reason: label carries no numerics; any numeric coercion signals shape confusion (D9 hygiene).
- (C12's `dangerouslySetInnerHTML` / schema-import bans cover this file too.)

**Acceptance criteria:** unit test extension of `apps/web/test/csv-export.test.ts`: labeled item emits kind+note columns, note beginning with `=`/`+`/`-`/`@` is neutralized with leading `'`; unlabeled item emits empty cells; header row includes the two new columns. Manual script `docs/manual-tests/ui-labeling.md`: set → chip appears; edit → note updates; clear → chip gone; re-run match from `/import` → label still present (cross-checks C10's survival guarantee end-to-end); CSV export contains label columns. VE2 `verifiable-local` (manual) for the UI; CSV logic `verifiable-local` (unit).

**Consumer-flow walkthrough:** consumes C11's shapes only; the two produced artifacts (chip, CSV columns) are terminal (human-read). CSV consumers (spreadsheets) receive neutralized text per S4 — no downstream code consumer.

## Go/No-Go Gate

| ID  | Subject                                                        | Status |
|-----|----------------------------------------------------------------|--------|
| C10 | `account_labels` schema, RLS, enum, mirror, member-set 7→8      | locked |
| C11 | Label PUT/DELETE API + `GET /accounts` label field + wire types | locked |
| C12 | `/import` page (upload → report → match → poll) + NavBar        | locked |
| C13 | `/apps` page + `SaasAppForm` + POST 23505→409 + wire types      | locked |
| C14 | Accounts label UI (`LabelControl`) + CSV label columns          | locked |

## Testing strategy

Runner: existing Vitest projects (`unit`, `integration`); Testcontainers postgres:16 / redis:7 pinned. All numeric/typed assertions follow the D9 discipline: assert `typeof`, not just presence.

Integration — extend `apps/api/test/api.integration.test.ts` (reusing `seedTenant`/`seedUser`/`loginAndGetCookie`/`app.inject`):
- **T-L1** PUT label happy path: 200; body `{ accountId, kind, note }` with `typeof kind === 'string'`; DB roundtrip shows row with `updated_at`.
- **T-L2** PUT upsert: second PUT with different kind/note → 200; asserted via direct SQL `SELECT * FROM account_labels WHERE tenant_id = $1 AND saas_account_id = $2` — row count exactly 1, `kind`/`note` match the second PUT, `updated_at` advanced, `created_by` unchanged from the first PUT (original-setter semantics) — NOT inferred from API responses alone. (Round-1 TEST-F2, FN-F3.) Additional case (round-2 FN-F3): after the original setter's `users` row is deleted (`ON DELETE SET NULL` → `created_by` NULL), a subsequent PUT by another user leaves `created_by` NULL — not resurrected to the second user (the column is absent from `DO UPDATE SET`). Implementation note (round-3 R3-T1): the test must delete the setter's `sessions` row(s) first — per the existing `DELETE FROM sessions WHERE token_hash = $1` pattern in `api.integration.test.ts` — since `sessions.user_id` has no cascading `ON DELETE` action and the `users` delete would otherwise fail with a 23503 FK violation.
- **T-L3** Validation: unknown kind → 400 `invalid_body`; note of 501 chars → 400; explicit empty-string note → 400 (the `.min(1)` boundary is intentional — SEC-F4); non-UUID param → 400 `invalid_params`; extra body field → 400 (strict).
- **T-L4** PUT on nonexistent account id → 404, AND direct DB check: no `account_labels` row created (RT8 mutation-absence).
- **T-L5** Cross-tenant: seed a REAL account owned by tenant A (valid UUID attached to tenant A's saas_app — not a random UUID, so the 404 exercises RLS indistinguishability rather than trivial not-found — SEC-F1); a tenant-B session PUTs a label on that account → 404; direct DB check: tenant-A's data untouched, no `account_labels` row created under either tenant (RT8).
- **T-L6** DELETE: existing label → 204 and row gone (direct DB check); repeat DELETE → 204 (idempotent); DELETE on nonexistent account → 404.
- **T-L7** `GET /accounts`: labeled account item has `label: { kind, note }` (typeof checks); unlabeled has `label: null`; CSV-relevant fields unchanged otherwise.
- **T-L8** Denial-path mutation absence: the existing auto-covering Origin/401 sweeps (driven by the `onRoute`-populated `app.apiRoutes`) already assert the 403/401 STATUS for the new routes once registered — T-L8 does not duplicate that (TEST-F3). Instead it asserts what the sweeps cannot: after an Origin-mismatched PUT `/accounts/:id/label` (403), a direct DB query shows no `account_labels` row was created (RT8).
- **T-L9** Rate-limit config sweep (TEST-F1): extend the `onRoute` capture in `app.ts` to also record `routeOptions.config?.rateLimit`; a sweep test asserts EVERY `/api`-scoped route carries a **truthy object** rate-limit config (`typeof === 'object'` — NOT a mere non-null check, so a future explicit `rateLimit: false` opt-out fails the sweep loudly instead of passing as "configured"; round-2 T2). This turns the C11 R42 member-set claim (12/12) into a red-able test that fails when any future route omits `config.rateLimit`. Prove it can fail (RT7) by temporarily stripping one route's config and confirming the sweep goes red before restoring it (the strip-and-confirm-red proof is the only accepted RT7 evidence for this test; round-2 T1).
- **T-S1** POST `/saas-apps` twice with same key → first 201, second 409 `{ error: 'duplicate_key' }`; GET still returns one item; no credential fields in any response.

Integration — worker (`apps/worker/test/match.integration.test.ts` extension):
- **T-W1** Label survives re-match: seed account + identity, run `runMatch`, insert label, mutate HR data so status flips (e.g. orphan → matched), run `runMatch` again → `account_links.status` changed AND `account_labels` row byte-identical (kind, note, updated_at unchanged) AND the surviving row's `tenant_id` still equals the seeded tenant (tenant-scoping untouched by the cross-cutting worker operation — SEC-F8).

Schema (`packages/schema/test` extension):
- **T-C1** `tenantScopedTables` contains `accountLabels`; migration applies from-scratch and from-0002; RLS visibility test per C10 acceptance.

Unit:
- **T-U1** `csv-export.test.ts` extension per C14 acceptance (label columns, neutralization, empty cells, header).

Manual (VE2): `docs/manual-tests/ui-import.md`, `ui-saas-apps.md`, `ui-labeling.md` as specified in C12/C13/C14. Existing `ui-orphan-list.md` re-run to confirm accounts page regression-free.

Gate before Phase 3: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration` all green; forbidden-pattern conformance greps for ALL C10–C14 patterns executed and clean (same Phase 2-4 mechanism as the predecessor plan — TEST-F6); `docker compose up -d --build` smoke (R32): all five services healthy, `/import`, `/apps`, `/accounts` render, one full happy-path loop executed manually.

## Considerations & constraints

- **Renaming/renumber safety**: `AccountListItem.label` is additive; existing consumers (accounts page, CSV, tests) tolerate the extra field only because we update them in the same change — TypeScript strictness makes the compiler enumerate them (N5 single-source pays off here).
- **`saas-apps.ts` local-type migration** (C13) changes no runtime behavior; wire shapes are already emitted today.
- **`/api/jobs/:jobId` reuse**: match polling uses the existing jobs route; no new job-status surface.
- **Postgres error-code sniffing** (23505) is driver-stable (`pg` exposes `err.code`); scoped catch, rethrow anything else (no error swallowing).
- **Label kind extensibility**: adding a 4th kind later = enum `ALTER TYPE ... ADD VALUE` migration + zod enum + display map + CSV unaffected. Deliberately NOT config-driven (YAGNI).

### Scope contract

| ID   | Deferred item                                                                 | Owner / trigger |
|------|-------------------------------------------------------------------------------|-----------------|
| SC8  | *(carried from predecessor)* E2E browser test infra. **Anti-Deferral cost-justification for keeping it deferred despite UI growing 3→5 pages**: the three new surfaces are thin clients over APIs that get full integration coverage in this plan (T-L1…T-S1); the failure modes E2E would uniquely catch (wiring, rewrite proxying, multipart boundary) are covered by the mandatory manual scripts + compose smoke gate; standing up Playwright (browser deps in CI, auth fixtures, tenant seeding) is a self-contained plan of comparable size to this one and would starve the feature work. Deferral cost accepted: manual re-runs of 4 scripts (3 new + `ui-orphan-list.md`), realistically **~45–60 min** per UI-touching change (TEST-F5 corrected the earlier ~15 min figure, which was per-script). Trigger to un-defer: next plan that adds or materially modifies a page — evaluate against this corrected cost. | future `e2e-playwright-bootstrap` plan |
| SC12 | Label audit history (who set what when; only latest label + original-setter `created_by` kept; no `discovery_events` emission). **Security note (round-1 SEC-F6)**: labeling is a *review-suppressing* control — it marks orphan/ghost accounts as benign. Without an audit trail, a compromised admin session could mislabel an account it controls as `known_shared` to deflect scrutiny, and later edits erase the trace. Tolerable under the current single-admin-per-tenant threat model; MUST be prioritized in labeling-v2, and becomes blocking the moment multi-user-per-tenant roles land. | future labeling-v2 |
| SC13 | Accounts list filtering by label (`?labeled=`, `?labelKind=` query params)     | future labeling-v2 |
| SC14 | SaaS app edit / delete / credential re-entry UI (rotation worker exists; UI absent) | future apps-admin plan |
| SC15 | Bulk labeling (multi-select rows)                                              | future labeling-v2 |
| SC16 | Import history / past-import listing on `/import` (page is stateless per visit) | future; needs `discovery_events` surfacing design |

## User operation scenarios

1. **Monthly HR sync (情シス, F1)**: Open `/import` from nav → choose `hr-2026-07.csv` → Upload → "142 imported, 3 skipped" with 3 row-numbered errors (`row 17: unknown status "休職"`) → fix CSV locally, re-upload (idempotent upsert) → 145/0 → Run matching → spinner → completed → follow link to `/accounts?status=orphan`.
2. **Orphan triage (F2)**: On `/accounts?status=orphan`, the `ci-bot@corp.example` row is a known CI service account → Label → kind "Service account", note "Jenkins deploy bot, owner: infra" → Save → chip appears → Export CSV → columns `label,labelNote` present → next month's import + re-match → chip still there.
3. **New tenant bootstrap (F3)**: Fresh tenant admin opens `/apps` → sees empty list → pastes downloaded service-account JSON, enters `admin@corp.example` → Register → appears in list, textarea cleared → goes to `/accounts`, runs sync (existing SyncControl). Pasting truncated JSON → inline "invalid service account JSON" before any network request. Clicking Register twice → second attempt 409 "already registered".
4. **Label lifecycle (F2)**: An orphan gets matched after HR fixes a typo'd email → account now `matched` but still carries stale "External collaborator" label → user opens Label → Clear → chip gone. (Auto-expiry of labels on status change is deliberately out — human judgement stays authoritative; noted under SC12/labeling-v2.)
5. **Session expiry mid-flow**: Any fetch from `/import`, `/apps`, or `LabelControl` hitting 401 routes to `/login`; after re-login the user returns via nav (no deep-link restore — matches existing pages' behavior).

## Implementation Checklist

Step 2-1 impact analysis (2026-07-24). Mechanical scans: `scan-shared-utils.sh` ran (sparse output — repo has no `lib/`-style shared dirs at root; monorepo packages ARE the shared layer); `build-codebase-fingerprint.sh` FAILED on macOS bash 3.2 (`declare -A` unsupported) — recorded as tooling deviation; manual inventory below substitutes. CI gate parity: workflow gates = pnpm lint / typecheck / test:unit / test:integration / compose-smoke — all runnable locally (compose smoke via docker compose); no CI-only grep gates; no pre-pr aggregate script exists.

### Files to create
- `packages/schema/migrations/0003_account_labels.sql` (C10)
- `apps/api/src/routes/account-labels.ts` (C11)
- `apps/web/src/lib/polling.ts` (C12 — extracted POLL_INTERVAL_MS / POLL_TIMEOUT_MS / pollJob)
- `apps/web/src/app/import/page.tsx` (C12)
- `apps/web/src/app/apps/page.tsx` (C13)
- `apps/web/src/components/SaasAppForm.tsx` (C13)
- `apps/web/src/components/LabelControl.tsx` (C14)
- `docs/manual-tests/ui-import.md`, `ui-saas-apps.md`, `ui-labeling.md`

### Files to modify
- `packages/schema/src/tables.ts` — accountLabels mirror + tenantScopedTables (7→8)
- `packages/schema/test/*` — member-set/RLS test extension (T-C1; check existing tables.test.ts assertion of 7)
- `packages/api-types/src/index.ts` — AccountLabelKind/AccountLabel/AccountLabelResponse; AccountListItem.label; SaasAppListItem/SaasAppListResponse/SaasAppCreateResponse
- `apps/api/src/app.ts` — onRoute capture extended with rateLimit config presence (T-L9); register account-labels route in authenticated scope
- `apps/api/src/routes/accounts.ts` — LEFT JOIN account_labels; label field mapping
- `apps/api/src/routes/saas-apps.ts` — 23505+constraint-name → 409; switch local types to api-types imports
- `apps/api/test/api.integration.test.ts` — T-L1..T-L9, T-S1
- `apps/worker/test/match.integration.test.ts` — T-W1
- `apps/web/src/lib/api-types.ts` — re-export new wire types
- `apps/web/src/lib/csv-export.ts` + `apps/web/test/csv-export.test.ts` — label/labelNote columns (T-U1)
- `apps/web/src/components/SyncControl.tsx` — retrofit: import from polling.ts, local consts removed
- `apps/web/src/components/NavBar.tsx` — Import / Apps links
- `apps/web/src/app/accounts/page.tsx` — label chip + LabelControl per row

### Shared assets that MUST be reused (no reimplementation)
- `withTenant` (`packages/schema/src/db.ts`) — every route DB access
- `MUTATION_RATE_LIMIT` / `LIST_RATE_LIMIT` (`apps/api/src/rate-limits.ts`)
- `csvField`/`neutralizeCell`/`quoteCsvCell` (`apps/web/src/lib/csv-export.ts`)
- `apiFetch`/`apiGetJson` (`apps/web/src/lib/api-server.ts`) for server components
- `POLL_INTERVAL_MS`/`POLL_TIMEOUT_MS`/`pollJob` — single source becomes `apps/web/src/lib/polling.ts`
- Test helpers: `seedTenant`/`seedUser`/`loginAndGetCookie`/`importCsv` + Origin/401 sweeps (`apps/api/test/api.integration.test.ts`)
- RLS block + GRANT pattern: copy verbatim shape from `0001_init.sql:100-166`

### Patterns to follow consistently
- zod `.strict()` + `safeParse` → 400 `{error:'invalid_*'}`; error shape `{error:'snake_case'}`
- tenantId/userId ONLY from `req.sessionContext` (S7)
- Route registration inside the `authenticated` scope in app.ts (gates auto-apply)
- Client components fetch relative `/api/*`; server components use api-server helpers + `redirect('/login')` on 401
- D9: integration tests assert `typeof`, direct SQL roundtrips
