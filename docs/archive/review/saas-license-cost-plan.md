# Plan: saas-license-cost

Cycle 7. Branch: `feature/saas-license-cost`.

Revision 2 — after plan-review round 1, run with three disjoint measurement missions
against the live stack. **37 findings, four Critical**, and the Criticals landed on the
parts revision 1 was most confident about. The response is not 21 patches; it is the
removal of the thing that generated them.

- **`idle` is cut from this cycle.** Revision 1 recorded in its own scope contract that
  per-application usage telemetry does not exist, and then defined a reclaimable reason
  that needs it. Three of the four Criticals and two Majors were that decision arriving in
  different disguises: the API cannot reach a connector capability at all (`apps/api` does
  not depend on `connectors-core`, and the capability sat on an instance that only exists
  once credentials are decrypted); the test written for it could not fail, because a
  CSV-only application has **zero** `saas_accounts` rows by construction, so `idle` is 0
  whether the eligibility conjunct is present or deleted; and `idle` was the only reason
  that overlapped another, making `reclaimable.total` double-count the most ordinary case
  there is — a leaver whose account is still live. Removing it also removes the connector
  interface extension, the new `apps/api → connectors-core` edge, and the roadmap-trigger
  question that came with them. What remains is derived from evidence this product
  actually holds. Recorded as **SCL7**.
- **C2's validation moves to the boundary.** Revision 1 declared "app-enforced for shape,
  schema-enforced for values" while wrapping the whole file in one transaction and
  demanding row-scoped errors. Measured: the first CHECK violation aborts the transaction
  and every later statement returns `current transaction is aborted` — a 500 that rolls
  back the rows already applied. `hr-import` avoids this by deciding every value in
  `validateRow` before the transaction opens, and C2 now does the same.
- **`assigned` stops counting accounts that no longer exist.** `sync` is upsert-only and
  never reaps, so an account deleted upstream keeps `account_status = 'active'` forever.
  Left alone, the feature's headline number would be permanently wrong in the direction
  that hides waste.
- **Two forbidden patterns were false against the tree they were written for**, and one
  contradicted an existing control test that *requires* the literal it banned. Both are
  re-derived; one is deleted with `idle`.

## Project context

- **Type**: mixed — service (Fastify API, BullMQ worker) + web app (Next.js 15) +
  library packages (`schema`, `connectors/*`, `api-types`, `crypto`, `matcher`, `queues`).
- **Test infrastructure**: unit + integration (vitest, two projects; integration uses
  Testcontainers against real Postgres 16) + E2E (Playwright) + CI (GitHub Actions:
  `checks`, `integration`, `compose-smoke`, all three required on `main` as of cycle 7).
- **Verification environment constraints**:
  - **VE1 — no second Google Workspace tenant.** Cross-tenant isolation is proven against
    two seeded tenants in Postgres (`verifiable-local`), which is where the RLS invariant
    lives.
  - **VE2 — no accounting/invoice system.** Out of scope by decision; no contract depends
    on it.
  - **VE3 — currency rendering is locale-dependent.** Asserted on the emitted string, not
    on a browser locale (`verifiable-local`).
  - **VE4 — no real paid SaaS contract data.** Every figure in tests and seed is
    synthetic (`verifiable-local`).
  - **VE5 — the E2E login budget is 5/min/IP and the suite consumes 5/5** (carried by
    prior cycles, omitted from revision 1). Measured: `e2e/playwright.config.ts:31` sets
    `use.storageState` globally, so a new spec inherits the shared session and adds zero
    login POSTs. C6's spec **must not** override `storageState`; with that constraint the
    budget is satisfied by construction (`verifiable-CI`).
- **Per-contract classification**: C1 `verifiable-local` (integration, Testcontainers);
  C2 `verifiable-local`; C3 `verifiable-local`; C4 `verifiable-local`; C5
  `verifiable-local` (unit + E2E); C6 `verifiable-CI` (`compose-smoke`).

## Objective

Let the product answer *what are we paying for that nobody uses?* — the first of the two
questions the SaaS-management category exists to answer, and one this repository can
answer for zero applications today.

Hold each application's contract (plan, seats, price, term), reconcile the purchased seats
against the accounts already inventoried, and surface the seats that are reclaimable:
held by someone who left, or held by nobody.

## Measured current state

Everything here was executed against PostgreSQL 16.13 during round 1, by three
independent reviewers.

