# Plan: tenant-context-pinning

Cycle 8. `SCL8` from `docs/archive/review/saas-license-cost-plan.md`, which
recorded it and priced the fix at "a connection/role change affecting every
route". **That price is wrong, and this plan exists because measuring it made the
fix an order of magnitude smaller.**

Revision 2 — **built and executed.** C1, C2 and C3 shipped together; the plan's
own split would have left a migration whose policies nobody moved.

Revision 1 — written from measurement. Nothing is built.

## The defect, re-measured rather than inherited

`withTenant` sets `app.tenant_id` with `set_config(..., true)` and every RLS
policy reads it back with `current_setting('app.tenant_id', true)`. The GUC is
transaction-local, which is what stops leakage ACROSS pooled requests — the
property the docstring claims, and it holds.

What it does not do is stop the *same* transaction from re-pointing itself.
Measured this cycle against the running stack, as the `opensmp_app` role:

| step | result |
|---|---|
| `set_config('app.tenant_id', <tenant A>, true)`, then `SELECT count(*) FROM saas_apps` | **2** |
| `set_config('app.tenant_id', <a different uuid>, true)` as the app role | **succeeds** |
| the same `SELECT count(*)` again | **0** |

So RLS follows the GUC, and the application's own role can move it mid
transaction. **The blast radius of any SQL injection in this repository is
therefore full tenant-isolation bypass**, not the leak of one query's rows.

## What does not fix it, measured

The obvious defence is the privilege system, and it does not apply here:

| attempt | result |
|---|---|
| `REVOKE SET ON PARAMETER app.tenant_id FROM opensmp_app` | accepted; the role still sets it |
| `REVOKE SET ON PARAMETER ... FROM PUBLIC` | accepted; the role **still sets it** |
| a `SECURITY DEFINER` setter, with the above | the definer works, and the direct `set_config` still works too |

Postgres does not gate *customized* (placeholder) options through `GRANT SET ON
PARAMETER`. The statement is accepted and enforces nothing. The middle row is the
one worth recording: `FROM PUBLIC` is the form that would have made this a
three-line fix, and it is not enforced either.

## What does fix it, measured

**Table privileges are enforced where parameter privileges are not.** Moving the
tenant identity out of a GUC and into a table the application role cannot touch
closes the re-pointing, and a prototype was run end to end:

| attempt as `opensmp_app` | result |
|---|---|
| call the setter twice in one transaction | **`tenant already set for this transaction`** |
| `INSERT` into the context table | `permission denied for table ctx` |
| `UPDATE` the context table | `permission denied for table ctx` |
| `SELECT` the context table | `permission denied for table ctx` |
| `DROP` / `CREATE OR REPLACE` the reader function | `must be owner of function` |

### The shape

- a table keyed by `pg_backend_pid()`, holding `(xid, tenant_id)`, owned by the
  migration role, **no privileges to `opensmp_app` at all**
- `set_tenant(uuid)` — `SECURITY DEFINER`, upserts the row **only when the stored
  `xid` differs from `pg_current_xact_id()`**, and raises otherwise. That single
  predicate is what makes the identity write-once per transaction.
- `current_tenant()` — `SECURITY DEFINER`, `STABLE` so the planner evaluates it
  once per statement rather than once per row
- every `tenant_isolation` policy's `USING` and `WITH CHECK` reads
  `current_tenant()` instead of `current_setting('app.tenant_id', true)`
- `withTenant` calls `set_tenant($1)` instead of `set_config`

## Blast radius of the change

Measured: **18 policy expressions across 9 tables** (`USING` + `WITH CHECK`
each), plus `packages/schema/src/db.ts`, plus the RLS sweep — which asserts the
no-GUC matrix by *not* calling `set_config`, and asserts the empty-string case
directly.

That is a migration, one connection helper, and a test file. It is **not** "a
connection/role change affecting every route": no route changes, no per-tenant
pools, no new connection strings.

## Contracts

### C1 — the context table and its two functions — BUILT (`migrations/0007_tenant_context.sql`)

- The **write-once predicate is the whole control** and must be red-proven by
  calling the setter twice, not by reading it.
- `current_tenant()` must be `STABLE`, and the reason belongs in the migration:
  a `VOLATILE` reader is called per row inside an RLS predicate.
- No grant on the table, ever — `GRANT USAGE` on the schema and `EXECUTE` on the
  two functions is the entire surface the app role gets.

### C2 — the policies — BUILT

- All 18 expressions move together. A policy left on the GUC is a table that is
  still re-pointable, and it would be invisible: the sweep's per-table matrices
  pass either way, because both predicates return the right answer for a
  well-behaved transaction.
