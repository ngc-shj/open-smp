# Plan Review: saas-license-cost
Date: 2026-07-31
Review round: 1

## Changes from Previous Round

Initial review. Three experts, disjoint measurement missions, run against the live stack
rather than over the plan text — the method cycle 6 adopted at round 6 after five rounds
of re-reading produced no Critical that a tool had not found first.

**37 findings, four Critical.** All three experts executed against PostgreSQL 16.13, and
each recorded what it verified as TRUE as well as what it found wrong, so the next round
does not re-derive them.

Five claims the plan made and the experts confirmed by execution: `pg` returns `numeric`
as a string and `numeric(14,2)` round-trips `1234567890.99` digit-for-digit;
`saas_apps.credentials_enc` is nullable; C2's `ON CONFLICT ... DO UPDATE ... RETURNING id,
(xmax = 0)` works as `opensmp_app` under FORCE RLS with `display_name` preserved; all
eight tenant-scoped tables declare both `USING` and `WITH CHECK` with `FORCE` set; and the
`SaaSConnector` member set in the plan is exactly the four files `git grep` returns.

The Critical findings are concentrated where the plan was most confident: the `idle`
eligibility rule it called its own main risk, and the boundary/validation split it
declared as a control class.

## Merged Review Findings

### Critical

**F-01**
**Severity:** Critical
**Problem:** `activityEligible` has no derivation path from the process that must emit it. C3/C4 require per-app activity eligibility, but `apps/api` does not depend on `connectors-core`. The capability is only declared in `SaaSConnector` instances built via `ConnectorFactory`, which throws on missing credentials. CSV-only apps (null credentials) cannot instantiate connectors, making the field derive from credential presence rather than a static capability declaration.
**Impact:** FR3 not satisfiable as designed. C4 acceptance passes for the wrong reason. Consumer 1's justification is defeated (SC57 defect class).
**Recommended Action:** Declare the capability statically and credential-free via a `ConnectorCapabilities` descriptor exported from `connectors-core`. Add `@open-smp/connectors-core` to `apps/api` deps (it lacks `googleapis`). Restate C3's member-set primitive as this descriptor map.
**Perspectives:** Functionality, Security, Testing

**F-02**
**Severity:** Critical
**Problem:** C2 delegates value validation to C1's constraints inside one whole-file transaction, so no value error can ever be row-scoped. C2 uses a single `withTenant` transaction for the whole file but demands row-scoped errors carrying row numbers. All five bad values are C1 schema constraints. The first violating row poisons the transaction; subsequent rows and valid rows abort with "current transaction is aborted".
**Impact:** 500 error on first violation. No `ImportRowIssue` list, no partial import. Valid rows already applied are rolled back. FR2 unmet. C2's declared control class is false.
**Recommended Action:** Rewrite C2's invariant: all five values are app-enforced at the boundary; C1's constraints are defense-in-depth. Follow `hr-import` exactly: validate `seats`, `unit_price`, `currency`, `billing_cycle`, `term` ordering in `validateRow`; collect `ImportRowIssues`; open the transaction only over `validRows`.
**Perspectives:** Functionality

**F-03**
**Severity:** Critical
**Problem:** The idle eligibility test cannot fail for the reason it claims. C3's acceptance tests a CSV-only application reporting zero idle. However, the only production writer of `saas_accounts` is `sync.ts`, which throws for apps without credentials. CSV-only apps have zero `saas_accounts` rows by construction, so every reason count is 0 regardless of `last_activity_at`. The paired RT7 mutation deletes the conjunct and leaves the count at 0.
**Impact:** The defect ships with a green test asserting it was prevented. C3's Go/No-Go entry would be marked proven.
**Recommended Action:** State the fixture as a STATE (`saas_accounts` rows older than `IDLE_AFTER_DAYS` attached to the connector-less app itself), note it's unreachable via product paths, and name the writer that creates it (direct SQL in integration test or `seed.ts`). Add the paired allow case. Strike the acceptance sentence if the fixture cannot be changed.
**Perspectives:** Testing

**F-04**
**Severity:** Critical
**Problem:** C2 removes an existing repository control test and names no replacement. `saas-app-key-pin.test.ts` asserts exactly one zod `key` declaration (`z.literal('google-workspace')`). C2 replaces it with `z.string().min(1)`, increasing the count to 2 and breaking the parity gate regex. Semantically, C2 removes the registry pin that prevented `app_key='label'` from producing indistinguishable sync vs audit records.
**Impact:** Implementer may rename fields to dodge the regex (false-positive control) or CI reds lead to control relaxation. C2's acceptance lacks `app_key` value cases.
**Recommended Action:** C2 must state which control replaces the pin and add an acceptance case rejecting `app_key` against a reserved-source denylist. Re-derive `saas-app-key-pin.test.ts` explicitly.
**Perspectives:** Testing

### Major

**F-05**
**Severity:** Major
**Problem:** Ghost/Orphan/Idle overlap is not mutually exclusive, and the acceptance tests the vacuous pair. A live DB CHECK enforces `ghost` implies `identity_id IS NOT NULL` and `orphan` implies `NULL`. The genuine overlap is `ghost ∩ idle` and `orphan ∩ idle`. C3 states no precedence and uses inconsistent adjudicators for `ghost`.
**Impact:** `reclaimable.total` double-counts the most common reclaimable seat. `reclaimableValue` overstates recoverable spend by ~2x.
**Recommended Action:** Declare precedence (`orphan > ghost > idle`), make reasons a partition, replace acceptance with the overlapping pair, and assert `ghost + orphan + idle == total`. Define `ghost` consistently as `account_links.status='ghost'`.
**Perspectives:** Functionality, Testing

**F-06**
**Severity:** Major
**Problem:** `app_key` validation is absent, removing the existing allowlist with no authorization tier to compensate. C2 deletes the `POST /saas-apps` `z.literal` pin. No role model exists (only `requireSession`). `MUTATION_RATE_LIMIT` is 60/min, IP-keyed, in-memory, single-instance. With `MAX_ROWS = 20,000`, this permits rapid catalog bloat. The rate limit justification was calculated for 1 INSERT/row, but C2 writes 2 tables/row, doubling the hold.
**Impact:** Unbounded catalog growth, unattributable DoS, and any authenticated session can register arbitrary app keys.
**Recommended Action:** Constrain `app_key` with a charset floor `/^[a-z0-9][a-z0-9-]{0,63}$/`. Add a per-tenant `saas_apps` ceiling enforced inside the C2 transaction. Export `MAX_ROWS`/`MAX_UPLOAD_BYTES` from a shared module. Record in threat model that "authenticated == full tenant write" is the model, or add a role column.
**Perspectives:** Security, Functionality, Testing

**F-07**
**Severity:** Major
**Problem:** C2's `app_key` and `app_name` lack validation, creating unnamed apps or splitting contracts via case/whitespace. C1 specifies no `ON DELETE` for `saas_contracts_saas_app_id_fkey`. `saas-apps.ts:180-241` pre-checks only `saas_accounts` and narrows the catch to `saas_accounts_saas_app_id_fkey`. A contract-only app sails past the pre-check, hits the contract FK, and throws 500.
**Impact:** The documented recovery path for a known risk yields a 500; the stray app is permanently un-removable through UI/API.
**Recommended Action:** Add both fields to row validation (trim + lowercase for key). Decide `ON DELETE` semantics explicitly (CASCADE matches `account_labels`) or extend the pre-check and widen the constraint whitelist. Add to C1/C2 acceptance.
**Perspectives:** Security, Functionality, Testing

**F-08**
**Severity:** Major
**Problem:** `numeric(14,2)` silent rounding, `NaN` acceptance, and undefined `reclaimableValue` period. `numeric(14,2)` silently rounds `10.005` to `10.01` and overflows on large inputs. `CHECK (unit_price >= 0)` rejects nothing for `NaN` or `1e3`. C4 introduces `reclaimableValue` without a formula, computation site, or period. `billing_cycle` is monthly|annual; multiplying by `unit_price` without period normalization yields incomparable figures.
**Impact:** FR4 unenforceable. Two rows showing the same reclaimable amount (one monthly, one annual) cause 12x misreading. CAST errors abort the transaction.
**Recommended Action:** Validate at boundary: `unit_price ^\d{1,12}(\.\d{1,2})?$`, `seats ^\d{1,9}$`. Add `CHECK (unit_price >= 0 AND unit_price = unit_price)` to C1. Define `reclaimableValue` in C3 with a formula, SQL computation, and period (normalize or add `reclaimableValuePeriod`).
**Perspectives:** Security, Functionality

**F-09**
**Severity:** Major
**Problem:** The new table is not enrolled in RLS/member sets, and C1's enforcement proof is manual-only. `rls.integration.test.ts` and `tables.test.ts` pin literal 8-element arrays. `saas_contracts` is not in them. C1's acceptance is `\d` output + one cross-tenant INSERT, with NO automated tests for the five CHECK/UNIQUE constraints. Forbidden patterns have no executing gate.
**Impact:** RLS sweeps skip the new table. Contracts marked pending against acceptance cannot be checked by CI. A future migration relaxing constraints passes gates.
**Recommended Action:** C1 names both list edits as obligations. Give C1 an integration case per constraint (attempt violating INSERT, assert 23514/23505). Re-scope forbidden patterns against measured member sets or demote them from "forbidden pattern" to review notes.
**Perspectives:** Testing

**F-10**
**Severity:** Major
**Problem:** CSV export `neutralizeCell` mangles negative `unassigned`, and `new Blob` pattern flags unmodified correct code. `DANGEROUS_FIRST_CHARS` includes `'-'`, so `neutralizeCell('-3')` returns `'-3` (apostrophe-prefixed text). C5 exports every scalar through it. `grep` returns `CsvExportButton.tsx:9` as the only `new Blob` site, but C5's forbidden pattern flags it as outside `csv-export.ts`.
**Impact:** Over-allocation exports as text, breaking spreadsheet math/sorting. The pattern pushes implementers to refactor clean code.
**Recommended Action:** Keep `neutralizeCell` untouched; format numeric columns before export, or add a numeric-typed field path. Restate `new Blob` pattern to exclude `CsvExportButton.tsx` and reuse it for `/licenses`.
**Perspectives:** Functionality, Security

