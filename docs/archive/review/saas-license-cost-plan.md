# Plan: saas-license-cost

Cycle 7. Branch: `feature/saas-license-cost`.

Revision 6 — **C6 built and executed. SC5 is complete.**

C6's own premise was the thing that gave way. Round 2 concluded the four cases
were "not jointly reachable", and every constraint behind that conclusion is
about ACCOUNTS: `apps.spec.ts` pins the seeded application's count at 4, a new
unmatched account reds the tenant-scoped orphan count in `accounts.spec.ts`, and
`ensureAccounts` binds to one application. All three hold, and all three were
measured again here.

What nobody had checked is whether the cases need accounts. They do not — they
need **contracts**, and measured: no test pins the number of applications, and
none pins contract state except the licences spec, which changes in the same
contract as the plan allowed. So the seed writes contracts, adds no account, and
the cases come free. **SCL14 is closed** by the same move: it recorded
over-allocation as unreachable in E2E, having reasoned from the account
constraints rather than from what the figure actually requires.

Revision 5 — **C4 and C5 built and executed.** The reconciliation now has a
reader, and two of this revision's findings came from that alone: a shape
consumed by nobody is a shape nobody has validated.

It also corrects revision 4. That revision claimed C4's placement decision
"either answer changes `page-spec-membership.test.ts`'s member set". Executed:
the gate keys on the FIRST path segment of a page directory, so a second form on
`/import` adds no member at all, and even `/import/contracts` would be covered by
`import.spec.ts`'s existing `goto('/import')`. Only a new top-level route forces
a spec — which `/licenses` does, regardless of where the upload lives. The
decision had to be made on other grounds, and was.

Revision 4 — **C2 built and executed.** Revision 3 recorded, per unbuilt
contract, the findings it had to answer; C2's are answered below, in the same
form as C1's and C3's — what the execution decided, not what was argued for.

Revision 3 — **rewritten from what was executed, not from what was argued.** Two
plan-review rounds returned 4 then 8 Critical findings; the count went up, and
every round-2 Critical sat inside a round-1 repair. All twelve were claims the
plan asserted without running: a CHECK that did not reject `NaN`, a transaction
abort no acceptance case could survive, mutations that could not red, fixtures
that could not exist.

So the method changed. C1 and C3 were built as artifacts and executed against a
real Postgres, and this document now records what the execution decided. The
prose that round 2 falsified is gone rather than patched; what survives is either
measured or explicitly marked as not yet built.

Revision 4 kept the method and skipped the prose round entirely: the contract
terms were settled, so the next thing that could falsify anything was an
artifact, and 15 mutations were executed against the result.

**Shipped: C1 and C3 (first PR), C2 (second), C4 and C5 (third), C6 (this one).**
Every contract in the Go/No-Go gate is built and executed.

## Project context

- **Type**: mixed — service (Fastify API, BullMQ worker) + web app (Next.js 15) +
  library packages.
- **Test infrastructure**: unit + integration (vitest, two projects; integration
  uses Testcontainers against real Postgres 16) + E2E (Playwright) + CI
  (`checks`, `integration`, `compose-smoke`, all three required on `main`).
- **Verification environment constraints**:
  - **VE1** — no second Google Workspace tenant; cross-tenant isolation is proven
    against two seeded tenants in Postgres (`verifiable-local`).
  - **VE2** — no accounting/invoice system; nothing here depends on one.
  - **VE3** — currency rendering is locale-dependent, so it is asserted on the
    emitted string (`verifiable-local`).
  - **VE4** — no real contract data; every figure is synthetic.
  - **VE5** — the E2E login budget is 5/min/IP and the suite consumes 5/5.
    Measured: `e2e/playwright.config.ts:31` sets `use.storageState` globally, so a
    new spec inherits the shared session and adds zero login POSTs. Any future
    spec here must not override it.
- **Per-contract classification**: C1, C2 and C3 `verifiable-local` (integration,
  Testcontainers) — all three executed. C4, C5 and C6 `verifiable-CI` (Playwright
  against the compose stack) — all three executed.

## Objective

Answer *what are we paying for that nobody uses?* — hold each application's
contract, reconcile purchased seats against the accounts already inventoried, and
surface the seats that are reclaimable: held by someone who left, or held by
nobody.

## Measured current state

Executed against PostgreSQL 16.13 during the review rounds and the build.