- `saas_apps` has `key`, `display_name`, `credentials_enc` (**nullable**),
  `credentials_key_version`. No plan, seats, price, currency, term or renewal column.
- `saas_accounts` has `account_status` (`active`/`suspended`/`archived`), `is_admin`,
  `last_activity_at`, `last_synced_at`.
- `account_links` has `status` (`matched`/`orphan`/`ghost`/`ambiguous`) with
  `CHECK ((status IN ('orphan','ambiguous')) = (identity_id IS NULL))`, so **ghost and
  orphan are mutually exclusive by the database**, not by an application rule.
- `packages/matcher/src/match.ts:12-21` produces `ghost` only when the identity is `left`
  **and** `account_status = 'active'`; a suspended account of a leaver is stored as
  `matched`. C3 therefore reads the stored link status rather than re-deriving it.
- `apps/worker/src/sync.ts:49-72` is **upsert-only**: it never deletes, archives or reaps
  rows absent from `listUsers`, and it stamps `last_synced_at = runStartedAt` on every row
  it does see.
- `apps/api/package.json` does **not** depend on `@open-smp/connectors-core`; only
  `apps/worker` does.
- `pg` returns `numeric` as a string; `numeric(14,2)` round-trips `1234567890.99`
  digit-for-digit, **silently rounds** `10.005` to `10.01`, and raises a cast error (not a
  CHECK violation) on overflow. `'NaN'::numeric >= 0` is **true**.
- `char(3)` rejects an over-long value on a bare column INSERT but **silently truncates**
  on an explicit cast: `'USDX'::char(3)` stores `USD`.
- Referential-integrity checks run as the referenced table's owner and **bypass RLS**: a
  single-column FK accepted a row pointing at another tenant's application, invisible to
  `SELECT` in the same transaction.
- `apps/api/src/routes/saas-apps.ts` pins `key: z.literal('google-workspace')` and
  `apps/api/test/saas-app-key-pin.test.ts` asserts that declaration appears exactly once;
  the test is registered in the parity gate's `CONTROL_FILES`.
- `apps/api/src/audit.ts` exports `AUDIT_SOURCE = 'label'`, and `discovery_events.source`
  is `saas_apps.key` for sync events — so a registrable key of `label` would forge audit
  records.
- `packages/schema/test/rls.integration.test.ts:12` drives five RLS matrices from a
  **hand-written** `MEMBER_TABLES` list of 8 tables; `packages/schema/test/tables.test.ts:47`
  pins the same set again. Neither is catalog-derived.
- `apps/web/src/lib/csv-export.ts:10` lists `'-'` in `DANGEROUS_FIRST_CHARS`, so
  `neutralizeCell('-3')` returns `'-3`. The only `new Blob(` in the tree is
  `apps/web/src/components/CsvExportButton.tsx:9`, **not** `csv-export.ts`.
- The demo tenant holds exactly one orphan account, and `e2e/specs/accounts.spec.ts:66`
  asserts `toHaveCount(1)` for the tenant-scoped orphan filter.
- The CSV path in `hr-import`: strict UTF-8, BOM strip, 10 MB and 20 000-row caps,
  `MAX_ERRORS = 100`, per-row validation returning `ImportRowIssue`, upsert inside
  `withTenant` over **validated rows only**.

## Requirements

- **FR1** — a contract can be recorded for an application, including one the connectors do
  not sync.
- **FR2** — contracts enter through CSV upload, validated at the boundary, with the same
  error/warning reporting shape as `hr-import`: every rejected row carries its row number
  and no rejected row prevents a valid row from being applied.
- **FR3** — per application, the product reports purchased seats, assigned seats, and
  reclaimable seats with the reason for each reclaimable seat, where every reason is
  derived from evidence the product holds.
- **FR4** — money figures are exact, and figures in different currencies or different
  billing cycles are never combined into one number.
- **NF1** — no new external integration, no new OAuth scope, no write to any connected
  system, **and no change or extension to the connector interface**.
- **NF2** — the new table is enrolled in the repository's existing RLS sweep, and
  cross-tenant access is proven closed by that sweep rather than by a bespoke test.

## Technical approach

### Why `idle` is not here