**F-11**
**Severity:** Major
**Problem:** `assigned` counts accounts that no longer exist upstream. `sync.ts` is upsert-only and never deletes/archives rows absent from `listUsers`. Deleted Google Workspace accounts keep `account_status='active'` forever with frozen `last_synced_at`.
**Impact:** `assigned` permanently overcounts by deleted accounts, causing `unassigned` to under-report reclaimable seats. Compounds over time; invisible to C6 seed.
**Recommended Action:** Restrict `assigned` to `last_synced_at >= latest sync timestamp`, or add a stale-account reclaimable reason. C3 must state it; C6 must seed a stale account.
**Perspectives:** Functionality

**F-12**
**Severity:** Major
**Problem:** `IDLE_AFTER_DAYS` testability contradiction and absolute literal seed rot. Risk says arithmetic belongs in SQL; testing strategy claims a UNIT test of reconciliation. If SQL, unit tests (no DB) can only assert over query strings, proving nothing. If JS, it's a second implementation. Tests re-typing `90` triggers RT3. Seeded `last_activity_at` values are absolute literals; idle assertions rot on the calendar.
**Impact:** Unit/integration tier conflict. E2E assertions will fail months later in `compose-smoke`, a required job.
**Recommended Action:** Decide explicitly: (a) declare reconciliation an integration-tier concern and drop unit line; or (b) name a narrow pure slice as the unit surface. Tests must import `IDLE_AFTER_DAYS` from its single declaration. Express seeded values relative to `now()`.
**Perspectives:** Testing, Functionality

**F-13**
**Severity:** Major
**Problem:** Import creates catalog rows with no persisted audit trail. The plan flags the lack of audit trail and asks for a decision, but the mitigation is an HTTP response body never stored. `0005_discovery_events_append_only.sql` establishes the opposite pattern for less consequential mutations. `recordLabelAuditBatch` provides a set-based append-only pattern.
**Impact:** Compromised/careless sessions can create thousands of rows with nothing to find, making F-06's DoS unattributable.
**Recommended Action:** Record a `discovery_events` row per import (or batched) on the `withTenant` transaction, following `recordLabelAuditBatch`'s shape. Add to C2 acceptance.
**Perspectives:** Security

**F-14**
**Severity:** Major
**Problem:** Unbounded text columns (`plan_name`, `note`) missing length/newline validation. C1 gives `text` with no `char_length` CHECK. C2 attaches no validation. Precedents (`hr-import`, `account_labels`, `label-note.ts`) cap free text and reject CRLF. C2's `note` is operator-authored, arrives via CSV, and accepts newlines, breaking export invariants.
**Impact:** 10 MB rows stored as one `note`. Storage growth independent of DoS bounds. Echoed values in error messages/log cause response bloat.
**Recommended Action:** Add `CHECK (char_length(...) <= N)` on `plan_name` and `note`. Reuse `noteSchema`'s newline rejection. Cap echoed values in C2 error messages.
**Perspectives:** Security

**F-15**
**Severity:** Major
**Problem:** Consumer 1 field list omits `hasConnector`, risking `sync.ts` throw. C4's acceptance says the page offers no sync affordance for `hasConnector: false`, but Consumer 1's declared read set omits the field. `sync.ts:95-97` throws "has no stored credentials" if called incorrectly.
**Impact:** Concrete risk of unhandled credential throws.
**Recommended Action:** Add `hasConnector` to Consumer 1's read set with the operation it drives. Re-walk the other two consumers.
**Perspectives:** Functionality

**F-16**
**Severity:** Major
**Problem:** Roadmap SC5 trigger argument axis misalignment. Roadmap checks if the interface is designed against one example. The plan argues purely compile-compatibility. Adding a brand-new capability axis whose only value comes from the single implementation IS that evidence. F-01 is the interface defect predicted on schedule.
**Impact:** Go/no-go taken against a broken design. Once fixed, it crosses an app/package boundary, violating current repo architecture.
**Recommended Action:** Re-classify against the corrected design. Say SC5 proceeds on the roadmap's axis (does this force a redesign for a second connector?) and record the new `apps/api -> connectors-core` edge as a deliberate architecture decision in C3.
**Perspectives:** Functionality

### Minor

**F-17**
**Severity:** Minor
**Problem:** `char(3)` currency column silently truncates on explicit cast. `char(3)` + `CHECK (currency ~ '^[A-Z]{3}$')` rejects over-long values on bare inserts, but explicit casts silently truncate: `'USDX'::char(3)` stores `USD`.
**Impact:** Currency substitution passes CHECK and acceptance. FR4 holds vacuously over wrong currency.
**Recommended Action:** Use `text` with the same CHECK. Validate app-side. Assert the STORED value for a 4-character input.
**Perspectives:** Security

**F-18**
**Severity:** Minor
**Problem:** Seeded E2E data conflicts with existing smoke test assertions. Demo tenant already holds exactly one orphan account. `e2e/specs/accounts.spec.ts:61-66` asserts `toHaveCount(1)` for `?status=orphan`. C6 seeding a second orphan reds this tenant-scoped spec. Adding fixtures to `seed-facts.ts` reds the seed-agreement gate unless mirrored asserts are added.
**Impact:** Compose-smoke failures in CI.
**Recommended Action:** State that ghost/orphan cases reuse existing seeded `google-workspace` accounts, or update `accounts.spec.ts:66` in the same contract. If using new fixtures, state that mirrored `assert_*` calls are a C6 obligation.
**Perspectives:** Testing

**F-19**
**Severity:** Minor
**Problem:** Duplicate `seats` and `purchased` in locked shape. C4 carries both; C3 defines `purchased = saas_contracts.seats`. Consumer 1 reads both.
**Impact:** Two names for one number in a shape designed to prevent restatement drift.
**Recommended Action:** Drop `seats` from the response, keep `purchased`.
**Perspectives:** Functionality

**F-20**
**Severity:** Minor
**Problem:** `total*` acceptance criterion falsely flags its own field. Acceptance says no field named `total*` aggregates across two currencies, while the shape declares `reclaimable.total` (a seat count).
**Impact:** Waived criterion guards nothing; check flags correctly intended data.
**Recommended Action:** Reword to: "no field of the response is a sum over rows whose currency differs". Note `reclaimable.total` is a seat count, exempt by type.
**Perspectives:** Functionality

**F-21**
**Severity:** Minor
**Problem:** Verification environment list drops E2E login budget and missing VE classification. Plan states each contract's manual-test path is classified against VE1-VE4, but no contract carries a classification. The E2E login budget (VE6) is omitted, though latent due to global `storageState`.
**Impact:** Unclear testing boundaries.
**Recommended Action:** Restore login budget as VE5 (or VE6) with a note that it's satisfied by `global storageState`. Add the one-line classification to each contract.
**Perspectives:** Testing

## Quality Warnings
No quality warnings flagged. All merged findings contain concrete file/line references, executed grep/SQL evidence, or explicit actionable remediation steps. No findings violate the [VAGUE], [NO-EVIDENCE], or [UNTESTED-CLAIM] gates.

## Recurring Issue Check

### Functionality expert