- `pg` returns `numeric` as a **string**; `numeric(14,2)` round-trips
  `1234567890.99` exactly and **silently rounds** `10.005` to `10.01`.
- **`'NaN'::numeric >= 0` is true, and so is `'NaN' = 'NaN'`** — Postgres defines
  self-equality as true for `numeric` (unlike IEEE floats) so the type can sort
  and index. `CHECK (v >= 0 AND v = v)` therefore **stores** `NaN`; measured.
- `char(3)` **silently truncates** on an explicit cast: `'USDX'::char(3)` → `USD`.
- Referential-integrity checks run as the referenced table's **owner and bypass
  RLS**, so a single-column FK accepts a row pointing at another tenant's parent.
- A policy declaring `USING` and omitting `WITH CHECK` **uses `USING` as the
  `WITH CHECK` expression**, so dropping the clause is not an observable mutation.
- `count()` is `bigint`, `int - bigint` is `bigint`, and pg returns `bigint` as a
  **string** — an uncast difference arrives as `'-2'`, and `tx.query<Row>` is an
  unchecked assertion that cannot catch it.
- `apps/worker/src/sync.ts` is **upsert-only**: it never deletes, archives or
  reaps rows absent from `listUsers`, and stamps `last_synced_at` on every row it
  does see.
- `packages/matcher/src/match.ts` returns `orphan` on rule fallthrough and
  `ambiguous` on multi-hit **regardless of `account_status`**; only `ghost`
  consults it.
- `account_links` has `UNIQUE (tenant_id, saas_account_id)` — **that**, not the
  status/identity CHECK, is what makes two link statuses per account impossible.
- `apps/api/package.json` does not depend on `@open-smp/connectors-core`.
- `apps/api/src/audit.ts` exports `AUDIT_SOURCE = 'label'`;
  `apps/worker/src/match.ts` writes `discovery_events.source = 'matcher'` as a
  literal. Both are registrable `saas_apps.key` values today.
- `apps/web/src/lib/csv-export.ts` lists `'-'` in `DANGEROUS_FIRST_CHARS`, so
  `neutralizeCell('-3')` returns `'-3` — ordering cannot fix this, only a
  numeric-typed path can.

## Requirements

- **FR1** — a contract can be recorded for an application, including one the
  connectors do not sync. **Built (C2), executed** — the import creates the
  catalog row, which is the only path to an application with no connector.
- **FR2** — contracts enter through CSV upload, validated at the boundary, and no
  rejected row prevents a valid row from being applied. **Built (C2), executed** —
  one acceptance case per constraint the catalog declares, each asserting the
  valid row in the same file survived.
- **FR3** — per application, the product reports purchased, assigned and
  reclaimable seats with a reason for each, every reason derived from evidence the
  product holds. **Built (C3), executed** — and since C4, reported to a person
  rather than to a test.
- **FR4** — money figures are exact, and figures in different currencies or
  billing cycles are never combined. **Built (C1, C3, C4, C5), executed** — the
  page and the export both carry the billing period beside the figure, and
  neither ever holds a money value as a number.
- **NF1** — no new external integration, no new OAuth scope, no write to any
  connected system, and **no change or extension to the connector interface**.
  Held: nothing in C1–C5 touches `packages/connectors`.
- **NF2** — the new table is enrolled in the repository's existing RLS sweep
  rather than getting a bespoke test. **Built, executed.**

## Contracts

### C1 — `saas_contracts` — BUILT (`migrations/0006_saas_contracts.sql`)

Columns: `id`, `tenant_id`, `saas_app_id`, `plan_name`, `seats`, `unit_price
numeric(14,2)`, `currency text`, `billing_cycle`, `term_start`, `term_end`,
`note`, `updated_at`.

Every constraint is **named explicitly**, because Postgres names a multi-column
CHECK positionally (`saas_contracts_check`, then `_check1`) and the composite FK
and the `tenants` FK both raise `23503` — SQLSTATE alone cannot tell them apart.

- `UNIQUE (tenant_id, saas_app_id)` — one current contract per application.
- **Composite FK** `(tenant_id, saas_app_id) → saas_apps (tenant_id, id)
  ON DELETE CASCADE`, on a new `UNIQUE (tenant_id, id)` on `saas_apps`. Composite
  because RI checks bypass RLS; `CASCADE` because
  `DELETE /saas-apps/:saasAppId` pre-checks only `saas_accounts` and narrows its
  catch to that one constraint name, so any other FK violation is a 500.