Cut, per SCL7. The reason is worth stating where the next reader will look for it: `idle`
was the only proposed reason whose evidence the product does not collect.
`last_activity_at` is Google's `lastLoginTime` for the Google Workspace account, so for
every other application it says nothing at all — and the review proved the point twice
over, once by showing the API has no path to a connector capability and once by showing
the test written to guard the rule could not fail. It returns when a connector supplies
per-application activity, which is a connector cycle, not this one.

### Why a seat is derived and not stored

An explicit `entitlements` table would have every row derived from `saas_accounts` for as
long as the only seat evidence is "the account exists". **An active account on an
application consumes one seat**, and the entitlement table appears when something can
distinguish two accounts that cost different amounts. Recorded as SCL2.

### Money

`numeric(14,2)`, exact, never a float, and **`text` rather than `char(3)` for currency**
because `char(n)` silently truncates on an explicit cast. Rejected alternative: integer
minor units — the exponent is currency-defined (JPY 0, USD 2), so every read and write
would need a per-currency table nothing here has. `pg` returns `numeric` as a string,
which the API passes through unchanged; a JSON number is an IEEE 754 double and would
round it.

Postgres does **not** validate this value on its own: `'NaN'::numeric >= 0` is true, and
`numeric(14,2)` rounds excess scale rather than rejecting it. Both are closed at the
boundary (C2) and again in the schema (C1), in that order.

## Contracts

### C1 — `saas_contracts`, one current contract per application

New migration `0006_saas_contracts.sql`.

- **Columns**: `id`, `tenant_id`, `saas_app_id`, `plan_name text`, `seats int`,
  `unit_price numeric(14,2)`, `currency text`, `billing_cycle billing_cycle` (new enum:
  `monthly`/`annual`), `term_start date`, `term_end date`, `note text`,
  `updated_at timestamptz NOT NULL DEFAULT now()`.
- **Invariants — schema-enforced**:
  - `UNIQUE (tenant_id, saas_app_id)`.
  - **Composite FK**: `UNIQUE (tenant_id, id)` is added to `saas_apps`, and this table
    declares `FOREIGN KEY (tenant_id, saas_app_id) REFERENCES saas_apps (tenant_id, id)
    ON DELETE CASCADE`. A single-column FK does **not** hold, measured: RI checks run as
    the referenced table's owner and bypass RLS, so a contract could reference another
    tenant's application. `ON DELETE CASCADE` matches `account_labels` and keeps
    `DELETE /saas-apps/:saasAppId` working for a contract-only application — measured,
    that route pre-checks only `saas_accounts` and narrows its catch to one constraint
    name, so any other FK violation becomes a 500 on exactly the path scenario 4 creates.
  - `CHECK (seats >= 0 AND seats <= 10000000)`.
  - `CHECK (unit_price >= 0 AND unit_price = unit_price)` — the self-equality term is what
    excludes `NaN`, which passes `>= 0`.
  - `CHECK (term_end IS NULL OR term_start IS NULL OR term_end >= term_start)`.
  - `CHECK (currency ~ '^[A-Z]{3}$')`.
  - `CHECK (plan_name IS NULL OR char_length(plan_name) <= 200)`,
    `CHECK (note IS NULL OR char_length(note) <= 500)` — matching `account_labels`.
  - RLS `ENABLE` + `FORCE`, one `tenant_isolation` policy with both `USING` and
    `WITH CHECK`, `GRANT SELECT, INSERT, UPDATE, DELETE` to `opensmp_app`. Measured in
    round 1: those four grants are sufficient for C2's full statement sequence including
    the `xmax` read and FK validation.
- **Member-set obligations (R42)**: `saas_contracts` is added to
  `packages/schema/test/rls.integration.test.ts`'s `MEMBER_TABLES` and to
  `tenantScopedTables` (plus the literal in `packages/schema/test/tables.test.ts:47`).
  Neither list is catalog-derived; enrolling costs nothing because the container is
  already up in that file and the exhaustive switches force the new arms, and it buys the
  SELECT / UPDATE / DELETE / `WITH CHECK` / no-GUC matrices. A bespoke one-off RLS test
  would satisfy NF2's letter and cover less; NF2 is written to forbid that.
- **Control class**: *enforceable boundary for the values it constrains, and nothing
  more.* Postgres rejects a violating write regardless of caller — but it does **not**
  adjudicate tenant/application coherence through a single-column FK, which is why the FK
  is composite. The claim is scoped rather than blanket because revision 1's blanket
  version is what licensed C2 to skip validation.