- R1: Checked — no issue (C5 reuses buildAccountsCsv/neutralizeCell; C2 reuses hr-import's boundary decisions)
- R2: Checked — no issue (IDLE_AFTER_DAYS declared once; re-typing forbidden)
- R3: Checked — no issue (the new type crosses via api-types and the apps/web/src/lib/api-types.ts re-export barrel)
- R4: N/A — hr-import, the precedent this contract follows, writes no discovery_events
- R5: Checked — no issue (one withTenant transaction)
- R6: Finding F-08
- R7: N/A — testing scope
- R8: Checked — no issue (C5 follows the existing table + CsvExportButton idiom)
- R9: N/A
- R10: Checked — no issue, but F-01/F-16 add an apps/api -> connectors-core edge, which is acyclic
- R11: N/A
- R12: Finding F-05
- R13: N/A
- R14: Checked — no issue (grants match 0001_init.sql:158-166; the enum needs no grant; uuid default, no sequence)
- R15: Checked — no issue
- R16: Checked — no issue (C6 seeds through seed.ts, which compose-smoke already runs)
- R17: Checked — no issue (C2 adopts withTenant, decodeUtf8Strict, ImportRowIssue, MUTATION_RATE_LIMIT)
- R18: Finding F-13
- R19: N/A — testing scope; the plan already reasons about the fake connector
- R20: N/A
- R21: N/A
- R22: Checked — no issue
- R23: N/A — entry is by CSV upload
- R24: Checked — 0006 creates one new table; its CHECKs constrain no pre-existing data
- R25: Checked — no issue
- R26: Checked — no issue (absence of the sync affordance, not a silent disable; activityEligible drives an explicit "not measured")
- R27: Checked — no issue
- R28: N/A
- R29: Checked — the pg-returns-numeric-as-string claim was verified by query, not accepted
- R30: N/A
- R31: Checked — the typo risk is real; answered in F-13 (validation, not just a warning) and F-08 (the removal path must work)
- R32: N/A
- R33: N/A
- R34: Finding F-15 — the un-reaped rows are pre-existing but the feature is the first consumer that is wrong because of them
- R35: Checked — VE1-VE4 classify every manual-test path
- R36: N/A
- R37: Checked — ghost/orphan are the product's existing vocabulary
- R38: N/A
- R39: N/A
- R40: Finding F-11
- R41: Finding F-01
- R42: Findings F-05, F-09, F-10. The SaaSConnector member set itself was recomputed and matches the plan exactly
- R43: N/A
- R44: N/A
- R45: N/A
- R46: N/A
- R47: Findings F-09, F-10 — both forbidden patterns are regexes whose exemption sets were written rather than derived
- R48: Findings F-03 and F-02
- R49: Finding F-02
- R50: Checked — every claim in this review was executed against live PostgreSQL 16.13 or the actual source

### Security expert


- R1: Finding F-04 (noteSchema not reused); see F-03 on MAX_ROWS
- R2: Finding F-03 (MAX_ROWS/MAX_UPLOAD_BYTES module-local in hr-import.ts:8-12; C2 will redeclare a DoS bound)
- R3: Finding F-01, F-04, F-08
- R4: Finding F-08
- R5: Checked — no issue; C2 declares one withTenant transaction for the whole file
- R6: [Adjacent] C1's FK declares no ON DELETE, unlike account_labels; deleting an app will fail on the contract FK. Functionality scope
- R7: N/A — testing scope
- R8: N/A — no security impact
- R9: Checked — no issue; C2 enqueues nothing
- R10: N/A
- R11: N/A
- R12: Checked — billing_cycle has two members, both handled
- R13: N/A
- R14: Checked — no issue. Executed the full C2 statement sequence on C1's exact table with only the four grants; all succeeded. No over-privilege either
- R15: Checked — no issue; 0006 adds no environment value
- R16: N/A — testing scope
- R17: Finding F-04
- R18: Finding F-03 (z.literal('google-workspace') removed with no replacement allowlist)
- R19: N/A — testing scope
- R20: N/A
- R21: N/A
- R22: Checked — no issue
- R23: N/A
- R24: Checked — 0006 is purely additive
- R25: Checked — no issue
- R26: N/A — UI scope
- R27: Checked — IDLE_AFTER_DAYS is single-sourced per C3
- R28: N/A
- R29: Checked — no issue
- R30: N/A
- R31: Checked — a re-import overwrites one contract silently but deletes nothing; the warn-on-create / silent-on-overwrite asymmetry is functionality scope
- R32: N/A — testing scope
- R33: N/A
- R34: Finding F-01 (saas_accounts FK carries the same defect and the plan does not name it)
- R35: Checked — VE1-VE4 classify each path
- R36: N/A
- R37: Checked — the worker's "has no stored credentials" throw is addressed by C4's hasConnector
- R38: N/A
- R39: Checked — C2 never touches credentials_enc
- R40: Checked — numeric-as-string is deliberate and C4 declares it
- R41: Checked — the connector activity-capability field is optional and the one implementation declares it
- R42: Checked — no issue. Verified the "every tenant-scoped table declares WITH CHECK" class live: 8/8 in pg_policies, all cmd=ALL, all forced. The connector member set is derived, not listed
- R43: Finding F-03
- R44: N/A — testing scope
- R45: N/A
- R46: N/A
- R47: Finding F-05 (surface-form check on a sink whose meaning SQL defines) and F-06 (char(3) truncates on cast but errors on column INSERT — same surface form, two semantics)
- R48: Finding F-02 (app-side and schema CHECK decide the same predicate; the schema's is weaker and admits NaN)
- R49: Finding F-01
- R50: Checked — no issue in the plan's own gates
- RS1: N/A — C1-C6 add no secret comparison
- RS2: Finding F-03 — MUTATION_RATE_LIMIT is present but 60/min, IP-keyed, in-memory, and its paired MAX_ROWS justification was computed for one INSERT per row, not two
- RS3: Finding F-02, F-04, F-06
- RS4: Checked — no issue; VE4 fixes all C6 seed figures as synthetic
- RS5: Finding F-03 (app_key has no whitelist or charset floor)
- RS6: Checked — no issue; csv-export.ts:45-47 orders neutralize -> strip -> quote correctly

No Critical findings. The plan's isolation story holds where it matters most: the RLS pattern is real and complete across all 8 tenant-scoped tables, C2's ON CONFLICT upsert cannot be made to collide across tenants, and the GRANT list is exactly right.

### Testing expert

- R1: Checked — no issue
- R2: Finding F-6 (IDLE_AFTER_DAYS reaching tests is unstated)
- R3: Finding F-3
- R4: Checked — no issue
- R5: Checked — no issue
- R6: Finding F-9
- R7: Finding F-4
- R8: N/A
- R9: N/A
- R10: N/A
- R11: N/A
- R12: Finding F-3
- R13: N/A
- R14: Finding F-3
- R15: Checked — no issue
- R16: Finding F-4
- R17: Checked — no issue
- R18: Finding F-3 (a new domain-pin test would also need a manual CONTROL_FILES entry — the addition-guard cannot see family (b))
- R19: Checked — no issue (fake connector)
- R20: N/A
- R21: N/A — plan review
- R22: Checked — no issue
- R23: N/A
- R24: Checked — 0006 creates one new table
- R25: N/A
- R26: N/A
- R27: Checked — the plan forbids re-typing the threshold in a UI string
- R28: N/A
- R29: Checked — no issue
- R30: Checked — no issue
- R31: Checked — re-import overwrite matches the existing hr-import idiom
- R32: N/A
- R33: Checked — single workflow file
- R34: Finding F-9
- R35: Finding F-11
- R36: Checked — no issue
- R37: N/A
- R38: N/A
- R39: N/A
- R40: Checked — unitPrice as string is asserted
- R41: Finding F-8
- R42: Finding F-3
- R43: Finding F-2 [Adjacent]
- R44: Checked — no issue
- R45: Checked — no new workspace member, so the parity gate's child count is unchanged
- R46: N/A
- R47: Finding F-8
- R48: Finding F-5
- R49: Finding F-8
- R50: Finding F-1
- RT1: Finding F-1
- RT2: Finding F-6
- RT3: Finding F-6
- RT4: N/A — no concurrency assertion in scope
- RT5: Finding F-6
- RT6: Checked — C4's shape has three named consumers
- RT7: Findings F-1, F-5, F-10
- RT8: Finding F-1
- RT9: Finding F-6
- RT10: Finding F-10

# Plan Review: saas-license-cost — Round 2
Date: 2026-07-31
Review round: 2

## Changes from Previous Round

Revision 2 removed the `idle` reclaimable reason rather than patching round 1's
findings one at a time, on the reasoning that `idle` was the generator: it needed
evidence the plan's own scope contract recorded as absent. Round 2 therefore gave
all three experts one mission — **attack revision 2's own repairs** — because the
previous cycle recorded seven consecutive rounds whose Criticals were inside the
previous round's fix.

**29 findings, eight Critical, and every Critical was inside a revision-2 repair.**
That is the ninth consecutive round of the pattern.

The common form, stated once rather than per finding: revision 2's repairs were
prose enumerations where the defining primitive was available. The RI/RLS
principle was derived and then applied to one FK of four. C2's validator list was
written by hand instead of derived from C1's constraint list. The reserved-key set
was `{label}` where the code says `{label, matcher}`. Three mutations were written
without being executed, and two fixtures were named without checking they could
exist.

Three findings converged 3/3 — C2's validation list not being derived from C1's
constraints (Critical in all three), the `saas-app-key-pin` control's disposition,
and the C6 seed cases not being jointly reachable.

# Functionality Plan Review — round 2, saas-license-cost (revision 2, 3877a25)

Executed against live PostgreSQL 16.13 and the seeded Demo Corp tenant, every write in BEGIN ... ROLLBACK.

## Round-1 findings revision 2 fixed — confirmed
F-01/F-03/F-16 (activityEligible, the unfalsifiable idle test, the SC5 trigger) — cut with idle; the deletion is complete: all nine remaining occurrences are records of the removal, and no contract, requirement, acceptance, risk, scope item, scenario, Go/No-Go row or mutation depends on idle, IDLE_AFTER_DAYS, activityEligible or a connector capability. NF1's new clause is consistent with every remaining contract.
F-02 — C2 now decides values before the transaction opens; correct in principle, residue in F2.
F-05 — ghost now reads account_links.status, matching the matcher.
F-06/F-13/F-14 — charset floor, ceiling, reduced MAX_ROWS, batched audit row, noteSchema reuse, 40-char echo cap all present.
F-07 — VERIFIED LIVE both directions: without ON DELETE the delete raises 23503 naming saas_contracts_tenant_id_saas_app_id_fkey, saas-apps.ts:216-224 whitelists only saas_accounts_saas_app_id_fkey and rethrows -> 500. With ON DELETE CASCADE as opensmp_app with the GUC set and FORCE RLS on: pre-check 0 accounts, DELETE 1, contract gone, no error. Scenario 4 is genuinely fixed.
The composite FK is creatable: ALTER TABLE saas_apps ADD CONSTRAINT ... UNIQUE (tenant_id, id) succeeds alongside the existing pkey and unique; the composite FK builds on it and a contract naming another tenant's app is rejected 23503. Cascade deletion is not blocked by FORCE RLS.
F-09/F-12/F-17/F-18/F-19/F-20/F-21 — member-set obligations, tier decision, text currency, seeded-orphan reuse, seats dropped, total wording, VE5 + per-contract classification all landed.

## F1 — CRITICAL — CHECK (unit_price = unit_price) does not exclude NaN. Executed: it stores.
Postgres defines NaN = NaN as TRUE for numeric (unlike IEEE floats) so the type can be sorted and indexed. Executed:
  SELECT 'NaN'::numeric >= 0, 'NaN'::numeric = 'NaN'::numeric;   -- t | t
  CREATE TEMP TABLE t (unit_price numeric(14,2), CHECK (unit_price >= 0 AND unit_price = unit_price));
  INSERT INTO t VALUES ('NaN');  -- INSERT 0 1 ; SELECT -> NaN
The term is a no-op. This was round 1's F-08 recommended action, adopted verbatim into the plan without being run.
Impact: FR4 unenforced at the schema. C1's stated control class is false for the one value the Money section is written about, and it is exactly the non-API writer C1 exists for. A stored NaN propagates: pg returns the string 'NaN', reclaimableValue evaluates to NaN, C4 serialises it as a string the UI formats as currency. C1's acceptance case and the RT7 row both describe a test that cannot pass — pressure to delete the case rather than fix the constraint.
Action: use unit_price <> 'NaN'::numeric (verified: rejects NaN with 23514, accepts 10.00 and 0.00). Correct the Money section and the RT7 row.

## F2 — CRITICAL — C2's boundary and C1's constraints still disagree, so the whole-file abort C2 was restructured to eliminate is still reachable
seats: C2 validates ^\d{1,9}$ (justified only against the int cast error), C1 checks <= 10000000. The window 10000001..999999999 passes the boundary and violates the CHECK. plan_name: C1 adds a 200-char CHECK; C2's validation list never mentions it, and the CSV cell can be 10 MB.
Executed, reproducing the round-1 failure mode exactly:
  INSERT (5, 'Business')          -- INSERT 0 1
  INSERT (20000000, 'Enterprise') -- ERROR: violates check constraint "c_seats_check"
  INSERT (7, 'Team')              -- ERROR: current transaction is aborted
unit_price is the one that is right: ^\d{1,12}(\.\d{1,2})?$ matches numeric(14,2)'s capacity exactly.
Impact: FR2 unmet on two ordinary inputs; a 500 with every valid row rolled back. C2's control class is false for plan_name.
Action: state the rule as a contract term — every C1 CHECK has a C2 validator with the same or a narrower domain, and C2 validates every column C1 constrains. Bind the seats bound to one declaration. Decide term_start/term_end parsing explicitly.

## F3 — CRITICAL — the watermark filters assigned but not reclaimable, so reclaimable is no longer a subset of assigned
C3 restricts assigned to accounts seen in the latest sync run; reclaimable and needsReview are counted over the stored link status with NO watermark and NO account_status predicate. Two divergences, both executed on the seeded tenant:
1. Pushing the ghost and orphan out of the latest run: assigned = 2, ghost = 1, orphan = 1 — the entire assigned count claimed reclaimable, and both reclaimable seats accounts the watermark just declared gone.
2. matcher/match.ts:74-82 returns orphan on rule fallthrough and ambiguous on multi-hit REGARDLESS of account_status; only deriveStatus consults it, and only for ghost. Suspending the orphan and archiving the ambiguous: assigned = 2, ghost = 1, orphan = 1, needsReview = 1 — a suspended account that consumes no seat by the plan's own rule is reported as a reclaimable seat.
This is the defect C3 explicitly claims to have closed for ghost, reintroduced for orphan and ambiguous and for all of them by the watermark.
Impact: FR3 unmet — a reclaimable seat is not a seat. Operational loop: an admin deletes a ghost upstream; sync never reaps; the watermark drops it from assigned; the ghost link stays; it is reported reclaimable FOREVER and reclaimableValue keeps charging for it. Simultaneously it is inside unassigned, so scenario 2's "6 unassigned and 4 reclaimable" double-counts up to 4 seats. reclaimable.total > assigned is reachable.
Action: define the reclaimable population as a restriction of the assigned population, in one place. Add the invariant ghost + orphan + needsReview + matched == assigned as an acceptance criterion. Add the two mutations. Say explicitly whether unassigned and reclaimable are disjoint.

## F4 — Major — matchState's two values cannot represent the states that occur
An application with zero accounts has no link rows, so it reports 'not-matched' and the page renders "not matched yet" instead of a reclaimable count — that is scenario 1's 11 CSV-only applications and scenario 4's typo'd app. For an application with no accounts, reclaimable: 0 IS derived from evidence, and suppressing it inverts the SC57 lesson the clause exists to carry. And a partially matched application: runMatch writes one link per account, but sync and match are separate BullMQ jobs, so accounts landed after the last match run have no link row while siblings do -> matchState 'matched' and those accounts contribute a silent zero.
Neither matchState nor needsReview has a stated derivation.
Action: at minimum 'no-accounts' | 'not-matched' | 'partially-matched' | 'matched', derived as (accounts = 0) / (linked = 0) / (0 < linked < accounts) / (linked = accounts). State needsReview = count(status='ambiguous') with the same population predicate as F3.

## F5 — Major — hasConnector has no stated derivation, and the only available one does not close the throw C2 opens
apps/api/src contains no connector knowledge except the z.literal and seed.ts's SAAS_APP_KEY; the registry is in apps/worker and NF1 now forbids extending the connector interface. So the only derivation is credentials_enc IS NOT NULL — credential presence, not connector support. sync.ts throws twice: "has no stored credentials" and "No connector registered for saas_apps.key". C2 removes the key allowlist and PATCH /saas-apps attaches credentials to any existing row with no key check, so an app created by import with key 'slak', given credentials by PATCH, carries hasConnector: true and hits the second throw.
Action: state the derivation and rename to hasCredentials, or derive from a static connector-key set in api-types (not a connector-interface change).

## F6 — Major [Adjacent] — "numeric columns are formatted before neutralisation" is a no-op
neutralizeCell inspects position 0 and csvField calls it on every cell; executed, neutralizeCell('-3') -> '-3. Any string a spreadsheet parses as a negative number begins with '-', so no formatting ORDER produces a cell that both passes through csvField and satisfies C5's acceptance. Round 1 offered two alternatives — format before export OR add a numeric-typed field path; revision 2 adopted the phrase without the mechanism. Also: unassigned/purchased/unitPrice/reclaimableValue are nullable and no cell form is stated for null; Consumer 2 is specified as reading "every scalar field" while reclaimable is an object.
Action: state the mechanism — numeric-typed columns emitted through quoteCsvCell only, bypassing neutralizeCell, enumerated with the reason each is safe. Null cell = empty.

## F7 — Major — C6's four seed cases are not simultaneously realisable
The over-allocated case requires assigned > purchased >= 0, hence at least one account, and google-workspace is the only application with any. Any newly seeded account is subject to the matcher's fallthrough -> orphan, and accounts.spec.ts:61-66 asserts toHaveCount(1) on /accounts?status=orphan, which is TENANT-scoped — so one new unmatched account anywhere reds compose-smoke. The escape route is narrow and unstated: 7 identities, 4 consumed, leaving three whose emails belong to the HR-import fixture set governed by the seed-facts/assert-seed-preserved agreement C6 itself cites. seed.ts:246-284 also binds ensureAccounts to a single saasAppId and a module-level ACCOUNTS constant, so a second account-bearing application is a restructure.
Action: name the four seeded applications and their accounts, including which identity each new account matches, and state that no new orphan link may be created.

## F8 — Major [Adjacent] — C2's app_key collides with saas-app-key-pin's regex, and the control narrows either way
saas-app-key-pin.test.ts:37 scans all of apps/api/src with an unanchored regex and asserts exactly one match. Executed: `app_key: z.string().regex(...)` -> ["key: z.string()"], and `'app_key': z.string().min(1)` -> ["key': z.string()"]. If C2's row schema is spelled in zod the control test reds. Read literally, "C2 removes the product's only key allowlist" deletes the pinned declaration and reds the same test; read as "opens a second writer", the test stays green while the property it defends is enforced for the new path by a mechanism the control cannot see.
Action: say whether the POST /saas-apps literal stays, and either forbid a zod field whose name ends in `key` in C2 or extend the control test in the same contract.

## F9 — Minor — "disjoint by the database CHECK" cites the wrong constraint
The CHECK constrains identity_id against status WITHIN a row and says nothing about two statuses coexisting. The real guarantor is account_links_tenant_id_saas_account_id_key UNIQUE (tenant_id, saas_account_id). Executed with only the CHECK in force: dropping the unique constraint let one account carry both a ghost and an orphan link (link_rows 2, statuses ghost,orphan).
Action: cite the unique constraint as the guarantor.

## F10 — Minor — the watermark subquery is correct only under RLS, and the verifying tier may not run under RLS
max(last_synced_at) carries no tenant predicate. Executed with a second tenant's account mis-parented onto Demo Corp's application (which the single-column saas_accounts FK permits) and a future last_synced_at: as opensmp_app with the GUC set, assigned = 4 (correct, the foreign row is invisible); as a BYPASSRLS/owner caller, assigned = 0.
Action: add the tenant predicate as defence-in-depth, or require the acceptance test to run as opensmp_app.


# Security Plan Review — round 2, saas-license-cost (revision 2, 3877a25)

All claims executed against PostgreSQL 16.13 in BEGIN ... ROLLBACK. Working tree unmodified.

## Round-1 closure status
- F-01 (activityEligible no derivation path) — closed by SCL7 cutting idle; the apps/api -> connectors-core edge is gone.
- F-06 (app_key allowlist removed) — closed in substance: charset floor, per-tenant ceiling, shared caps, and the "authenticated == full tenant write" model recorded.
- F-07 (app_key/app_name unvalidated; ON DELETE undecided) — closed.
- F-08 (numeric rounding / NaN / undefined reclaimableValue period) — closed.
- F-10 (neutralizeCell mangles negatives; new Blob pattern inverted) — closed.
- F-13 (no persisted audit trail) — nominally closed; see S5, the row cannot be read back.
- F-14 (unbounded plan_name/note, uncapped echo) — closed for note and the 40-char echo; NOT closed for plan_name (S2).
- F-17 (char(3) truncates on cast) — closed.

VERIFIED TRUE by execution: the composite FK does close the round-1 cross-tenant reference. Built C1 exactly as written; as opensmp_app under FORCE RLS with app.tenant_id = A, INSERT naming B's app fails 23503 saas_contracts_tenant_id_saas_app_id_fkey, same-tenant insert succeeds. Postgres's ~ '^[A-Z]{3}$' correctly rejects 'USD'||chr(10) (no POSIX trailing-newline hole), and the JS regexes are tight against Unicode digits, fullwidth forms and trailing newlines. No finding on any of these.

## S1 — CRITICAL — C1 states the RI/RLS principle and then enumerates a class of one (escalate: true)
plan:180-184 derives the general rule (RI checks run as the referenced table's owner and bypass RLS) and applies it to exactly one FK. Executed: EVERY single-column FK on a tenant-scoped table carries the identical defect. As opensmp_app with app.tenant_id = B, all accepted:
  saas_accounts.saas_app_id     (0001_init.sql:44)  — accepted
  account_links.saas_account_id (0001_init.sql:58)  — accepted
  account_links.identity_id     (0001_init.sql:59)  — accepted (B's link bound to A's identity)
  sessions.user_id              (0001_init.sql:89)  — accepted (B's session bound to A's user)
Reproduced C2's scenario-4 acceptance end to end: tenant B inserts one saas_accounts row naming tenant A's saas_app_id; A's DELETE pre-check (saas-apps.ts:196-200) runs under RLS and counts 0; the DELETE fails 23503 saas_accounts_saas_app_id_fkey; the catch (saas-apps.ts:210-219) matches that exact constraint and returns 409 app_has_accounts with no accountCount. A's application becomes permanently un-deletable with a 409 that contradicts everything A can see. C2's acceptance ("can be deleted ... without a 500") passes as written while the recovery path is dead.
Action: 0006 already adds UNIQUE (tenant_id, id) on saas_apps — the prerequisite. Add matching UNIQUE (tenant_id, id) on saas_accounts, identities, users and re-declare the four FKs as composite. If any is deferred, C1 must say which and why, and stop asserting the principle in the singular. Re-derive the member set from pg_constraint (R42).

## S2 — CRITICAL — C2's boundary is incomplete for three columns and disagrees with C1 on a fourth; F-02's failure mode reproduced (escalate: true)
plan:230-235 demotes C1's constraints to defence-in-depth BECAUSE C2 is believed to decide every value, and plan:274-275 declares C2 a fail-closed gate that "cannot pass a row without deciding it". The validation list covers app_key, app_name, unit_price, seats, currency, note — NOT plan_name, term_start, term_end beyond ordering. And seats ^\d{1,9}$ admits 999999999 while C1's CHECK rejects above 10000000.
Measured on C1's exact table as opensmp_app under FORCE RLS:
  INSERT ... seats = 999999999  -> ERROR: violates check constraint "saas_contracts_seats_check"
  next statement               -> ERROR: current transaction is aborted, commands ignored until end of transaction block
That second line is F-02 verbatim. plan_name > 200 chars hits its CHECK the same way; an unparseable term_start raises 22007 on the date cast — and plan:244-245 shows the author was aware of exactly this hazard for seats ("so an out-of-range cast error cannot abort the run") without extending it to the date columns.
Impact: one crafted row in a 2000-row CSV aborts the transaction, rolls back every valid row already applied, returns 500 with no ImportRowIssue list. FR2 unmet, control class false. The round-1 Critical relocated inside its own fix (R49: another control was narrowed because this one was believed to close the class).
Action: DERIVE C2's validation list from C1's column list rather than writing it — every column C1 constrains or types must have a paired validateRow decision, and the two bounds must be one shared constant (SEATS_MAX), not two literals differing by 100x. Add plan_name (<=200), term_start/term_end (strict YYYY-MM-DD, rejecting infinity/today/epoch which date accepts), align seats. Add the paired acceptance: a row violating each C1 constraint produces a row-scoped error WHILE a valid row in the same file is proven applied — the falsifiability table asserts this property but has no entry that would red on the seats/plan_name/term_* gaps.

## S3 — Major — the forbidden app_key set is {label}; derived from the code it is {label, matcher}
Every producer of discovery_events.source, derived by grep:
  sync.ts:150 app.key (sync_completed); sync.ts:157 app.key (sync_raw); sync.ts:178 appKey (sync_failed);
  match.ts:138 literal 'matcher' (match_completed); audit.ts:57 AUDIT_SOURCE 'label' (label_set/label_cleared)
'matcher' passes ^[a-z0-9][a-z0-9-]{0,63}$. events.ts:57-60 filters on source and nothing else; the projection keys on kind, so source is the only dimension selecting an audit family. Fully reachable with only C2 plus existing routes: import app_key=matcher -> POST /sync/:saasAppId (any authenticated session) -> sync.ts:88-96 assigns appKey BEFORE the "has no stored credentials" throw -> the failure path at sync.ts:178 commits a row with source='matcher', interleaved with the matcher's genuine trail under GET /events?source=matcher. That is saas-app-key-pin.test.ts:14-21's own argument for 'label', applying verbatim to a member the plan did not enumerate.
Secondary: (a) the normalisation order is prose, not a contract term — comparing before toLowerCase() lets LABEL through; (b) C2 removes saas-app-key-pin.test.ts's subject and the plan never states that test's disposition, leaving the only gate keeping this argument alive unowned.
Action: export RESERVED_EVENT_SOURCES = [AUDIT_SOURCE, MATCHER_SOURCE] from one module with match.ts:138 importing MATCHER_SOURCE instead of re-typing it; C2 rejects membership. Pin the normalisation order (trim -> lowercase -> regex -> reserved-set) as a contract term with acceptance for LABEL and MATCHER. State what replaces saas-app-key-pin.test.ts and its CONTROL_FILES entry.

## S4 — Major — the per-tenant ceiling does not serialize at READ COMMITTED; measured
plan:257-259 claims the ceiling "runs inside the C2 transaction under RLS so it cannot be raced". Executed: two concurrent opensmp_app transactions against an RLS-forced table pre-loaded with 8 rows, ceiling 10, each counting then inserting 5:
  B counted: 8 / A counted: 8 / final_rows_ceiling_was_10 = 18
Both read the same pre-insert snapshot and both committed. SELECT count(*) at READ COMMITTED takes no lock and there is no row to conflict on. Overshoot bounded only by MAX_ROWS x concurrent requests.
DoS arithmetic with real values: MUTATION_RATE_LIMIT = 60/min, { global: false }, in-memory, no trustProxy — keyed by socket IP, not tenant or session. Per-row statements from plan:262-267: 2, plus one ceiling count and one audit INSERT per request -> 4002 statements on one pooled connection at MAX_ROWS=2000 vs hr-import's 20000. The cap reduction is CONSERVATIVE relative to the plan's own criterion — no finding on the cap value. The finding is that the ceiling, the only bound on catalog growth, admits 60 x 2000 = 120000 new saas_apps rows per minute per IP with the ceiling raced open, and the plan declares no numeric ceiling value at all.
Action: take a lock the count can be read under (pg_advisory_xact_lock on tenant, or SELECT ... FOR UPDATE), or move the bound into the schema. Delete the "so it cannot be raced" claim; it is measurably false. Declare the ceiling's numeric value as a single named constant with an acceptance case running two concurrent imports (RT4).

## S5 — Major — C2's audit row is the mitigation for F-13 and cannot be read back, nor does it record an actor
The only read path is GET /events, whose projection is a per-kind allowlist: kind not in LABEL_AUDIT_KINDS -> projectSyncPayload keeps counts and runId only; kind in LABEL_AUDIT_KINDS -> projectAuditPayload keeps actorUserId, saasAccountId, before, after only. DiscoveryEventPayload has no field that could carry a key list. EITHER BRANCH DROPS THE CREATED KEYS — the row is stored and the evidence is not served. C2's stated payload also contains no actor at all, while F-13's impact was "a compromised session can create thousands of rows with nothing to find".
Control collision: audit-append-only.test.ts:94-116 asserts sites equals exactly ['audit.ts'] for INSERT INTO discovery_events across apps/api/src. A new INSERT in the import route reds it; reusing recordLabelAuditBatch instead forces source = AUDIT_SOURCE and a LabelAuditKind, forging the very family S3 exists to protect.
Action: extend the projection and DiscoveryEventPayload with a bounded createdKeys: string[] and add actorUserId to C2's payload; add the import kind to a named kind set with its own projector (the shape C21 established). Route the write through a second exported function in audit.ts (keeping the single-INSERT-site control intact) with its own source constant, distinct from AUDIT_SOURCE and MATCHER_SOURCE. Add an acceptance case that reads the created keys back through GET /events — the falsifiability table has no row that would red if the audit payload were dropped.

## S6 — Major — ON DELETE CASCADE adds an unaudited destruction path behind a guard that counts the wrong table
Measured: the cascade fires and BYPASSES TABLE PRIVILEGES — with DELETE withheld from opensmp_app on saas_contracts, a direct DELETE returned "permission denied for table saas_contracts" while DELETE FROM saas_apps cascaded the contract row away (contracts_left = 0). The RI action runs as the referenced table's owner, so no grant and no RLS predicate constrains it.
Asymmetric auditing: C2 writes a discovery_events row when a contract is created, while saas-apps.ts:180-249 writes none when one is destroyed — and its only guard is SELECT count(*) FROM saas_accounts, which knows nothing about contracts. An authenticated session at 60 req/min can erase every recorded price, seat count and term in the tenant, leaving a trail that records only creations. 0005 exists precisely so destruction leaves something to find.
Action: write a contract_deleted audit row on the cascade path (trigger, or explicit pre-delete in the route since the cascade is invisible to the application), or make DELETE refuse when a contract exists unless the caller opts in (R31). Add an acceptance asserting the trail exists after a cascade, and note in C1 that the cascade is privilege- and RLS-exempt.

## S7 — Minor — the DELETE grant on saas_contracts is over-privilege
plan:196-198 grants SELECT, INSERT, UPDATE, DELETE citing round 1's "sufficient" measurement. Sufficiency is not necessity — that was my round-1 finding to get wrong. No contract in C1-C6 issues a DELETE: C2 upserts, a renewal overwrites (SCL1), C3-C5 read. The only removal path is the cascade, which needs no grant. Given SCL8 sets the blast radius of any injection at full tenant-isolation bypass, an unused write privilege is a free widening (R14, over-privilege direction).
Action: grant SELECT, INSERT, UPDATE only; record that the cascade is unaffected because RI actions run as the table owner.

## S8 — Major — SCL8's deferral is defensible on cost, but its compensating control is not sufficient
Re-confirmed live: set_config('app.tenant_id', <other>, true) inside an open transaction re-points every RLS predicate. Also tested the cheapest alternative SCL8 calls too large: PostgreSQL 16 accepts GRANT/REVOKE SET ON PARAMETER "app.tenant_id" syntactically, but the revoke is NOT ENFORCED for a placeholder GUC — after REVOKE ... FROM PUBLIC, opensmp_app re-pointed the GUC without error. So SCL8's cost claim stands and deferring IS defensible.
What is not defensible is the compensating control as written. plan:277-279 forbids "tx\.query\( + a template literal containing ${ in the import path" — a surface-form check on an injection sink whose meaning SQL defines (R47, whose Critical criterion is exactly this). It does not match const text = '...' + value; await tx.query(text) — string concatenation, no template literal, no ${ at the call site — and the repository's own idiom builds SQL fragments in helpers precisely this way (buildEventsWhere at events.ts:66-88 returns a clause string assembled outside the tx.query( call). It also misses client.query(, pool.query( and drizzle raw escapes.
Action: keep the deferral and the pattern, but make it an ALLOW-list: "every statement in the import path is tx.query(<string literal>, values)" — no concatenation, no interpolation, no variable first argument — which is checkable and has no unenumerated spelling. Add the second half SCL8 already owes (correcting the withTenant docstring at db.ts:13-17, which claims "pooled-connection leakage across tenants cannot occur", a stronger property than the GUC has) and record that SET ON PARAMETER was measured and does not work.

## S9 — Minor — MAX_ROWS cannot be one shared constant with two required values
plan:253-256 says both caps move to a shared module AND that MAX_ROWS for this route is 2000, not 20000. One exported name cannot hold both. The implementer either imports the single MAX_ROWS and silently applies 20000 to C2 — a 10x loosening of a DoS bound stated as a contract value — or redeclares locally, defeating the move. MAX_ERRORS = 100 has the same ambiguity and is unmentioned.
Action: name the exports for their subjects — HR_IMPORT_MAX_ROWS = 20_000, CONTRACT_IMPORT_MAX_ROWS = 2_000, with MAX_UPLOAD_BYTES and MAX_ERRORS genuinely shared.

## [Adjacent] (functionality/testing scope)
C4's shape makes every contract field nullable, but unit_price's, seats's and currency's regexes all reject the empty string, and the plan never says which CSV cells may be blank — an application recorded with a plan name and no price is rejected outright. ^\d{1,12} also rejects 0000000000000.99, which numeric(14,2) stores fine.


# Testing Plan Review — round 2, saas-license-cost (revision 2, 3877a25)

Executed against live PostgreSQL 16, the seeded demo data, and the real test files. DB experiments in BEGIN ... ROLLBACK; working tree unmodified.

## Round-1 findings revision 2 correctly closed
F-01 (activityEligible no path) — closed by SCL7. F-03 (idle test could not fail) — closed by the same cut. F-05 (reason overlap / vacuous acceptance) — closed: partition over the stored link status, disjoint by the live CHECK, ghost+orphan == total, ambiguous broken out as needsReview. F-06 (allowlist) — closed. F-07 (app_key/app_name, ON DELETE) — closed. F-09 (RLS enrollment + constraint tests) — closed in substance; residues T-01, T-07. F-12 (tier contradiction, seed rot) — closed. F-18 (second orphan would red accounts.spec.ts:66) — closed; ghost/orphan reuse verified sound. F-21 (VE list) — closed. F-04 (removes a control test) — ONLY HALF closed, see T-06.

## T-01 — CRITICAL — mutation row 8 is inert: dropping WITH CHECK cannot red the RLS sweep's INSERT matrix
plan:462 pairs "drop WITH CHECK from the new policy" with "the RLS sweep's INSERT matrix". Postgres does not work that way: when a policy declares USING and omits WITH CHECK, THE USING EXPRESSION IS USED AS THE WITH CHECK EXPRESSION. Executed the mutation against the live database — created saas_contracts exactly as C1 declares, policy carrying only USING(...), granted to opensmp_app, ENABLE + FORCE — then ran the sweep's own INSERT shape under tenant A's GUC with tenant_id = B:
  PROBE A (mutated policy, foreign tenant_id): ERROR: new row violates row-level security policy
  PROBE C (legit insert, mutated policy):      INSERT 0 1
The deny fires and the allow still passes, so rls.integration.test.ts:424-446 (rejects.toThrow()) is green under the mutation for EVERY fixture. Not fixture-dependent; the row is false as written.
Impact: C1's member-set enrollment is presented as the proof that NF2 is closed by the sweep rather than by a bespoke test, and this is the single edit offered as evidence the sweep can fail on the new table. The plan's own R50 discipline is violated by the one row guarding tenant isolation.
Action: replace with a mutation Postgres honours — WITH CHECK (true), USING (true), or dropping the policy. If the intent is to prove the WITH CHECK clause load-bearing, state that it is NOT independently falsifiable given a matching USING and record it as a known limit. Note C1's policy has identical predicates in both clauses, so the clause is textual redundancy the schema pattern keeps for uniformity.

## T-02 — CRITICAL — the sync-watermark clause has no fixture; C6 cannot produce one and no other writer is named
plan:456 pairs "drop the sync-watermark clause" with "a stale account is not counted". That reds only against an account whose last_synced_at is strictly older than its application's maximum. Measured: all four demo accounts share one timestamp to the microsecond (2026-07-30 14:49:54.735951+00). seed.ts:258,265 writes last_synced_at = now() on both INSERT and DO UPDATE inside one withTenant transaction, so now() is constant across all rows — the seed cannot produce a spread, and SeedAccount has no lastSyncedAt field. Producing one the obvious way is blocked: a fifth account on google-workspace reds e2e/specs/apps.spec.ts:161 ("Cannot delete — 4 accounts still attributed"), and a second app needs >= 2 accounts (a single-account app is always its own watermark). Round 1's F-11 recommended exactly this pairing — "C3 must state it; C6 must seed a stale account" — and revision 2 adopted the C3 half while dropping the C6 half.
Impact: F-03's defect class regenerated inside the fix that closed F-03. If the implementer takes C6 as the fixture source — the only one the plan names, blessed by its acceptance ("without hand-editing the database") — the conjunct is a no-op on every fixture, the assertion passes with the clause deleted, and C3 is marked proven. The clause exists to stop assigned overcounting permanently in the direction that hides waste, so its silent removal is undetectable downstream.
Action: state the fixture as a STATE and name its writer. Two legitimate writers: direct SQL in an apps/api integration test (the declared tier), or two runSync passes with differing listUsers output through the existing FakeConnector (the only path exercising the production stamp). Add the paired allow case. If C6 carries it, it needs a second application with >= 2 accounts whose emails are absent from seed-facts.ts, and the plan must say so.

## T-03 — CRITICAL — C2's acceptance list is not derived from C1's constraint set; three gaps reproduce F-02's abort, none tested
Verified the precedent: hr-import.ts:181-206 opens one withTenant transaction and issues one INSERT per row with NO savepoints and NO per-row catch, so any constraint violation inside it throws the whole request. Three C1 constraints have no validateRow counterpart, or a wider one:
1. seats — C1 CHECK (>= 0 AND <= 10000000); C2 ^\d{1,9}$ admits 999999999. Every value in 10000001..999999999 passes the boundary and raises 23514 inside the transaction.
2. plan_name — C1 CHECK (char_length <= 200); C2 lists the column but its validateRow rules never mention it. app_name is capped at 200, plan_name is not.
3. term_start / term_end — C1 declares them date; C2 validates only the ORDERING. An unparseable or empty cell is a 22007/22008 cast error inside the transaction — the same abort the seats regex was chosen to avoid; the reasoning was applied to one column and not the others.
C2's acceptance enumerates seven bad-value cases and contains none of these three.
Impact: FR2 fails on the same mechanism revision 2 was written to close, with every valid row rolled back. The acceptance list was written from the examples in the prose rather than derived from C1's constraint set, which is why the two constraints C2 forgot are the two with no test.
Action: derive the C2 acceptance list from C1's constraint list mechanically — one case per C1 constraint, asserting the row number AND that valid rows in the same file were applied. Make the bounds agree (^\d{1,8}$ plus an explicit <= 10000000, or raise C1's cap), add plan_name reusing the app_name cap, add a date-parse rule before the ordering check. State the invariant as a contract term: NO VALUE REACHES THE TRANSACTION THAT C1 CAN REJECT.

## T-04 — Major — mutation row 3's discriminating fixture does not exist and cannot be seeded
"re-derive ghost through an identities join -> ghost matches the stored link status" (plan:457). The two derivations differ on exactly one state: matcher/match.ts:9-17 returns ghost only when the identity is left AND accountStatus === 'active'; a suspended/archived account of a left identity is stored matched but counted ghost by an identities join. Measured: all four seeded accounts are active, so both derivations return ghost = 1 and the mutation leaves the assertion green. Producing the state through seed.ts is blocked in every obvious direction — a fifth account reds apps.spec.ts:161; suspending bob.suzuki flips his link to matched, redding accounts.spec.ts:39-46, assert-seed-preserved.sh's assert_status ... 'ghost', and seed.ts:386's own ghost >= 1 bar; reusing bob's email on a second application makes the gate's jq selector return two rows so the comparison exits 1.
Impact: the row justifying C3's central design decision — read the stored status, do not re-derive — cannot fail. Reverting to revision 1's ghost definition would ship green.
Action: name the fixture state (an account_links row with status='matched', identity_id -> a left identity, account suspended) and its writer; direct SQL in the C3 integration test is cheapest and stays in the declared tier.

## T-05 — Major — C6's four seeded cases are not jointly reachable; only one application can ever report assigned > 0
Measured: the demo tenant holds exactly one saas_apps row and four saas_accounts rows, all on it; every other application C6 creates is CSV-only with zero accounts by construction. Therefore over-allocated requires google-workspace; ghost+orphan requires link rows so also google-workspace; and UNIQUE (tenant_id, saas_app_id) allows one contract per application, so those two cases collapse onto one contract row; which leaves "a fully used contract" satisfiable only as a zero-seat contract on an account-less application — a fixture that cannot distinguish a correct assigned from one hardcoded to 0. The account count is not free to change: apps.spec.ts:161 pins it at 4 in compose-smoke. The plan's scenarios 2 and 3 (Slack 50/44, Figma 10/13) are not reproducible in the seeded demo at all.
Impact: the E2E over-allocation assertion, mutation row 1 (clamp unassigned) and mutation row 11 (neutralise numeric columns) all depend on an over-allocated row, and the plan does not say which application carries it. The acceptance sentence is false as written.
Action: name the application per case. Workable: google-workspace carries the over-allocated AND ghost/orphan contract (seats = 2 against 4 assigned, ghost 1, orphan 1), one CSV-only application carries the unassigned-seats case, and "fully used" is either dropped from the seed and asserted at the integration tier or requires a second connector-less application with its own seeded accounts — state that obligation, its emails, and that they must all resolve to matched.
VERIFIED AS CLAIMED: the ghost/orphan reuse is sound — the seeded accounts provide exactly one ghost (bob.suzuki) and one orphan (unknown.contractor), and adding CONTRACT ROWS ALONE touches no email literal, no link status, no display_name, so seed-gate-agreement.test.ts and every existing E2E assertion are unaffected. The gap is the applications C6 must also create, not the contracts.

## T-06 — Major — saas-app-key-pin.test.ts reds under C2 and no contract owns its re-derivation or its CONTROL_FILES entry
Round 1's F-04 asked C2 to state which control replaces the pin AND to re-derive the test explicitly. Revision 2 did the first half and left the second. C2 removes z.literal('google-workspace'), and saas-app-key-pin.test.ts:86-89 asserts toHaveLength(1) over every zod key: declaration in apps/api/src then toBe("key: z.literal('google-workspace')"). Both red. Worse, its extractor is unanchored, so a new app_key: z.string() field matches as a key declaration and the file reds on the SECOND assertion instead of the first — pointing at the wrong cause. The file is a named member of CONTROL_FILES (package-test-parity.test.ts:616), so deleting it also reds the parity gate; and a route-level rejection test does not satisfy the CONTROL_FILES membership rule, so nothing repository-wide watches saas_apps.key afterwards.
Impact: a red control file with no owner is the condition under which controls get relaxed rather than re-derived. The narrowing is real: the source-form pin covered ANY future writer of saas_apps.key in apps/api/src; a route test covers one route.
Action: give C2 an explicit obligation naming (a) what the test becomes — the natural re-derivation is "no zod key field admits a value equal to AUDIT_SOURCE", keeping the whole-src scan and dropping the literal — and (b) the CONTROL_FILES edit. Note the addition-guard cannot see this family, so the entry must be added by hand.

## T-07 — Minor — two constraint names C1 wants asserted are Postgres-positional, and the C1 cases have no allow side
Created C1's table verbatim and read pg_constraint. Most names are mnemonic, but the term-ordering CHECK — the only multi-column one — is named saas_contracts_check, purely positional: a second multi-column CHECK later becomes saas_contracts_check1, and the obvious guess (saas_contracts_term_check) does not exist. There is also a second FK, saas_contracts_tenant_id_fkey (to tenants), raising the same 23503 as the composite FK, so SQLSTATE alone cannot tell them apart — which is why C1 asks for the name and why the name must be stable. C1's acceptance is deny-only: nothing asserts a VALID contract at the boundary values inserts, so CHECK (false) would satisfy every case (RT10).
Action: name every constraint explicitly in 0006 (CONSTRAINT saas_contracts_term_order_check CHECK (...)), add one allow-side case at boundary values. Existing SQLSTATE idiom: rejects.toMatchObject({ code: '42501' }) at rls.integration.test.ts:328,348; no existing test asserts constraint though production does, so toMatchObject({ code, constraint }) is the natural extension.
VERIFIED AS CLAIMED: enrolling in MEMBER_TABLES costs no additional container boot (one PostgreSqlContainer in beforeAll; the matrices are it.each), and the exhaustive switches DO force the new arms — compiled the shape under strict: true and got TS2366, and packages/schema/tsconfig.json includes test. Adding the arm also forces a SeedIds field, and the UPDATE/DELETE read-back forces a real seeded row. Two test titles go stale on enrollment and should be in the same obligation: rls.integration.test.ts:240 already says "all 7 member tables" for 8, and tables.test.ts:47 says "exactly the 8 tables".

## T-08 — Minor — two mutation rows do not say which tier's assertion they target, and one is green at the tier a reader would pick
"remove the = unit_price term from the CHECK -> NaN is rejected" (plan:464): C2's regex already rejects NaN app-side and C2's acceptance carries a NaN case, so pairing this mutation with the C2 assertion leaves it green — it reds only against the C1 integration case that writes 'NaN'::numeric directly. "move C2's value validation back into the transaction -> a bad row does not roll back the good ones" (plan:466) reds only if the chosen bad value is one Postgres actually rejects; a three-decimal unit_price — one of C2's own acceptance cases — is silently rounded by numeric(14,2), so the transaction never aborts and the mutation is green.
Action: qualify both rows with tier and fixture.

## T-09 — Minor — the unit-tested pure slice needs a production export the precedent does not have
plan:444-445 declares validateRow a unit surface. hr-import.ts:38 declares validateRow module-private with no unit test anywhere — the precedent C2 says it follows is covered only through api.integration.test.ts:453. So C2's unit test requires exporting a function whose only consumer is the test (RT6), which the plan does not say. The half of C2's acceptance that matters most ("every valid row in the same file is still applied") is inherently integration.
VERIFIED AS CLAIMED: the tier decision is consistent with the harness — the integration project globs **/*.integration.test.ts depth-agnostically, apps/api's test:integration is byte-identical to the canonical form, apps/api already has an assigned integration file, and vitest list --filesOnly --project integration confirms discovery. One consequence worth stating: each integration FILE provisions its own Testcontainers instance, so a new apps/api/test/licenses.integration.test.ts adds a seventh container boot to the integration job — folding the C2/C3 cases into api.integration.test.ts costs none.

## T-10 — Minor — C5's forbidden-pattern derivation command is not reproducible on a machine that has run the E2E suite
plan:401 derives the exemption from `grep -rn "new Blob" apps/web/src e2e`, "which returns exactly that one site". Executed: it returns the one site PLUS many hits inside e2e/playwright-report/index.html, a bundled Playwright artifact. It is gitignored, so `git grep -n "new Blob(" -- apps/web/src e2e` returns exactly one line — the claim is true of git grep, not of grep -rn.
Action: restate the derivation as git grep, which also makes the exemption set a property of the tracked tree rather than of the working directory.

## Recurring Issue Check — Round 2

### Functionality expert

- R1 Checked — no issue
- R2 Finding F2 (seats bound spelled twice)
- R3 Finding F3 (the watermark reached assigned and not the reclaimable joins)
- R4 Checked — no issue
- R5 Checked — no issue
- R6 Checked — verified live; ON DELETE CASCADE removes the contract and the route returns 204
- R7 Finding F7
- R8 Checked — no issue
- R9 N/A
- R10 Checked — the apps/api -> connectors-core edge is gone with idle
- R11 N/A
- R12 Finding F4
- R13 N/A
- R14 Checked — no issue
- R15 Checked — no issue
- R16 Finding F7
- R17 Checked — no issue
- R18 Finding F8
- R19 N/A — testing scope
- R20 N/A
- R21 N/A
- R22 Checked — no issue
- R23 N/A
- R24 Checked — 0006 is additive; the altered table gains only a UNIQUE, verified creatable against live data
- R25 Checked — no issue
- R26 Checked — the sync affordance is absent, not silently disabled; see F4 for what matchState renders
- R27 Checked — no issue now that IDLE_AFTER_DAYS is gone
- R28 N/A
- R29 Finding F1 (Postgres numeric NaN equality stated backwards) and F9 (wrong constraint cited)
- R30 N/A
- R31 Checked — the typo path is answered by validation, the audit row and the working DELETE
- R32 N/A
- R33 N/A
- R34 Checked — sync's never-reaping is named and owned by C3; SCL8 records the withTenant GUC
- R35 Checked — VE1-VE5 plus per-contract classification
- R36 N/A
- R37 Checked — ghost/orphan are the product's existing vocabulary
- R38 Finding F4 (partially-matched is a state the model cannot express)
- R39 Checked — C2 never touches credentials_enc
- R40 Checked — numeric-as-string declared and every contract field nullable; the null CSV cell is F6
- R41 Finding F5
- R42 Findings F3, F9
- R43 Checked — the composite FK narrows rather than widens; verified 23503
- R44 N/A
- R45 N/A
- R46 N/A
- R47 Findings F8 (the pin regex matches inside app_key) and F1 (a CHECK whose meaning Postgres defines differently than the plan reads it)
- R48 Findings F1 and F2 — C2's regex and C1's CHECK decide seats and unit_price by different domains
- R49 Findings F1, F2, F6
- R50 Finding F10; otherwise every claim executed against live PostgreSQL 16.13 or read from source

### Security expert

- R1 Checked — no issue
- R2 Findings S9, S2
- R3 Findings S1, S3
- R4 Finding S5
- R5 Checked — no issue
- R6 Finding S6
- R7 N/A — testing scope
- R8 N/A — UI scope
- R9 Checked — no issue
- R10 Checked — SCL7 removes the apps/api -> connectors-core edge entirely
- R11 N/A
- R12 Checked — billing_cycle two members both handled; link_status's five all named in C3
- R13 N/A
- R14 Finding S7
- R15 Checked — no issue
- R16 N/A — testing scope
- R17 Checked — no issue
- R18 Finding S3
- R19 N/A — testing scope
- R20 N/A
- R21 N/A
- R22 Checked — no issue
- R23 N/A
- R24 Checked — 0006 additive except ALTER TABLE saas_apps ADD UNIQUE (tenant_id, id), which cannot fail: id is already the primary key so the pair is trivially unique (verified against live saas_apps)
- R25 Checked — no issue
- R26 N/A
- R27 Finding S9
- R28 N/A
- R29 Checked — the numeric, char(3) and RI-bypass claims were each re-executed, not accepted
- R30 N/A
- R31 Finding S6
- R32 N/A
- R33 N/A
- R34 Finding S1 — the four cross-tenant FKs are pre-existing, were named in round 1's R34 note, and revision 2 defers them with no cost justification while landing the exact prerequisite constraint
- R35 Checked — VE1-VE5 classify every path; each contract now carries its classification
- R36 N/A
- R37 N/A
- R38 N/A
- R39 Checked — C1/C2 never touch credentials_enc
- R40 Finding S5
- R41 Checked — hasConnector derives from credentials_enc IS NOT NULL, a column that exists; the capability with no backing path is cut
- R42 Findings S1, S3 — both member sets re-derived from pg_constraint and from grep, not from the plan's lists
- R43 Finding S6 — ON DELETE CASCADE is a fix-induced widening: revision 1's absent ON DELETE protected the contract row, revision 2's cascade destroys it under a guard that does not see it
- R44 N/A
- R45 N/A
- R46 N/A
- R47 Finding S8
- R48 Finding S2 — seats decided by two adjudicators with different semantics, and the weaker one's approval poisons the transaction
- R49 Findings S2, S4
- R50 Checked — every claim executed in BEGIN ... ROLLBACK or read from the cited line
- RS1 N/A
- RS2 Checked on presence; arithmetic in S4; cap value conservative
- RS3 Finding S2
- RS4 Checked — no issue
- RS5 Finding S3
- RS6 Checked — no issue

### Testing expert

- R1 Checked — no issue
- R2 Checked — no issue (caps move to a shared module; IDLE_AFTER_DAYS gone)
- R3 Finding T-03
- R4 Checked — no issue (discovery_events.kind is string in api-types with no exhaustive consumer, so a new kind is additive)
- R5 Checked — no issue
- R6 Checked — ON DELETE CASCADE declared; the narrow catch at saas-apps.ts:223-225 is then never reached by the contract FK
- R7 Findings T-05, T-04
- R8 N/A
- R9 N/A
- R10 Checked — the apps/api -> connectors-core edge is gone with SCL7
- R11 N/A
- R12 Checked — billing_cycle both members named; all five link states named
- R13 N/A
- R14 Checked — the four grants were executed in round 1 against C1's exact table
- R15 N/A
- R16 Finding T-05
- R17 Checked — no issue
- R18 Finding T-06
- R19 N/A — FakeConnector untouched
- R20 N/A
- R21 N/A
- R22 Checked — no issue
- R23 N/A
- R24 Checked — the added UNIQUE (tenant_id, id) is over a PK-containing pair and applied cleanly against live seeded data
- R25 N/A
- R26 Checked — hasConnector suppresses the sync affordance and is in Consumer 1's read set
- R27 Folded into T-07 — two test titles go stale on enrollment
- R28 N/A
- R29 N/A
- R30 N/A
- R31 N/A
- R32 N/A
- R33 Checked — single workflow file
- R34 Checked — SCL8 and SCL9 record the deferred pre-existing defects with triggers and cost justification
- R35 Checked — VE1-VE5 plus per-contract classification
- R36 N/A
- R37 N/A
- R38 N/A
- R39 N/A
- R40 Checked — numeric-as-string declared and asserted
- R41 Checked — closed by SCL7
- R42 Findings T-01, T-07
- R43 N/A
- R44 N/A
- R45 N/A
- R46 N/A
- R47 Findings T-06, T-10
- R48 Findings T-03, T-08
- R49 Checked — every contract carries a control class and C1's is scoped rather than blanket
- R50 Finding T-01 — the one mutation whose behaviour the plan asserts was never executed
- RT1 Checked — no new mock; C3 runs against real Postgres
- RT2 Finding T-09
- RT3 Checked — no threshold constant survives the idle cut
- RT4 N/A
- RT5 Checked — C1's cases run as opensmp_app under FORCE RLS through the existing sweep
- RT6 Finding T-09
- RT7 Findings T-01, T-02, T-04, T-08
- RT8 Finding T-01
- RT9 Checked — the tier decision explicitly refuses a JavaScript twin of the SQL
- RT10 Finding T-07