- `CHECK (seats >= 0 AND seats <= 10000000)`.
- `CHECK (unit_price >= 0 AND unit_price <> 'NaN'::numeric)` — **not**
  `unit_price = unit_price`, which was round 1's recommendation, adopted into
  revision 2 unexecuted, and which stores `NaN`.
- term ordering, `currency ~ '^[A-Z]{3}$'`, `plan_name` ≤ 200, `note` ≤ 500.
- RLS `ENABLE` + `FORCE`, one `tenant_isolation` policy with both `USING` and
  `WITH CHECK`, `GRANT SELECT, INSERT, UPDATE, DELETE`. `DELETE` is granted for
  consistency with every other mutable member table — the RLS sweep classifies
  members as append-only or mutable and withholding it would need a third
  category. No contract issues one, and the cascade needs no grant at all.
- **Enrolled** in `packages/schema/test/rls.integration.test.ts`'s `MEMBER_TABLES`
  and in `tenantScopedTables`, buying the SELECT / UPDATE / DELETE / `WITH CHECK`
  / no-GUC matrices.

**Control class**: *enforceable boundary for the values it constrains, and nothing
more.* Scoped deliberately: revision 2's blanket claim is what licensed C2 to skip
validation.

### C3 — the reconciliation and `GET /licenses` — BUILT (`apps/api/src/routes/licenses.ts`)

One SQL expression over **one seat population**, every term a `FILTER` over it.

```
seat := active accounts of the application that were seen in its latest sync run
```

- **assigned** = `count(seat)`. The watermark exists because `sync` never reaps:
  without it an account deleted upstream is counted forever, in the direction that
  hides waste.
- **unassigned** = `(purchased − assigned)::int`, **not clamped**; `NULL` when no
  contract exists. The cast is load-bearing — without it the value arrives as the
  string `'-2'`.
- **reclaimable** = `ghost` + `orphan`, both `FILTER`s over `seat`. Because they
  restrict the same population, `reclaimable ≤ assigned` holds by construction
  rather than by agreement between subqueries — revision 2's form was measured
  reporting `assigned = 2` with `reclaimable = 2` where both reclaimable accounts
  were ones the watermark had just declared gone.
- **needsReview** = `ambiguous`. Nobody owns the account, but the matcher could
  not decide which identity; reclaiming it is the wrong action.
- **matchState** — four values, not two: `no-accounts` / `not-matched` /
  `partially-matched` / `matched`. An application with no accounts has nothing to
  reclaim and reporting it as unmatched would suppress a correct zero; partial
  matching is the ordinary steady state, because sync and match are separate jobs.
- **reclaimableValue** = `unit_price × (ghost + orphan)`, computed in SQL as
  `numeric`, serialised as the string pg returns, carrying
  `reclaimableValuePeriod` so a monthly and an annual figure are never compared.
- Driven by `saas_apps LEFT JOIN saas_contracts`, so an application with accounts
  and no contract is visible with null contract fields.

**Control class**: *detection or audit only.*

### C2 — contract CSV import — BUILT (`apps/api/src/routes/contract-import.ts`)

`POST /api/contract-import`, multipart, one CSV row per application:
`app_key, app_name, plan_name, seats, unit_price, currency, billing_cycle,
term_start, term_end, note`. It writes the catalog row as well as the contract,
because FR1's "an application the connectors do not sync" had no other path —
`POST /saas-apps` pins its key to one literal and demands credentials.

**No value reaches the transaction that C1 can reject** — and the shape of the
transaction is what dictates that. One INSERT per row, no savepoints, so a
refused value does not degrade its own row: it aborts the transaction, every
later statement returns `current transaction is aborted`, and the applied rows
roll back.

Savepoints were considered and **rejected**. They would make the failure
survivable and would also make a missing validator *invisible*, because the
valid rows would still land. "The valid row in the same file was still applied"
is the assertion that proves the derivation complete, and it can only prove it
while a missed constraint is fatal.

The list is not hand-written. `contract-import.integration.test.ts` reads
`pg_constraint` for every `c`/`u`/`f`/`p` constraint on `saas_contracts` and
fails when one has no case — which is what revision 2's hand-written list, short
of `plan_name` and both term dates and disagreeing with C1 on `seats` (10⁹ vs
10⁷), would have failed. A second assertion derives the NOT NULL columns without
defaults from `pg_attribute` and checks them against the shipped INSERT's column
list, since 23502 aborts a transaction like anything else.