- **Forbidden patterns**:
  - `pattern: numeric\(\d+, *[01]\)` on money columns — reason: scale below 2 truncates.
  - `pattern: (float|double precision|real)` in `0006_*.sql` — reason: money is exact.
  - `pattern: char\(3\)` for `currency` — reason: silent truncation on cast.
- **Acceptance** (integration tier, in the file that already boots the container):
  each constraint gets a case that attempts the violating write and asserts the specific
  SQLSTATE and constraint name — `23514` for each CHECK, `23505` for each UNIQUE, `23503`
  for the composite FK with another tenant's `saas_app_id`. A manual `\d` is not
  acceptance; a constraint no test names can be relaxed by a later migration with every
  gate green.

### C2 — contract CSV import

`POST /contract-import`, following `hr-import`'s shape, with `MUTATION_RATE_LIMIT`
imported from `apps/api/src/rate-limits.ts`.

- **Columns**: `app_key`, `app_name`, `plan_name`, `seats`, `unit_price`, `currency`,
  `billing_cycle`, `term_start`, `term_end`, `note`.
- **All values are validated in `validateRow`, before any transaction opens.** This is the
  correction that matters: `seats`, `unit_price`, `currency`, `billing_cycle` and the term
  ordering are decided in the application, and C1's constraints are defence-in-depth
  against the non-API writer C1 names — not the primary validator. Measured, the previous
  arrangement could not produce a row-scoped error at all, because the first CHECK
  violation aborts the transaction and every subsequent statement fails with
  `current transaction is aborted`.
  - `app_key`: required, trimmed, lowercased, `^[a-z0-9][a-z0-9-]{0,63}$`, and **rejected
    when it equals `AUDIT_SOURCE`** (imported from `apps/api/src/audit.ts`, never
    re-typed). `discovery_events.source` is `saas_apps.key` for sync events and
    `AUDIT_SOURCE` for audit events, so a registrable key of `label` forges audit records.
  - `app_name`: required when `app_key` is new, ignored when it is not, length ≤ 200.
  - `unit_price`: `^\d{1,12}(\.\d{1,2})?$` — this rejects `NaN`, scientific notation, and
    the third decimal that `numeric(14,2)` would silently round, and it enforces the
    `>= 0` and 10¹² bounds before Postgres sees the value.
  - `seats`: `^\d{1,9}$`, keeping it inside `int` so an out-of-range cast error cannot
    abort the run.
  - `currency`: `^[A-Z]{3}$` app-side as well as in the schema.
  - `note`: reuses `noteSchema` from `apps/api/src/label-note.ts` (≤ 500, no `\r`/`\n`) —
    it is operator-authored free text, which is the exact case that schema exists for.
  - a duplicate `app_key` within one file produces a warning, mirroring `hr-import`'s
    duplicate-`employee_id` rule.
  - Error messages echo at most 40 characters of the offending value; the whole cell can
    be 10 MB and it reaches the response body and the request log.
- **Caps**: `MAX_UPLOAD_BYTES` and `MAX_ROWS` move to a shared module and are imported by
  both import routes rather than redeclared. `MAX_ROWS` for this route is **2 000**, not
  20 000: `hr-import`'s cap was justified as bounding a one-INSERT-per-row transaction
  holding a pooled connection, and C2 writes two tables per row.
- **Per-tenant ceiling**: the number of `saas_apps` rows a tenant may hold is bounded, and
  the check runs **inside** the C2 transaction under RLS so it cannot be raced across
  concurrent requests. C2 removes the product's only key allowlist
  (`z.literal('google-workspace')`) and there is no role model to compensate — every
  authenticated session has full tenant write.
- **Transaction flow**: one `withTenant` transaction over the validated rows only. Per row,
  `INSERT INTO saas_apps … ON CONFLICT (tenant_id, key) DO UPDATE SET key = EXCLUDED.key
  RETURNING id, (xmax = 0) AS created` — a no-op `DO UPDATE` because `DO NOTHING` returns
  no row on conflict, and because `display_name` must not be overwritten. Verified in
  round 1 as `opensmp_app` under FORCE RLS: `created` is `t` on insert, `f` on conflict,
  `display_name` preserved.