- **The sweep therefore needs a new case per table**: set tenant A, attempt to
  re-point to tenant B, assert the attempt raises AND that the visible row set
  did not change. That is the assertion this plan exists to make possible, and
  no existing case can fail on it.
- `MEMBER_TABLES` is a hand-kept list (`SCL9`). A table missing from it is a
  table this migration might also miss. Derive the policy set from
  `pg_policies` in the same test rather than from the list.

### C3 — `withTenant` and its docstring — BUILT

- The docstring currently claims a stronger property than the GUC has. It is
  corrected in the same contract that makes the claim true, not before.
- The empty-string case (`set_config('app.tenant_id', '')`) disappears with the
  GUC; what replaces it is "no row for this pid and xid", which
  `current_tenant()` returns as `NULL` and every policy compares as false.

## Considerations

### Costs to state rather than discover

- **`pg_current_xact_id()` forces xid assignment**, including for read-only
  transactions that would otherwise consume none. That is real wraparound
  pressure at scale, and `pg_current_xact_id_if_assigned()` cannot replace it —
  it returns NULL exactly when the keying needs a value. Accepted deliberately;
  it is the price of a per-transaction identity that the transaction cannot
  forge.
- Two extra round trips per `withTenant` become one (the setter replaces
  `set_config`), and one function call per statement instead of a GUC read.
  Unmeasured; the plan does not claim it is free.
- The context row survives the transaction (keyed by pid, overwritten on the
  next transaction's first call). A backend that dies mid-transaction leaves a
  stale row, which the next transaction on that pid overwrites — but a stale row
  whose `xid` matches a *recycled* xid would be a false accept. `xid8` is
  64-bit and does not wrap, which is why the key uses it rather than `xid`.

### What this does not close

- It does not make SQL injection harmless. An injection still reads and writes
  everything the CURRENT tenant can — it stops being a whole-database bypass and
  becomes a whole-tenant one.
- It does not address `SCL9` (neither `MEMBER_TABLES` nor `tenantScopedTables` is
  catalog-derived) or `SCL10` (four single-column FKs accept cross-tenant
  references). Both are adjacent and both stay open; C2 borrows `SCL9`'s fix for
  its own test only.

## What execution added

**The policy move is a loop over `pg_policies`, and the migration checks its own
work.** Writing the member set as a list was the obvious form and it is the one
that leaves a table behind; the migration refuses to finish if it moved none, or
if any `tenant_isolation` policy still matches `%current_setting%`.

**`SET search_path` on both functions**, which revision 1 did not mention and
which is not decoration: a `SECURITY DEFINER` function without it resolves
`tenant_context` through the CALLER's path, and `pg_temp` is searched first when
it is not named — so a caller could plant a temp table of that name and have the
setter write there. `pg_temp` is named last on both.

**Two claims elsewhere had gone false and are corrected in the same change.**
`withTenant`'s docstring claimed the property the GUC did not have. And
`auth.ts` explained that an unvalidated non-UUID reaches `set_config` and then
the RLS predicate's `::uuid` cast — after 0007 it is refused at the function
call instead, measured as `invalid input syntax for type uuid`. The validation
is still required and the failure shape is unchanged; only the location moved,
and a comment naming the wrong location is the class `SC65` records.

**A fake caught the change.** `auth.test.ts` allowlists the statements its fake
pool expects and threw on `SELECT set_tenant_context($1)`. That is the fake
doing its job — one that accepted anything would have let a connection-layer
change through untested.

### The mutations

Five run: three red, two survivals declared in advance.

| mutation | result |
|---|---|
| the setter loses its write-once predicate | reds |
| the app role is granted SELECT/DELETE on the context table | reds |
| one policy is left on the GUC | reds |
| the migration stops checking its own work | survives — **declared** |
| the reader stops being `STABLE` | survives — **declared** |

The fourth is a belt on a fastened belt: the sweep asserts the same property
independently, so the migration's self-check has no failing state while the loop
above it is correct. The fifth is a performance property — per-row instead of
per-statement evaluation inside an RLS predicate — and nothing here measures it.
Both are recorded rather than chased.

### Suite state

unit 440 green (36 files), integration 215 green (9 files; the RLS sweep went 63
to 76), E2E 49 green, `assert-seed-preserved.sh` intact, lint and typecheck
clean.

The E2E run was against a stack rebuilt with `docker compose down` **without**
`-v`, so 0007 was applied to a database that already carried data — the upgrade
path, not just the fresh-install one.