Four rejections come from the **column type** rather than from a constraint, so
`pg_constraint` cannot enumerate them and the test says so: a calendar-invalid
date (22008 — `2025-02-30` matches any shape regex), a value outside the
`billing_cycle` enum (22P02), `numeric(14,2)` overflow (22003), and `int4`
overflow on `seats`. Excess numeric scale is worse than an error and is refused
too: Postgres **rounds** it, silently, in the money column.

**`app_key` refuses the reserved set, and the set is derived.** The three
product-owned `discovery_events.source` values are declared once, as scalars, in
`@open-smp/api-types`; `audit.ts`, the matcher and the import all import them,
and `saas-app-key-pin.test.ts` asserts that no source is spelled at its INSERT
site and that every exported `*_EVENT_SOURCE` is a member. `'contract'` joined
the set by being introduced, which is the case a copied list gets wrong.

Normalisation is trim → lowercase → shape → reserved, and what makes it correct
is the consequence rather than the order: **the reserved test runs against the
exact bytes that will be stored.** Checking the raw cell accepts ` LABEL `.

**`saas-app-key-pin.test.ts` has an owner and a true claim.** Its old one —
`saas_apps.key` is one literal — stops being true here, so the file now asserts
the property that literal was protecting, over all three write paths: the zod
literal (unchanged), the import's reserved-set refusal, and seed.ts. Its regex
is left-anchored, and both directions are proven — `app_key:` must not match,
`'key':` and a formatter-split chain must.

**The ceiling is a lock, not a count.** `pg_advisory_xact_lock` keyed on
(`'saas_apps_catalog'`, tenant), taken before the count. A `tenants` row lock
was not available — the role holds SELECT and INSERT, and `FOR UPDATE` needs
UPDATE — and the rows being counted are the rows being created, so there is
nothing else to lock. Exceeding it is a **per-row** outcome: rows naming
applications that already exist still apply, so a full catalog cannot stop an
operator re-pricing what is in it.

The acceptance test drives two real transactions through the shipped lock and
count, forcing the interleave and waiting on `pg_locks` for a backend actually
blocked. `Promise.all` of two uploads was rejected as the test: it passes
whether or not the lock exists.