- **Audit**: every import writes one batched `discovery_events` row naming the created
  keys, on the same transaction, following `recordLabelAuditBatch`'s set-based shape.
  `0005` revoked UPDATE/DELETE on that table from `opensmp_app` precisely so the trail
  cannot be rewritten. Revision 1 offered an HTTP warning as the mitigation for a write a
  typo can perform; a response body read once by the uploader is not a record.
- **Control class**: *fail-closed verification gate.* It cannot pass a row without
  deciding it, and an unparseable row denies rather than defaults. It is not a boundary: a
  caller with database access bypasses it, which is what C1 is for.
- **Forbidden patterns**:
  - `pattern: tx\.query\(` + a template literal containing `${` in the import path —
    reason: money and currency are user-controlled text and must be bound parameters.
    Measured in round 1: `withTenant` sets `app.tenant_id` transaction-locally but does not
    pin it, so a statement injected inside the transaction can `set_config` its way to
    another tenant — an injection here is a full isolation bypass, not a scoped leak.
  - `pattern: ON CONFLICT[\s\S]{0,200}display_name = EXCLUDED\.display_name` in this path —
    reason: renaming an application from a contract CSV.
- **Acceptance**: unknown `app_key` creates the application, emits a warning naming it, and
  writes the audit row; known `app_key` with a different `app_name` leaves `display_name`
  unchanged; `app_key` equal to `AUDIT_SOURCE` is rejected with its row number; each of
  non-integer `seats`, `unit_price` of `NaN`, `unit_price` with three decimals, negative
  `unit_price`, `currency` of length ≠ 3 (with the **stored** value asserted, not merely
  that an error was raised), unknown `billing_cycle`, and `term_end < term_start` produces
  one row-scoped error carrying the row number **while every valid row in the same file is
  still applied**; and an application created by import, holding a contract and no
  accounts, can be deleted through `DELETE /saas-apps/:saasAppId` without a 500.

### C3 — the reconciliation

Per application:

- **purchased** = `saas_contracts.seats`, null when no contract is recorded.
- **assigned** = `saas_accounts` with `account_status = 'active'` **that were seen in the
  application's most recent sync run** (`last_synced_at >= (SELECT max(last_synced_at)
  FROM saas_accounts WHERE saas_app_id = …)`). Without the second clause, accounts deleted
  upstream are counted forever, because `sync` is upsert-only and never reaps — the error
  compounds and hides waste, which is the direction that matters least to notice and most
  to be wrong about.
- **unassigned** = purchased − assigned, **not clamped**. Negative is over-allocation, a
  licence-compliance signal, and clamping reports it as a clean sheet.
- **reclaimable**, a partition over the stored link status, not a re-derivation:
  - `ghost` — `account_links.status = 'ghost'`. The matcher already decides this and
    requires `account_status = 'active'`; re-deriving it through an `identities` join, as
    revision 1 did, produces a *different set* that includes suspended accounts, which
    `assigned` excludes — so `reclaimable` could exceed `assigned`.
  - `orphan` — `account_links.status = 'orphan'`.
  - The two are disjoint **by the database CHECK**, not by an application rule, so the
    partition is proven rather than asserted.
- **The other three link states are named rather than ignored**, because silence about
  them is an affirmative claim:
  - `ambiguous` — `identity_id IS NULL`, so nobody owns the account, but the matcher could
    not decide which identity. Counted in `assigned`, reported under its own
    `needsReview` count, **not** as reclaimable: reclaiming an account the product failed
    to attribute is the wrong action.
  - `matched` — not reclaimable.
  - **no `account_links` row at all** — the state of a tenant that has synced but never
    matched. Reported as `matchState: 'not-matched'` for the application rather than as
    `reclaimable: 0`, because zero here is an answer derived from evidence that does not
    exist. This is the one C3 clause that carries revision 1's SC57 lesson forward.
- **reclaimableValue** = `(ghost + orphan) × unit_price`, computed in **SQL** as `numeric`
  and serialised as a string, carrying the contract's own `billingCycle` as its period.
  Revision 1 introduced this term in C4 with no formula, no computation site and no
  period; monthly and annual figures that look alike are a 12× misreading, and the plan
  already refuses the same class of error across currencies.
- **Control class**: *detection or audit only.* Nothing is denied or deleted.
- **Invariants**: the terms above are declared once and consumed by the SQL, the API and
  the UI. `IDLE_AFTER_DAYS` is gone with `idle`.
- **Acceptance**: an over-allocated application reports a negative `unassigned`; a
  connector-backed application with accounts but no contract row reports null contract
  fields and non-null `assigned`; `ghost + orphan == reclaimable.total`; an application
  whose accounts have no link rows reports `matchState: 'not-matched'` rather than
  `reclaimable.total: 0`; and an account present in `saas_accounts` but absent from the
  latest sync run is not counted in `assigned`.

### C4 — `GET /licenses`

Driven by **`saas_apps LEFT JOIN saas_contracts`**, so inventory is never hidden by
missing contract data. Revision 1 left the driving side unstated, and both readings broke:
contract-driven hides the only application that has real accounts until someone uploads a
row for it, and app-driven leaves Consumer 1 unable to perform the operations its
walkthrough claims.

- **Shape** (`@open-smp/api-types`): `{ appKey, appName, hasConnector: boolean,
  matchState: 'matched' | 'not-matched', planName: string | null, unitPrice: string | null,
  currency: string | null, billingCycle: 'monthly' | 'annual' | null, termStart: string |
  null, termEnd: string | null, purchased: number | null, assigned: number,
  unassigned: number | null, needsReview: number, reclaimable: { ghost, orphan, total },
  reclaimableValue: string | null, reclaimableValuePeriod: 'monthly' | 'annual' | null }`.
  Every contract-derived field is nullable, because an application without a contract is
  the ordinary case on day one. `seats` is gone — it was `purchased` under a second name,
  in a shape whose stated purpose is preventing restatement drift.
- **Money is a string; no field sums across rows whose `currency` or `billingCycle`
  differ.** Stated as a property rather than as a ban on names beginning `total`, which
  would have flagged `reclaimable.total` — a seat count.
- **Consumer-flow walkthrough**:
  - *Consumer 1 — `apps/web/src/app/licenses/page.tsx`* reads `{ appKey, appName,
    hasConnector, matchState, planName, unitPrice, currency, billingCycle, purchased,
    assigned, unassigned, needsReview, reclaimable, reclaimableValue,
    reclaimableValuePeriod }`. It uses `currency` to format `unitPrice` and
    `reclaimableValue` **without arithmetic**; `reclaimableValuePeriod` to label the
    figure so a monthly and an annual row are never read as comparable; `unassigned`'s
    sign to choose the over-allocation presentation, and its **null** to render "no
    contract recorded" rather than zero; `matchState` to render "not matched yet" instead
    of a reclaimable count; and `hasConnector` to suppress the sync affordance, so the
    worker's `has no stored credentials` throw is unreachable from the UI rather than
    merely unlikely. `hasConnector` was missing from revision 1's read set while an
    acceptance criterion depended on the page reading it — the walkthrough had not been
    run against that consumer.
  - *Consumer 2 — the licences CSV export* reads every scalar field. Numeric columns are
    formatted **before** neutralisation (see C5); it performs no arithmetic.
  - *Consumer 3 — `e2e/specs/licenses.spec.ts`* reads the rendered table and asserts the
    over-allocated row shows a negative number.
- **Control class**: *detection or audit only* — a read endpoint behind the existing
  session guard.
- **Acceptance**: a CSV-only application carries `hasConnector: false`; a connector-backed
  application with no contract carries null contract fields and a non-null `assigned`;
  `unitPrice` is a string or null in every response; no response field is a sum over rows
  differing in `currency` or `billingCycle`.

### C5 — `/licenses` page and CSV export

- The export goes through `csv-export.ts`'s `neutralizeCell`/`csvField`, and the download
  through the existing `CsvExportButton`, parameterised by builder and filename. The
  repository's split is `csv-export.ts` builds the string, `CsvExportButton.tsx` wraps it
  in a Blob — revision 1's forbidden pattern had these backwards and would have flagged
  the only correct site in the tree on day one.
- **Numeric columns are formatted before neutralisation.** `DANGEROUS_FIRST_CHARS`
  includes `'-'`, so `neutralizeCell('-3')` returns `'-3`: the over-allocation figure —
  the one number this feature exists to make loud — would export as text while every
  zero-waste row exported as a number, and every spreadsheet sort, filter and sum would
  skip exactly the rows that matter. `neutralizeCell` is not weakened for other callers.
- **Control class**: *detection or audit only*.
- **Forbidden patterns**: `pattern: new Blob\(` outside
  `apps/web/src/components/CsvExportButton.tsx` — reason: a second CSV writer bypasses the
  formula-injection guard. Derived from `grep -rn "new Blob" apps/web/src e2e`, which
  returns exactly that one site.
