# Plan: saas-license-cost

Cycle 7. Branch: `feature/saas-license-cost`.

Revision 1 — **not yet reviewed.** Written after `docs/roadmap.md` put this first in the
order SC5 → SC3 → SC2 → SC4, and after the scope was fixed to manual/CSV contract entry
with no external ingestion and no write scopes.

## Objective

Let the product answer *what are we paying for that nobody uses?* — the first of the two
questions the SaaS-management category exists to answer, and one this repository can
answer for zero applications today.

Concretely: hold each application's contract (plan, seats, price, term), reconcile the
purchased seats against the accounts already inventoried, and surface the seats that are
reclaimable — held by someone who left, held by nobody, or held by an account that has
not been used.

## Measured current state

- `saas_apps` has `key`, `display_name`, `credentials_enc`, `credentials_key_version`.
  **No plan, seats, price, currency, term or renewal column exists.** `credentials_enc`
  is nullable, so an application row without a connector is already representable.
- `saas_accounts` has `account_status` (`active` / `suspended` / `archived`), `is_admin`,
  `last_activity_at`, `last_synced_at`.
- `account_links` has `status` (`matched` / `orphan` / `ghost` / `ambiguous`),
  `confidence`, `rule_id`, `evidence`, with `CHECK ((status IN ('orphan','ambiguous')) =
  (identity_id IS NULL))`.
- `identities` has `status` (`active` / `left`) and `left_at`.
- `last_activity_at` is populated end to end, but it is **Google's `lastLoginTime` for
  the Google Workspace account** — a per-tenant login timestamp, not per-application
  usage. Contract C3 is written against this fact rather than around it.
- The CSV path already exists in `hr-import`: strict UTF-8 with `TextDecoder({fatal:
  true})`, BOM strip, 10 MB and 20 000-row caps, `MAX_ERRORS = 100`, per-row validation
  returning `ImportRowIssue`, and an upsert inside `withTenant`.
- RLS: every tenant-scoped table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and one
  `tenant_isolation` policy declaring **both** `USING` and `WITH CHECK`, plus an explicit
  `GRANT` to `opensmp_app`.

## Requirements

- **FR1** — a contract can be recorded for an application, including one the connectors
  do not sync.
- **FR2** — contracts enter through CSV upload, validated at the boundary, with the same
  error/warning reporting shape as `hr-import`.
- **FR3** — per application, the product reports purchased seats, assigned seats, and
  reclaimable seats with the reason for each reclaimable seat.
- **FR4** — the money figures are exact, and figures in different currencies are never
  summed into one number.
- **NF1** — no new external integration, no new OAuth scope, no write to any connected
  system. (This is the scope decision, restated as a requirement so a review can enforce
  it.)
- **NF2** — the new table follows the RLS pattern above, and cross-tenant access is
  proven closed by an integration test, not by inspection.

## Technical approach

### Why a seat is derived and not stored

An explicit `entitlements` table — one row per account per seat — is the general model
and is what the category's mature products carry. It is not what this cycle builds,
because every row of it would be derived from `saas_accounts` for as long as the only
seat evidence is "the account exists". Repetition is cheaper than the wrong abstraction:
**an active account on an application consumes one seat of that application's contract**,
and the entitlement table appears when something can distinguish two accounts that cost
different amounts (a free viewer tier, a per-role price). That trigger is recorded in the
scope contract rather than guessed at now.

### Money

`numeric(14,2)`, exact, never a float. Rejected alternative: integer minor units, which
is the usual advice and is *more* error-prone here — the minor-unit exponent is
currency-defined (JPY 0, USD 2), so every read and write would need a per-currency
exponent lookup that nothing in this repository has. `numeric` holds JPY as `.00` and
costs one conversion at the edge. `pg` returns `numeric` as a **string**, which the API
passes through unchanged: JSON numbers are IEEE 754 doubles and would silently round.

## Contracts

### C1 — `saas_contracts`, one current contract per application

New migration `0006_saas_contracts.sql`:

- Columns: `id`, `tenant_id`, `saas_app_id` (FK), `plan_name text`, `seats int`,
  `unit_price numeric(14,2)`, `currency char(3)`, `billing_cycle billing_cycle`
  (new enum: `monthly` / `annual`), `term_start date`, `term_end date`, `note text`,
  `updated_at timestamptz NOT NULL DEFAULT now()`.
- `UNIQUE (tenant_id, saas_app_id)` — one current contract per application. History is
  out of scope (SC-H below).
- `CHECK (seats >= 0)`, `CHECK (unit_price >= 0)`, `CHECK (term_end IS NULL OR term_start
  IS NULL OR term_end >= term_start)`, `CHECK (currency ~ '^[A-Z]{3}$')`.
- RLS: `ENABLE` + `FORCE`, one `tenant_isolation` policy with **both** `USING` and
  `WITH CHECK`, and `GRANT SELECT, INSERT, UPDATE, DELETE` to `opensmp_app` — the same
  four clauses every other tenant-scoped table declares.

### C2 — contract CSV import, and the application rows it must be able to create

`POST /contract-import`, modelled on `hr-import` and reusing its boundary decisions
(10 MB cap, row cap, strict UTF-8, `ImportRowIssue`, `MUTATION_RATE_LIMIT`).

Columns: `app_key`, `app_name`, `plan_name`, `seats`, `unit_price`, `currency`,
`billing_cycle`, `term_start`, `term_end`, `note`.

**The import creates a `saas_apps` row when `app_key` is unknown.** This is the clause
the contract exists to state: if a contract could only attach to an application a
connector had already created, the feature would cover exactly the applications that are
synced — one, today — and the product would be able to price only the system it can
already see. `credentials_enc` is nullable precisely because an application without a
connector is a legitimate row. `app_name` is therefore required when `app_key` is new and
ignored when it is not, and creating an application is reported in `warnings` so a typo
in `app_key` is visible as a new application rather than silent.