**The audit row is readable.** It goes through the single INSERT in `audit.ts`
(generalised over the source, so `audit-append-only.test.ts`'s "exactly one
occurrence, in audit.ts" still holds) under `source = 'contract'`, `kind =
'contract_import'`, carrying `actorUserId`, `imported`, `skipped` and
`createdAppKeys`. `GET /events` gained a third projection branch — without it
the row is stored, answers `?source=contract`, and serves `{}`. The key list
projects whole or not at all: a filtered list would report fewer created
applications than were created, which is the one direction an audit trail must
not be wrong in.

Caps are named for their subjects in `apps/api/src/import-limits.ts`:
`HR_IMPORT_MAX_ROWS` (20 000), `CONTRACT_IMPORT_MAX_ROWS` (2 000),
`MAX_SAAS_APPS_PER_TENANT` (500), `MAX_IMPORT_ERRORS` (100).

**Control class**: *enforceable boundary for the values it admits into the
catalog and the contract table.* Not a boundary on WHO may import — no role
model distinguishes that, and every authenticated session has full tenant write
(unchanged, still recorded under Risks).

### C4 / C5 — `/licenses` page and CSV export — BUILT (`apps/web/src/app/licenses/`)

**Where the upload lives, and why it is not a question of the spec gate.** The
contract CSV's subject is licences, so the form sits beside the table it changes
and the operator watches the reconciliation move. `/import` was the alternative
and is bound to the HR flow: one `State` union running upload → match → done, an
error map keyed to `hr-import`'s strings, and a "Run matching" step that means
nothing after a contract upload. A second form there is two features in one
component.

Revision 4 said either answer moved `page-spec-membership.test.ts`'s member set.
It does not — see the correction at the head of this document. The gate fires
here because `/licenses` is a new top-level route, and it would have fired for
that reason wherever the upload went.

**The export needed a numeric-typed path, and got one.** `-` is in
`DANGEROUS_FIRST_CHARS`, so the sanitizing path renders `-2` as `'-2` — text, in
a spreadsheet, for the one number this screen exists to make loud, while every
zero-waste row exports as a number. `csvNumericField` takes a `number`, so the
exemption is bound to the TYPE: no operator- or connector-supplied string can
reach it. An ordering rule ("run the numeric columns first", "skip columns 5-9")
would be a list that drifts the moment a column is added.

The two money columns deliberately KEEP the sanitizing path. They are
non-negative by C1's CHECK, so `neutralizeCell` is a no-op on them — and relying
on that at a distance to justify an exemption is the move the type-bound
exemption exists to refuse.

**`formatMoney` and `unassignedTone` are functions, not JSX**, because each has
a plausible wrong version that reads as an improvement. The mutation run found
that the first draft of `formatMoney`'s tests could not fail on the property they
named — see the Testing section.

**Every figure cell carries a `data-testid`.** The first E2E draft counted em
dashes across the row and asserted 3; the row renders 5. Corrected to per-cell
assertions rather than to `5`: a count over a row passes for the wrong reason as
soon as a neighbouring cell renders the same characters.

The `new Blob(` forbidden pattern that revision 2 proposed was never added to the
repository, and round 2 had already established it was inverted — the one call
site is `CsvExportButton.tsx`, which is correct. There is now one download path
(`downloadCsv`) that both exports share, because a second copy that forgets
`revokeObjectURL` is invisible to a reader comparing the two.

### C6 — seed and E2E — BUILT (`apps/api/src/seed.ts`)

Round 2's four constraints all still hold, re-measured: only `google-workspace`
has accounts, `apps.spec.ts:161` pins its count at 4, a new unmatched account
becomes an orphan and reds the tenant-scoped count in `accounts.spec.ts:66`, and
`ensureAccounts` binds to one application.

**The premise was the error.** Every one of those constraints is about accounts,
and the cases do not need accounts — they need contracts. Measured: nothing pins
the number of applications, and nothing pins contract state except the licences
spec, which changes here in the same contract, as this section required. So the
seed writes two contracts and adds no account, and the constraint that framed C6
never applies.

**Which application carries which case:**

| case | application | how |
|---|---|---|
| over-allocation | `google-workspace` | 3 seats against 4 assigned → `unassigned = -1`, unclamped |
| reclaimable value | `google-workspace` | 1 ghost + 1 orphan × 12.00 USD → 24.00, computed in SQL |
| needs review, not reclaimable | `google-workspace` | the ambiguous account, which the matcher could not attribute |
| contract with no connector | `notion` | a contract, no credentials, no accounts |
| two periods that must not be summed | both | `notion` is annual where the workspace is monthly (SCL4) |

The first two are the product's argument in one row: the demo opens
over-allocated, and the seats that would fix it are the reclaimable ones sitting
beside the figure. `seats: 3` is not a magic number — the seeder **checks its own
bar** and refuses to finish if the contract is not over-allocated, comparing
against the accounts that actually landed rather than the 4 this file expects,
because the count is derived and a link that stops resolving would move it
without anyone touching the contract.

**The case that is NOT covered**, stated rather than left to be discovered: an
application with accounts and *no* contract. It is the pre-seed state, and
showing it alongside the others needs a second account-bearing application —
which is precisely what reds the two assertions above. Trigger: the first cycle
that needs a second connector (SC2 on the roadmap), which brings its own
application and its own accounts, and which must then decide what
`accounts.spec.ts`'s tenant-scoped orphan count becomes.

`assert-seed-preserved.sh` grew the contract figures, because the licences spec
is the first E2E path that can write `saas_contracts` and `saas_apps` — a seeded
fact no gate inspects is the leak that gate exists to catch.
`seed-gate-agreement.test.ts` cross-checks them against `seed-facts.ts` in the
`checks` job, including that purchased is **below** assigned, so "the demo still
demonstrates something" is asserted from the two figures rather than from prose.

## Go/No-Go Gate

| ID | Subject | Status |
|----|---------|--------|
| C1 | `saas_contracts` table, composite FK, constraints, RLS enrollment | **locked — built and executed** |
| C3 | seat reconciliation and `GET /licenses` | **locked — built and executed** |
| C2 | contract CSV import | **locked — built and executed** |
| C4 | licences page consumption of the shape | **locked — built and executed** |
| C5 | CSV export | **locked — built and executed** |
| C6 | seed data and E2E | **locked — built and executed** |

## Testing strategy, and what was executed

The reconciliation is an **integration**-tier concern: its arithmetic is a SQL
expression, so a unit test could only assert over a query string, and a JavaScript
twin is the duplication C3's single-declaration invariant exists to prevent. The
tests execute the **shipped** `ROLLUP_SQL` and `toItem`, not copies.

**Every assertion was proven able to fail by executing the mutation** — and the
first attempt failed that proof twice, which is why the rule is stated as
*executed*, not as *listed*:

| mutation | result |
|---|---|
| `WITH CHECK (true)` on the new policy | reds 1 (the WITH CHECK INSERT matrix) |
| `unit_price = unit_price` (round 1's recommendation) | reds 1 (the NaN case) |
| single-column FK instead of composite | reds 1 (the cross-tenant reference case) |
| drop the sync watermark | reds 1 (the stale-account case) |
| drop `account_status = 'active'` | reds 1 (the suspended-orphan case) |
| clamp `unassigned` at zero | reds 1 (the over-allocation case) |

Two fixture defects were found only by running those mutations, neither visible to
review: the `WITH CHECK` arm collided with the seeded contract on the unique pair,
so it threw `23505` and `rejects.toThrow()` passed without the policy being
consulted; and the constraint cases shared one application, so a deny case that a
mutation wrongly let through took the unique pair and redded the allow case too.
Both are fixed — a per-tenant spare application, and a fresh application per case.

C2 was verified the same way, with 15 mutations run from a harness that asserts
each anchor occurs **exactly once** before editing — a regex that matches nothing
produces a green run reading as "the mutation survived" when nothing was mutated.
Every one redded; none survived.

| mutation | result |
|---|---|
| currency validator widened to `{2,4}` | reds the currency acceptance case |
| `unit_price` validator admits `NaN` and negatives | reds integration + unit |
| reserved-key check removed from `normalizeAppKey` | reds the pin test + integration |
| catalog advisory lock made a no-op | reds the serialisation case |
| contract projection branch removed | reds the audit-readability case |
| matcher writes `'matcher'` inline again | reds the pin test |
| one constraint dropped from the coverage map | reds the catalog-derivation case |
| `saas_app_id` dropped from the INSERT column list | reds the NOT NULL case |
| key-declaration regex loses its left anchor | reds the `app_key` over-match case |
| date validation reduced to the shape regex | reds integration + unit |
| catalog ceiling never refuses | reds the ceiling case |
| `ON CONFLICT` retargeted to the wrong constraint | reds the re-import case |
| projection accepts any number as a count | reds the projection unit cases |
| created-key list projected element-wise | reds the projection unit cases |
| `seats` ceiling raised to revision 2's 10⁹ | reds the seats acceptance case |

The concurrency case earns its place separately: its interleave is **forced**,
not hoped for. The first transaction signals after taking the lock, the second is
started only then, and the assertion waits on `pg_locks` for a backend actually
blocked — so removing the lock times out with a message naming the cause rather
than passing on a scheduling accident.

Suite state after C2: unit 375 green (31 files), integration 194 green (8 files,
full run — a targeted run has a different scope from CI's), lint and typecheck
clean.

### C4 / C5, and the mutation that should have failed

Nine mutations, eight red. The one that survived is the finding.

| mutation | result |
|---|---|
| numeric columns routed back through the sanitizing path | reds the over-allocation case |
| `unassignedTone` folds "no contract" into "no spare seats" | reds the three-state cases |
| `unassignedTone` clamps over-allocation away | reds the three-state cases |
| the export drops the billing-period column | reds the period case |
| the upload leaves the server-rendered table stale | reds the E2E upload case |
| the export button offers the wrong filename | reds the E2E download case |
| the page renders `purchased ?? 0` | reds the E2E "invents no figure" case |
| `formatMoney` renders through `String(Number(v))` | reds the scale cases |
| **`formatMoney` renders through `Number(v).toFixed(2)`** | **survived — see below** |

The surviving mutation was run against the FIRST draft of `formatMoney`'s tests,
which asserted that a value crosses "unparsed" using `1234567890.99` and `0.07`.
Measured afterwards: `Number(v).toFixed(2)` returns `v` for **every** value
`numeric(14,2)` can hold, because 14 significant digits fit inside a double. So
the block's claim — that a number loses the VALUE here — was false at this
column's bounds, and its assertions could not fail on the property they named.
They read as coverage of an invariant nothing was checking.

What a number loses at this boundary is the SCALE: `String(Number('10.50'))` is
`'10.5'`, `String(Number('0.00'))` is `'0'`. That is also the realistic edit —
`{Number(item.unitPrice)}` in the cell — and it renders a wrong price and turns a
free plan into an unpriced one. The tests now pin that, and the mutation reds.

`toFixed(2)` still survives and is recorded, not chased: it preserves both the
value and the scale, which makes it a behaviour-preserving rewrite rather than a
defect the tests are blind to. The value argument for keeping `numeric` a string
holds one step out, under ARITHMETIC, which is why C3 computes
`reclaimableValue` in SQL and nothing on this page computes anything.

Suite state after C4/C5: unit 398 green (32 files), integration 194 green, E2E 46
green against the compose stack, `assert-seed-preserved.sh` intact, lint and
typecheck clean.

### C6

Five mutations, all red.

| mutation | result |
|---|---|
| the seeded contract stops being over-allocated | reds the **seed job itself** |
| the gate asserts a seat count the fixture does not hold | reds the C38 agreement |
| the gate stops guarding the contract-only application | reds the C38 agreement |
| the gate asserts a seed that is no longer over-allocated | reds the C38 agreement |
| the seed registers an application under a reserved source | reds the key pin |

The first is the one worth having: the seeder refuses to finish rather than
producing a demo whose opening screen has nothing to say, and it fails in
`compose-smoke` before the E2E suite runs, so the cause is named where it happens
rather than three steps later.

**A gap this run cannot cover.** `ensureContract` upserts with `DO UPDATE`, so an
edited figure reaches a stack whose volume already holds the previous seed.
Mutating it to `DO NOTHING` is invisible in CI, because CI boots a fresh volume
and the two forms are then identical — the failure only exists for a developer
re-seeding an existing stack, which is where it was found. Recorded rather than
guarded; a test would have to provision a stale volume.

Suite state after C6: unit 402 green (32 files), integration 194 green, E2E 47
green against the compose stack, `assert-seed-preserved.sh` intact including the
eight new contract assertions, lint and typecheck clean.

## Considerations & constraints

### Scope contract

`SCL` rather than `SC`, because `docs/roadmap.md` and the MVP plan already use
`SC1`–`SC11` for repository-wide deferrals.

- **SCL1** — contract history is out; one current contract per application.
- **SCL2** — tiered plans, where not every active account consumes a paid seat,
  are not representable. Trigger: the first such plan; it promotes the derived
  seat to an `entitlements` table.
- **SCL3** — usage-based pricing is out.
- **SCL4** — no FX and no cycle normalisation; cross-currency and cross-cycle
  totals are refused rather than approximated.
- **SCL5** — automatic ingestion from accounting systems is out by the scope
  decision that opened this cycle.
- **SCL6** — per-application usage telemetry does not exist.
- **SCL7** — the `idle` reclaimable reason is cut. It needed the evidence SCL6
  records as absent, and round 1 proved the consequences: no derivation path from
  `apps/api` to a connector capability, a test that could not fail because a
  CSV-only application has no accounts at all, and an overlap with `ghost` that
  double-counted the most ordinary reclaimable seat. Trigger: a connector that
  declares per-application activity, read as a static credential-free descriptor.
- **SCL8** — **`withTenant` does not pin `app.tenant_id` for the life of the
  transaction.** Measured: `set_config('app.tenant_id', …, true)` inside an open
  transaction re-points every RLS predicate, and `REVOKE SET ON PARAMETER` is
  accepted but not enforced for a placeholder GUC. Pre-existing and not introduced
  here, but it sets the blast radius of any SQL injection at *full tenant-isolation
  bypass*. Not fixed: the fix is a connection/role change affecting every route.
  Trigger: the next cycle touching `packages/schema`'s connection handling — where
  the `withTenant` docstring should also be corrected, since it claims a stronger
  property than the GUC has.
- **SCL9** — neither `MEMBER_TABLES` nor `tenantScopedTables` is catalog-derived,
  so the next tenant-scoped table has the same exposure C1 closed by hand.
  Trigger: the next new table; the fix is one query against
  `information_schema.columns`.
- **SCL10** — **four existing single-column FKs carry C1's defect**
  (`saas_accounts.saas_app_id`, `account_links.saas_account_id`,
  `account_links.identity_id`, `sessions.user_id`); each accepts a cross-tenant
  reference, measured. Not fixed here: each needs a `UNIQUE (tenant_id, id)` on
  its parent and a composite re-declaration, which is a migration touching four
  tables and every insert path — larger than this subject and unreviewable inside
  it. `saas_apps` now carries the prerequisite constraint. Trigger: the next cycle
  touching the schema; derive the member set from `pg_constraint`, not from this
  list.
- **SCL11** — the catalog lock serialises the import **against itself**, not
  against `POST /saas-apps`, which sits outside it. The ceiling still holds today
  only because that route can create one key and `UNIQUE (tenant_id, key)` caps
  it at one row. Trigger: the cycle that widens `saas_apps.key` past the literal
  — that route then needs the same lock, and the reserved-set refusal with it.
- **SCL12** — **the import has no authorisation.** Every authenticated session of
  a tenant may create catalog rows and rewrite every contract in it. The ceiling
  bounds the damage and the audit row records the actor; neither decides who may.
  Trigger: the first role model. Do not read the ceiling as a control over *who*
  — an overstated control is what makes a later cycle skip the real one.
- **SCL13** — `hr-import`'s `skipped` reports the length of its truncated error
  list, so a file with more than 100 rejected rows under-reports how many were
  skipped. Pre-existing, not introduced here, and not fixed here because the
  figure belongs to a shipped response shape the web app renders.
  `contract-import` counts every rejected row instead, which is why the two
  fields with one name now mean slightly different things. Trigger: the next
  change to the HR import's response.

- ~~**SCL14** — over-allocation is not reachable in E2E~~ — **closed by C6**, and
  wrong when written. It reasoned that showing the figure meant writing a
  contract against the seeded application "which persists for the life of the
  volume and which the gate does not inspect". Both halves are true; the
  conclusion was not. The seed writes that contract *deliberately*, and the gate
  now inspects it. What made the item look binding was reading persistence as a
  hazard rather than as the mechanism.
- **SCL16** — an application with accounts and **no** contract is no longer
  visible in the demo, because the only account-bearing application now carries
  one. Showing both states at once needs a second account-bearing application,
  which reds `apps.spec.ts`'s account count and `accounts.spec.ts`'s
  tenant-scoped orphan count. Trigger: SC2, the second connector, which brings an
  application and accounts of its own and must decide what those two assertions
  become.
- **SCL17** — `ensureContract` upserts with `DO UPDATE` so an edited figure
  reaches a stack whose volume already holds the previous seed. The `DO NOTHING`
  regression is **invisible in CI**, which boots a fresh volume and cannot tell
  the two apart; it only exists for a developer re-seeding an existing stack.
  Not guarded — a test would have to provision a stale volume. Trigger: any
  change to the seeder's write strategy.
- **SCL15** — the upload forms' friendly copy is keyed off the row-cap constants,
  so a cap change carries; a change to the ROUTE's message FORMAT would still
  drop each map to its generic fallback. Not guarded: the failure is cosmetic and
  the guard would be a source-scanning test over an error string. Trigger: any
  edit to an import route's 400 bodies.

Closed this revision: **SC37** (`MAX_UPLOAD_BYTES` moved into
`@open-smp/api-types`). It was not on this plan's list — it is inherited, and
recorded in `sc42-derive-link-status-domain-plan.md` — but the import needed a
fourth site for the constant, and a hand-synced comment across four files was no
longer defensible. The user-facing "max 10MB" strings stay literals: an E2E spec
and a manual-test doc assert them, so deriving those is a separate change.

### Risks

- **`numeric` arrives as a string, and so does `bigint`.** Arithmetic in
  JavaScript re-introduces the float error the column type exists to avoid; the
  arithmetic belongs in SQL. `tx.query<Row>` is an unchecked assertion, so a wrong
  declaration is invisible to typecheck — it took a failing test to find one.
- **C2 creates catalog rows** and no role model distinguishes who may. Every
  authenticated session has full tenant write, so the ceiling and the audit row
  are what bound and record it — neither is authorisation (SCL12).
- ~~The reconciliation is exercised by tests and by nothing else~~ — closed by
  C4/C5, and the closing earned its keep: rendering the shape is what found that
  a no-contract row shows five em dashes rather than three, and that
  `formatMoney`'s exactness claim was untrue at this column's bounds. Neither was
  visible while the only consumer was a test asserting the shape it expected.