- **Acceptance**: a contract value beginning `=` is emitted neutralised (deny side); the
  exported `unassigned` cell for an over-allocated row **parses as a negative number**
  (allow side); the over-allocated row is visually distinct from a zero-waste row.

### C6 — seed and E2E

- Seeded cases: a fully used contract, one with unassigned seats, one over-allocated, and
  one whose reclaimable seats include a ghost and an orphan. **The ghost/orphan case
  reuses the existing seeded `google-workspace` accounts**, which already provide one of
  each. A second orphan would red `e2e/specs/accounts.spec.ts:66`, whose `toHaveCount(1)`
  is tenant-scoped, in `compose-smoke`.
- New fixtures must not add an `email:` literal to `e2e/fixtures/seed-facts.ts` unless the
  mirrored `assert_*` calls are added to `e2e/scripts/assert-seed-preserved.sh` in the same
  contract: `apps/api/test/seed-gate-agreement.test.ts:67` derives its expected call count
  from that file by regex.
- `e2e/specs/licenses.spec.ts` must contain a literal `page.goto('/licenses')`
  (`apps/web/test/page-spec-membership.test.ts` requires it) and must **not** override
  `storageState` (VE5).
- **Control class**: *fail-closed verification gate* — the spec denies a merge when the
  page stops rendering the rollup.
- **Acceptance**: the seeded tenant reproduces all four cases without hand-editing the
  database; the new spec appears in the E2E discovered set, which the parity gate observes.

## Go/No-Go Gate

| ID | Subject | Status |
|----|---------|--------|
| C1 | `saas_contracts` table, composite FK, constraints, RLS enrollment | pending |
| C2 | contract CSV import, boundary validation, audit trail | pending |
| C3 | seat reconciliation over the stored link status | pending |
| C4 | `GET /licenses` response shape | pending |
| C5 | `/licenses` page and CSV export | pending |
| C6 | seed data and E2E coverage | pending |

Revision 2 has not been reviewed. No contract is locked.

## Testing strategy

- **Tier**: the reconciliation is an **integration**-tier concern. Its arithmetic lives in
  SQL, so a unit test could only assert over a query string — proving nothing about
  `numeric` semantics — or would require a JavaScript twin of the SQL, which is the
  duplication C3's single-declaration invariant exists to prevent. The genuinely pure
  slices (row validation in `validateRow`, the CSV formatting in C5) are unit-tested.
- **RLS**: through the existing sweep, per C1's member-set obligations. Not a bespoke test.
- **Constraints**: one integration case per C1 constraint, asserting SQLSTATE and
  constraint name.
- **Import**: the C2 acceptance list, each as its own case, with the row number asserted
  and with a valid row in the same file proven to have been applied.
- **Falsifiability (RT7)** — every assertion ships with the single edit that reds it:

  | mutation | assertion it must red |
  |---|---|
  | clamp `unassigned` at zero | negative over-allocation is reported |
  | drop the sync-watermark clause from `assigned` | a stale account is not counted |
  | re-derive `ghost` through an `identities` join | `ghost` matches the stored link status |
  | count `ambiguous` as reclaimable | `ghost + orphan == reclaimable.total` |
  | return `reclaimable: 0` for an unmatched application | `matchState: 'not-matched'` |
  | add `display_name = EXCLUDED.display_name` to C2's upsert | a known `app_key` is not renamed |
  | drop the `AUDIT_SOURCE` rejection | `app_key` of `label` is refused |
  | drop `WITH CHECK` from the new policy | the RLS sweep's INSERT matrix |
  | make the FK single-column | a contract cannot reference another tenant's application |
  | remove the `= unit_price` term from the CHECK | `NaN` is rejected |
  | neutralise numeric columns | the exported `unassigned` parses as a negative number |
  | move C2's value validation back into the transaction | a bad row does not roll back the good ones |

- **Allow side (RT10)**: a legitimate re-import that changes only `seats`; an application
  both connector-backed and contracted; a contract value beginning `=` still neutralised
  while `-3` still exports as a number.

## Considerations & constraints

### Scope contract

IDs are prefixed `SCL` because `docs/roadmap.md` and the MVP plan already use `SC1`–`SC11`
for repository-wide deferrals.