Upsert keyed by `(tenant_id, saas_app_id)`; re-import fully overwrites, as `hr-import`
does for HR.

### C3 — the reconciliation, with its terms defined once

Per application:

- **purchased** = `saas_contracts.seats`.
- **assigned** = count of `saas_accounts` with `account_status = 'active'`.
- **unassigned** = purchased − assigned. **Negative is not clamped**: more active accounts
  than seats is over-allocation, a different and louder signal than waste, and clamping it
  to zero would report a compliance problem as a clean sheet.
- **reclaimable**, each with its reason:
  - `ghost` — the account links to an identity with `status = 'left'`.
  - `orphan` — `account_links.status = 'orphan'` (linked to nobody).
  - `idle` — `last_activity_at` older than a threshold, **and only for applications whose
    connector supplies per-application activity.** Today that is the Google Workspace
    application alone, because `last_activity_at` is Google's `lastLoginTime`. Applying it
    to a CSV-only application would report "nobody uses this" from evidence that says
    nothing about it — the same defect class as SC57, where a residue's stated reason was
    false when measured. The eligible set is derived from the connector registry, never
    from a hand-written list of application keys.

These definitions are declared **once** and consumed by the SQL, the API and the UI, in
the shape control 6 of the parity cycle already enforces for domain derivations —
otherwise the reconciliation is restated in three places and drifts in two.

### C4 — `GET /licenses`

Per-application rollup: contract fields, purchased / assigned / unassigned, reclaimable
count broken down by reason, and the monetary value of the reclaimable seats.

**Money is returned as a string** and totals are per currency. A single `totalCost` across
mixed currencies is not produced at all — not as a sum, not as an approximation. Adding
1000 JPY to 10 USD is the first bug this feature would otherwise ship, and it is worse
than a missing number because it looks like an answer.

### C5 — `/licenses` page and CSV export

Table per application with the C3 columns and the reclaimable breakdown, plus CSV export
through the existing `buildAccountsCsv` idiom — including its `neutralizeCell` formula
guard, which is why the export goes through that module rather than a second writer.

### C6 — seed and E2E

Seed data covering the four cases the reconciliation must separate: a fully used
contract, one with unassigned seats, one over-allocated, and one whose reclaimable seats
include a ghost and an orphan. One E2E spec asserting the page renders the rollup and
that the over-allocated application is not displayed as zero waste.

## Testing strategy

- **Unit**: the reconciliation's arithmetic and the `idle` eligibility rule, including the
  case that must not fire — a CSV-only application with a stale `last_activity_at` on some
  account of a *different* application.
- **Integration** (Testcontainers, RLS): a second tenant's contract is invisible, and an
  `INSERT` naming another tenant is rejected by `WITH CHECK` rather than merely unread.
- **Import**: unknown `app_key` creates the application and warns; known `app_key` with a
  different `app_name` does not rename it; `seats` non-integer, negative price, bad
  currency, `term_end` before `term_start` each red with the row number.
- **Falsifiability**: every assertion above ships with the single edit that reds it,
  recorded in the RT7 table this repository's plans carry. Explicitly included: clamping
  `unassigned` at zero, widening `idle` to every application, and summing across
  currencies — the three defects this plan's contracts exist to forbid.

## Considerations & constraints

### Scope contract

- **SC-H** — contract *history* (renewals, price changes over time) is out. One current
  contract per application; a renewal overwrites. Trigger: the first question that needs
  a figure from a past term.
- **SC-T** — tiered plans, where not every active account consumes a paid seat, are not
  representable. This is the trigger that promotes the derived seat to an `entitlements`
  table, and it is the one to watch, because the workaround (a second contract row per
  tier) is available and would encode the wrong model cheaply.
- **SC-U** — usage-based / consumption pricing is out; `seats × unit_price` is the only
  cost model.
- **SC-F** — no FX. Cross-currency totals are refused rather than approximated.
- **SC-A** — automatic ingestion from accounting systems or invoices is out by the scope
  decision that opened this cycle. Trigger: none within this plan; the roadmap holds it.
- **SC-P** — per-application usage telemetry does not exist, which is what confines
  `idle` to one application. Closing it is a connector capability, not a schema change,
  and it is the strongest argument for SC3 following this cycle rather than preceding it.

### Risks

- **The `idle` rule is the one that can be quietly wrong.** It reads a column that exists,
  is populated, and means something adjacent to what the feature wants. A test that only
  checks "idle accounts are counted" passes for the broken version too; the eligibility
  test is the one that has to fail first.
- **`numeric` arrives as a string** through `pg`. Any arithmetic performed in JavaScript on
  it re-introduces the float error the column type was chosen to avoid — the arithmetic
  belongs in SQL.
- **Creating applications from a CSV** is a write that a typo can perform. The warning is
  the mitigation; a review should decide whether it is enough before implementation.

## User operation scenarios

1. **First contract load** — admin uploads `contracts.csv` covering 12 applications, of
   which 11 have no connector. All 12 appear on `/licenses`; 11 are reported as newly
   created applications in the import warnings.
2. **Finding waste** — `/licenses` shows Slack at 50 purchased, 44 assigned, 6 unassigned,
   and 4 reclaimable (3 ghost, 1 orphan); the reclaimable value is shown in the contract's
   own currency.
3. **Catching over-allocation** — Figma shows 10 purchased and 13 assigned; the row reports
   −3 rather than 0, which is the licence-compliance signal.
