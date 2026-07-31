# Plan: saas-license-cost

Cycle 7. Branch: `feature/saas-license-cost`.

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

**Shipped in this PR: C1 and C3.** C2, C4, C5 and C6 are not implemented, and
each carries the findings it must answer when it is.

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
- **Per-contract classification**: C1 and C3 `verifiable-local` (integration,
  Testcontainers) — both executed. C2, C4, C5 unbuilt; C6 would be
  `verifiable-CI`.

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
  connectors do not sync. *(C2, unbuilt.)*
- **FR2** — contracts enter through CSV upload, validated at the boundary, and no
  rejected row prevents a valid row from being applied. *(C2, unbuilt.)*
- **FR3** — per application, the product reports purchased, assigned and
  reclaimable seats with a reason for each, every reason derived from evidence the
  product holds. **Built (C3), executed.**
- **FR4** — money figures are exact, and figures in different currencies or
  billing cycles are never combined. **Built (C1, C3), executed.**
- **NF1** — no new external integration, no new OAuth scope, no write to any
  connected system, and **no change or extension to the connector interface**.
  Held: nothing in C1 or C3 touches `packages/connectors`.
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

### C2 — contract CSV import — NOT BUILT

The one contract all three reviewers converged on (3/3, Critical). What it must
answer before it is written:

- **Derive the validator list from C1's constraint list.** Round 2 measured the
  failure: `hr-import` issues one INSERT per row inside a single transaction with
  no savepoints, so the first CHECK violation aborts it and every later statement
  returns `current transaction is aborted` — a 500 that rolls back the rows
  already applied. Revision 2's hand-written list omitted `plan_name` and the term
  dates and disagreed with C1 on `seats` (10⁹ vs 10⁷). The contract term is: **no
  value reaches the transaction that C1 can reject.**
- **`app_key` must be rejected when it names an event source.** Derived from the
  code, that set is `{AUDIT_SOURCE, 'matcher'}`, not `{AUDIT_SOURCE}` — the
  matcher writes `discovery_events.source = 'matcher'` and `GET /events` filters
  on `source` alone, so a registrable key of either forges an audit family. Pin
  the normalisation order (trim → lowercase → regex → reserved-set) as a contract
  term.
- **`saas-app-key-pin.test.ts` has no owner.** Its regex is unanchored, so a zod
  field named `app_key` matches as a `key` declaration; it is a `CONTROL_FILES`
  member, so deleting it reds the parity gate. C2 must state what it becomes.
- **The per-tenant ceiling does not serialize at READ COMMITTED** — measured, two
  concurrent transactions overshot a ceiling of 10 to 18 rows. It needs a lock,
  not a count.
- **The audit row must be readable.** `GET /events`' projection is a per-kind
  allowlist and both branches drop an unknown payload, so a `discovery_events` row
  naming the created keys is stored and never served. It also needs an actor.
- Caps: name the exports for their subjects (`HR_IMPORT_MAX_ROWS`,
  `CONTRACT_IMPORT_MAX_ROWS`); one name cannot hold two values.

### C4 / C5 — `/licenses` page and CSV export — NOT BUILT

- The response shape exists and is consumed by nothing yet.
- **The CSV export needs a numeric-typed path**, not an ordering rule:
  `neutralizeCell` inspects position 0 and `'-'` is in its dangerous set, so the
  over-allocation figure — the one number this feature exists to make loud —
  exports as text while every zero-waste row exports as a number.
- The `new Blob(` boundary is `CsvExportButton.tsx`, not `csv-export.ts`; derive
  the exemption with `git grep`, since `grep -rn` also matches the gitignored
  Playwright report.

### C6 — seed and E2E — NOT BUILT

Round 2 measured that the four cases are **not jointly reachable**: only
`google-workspace` can report `assigned > 0`, its account count is pinned at 4 by
`e2e/specs/apps.spec.ts:161`, any new unmatched account becomes an orphan and reds
`e2e/specs/accounts.spec.ts:66` (tenant-scoped), and `seed.ts` binds
`ensureAccounts` to a single application. C6 must name each case's application and
accounts, or say which existing assertion changes in the same contract.

## Go/No-Go Gate

| ID | Subject | Status |
|----|---------|--------|
| C1 | `saas_contracts` table, composite FK, constraints, RLS enrollment | **locked — built and executed** |
| C3 | seat reconciliation and `GET /licenses` | **locked — built and executed** |
| C2 | contract CSV import | pending — not in this PR |
| C4 | licences page consumption of the shape | pending — not in this PR |
| C5 | CSV export | pending — not in this PR |
| C6 | seed data and E2E | pending — not in this PR |

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

Suite state: `packages/schema` integration 63 green, `apps/api`
`licenses-rollup.integration.test.ts` 10 green, unit 276 green, lint and typecheck
clean.

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

### Risks

- **`numeric` arrives as a string, and so does `bigint`.** Arithmetic in
  JavaScript re-introduces the float error the column type exists to avoid; the
  arithmetic belongs in SQL. `tx.query<Row>` is an unchecked assertion, so a wrong
  declaration is invisible to typecheck — it took a failing test to find one.
- **C2 will create catalog rows** and no role model distinguishes who may. Every
  authenticated session has full tenant write.
- The reconciliation is exercised by tests and by nothing else until C4/C5 land;
  a shape consumed by no one is a shape nobody has validated in use.
