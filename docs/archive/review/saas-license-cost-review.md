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