- **SCL1** — contract history (renewals, price changes over time) is out; one current
  contract per application, a renewal overwrites. Trigger: the first question needing a
  figure from a past term.
- **SCL2** — tiered plans, where not every active account consumes a paid seat, are not
  representable. Trigger: the first such plan; it promotes the derived seat to an
  `entitlements` table. Owner: C3.
- **SCL3** — usage-based pricing is out; `seats × unit_price` is the only cost model.
- **SCL4** — no FX and no cycle normalisation. Cross-currency and cross-cycle totals are
  refused rather than approximated. Trigger: a tenant needing one number, at which point
  the rate source and its as-of date become part of the contract. Owner: C4.
- **SCL5** — automatic ingestion from accounting systems or invoices is out by the scope
  decision that opened this cycle. Owner: `docs/roadmap.md`.
- **SCL6** — per-application usage telemetry does not exist. Owner: a connector cycle.
- **SCL7** *(revision 2)* — **the `idle` reclaimable reason is cut.** It needed evidence
  SCL6 records as absent, and round 1 proved the consequences rather than predicting them:
  no derivation path from `apps/api` to a connector capability, a test that could not fail
  because a CSV-only application has no accounts at all, and an overlap with `ghost` that
  double-counted the most ordinary reclaimable seat. Cutting it also removes the connector
  interface extension and the `apps/api → connectors-core` edge, so **NF1 now forbids
  touching the connector interface at all** and the roadmap's reorder trigger cannot fire
  from this cycle. Trigger: a connector that declares per-application activity — at which
  point the capability is a static, credential-free descriptor read without instantiating
  a connector, which is the shape round 1 established.
- **SCL8** *(revision 2)* — **`withTenant` does not pin `app.tenant_id` for the life of
  the transaction.** Measured in round 1: `set_config('app.tenant_id', …, true)` inside an
  open transaction re-points every RLS predicate. This is pre-existing and not introduced
  here, but it sets the blast radius of any SQL injection in this repository at *full
  tenant-isolation bypass*, which is why C2's parameterisation is a forbidden pattern
  rather than a convention. Not fixed in this cycle: the fix is a connection/role change
  affecting every route, which is larger than this subject and would be unreviewable
  inside it. Trigger: the next cycle touching `packages/schema`'s connection handling —
  and the `withTenant` docstring, which currently implies a stronger property than the GUC
  has, should be corrected there.
- **SCL9** *(revision 2)* — neither `MEMBER_TABLES` nor `tenantScopedTables` is
  catalog-derived, so the next tenant-scoped table has the same exposure C1 is closing by
  hand. Trigger: the next new table; the fix is one query against
  `information_schema.columns` for `tenant_id`.

### Risks

- **`numeric` arrives as a string.** Arithmetic in JavaScript re-introduces the float error
  the column type was chosen to avoid; the arithmetic belongs in SQL, and C3 says so as a
  contract term rather than as advice.
- **C2 creates catalog rows**, and no role model distinguishes who may. The mitigations are
  the charset rule, the per-tenant ceiling, the reduced row cap and the audit row — not the
  warning, which revision 1 offered and round 1 rejected.
- **The seeded `last_activity_at` values are absolute literals** (`2024-03-01` and three
  2026 dates). No assertion in this plan depends on them now that `idle` is gone; if a
  future cycle adds one, the values must become relative to `now()` or the assertion is a
  dated failure in `compose-smoke`.

## User operation scenarios

1. **First contract load** — admin uploads `contracts.csv` covering 12 applications, 11 of
   which have no connector. All 12 appear on `/licenses`; 11 are reported as newly created
   applications in the warnings and in one `discovery_events` row.
2. **Finding waste** — Slack shows 50 purchased, 44 assigned, 6 unassigned and 4
   reclaimable (3 ghost, 1 orphan), with the reclaimable value in the contract's own
   currency and labelled with its billing cycle.
3. **Catching over-allocation** — Figma shows 10 purchased and 13 assigned; the row reports
   −3, and the exported CSV cell parses as −3.
4. **A typo in the CSV** — `app_key` `slak` is uploaded; a new application appears in the
   warnings and on `/licenses` with zero accounts, and the admin deletes it through
   `DELETE /saas-apps/:saasAppId` without hitting a 500.
5. **A tenant that has synced but never matched** — every application reports
   `matchState: 'not-matched'`, and no row claims zero reclaimable seats.
