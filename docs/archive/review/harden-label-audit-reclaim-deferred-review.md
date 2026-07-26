# Plan Review: harden-label-audit-reclaim-deferred
Date: 2026-07-26
Review round: 1

## Changes from Previous Round
Initial review.

## Merged Findings

## Consolidated Findings

**Critical**
**Problem**: C31's test-only route registers under `/api/`, breaking four existing test sweeps in `buildApp` that collect every `/api/`-prefixed route. This includes a hard-coded deep-equal assertion on `apiRoutes`, a rate-limit check, a 401 unauthenticated sweep, and an Origin 403 sweep. Contradicts NFR5 and C28 AC5.
**Impact**: The plan's test-only route will cause existing integration tests to fail immediately upon implementation, introducing a regression (cycle-2 failure mode #4) and violating the "existing tests pass unmodified" criterion.
**Recommended action**: Register the route outside the `/api/` prefix on a separately-built Fastify instance scoped to the C31 `describe` block. Add an acceptance criterion explicitly asserting that the `apiRoutes` deep-equal check at `api.integration.test.ts:1501` passes unmodified.
**Perspectives**: Testing

**Major**
**Problem**: C29/C30/C32 member-set derivation undercounts label-kind copies and misses property-bound casts. The plan derives members from a filename glob or spelling-bound grep, missing three casts in `accounts.ts:77` and `identities.ts:55`, the Drizzle runtime enum in `tables.ts:44-48`, and two runtime arrays in `apps/web`. Adding a 4th kind passes silently in web UI due to union assignment rules.
**Impact**: Silent type/runtime drift. New kinds are settable/storable but not filterable or correctly typed in primary read surfaces, reproducing the exact D9 failure mode the plan aims to eliminate. Plan scenario 3 is false.
**Recommended action**: Re-derive the member-set by property across the tree. Apply the typed-query-row remedy uniformly, broaden the forbidden pattern to `apps/api/src/routes/**`, derive web copies from `ACCOUNT_LABEL_KINDS`, and update `tables.test.ts:23-29` to assert against the canonical enum instead of a literal copy.
**Perspectives**: Functionality, Security, Testing

**Major**
**Problem**: C29's proposed `label-kinds.ts` signature uses `export { X as Y } from '...'` which fails to bind `Y` in local scope under `verbatimModuleSyntax: true`. The subsequent `[...LABEL_KINDS, ...]` references an unbound identifier, causing a hard `TS2304` compile error.
**Impact**: The locked signature is unimplementable. Ad-hoc fixes will likely re-inline literals, defeating C29's copy-reduction goal, while acceptance criterion 5 still passes.
**Recommended action**: Use a separate value import to bind `LABEL_KINDS` before spreading it, ensuring compliance with `tsconfig.base.json:14`.
**Perspectives**: Functionality

**Major**
**Problem**: C32's enforcement is incomplete. The declared forbidden-pattern regex misses non-main/master branches, short SHAs, non-v-prefixed tags, sub-path actions, and docker:// refs. There is no local unit gate to verify pin shape, and no `dependabot.yml` or `renovate.json` to handle SHA unpinning cadence.
**Impact**: Supply-chain control decays on the first new action added. Manual edits are required for updates, trading tag-compromise risk for unowned stale-dependency risk without explicit trade-off documentation.
**Recommended action**: Invert to an ALLOWLIST regex matching `^[0-9a-f]{40}`. Add a local unit test reading `.github/workflows/*.yml` to assert pin shape. Add `dependabot.yml` with `github-actions` ecosystem to handle SHA bumps automatically.
**Perspectives**: Security, Testing

**Major**
**Problem**: C30's regex parse is bound to shell quoting/spelling (`^` anchor, single-quote delimiter). It fails on double-quoted args, leading indentation, or loop forms. `I30.4` only catches total-zero matches, missing partial drift that produces false-reds or silently green gates. Acceptance criterion 1 uses a magic literal (`>=4`) instead of deriving from `SEEDED_ACCOUNTS`.
**Impact**: Tests train maintainers to relax assertions on false negatives or mask correct gate behavior. Re-creating RT3 violation C30 aims to close.
**Recommended action**: Derive the count dynamically (`Object.keys(SEEDED_ACCOUNTS).length * 2`). Loosen regex to tolerate quotes/whitespace. Add a negative self-test with inline double-quoted/loop fixtures to prove property-bound parsing.
**Perspectives**: Testing

**Major**
**Problem**: C28's fake-PoolClient test (AC3) asserts SQL-text identity between `recordLabelAudit` and its delegate `recordLabelAuditBatch`. This is structurally vacuous (`x === x`) and cannot falsify if delegation is removed, provided SQL remains coincidentally identical. It does not verify SQL validity, `unnest` binding, or row cardinality.
**Impact**: False confidence in C28's delegation design. Regression guard (FR1) remains uncovered by the fake tier.
**Recommended action**: Drop the SQL-text assertion. Replace with a structural delegation check (one-element array triggers batch) and keep the empty-array zero-call check. Explicitly state that the existing integration test (AC2) discharges FR1, not the fake. Add an integration assertion for the single-account write path.
**Perspectives**: Testing

**Major**
**Problem**: C28's Consumer 4 walkthrough never verifies that the scalar `kind` parameter can express scheduled operations, specifically SC27 (bulk clearing).
**Impact**: The check is missing. While scalar `kind` is sufficient for uniform `label_cleared`, the absence of an explicit verification leaves a design gap unexamined.
**Recommended action**: Explicitly state and verify that scalar `kind` can/cannot express SC27 operations, confirming uniform clearance logic is sufficient.
**Perspectives**: Functionality

**Minor**
**Problem**: C28/C29 repeal the documented C8 "type-only" invariant without explicit handling. The R-A probe only verifies boot/build success, not the client-bundle boundary. `apps/web/src/app/import/page.tsx` hand-duplicates constants specifically to preserve C8.
**Impact**: Low direct risk (few bytes in bundle), but reverses a documented cross-cycle invariant with a probe that doesn't test the actual property.
**Recommended action**: Name C8 in the Technical Approach and explicitly state the amendment/repeal with reasoning. Update inline comments at `api-types/src/index.ts:1-4`. Extend the R-A probe to assert the bundle boundary holds.
**Perspectives**: Functionality, Security

**Minor**
**Problem**: Objective/Scenario 2 claims a corrupt payload renders as '—', but the codebase (`events/page.tsx:37-42,55-57`) renders '—' only when BOTH sides are absent. Single-field corruption renders 'none', identical to genuine "no label".
**Impact**: Misleading plan documentation contradicts actual rendering behavior. C29's own walkthrough gets this right; the Objective does not.
**Recommended action**: Correct Objective 2 to accurately reflect the 'none' vs '—' rendering logic based on `auditTransition`'s null coalescing behavior.
**Perspectives**: Functionality

**Minor**
**Problem**: Validation added at the audit read boundary silently drops out-of-domain `kind` values without emitting a signal.
**Impact**: Converts a visible symptom (D9 undefined render) into an invisible one. Investigators lose the ability to distinguish "corrupt row" from "no label".
**Recommended action**: Keep the omission behavior but add a `req.log.warn` in `projectAuditPayload` on the reject branch to create a distinguishable signal without exposing storage-integrity details. Record as an invariant.
**Perspectives**: Security

**Minor**
**Problem**: `seed.ts:24-25` creates a tenant with a known-plaintext admin password without a `NODE_ENV` or `SEED_ENABLED` guard.
**Impact**: Low immediate risk but raises the cost of hardening later, especially as C30 elevates seeded values to a first-class contract.
**Recommended action**: Add a `NODE_ENV`/`SEED_ENABLED` guard around the admin creation logic to prevent accidental exposure in non-seed contexts.
**Perspectives**: Security

**Minor**
**Problem**: I29.4 has no stated test file home. `packages/schema` is the natural home but lacks a dependency on `@open-smp/api-types`, which the plan forbids adding.
**Impact**: Unclear implementation location for the schema-semantics test.
**Recommended action**: Explicitly assign I29.4 to `apps/api/test/api.integration.test.ts` (already boots Postgres, imports api-types transitively). Document why `packages/schema` was rejected.
**Perspectives**: Testing

**Minor**
**Problem**: R44 evidence command judges exit status through `head` and uses `docker compose up -d`. `head` masks the typecheck exit status, and `-d` returns on container start, not compilation success.
**Impact**: A `pnpm typecheck` failure or Next.js module-resolution build failure is masked as success, defeating the R-A gate's purpose.
**Recommended action**: Drop `| head`. Replace log-eyeballing with a status-asserted probe: `curl -sf -w '%{http_code}' http://localhost:3000/events` after a readiness wait, asserting 200.
**Perspectives**: Testing


## Raw Expert Findings (authoritative prose)

### Functionality expert
```
FUNCTIONALITY EXPERT — Round 1

F1 [Major] C29's premise ("two hand-synced copies") undercounts the domain; apps/web holds a third and fourth copy the plan never lists.
Sites: apps/web/src/lib/label-kinds.ts:7-13 (LABEL_KIND_NAMES Record + LABEL_KINDS derived), apps/web/src/app/accounts/page.tsx:17-23 (LABEL_FILTERS literal array), apps/web/src/components/LabelFilter.tsx:7-14 (FILTERS enumeration).
LABEL_KIND_NAMES is Record<AccountLabelKind,string> so a 4th kind is a compile error there — but accounts/page.tsx and LabelFilter.tsx are plain arrays typed LabelFilterValue[]; a shorter array is still assignable, so a 4th kind is SILENT there.
Impact: plan user-scenario 3 promises "one edit in api-types plus the migration" — false. New kind would be settable/storable but not filterable in web UI: verbatim the failure mode label-kinds.ts:1-5 documents and FR2/I29.3 claim to eliminate.
Action: recompute member-set over whole tree; either derive all web copies from ACCOUNT_LABEL_KINDS, or scope them out with an SC id and correct scenario 3.

F2 [Major] C29's label-kinds.ts signature snippet does not compile.
`export { X as Y } from '...'` does not bind Y in local scope; `[...LABEL_KINDS, ...]` on the next line is an unbound identifier. Verified with repo tsc 5.7.3: "error TS2304: Cannot find name 'LABEL_KINDS'".
Correct form needs a separate value import. Note tsconfig.base.json:14 sets verbatimModuleSyntax:true so it must be a value import.
Impact: locked signature not implementable; an implementer resolving it ad hoc could re-inline the three literals, reintroducing the copy C29 exists to delete, while acceptance criterion 5 still passes.

F3 [Major] I29.1 member-set omits three casts of the same class (spelling-bound grep).
Plan's grep anchored on 3 spellings, found 4. Property-based re-derivation finds 7:
  apps/api/src/routes/account-labels.ts:90  as AccountLabelResponse['kind']            MISSING
  apps/api/src/routes/accounts.ts:77        as NonNullable<AccountListItem['label']>['kind']   MISSING
  apps/api/src/routes/identities.ts:55      as NonNullable<IdentityAccountItem['label']>['kind'] MISSING
All three are the identical shape (string column from tx.query<> asserted into the label-kind union). Plan's forbidden pattern is scoped by filename glob to account-labels*.ts so accounts.ts:45 and identities.ts:35 (`label_kind: string | null`) sail past.
Impact: after C29 the invariant reads satisfied while 3/7 of the class is untreated. This is the "guard bound to spelling not property" defect the plan itself names as cycle-2's most repeated.

F4 [Major] C28 Consumer 4 walkthrough never checks the scalar `kind` parameter against SC27 (bulk clearing).
kind is scalar (bound as $3 outside the unnest) — one kind for the whole batch. Fine for today's callers, but the walkthrough only verifies the two current literal values are in the set; it never verifies the signature can express the operations the plan's own deferral list schedules against it (SC27 bulk clear).
Action: state explicitly what scalar kind can/cannot express, naming SC27. Bulk-clear is uniform label_cleared so scalar IS sufficient — the defect is that the check was never performed.

F5 [Minor] R-A overstated in one direction, understated in another.
(a) Next.js risk is empirically ABSENT — agent executed the probe: added ACCOUNT_LABEL_KINDS+isAccountLabelKind to api-types, rewired apps/web/src/lib/label-kinds.ts to import the value, ran `pnpm typecheck` -> 0 errors and `next build` -> "Compiled successfully in 4.2s, 9/9 static pages". Tree restored clean.
(b) Consumer count wrong: only TWO consumers depend on @open-smp/api-types (apps/api, apps/web). apps/worker and e2e do NOT (verified in both manifests and node_modules).
(c) The real obstacle is UNNAMED: packages/api-types/src/index.ts:1-4 documents "Type-only — no runtime exports ... (C8 invariant)". Restated at apps/web/src/lib/api-types.ts:1-4 and ACTIVELY RELIED ON at apps/web/src/app/import/page.tsx:10-11, which hand-duplicates MAX_UPLOAD_BYTES *because* "api-types is type-only (C8), so the value cannot be imported at runtime". C29 repeals a documented cross-cycle invariant without naming it.

F6 [Minor] Objective/scenario 2 contradicts I29.5.
Plan:53 and :569 claim a corrupt payload "renders as a neutral placeholder / '—'". Traced apps/web/src/app/events/page.tsx:37-42,55-57: '—' requires BOTH sides absent. Single-field corruption renders 'none' — identical to a genuine "no label", because auditTransition coalesces undefined to null at :57 and labelSnapshot returns 'none' for falsy.
C29's own walkthrough (plan:313, I29.5) gets this right. The Objective does not.

## Recurring Issue Check
- R1: pass
- R2: fired (see F1)
- R3: fired (see F1, F3)
- R12: pass
- R16: pass
- R21: n/a
- R29: n/a (no external spec cited)
- R33: pass
- R34: n/a
- R42: fired (see F1, F3)
- R44: pass

VERIFIED-CORRECT (no finding): I28.1 member-set reproduces exactly (6 insert sites, audit family exactly 2, AUDIT_SOURCE not imported under apps/worker, recordLabelAudit exactly 2 call sites, no dynamic table names); I30.1/2/3 extraction regexes reproduce plan output byte-for-byte, all cited line numbers exact, 7 Playwright importers confirmed; I32.1 (exactly one workflow file, 10 uses: lines, no composite actions/workflow_call/docker://); I29.4/R16 — migration 0003:4 defines the enum, pg_enum query executed as opensmp_app returns all three labels, catalogs world-readable; ORM/type-shape — readonly[].map(JSON.stringify) -> mutable string[] binds to text[], typechecks clean, behavior-preserving vs account-labels-bulk.ts:80-95; C33/MUTATION_PATTERN probe replicated (does not trip); C31 premise (client_error in exactly one place, every branch line exact, sub-400 reading correct); R1 (collectSourceFiles/normalizeSource do exist and should be reused); C30 placement analysis sound (vitest globs exactly as quoted); ID hygiene (C28-C33, SC32-SC35 no collision).
```

### Security expert
```
SECURITY EXPERT — Round 1

F1 [Major] C29's member-set derivation bound to spelling misses 3 of 7 label-kind casts, leaving accounts.ts and identities.ts fail-open.
Same three omitted members as Functionality F3: account-labels.ts:90, accounts.ts:77, identities.ts:55.
Security angle the functionality report does not carry: accounts.ts and identities.ts are the product's PRIMARY label-read surfaces (accounts list + identity detail). Their output feeds LABEL_KIND_NAMES[snapshot.kind] in apps/web — an unchecked index yielding `undefined` in the rendered cell for an out-of-domain value. That is the IDENTICAL D9 symptom C29 exists to eliminate on the events page. Fixing the symptom on 1 of 3 surfaces leaves the operator's primary review surfaces exhibiting it.
Also: the plan's forbidden pattern is filename-glob-scoped to routes/account-labels*.ts. accounts.ts:45 and identities.ts:35 declare `label_kind: string | null` in exactly the guarded position and would sail past.
Action: re-derive by property; apply typed-query-row remedy uniformly; broaden forbidden pattern from the filename glob to the property across apps/api/src/routes/**. If accounts.ts/identities.ts are deliberately deferred that needs an explicit SC entry with a trigger, not silent omission.

F2 [Major] C29's fail-closed argument rests on a premise the schema does not support.
I29.5 accepts the rendering ambiguity because "the corrupt case is unreachable without direct DB write access (C27 + RLS)". Read migration 0005: it is `REVOKE UPDATE, DELETE ON discovery_events FROM opensmp_app;`. INSERT IS NOT REVOKED — and cannot be, the app must write audit rows. C27 constrains REWRITING history, not AUTHORING it. The plan conflates the two.
The real question is whether any app-level path can put attacker-influenced content into a discovery_events payload. apps/worker/src/sync.ts:178 inserts a connector-supplied error string; sync.ts:157 (sync_raw, gated on DISCOVERY_STORE_RAW) inserts ENTIRE PROVIDER PAYLOADS. These differ from an audit row only by `source` and `kind`.
That is exactly the boundary SC30 protects: the audit family is distinguished from the sync family SOLELY by `source`, and sync `source` is app.key. `key` is z.literal('google-workspace') (saas-apps.ts:11) today, so the boundary holds — but only by that literal.
Impact: not exploitable at 3a56620. The defect is that a recorded security rationale is stronger than the control backing it. Combined with the accepted rendering ambiguity, a forged audit row is invisible in the UI BY DESIGN. For a review-suppression control that property must be stated precisely.
Action: correct I29.5's premise to what the schema enforces — C27 blocks rewriting, not authoring; authorship is constrained at the app layer by I28.1/I33.1 + AUDIT_SOURCE, and by saas_apps.key being z.literal (SC30). Promote SC30 from an inherited one-liner to a STATED DEPENDENCY of C29.

F3 [Minor] Validation added at the audit read boundary only; out-of-domain kind is silently dropped with no signal (RS3).
After C29, out-of-domain at write time is stored without complaint and at read time silently dropped. Neither boundary REPORTS the condition. C29 converts a visible symptom (undefined in a rendered cell — which is how D9 was FOUND) into an invisible one with no compensating signal.
Action: keep the omission behavior (correct render-time choice) but have projectAuditPayload emit req.log.warn({eventId, field}, 'audit payload kind outside domain') on the reject branch. One line; creates the signal distinguishing "corrupt row" from "no label" for an investigator; does not expose storage-integrity detail to operators (the concern I29.5 correctly raises). Record as an invariant so it cannot be dropped as noise.

F4 [Minor] C32's forbidden-pattern regexes do not catch every mutable-ref form.
Declared: `uses:\s*[\w-]+/[\w-]+@v\d` and `@(main|master)`. As a FORWARD gate on I32.1 they miss: branch names other than main/master (@develop, @next); short SHAs (@fbc6f39 — mutable, resolved at run time); non-v-prefixed tags (@4.0.0, @latest); SUB-PATH actions (owner/repo/path@v4 — the [\w-]+/[\w-]+ shape stops at the second segment); docker:// refs.
Also inherits the "empty grep is evidence about the grep" risk the plan names as cycle-2 lesson 1 for C30 but does not apply to C32.
Action: invert to an ALLOWLIST — assert every uses: line matches ^\s*(-\s+)?uses:\s*[\w.-]+/[\w.-]+(/[\w.-]+)*@[0-9a-f]{40}(\s+#.*)?$ AND that the count of uses: lines is non-zero/exact. Catches every form above including sub-paths and docker://.

F5 [Minor] C32 pins with no defined unpinning cadence — trades tag-compromise risk for unowned stale-dependency risk.
No dependabot.yml, no renovate.json in tree (verified: .github holds only workflows/). Pinning stops upstream security patches for all four actions until a human edits the SHA; actions/checkout has shipped credential-persistence fixes historically.
Plan's scenario 5 states the upside and not the cost. Per the "Proposing options" standard: what the unpinned status quo silently satisfied that pinning does not is automatic receipt of upstream security fixes. The plan does not name that axis.
Action: add .github/dependabot.yml with package-ecosystem: github-actions (Dependabot understands SHA pins and bumps them preserving the # vN comment — the standard pairing). ~6 lines, no CI job, NFR4 intact. If out of scope, record as a numbered SC with a trigger and add the cost to scenario 5.

F6 [Minor] C28/C29 reverse the documented C8 type-only invariant; the R-A probe does not test the property that matters.
Three in-tree citations: packages/api-types/src/index.ts:1-4, apps/web/src/lib/api-types.ts:1-4, and decisively apps/web/src/app/import/page.tsx:10-11 which hand-duplicates a constant *specifically* to preserve this.
The probe as written checks DOES IT RESOLVE (typecheck, test:unit, e2e tsc, docker compose logs web). C8 asserts something about the CLIENT BUNDLE. BulkLabelBar.tsx and LabelControl.tsx are both 'use client' and both consume AccountLabelKind; a green `docker compose logs web` proves the app boots, not that the bundle boundary held.
Impact: low direct risk (worst case a few bytes of string array in the client bundle, not server code). The finding is that a documented invariant with three in-tree citations is reversed by a probe that does not test it.
Action: (1) name C8 in the Technical approach and state C28/C29 amend it, with reasoning — a frozen string array is not "server code" and creates no data path, which is what C8 protects. (2) update the comments at api-types/src/index.ts:1-4 and web/src/lib/api-types.ts:1-4 in the same commit. (3) extend the R-A probe from "the app boots" to the property.

F7 [Minor] [Adjacent] seed.ts has no NODE_ENV guard around creating a known-plaintext admin.
apps/api/src/seed.ts:24-25 creates a tenant with a known-plaintext admin password, no NODE_ENV / SEED_ENABLED guard (grepped: none). Wired into docker compose as a service. Not this plan's doing, but C30 makes the seeded values a first-class asserted contract across three tiers, raising the cost of adding such a guard later. May overlap with Functionality's scope.

## Recurring Issue Check
- R1: pass
- R2: pass
- R3: pass
- R14: pass
- R16: pass
- R29: n/a (no external spec cited)
- R33: pass
- R42: fired (see F1)
- R44: pass
- RS1: pass
- RS2: pass
- RS3: fired (see F3)
- RS4: pass (seeded demo values are created by the seeder, not credentials to a real system; .gitignore covers .env/.env.*; no tracked .env; seed.ts:29-37 fake SA JSON marked DEMO-NOT-A-REAL-KEY)
- RS5: pass
- RS6: fired (see F4, F5)

VERIFIED-CORRECT (no finding): audit-family member set exactly {audit.ts:41, account-labels-bulk.ts:91}; all four C32 SHAs correct, pnpm/action-setup@v4 IS an annotated tag dereferencing to b906affc… — I32.2 is a real trap correctly resolved; .github has exactly one file, no composite/workflow_call/docker://; app.ts:116 sub-400 unreachability CONFIRMED by tracing every reply.code() in apps/api/src (sub-400 codes only 200/201/202/204, all on return reply.send() paths that terminate; no path sets sub-400 then throws) — plan's "test MUST use a 4xx" is correct; events/page.tsx:56 returns '—' only when both sides undefined (I29.5 accurate); I28.5 transaction boundary preserved, forbidden pattern's \w* correctly covers the Batch variant; NFR3 cardinality preserved; RLS predicate untouched (buildEventsWhere keeps tenant_id=$1 unconditionally first, no top-level OR); NFR2 MUTATION_PATTERN will not trip, SC34 correctly classified fail-loud; C31 error-shape — read EVERY branch of app.ts:94-134, no branch reflects error.message/code/stack, including the SC32-deferred ones; VE6 login budget unaffected; AES-256-GCM boundary untouched; injection — every statement stays parameterized, promoting kind to bound $3 is a strict improvement.
```

### Testing expert
```
TESTING EXPERT — Round 1

F1 [CRITICAL] C31's test-only route breaks three existing sweeps and an exact route-membership assertion.
buildApp (apps/api/src/app.ts:26-36) collects EVERY /api/-prefixed route into apiRoutes via an onRoute hook. Four existing tests iterate or pin that array:
  api.integration.test.ts:1501 — asserts app.apiRoutes.map(...).sort() DEEP-EQUALS a hardcoded 21-element list. An exact count, deliberately, per its own comment at :1495-1500.
  :1526 — asserts every registered route has hasRateLimit === true
  :168 — 401 sweep, injects unauthenticated to every non-login route expecting 401
  :187/:198 — Origin 403 sweeps, expect 403 on every non-GET route
A test-only route registered under /api/ fails ALL FOUR. Registering it outside /api/ (like /healthz at app.ts:49) dodges apiRoutes — but the plan never says which side of that boundary it lands on. I31.3 gestures at this ("registered outside the authenticated scope") but conflates the AUTH scope with the /api PREFIX scope; those are different registrations and only the prefix drives apiRoutes.
Directly contradicts NFR5 and C28 acceptance criterion 5's "existing tests pass unmodified" — and is exactly cycle-2 failure mode #4 (a fix introducing defects). The plan asserts app.ts is unmodified but never checks the TEST blast radius.
Action: specify the registration site concretely. Viable shape: a route outside the /api prefix on a SEPARATELY-BUILT app instance local to the C31 describe block — the latter cannot perturb any sweep at all. Add acceptance criterion: "the apiRoutes deep-equal assertion at :1501 passes unmodified", recorded as executed.

F2 [Major] RT9 member-set wrong — SIX copies of the label-kind domain, not three; C29 leaves three ungated.
  1 apps/api/src/label-kinds.ts:6                      runtime array   plan has it
  2 packages/api-types/src/index.ts:21                 type            plan has it
  3 packages/schema/migrations/0003_account_labels.sql:4  DB enum      plan has it (I29.4)
  4 packages/schema/src/tables.ts:44-48 accountLabelKindEnum  drizzle runtime array   MISSING
  5 apps/web/src/lib/label-kinds.ts:7-13               runtime array   MISSING
  6 apps/web/src/app/accounts/page.tsx:17-23           runtime array   MISSING
Copy 4 is gated by packages/schema/test/tables.test.ts:23-29 against a HARDCODED LITERAL LIST — pinning it to a copy of the copy, not to the domain.
Copy 6 is typed LabelFilterValue[] — an array of a UNION. Adding a 4th kind leaves this array with three and NOTHING FAILS, because a shorter array is still assignable. Precisely the drift shape FR2 exists to close, reproduced verbatim in apps/web.
Plan user-scenario 3 is therefore FALSE: a 4th kind would still need edits in tables.ts, tables.test.ts, web/lib/label-kinds.ts, web/accounts/page.tsx — only tables.test.ts failing loudly.
Action: (a) extend I29.4 — make tables.test.ts:23-29 assert accountLabelKindEnum.enumValues equals ACCOUNT_LABEL_KINDS imported from api-types (one-line change converting a literal-copy gate into a derivation gate, unit tier, free), and derive web copies from ACCOUNT_LABEL_KINDS; or (b) scope-out copies 4-6 as SC36 with a trigger and correct scenario 3. (a) is cheap and is what FR2 demands.

F3 [Major] C30's regex parse is bound to the shell gate's SPELLING; I30.4 does not catch the realistic drift.
Executed the plan's regex against variants a maintainer could plausibly write:
  current form                                        -> 1 match
  double-quoted args (assert_status "alice…" "matched") -> 0
  leading indentation (inside an if/for)               -> 0
  loop form (for e in …; do assert_status "$e" matched; done) -> 0
The ^ anchor and hard-coded single-quote delimiter are both SPELLING. Bash treats 'x' and "x" identically, so a reformat is behavior-preserving for the gate and catastrophic for the test.
I30.4 catches only TOTAL-ZERO. The dangerous case is PARTIAL: convert three of four assert_status lines to a loop and leave one -> extracts 1, non-zero, I30.4 passes -> bidirectional set-equality fails LOUDLY BUT FOR THE WRONG REASON ("fixture has 4, gate has 1") when the gate is actually correct. A false red that trains the next maintainer to relax the assertion; if someone "fixes" it by making I30.1 one-directional it goes silently green gating nothing.
Also: acceptance criterion 1's "extracts >=4 pairs" is a MAGIC LITERAL that must itself be hand-synced with SEEDED_ACCOUNTS — re-creating the RT3 violation C30 exists to close, one level up.
Action: derive the count — assert extracted.length === Object.keys(SEEDED_ACCOUNTS).length * 2. Loosen the regex to tolerate both quote styles and leading whitespace. Add a NEGATIVE SELF-TEST mirroring the idiom already proven at audit-append-only.test.ts:61-86: feed the extractor double-quoted and loop variants as inline fixtures and assert it still finds them. That converts a spelling-bound parse into a property-bound one, free at the unit tier.

F4 [Major] C28's fake-PoolClient test (acceptance criterion 3) cannot falsify the property it claims.
C28's design makes recordLabelAudit a DELEGATION to recordLabelAuditBatch (plan:162). A test asserting that a function and its own single-line delegate emit the same SQL asserts x === x. It passes by construction and can never go red while the delegation exists — and if someone later un-delegates them (the exact regression FR1 guards), it STILL passes as long as the two hand-written statements match at that moment, which they do today.
RT5: verifies the fake's belief about call shape, not the production primitive. Misses whether the SQL is VALID, whether unnest($4::text[]) actually binds string[] to text[], whether the kind promotion still writes 'label_set', whether N payloads produce N rows.
The plan is right that criterion 2 (existing integration test, unmodified, real Postgres) is the real proof. Criterion 3 adds test-count without falsifiability, and NFR5 creates pressure to keep it.
Action: drop criterion 3's SQL-text-identity assertion or replace with the assertion that has content — recordLabelAudit CALLS THROUGH to recordLabelAuditBatch with a one-element array (structural delegation, falsifiable by re-introducing a second statement). Keep criterion 4 (empty array => zero query calls), which IS non-vacuous. State explicitly that criterion 2, not the fake, discharges FR1. ADD an integration assertion that the SINGLE-ACCOUNT path still writes a correct row — the plan names only the BULK integration test as the unmodified regression proof, leaving the path that actually changed shape (literal -> delegation) covered only by the fake.

F5 [Minor] C32 has no local gate, and one is cheap and already idiomatic here.
Plan says C32 "has no local test — a workflow file's correctness is only observable by executing it". That conflates two properties. Whether a pinned SHA WORKS needs CI, correctly. Whether every uses: is SHA-pinned rather than tag-pinned is a pure static property of a text file — exactly the shape of the source-level gates this repo already runs at the unit tier (audit-append-only.test.ts, no-rotation-route.test.ts, C33 itself).
Left ungated the control decays on the first uses: line added in a later cycle: nothing fails, CI stays green because a tag-pinned action works fine. A supply-chain control that silently reverts.
Action: unit test reading .github/workflows/*.yml, extracting every uses: line, asserting each matches /@[0-9a-f]{40}\b/. Include the anti-vacuity assertion the repo already uses — an exact/derived count, not toBeGreaterThan(0). ~15 lines in the cheapest job. Keep acceptance criterion 3's observed CI run as the separate proof the SHAs resolve.

F6 [Minor] C29's I29.4 has no stated home, and the natural one is in the wrong package.
Five integration files exist; none queries pg_enum (verified zero hits tree-wide). Schema-semantics home is packages/schema, but packages/schema does NOT depend on @open-smp/api-types — placing it there requires a new cross-package dependency schema -> api-types, which the plan's dependency-direction analysis never considers and which the "no dependency added" scope statement forbids.
Action: name the file. apps/api/test/api.integration.test.ts is correct (already boots Postgres, already imports api-types transitively, adds no dependency). Record that the schema-package home was rejected because it would add a forbidden dependency.

F7 [Minor] R44 — one evidence command in the C28 probe judges exit status through a pipe.
Plan line 234: `pnpm --filter e2e exec tsc --noEmit --project tsconfig.json 2>&1 | head`. Exit status is head's, ~always 0. A typecheck failure with >10 lines looks identical to success, and the probe is recorded green. The other two grep-pipes are member-set DERIVATIONS where output is the evidence — those are fine. This one is a GATE: R-A names it as the mitigation deciding whether C28/C29 are implementable at all.
Same line: `docker compose up -d --build ... && docker compose logs web --tail=30` judges success by up -d returning, but -d returns once containers START, not once Next.js compiles. A build-time module-resolution failure — the exact failure R-A exists to detect — surfaces in logs the operator is asked to eyeball, not in an exit code.
Action: drop the | head. Replace log-eyeballing with a status-asserted probe: curl -sf -w '%{http_code}' http://localhost:3000/events after a readiness wait, asserting 200 — a page that failed to resolve the value import returns 500.

STRATEGY ASSESSMENT: tier assignment mostly right and deliberately so. Unit tier for C29 projection / C30 file comparison / C33 source gate is correct. C32 -> CI-only is right for SHA RESOLUTION, wrong for PIN SHAPE (F5). I29.4 correctly needs the real DB.
One misassignment: C31 -> integration. The handler under test (app.ts:94-134) touches neither Postgres nor Redis — it is a pure function of the thrown error and reply.statusCode. Paying a Testcontainers boot for it is what FORCES the shared-app collision in F1. A separately-built Fastify instance with stub deps would run this at the unit tier and sidestep F1 entirely.
Red-proof discipline is genuinely strong. Verified C33's red proof actually fires (bulk INSERT survives normalizeSource, 1 match in each of audit.ts and the bulk route). C30's bidirectional proof is correctly specified — both directions ARE necessary. C31's red proof does make the test red (client_error appears in exactly one place tree-wide). C33's assertion is file-ANCHORED not file-scoped (sites.length===1 && sites[0].endsWith('audit.ts')), so a new insert in a third file is also caught. Good design.
Test-count claims exact, not approximate — reproduced 164/16/5/43 locally.

## Recurring Issue Check
- R1: pass
- R2: pass
- R3: n/a
- R16: pass
- R21: pass
- R33: pass
- R42: fired (see F2)
- R44: fired (see F7)
- RT1: pass
- RT2: pass (every finding testable; none requires a login, VE6 respected)
- RT3: fired (see F3)
- RT4: pass
- RT5: fired (see F4)
- RT6: pass
- RT7: pass
- RT8: pass
- RT9: fired (see F2)
```

## Recurring Issue Check
### Functionality expert
- R1: pass
- R2: fired (see F1)
- R3: fired (see F1, F3)
- R12: pass
- R16: pass
- R21: n/a
- R29: n/a (no external spec cited)
- R33: pass
- R34: n/a
- R42: fired (see F1, F3)
- R44: pass

VERIFIED-CORRECT (no finding): I28.1 member-set reproduces exactly (6 insert sites, audit family exactly 2, AUDIT_SOURCE not imported under apps/worker, recordLabelAudit exactly 2 call sites, no dynamic table names); I30.1/2/3 extraction regexes reproduce plan output byte-for-byte, all cited line numbers exact, 7 Playwright importers confirmed; I32.1 (exactly one workflow file, 10 uses: lines, no composite actions/workflow_call/docker://); I29.4/R16 — migration 0003:4 defines the enum, pg_enum query executed as opensmp_app returns all three labels, catalogs world-readable; ORM/type-shape — readonly[].map(JSON.stringify) -> mutable string[] binds to text[], typechecks clean, behavior-preserving vs account-labels-bulk.ts:80-95; C33/MUTATION_PATTERN probe replicated (does not trip); C31 premise (client_error in exactly one place, every branch line exact, sub-400 reading correct); R1 (collectSourceFiles/normalizeSource do exist and should be reused); C30 placement analysis sound (vitest globs exactly as quoted); ID hygiene (C28-C33, SC32-SC35 no collision).

### Security expert
- R1: pass
- R2: pass
- R3: pass
- R14: pass
- R16: pass
- R29: n/a (no external spec cited)
- R33: pass
- R42: fired (see F1)
- R44: pass
- RS1: pass
- RS2: pass
- RS3: fired (see F3)
- RS4: pass (seeded demo values are created by the seeder, not credentials to a real system; .gitignore covers .env/.env.*; no tracked .env; seed.ts:29-37 fake SA JSON marked DEMO-NOT-A-REAL-KEY)
- RS5: pass
- RS6: fired (see F4, F5)

VERIFIED-CORRECT (no finding): audit-family member set exactly {audit.ts:41, account-labels-bulk.ts:91}; all four C32 SHAs correct, pnpm/action-setup@v4 IS an annotated tag dereferencing to b906affc… — I32.2 is a real trap correctly resolved; .github has exactly one file, no composite/workflow_call/docker://; app.ts:116 sub-400 unreachability CONFIRMED by tracing every reply.code() in apps/api/src (sub-400 codes only 200/201/202/204, all on return reply.send() paths that terminate; no path sets sub-400 then throws) — plan's "test MUST use a 4xx" is correct; events/page.tsx:56 returns '—' only when both sides undefined (I29.5 accurate); I28.5 transaction boundary preserved, forbidden pattern's \w* correctly covers the Batch variant; NFR3 cardinality preserved; RLS predicate untouched (buildEventsWhere keeps tenant_id=$1 unconditionally first, no top-level OR); NFR2 MUTATION_PATTERN will not trip, SC34 correctly classified fail-loud; C31 error-shape — read EVERY branch of app.ts:94-134, no branch reflects error.message/code/stack, including the SC32-deferred ones; VE6 login budget unaffected; AES-256-GCM boundary untouched; injection — every statement stays parameterized, promoting kind to bound $3 is a strict improvement.

### Testing expert
- R1: pass
- R2: pass
- R3: n/a
- R16: pass
- R21: pass
- R33: pass
- R42: fired (see F2)
- R44: fired (see F7)
- RT1: pass
- RT2: pass (every finding testable; none requires a login, VE6 respected)
- RT3: fired (see F3)
- RT4: pass
- RT5: fired (see F4)
- RT6: pass
- RT7: pass
- RT8: pass
- RT9: fired (see F2)

VERIFIED-CORRECT (no finding): C33's red proof actually fires (bulk INSERT survives normalizeSource, 1 match in each of audit.ts and the bulk route). C30's bidirectional proof is correctly specified — both directions ARE necessary. C31's red proof does make the test red (client_error appears in exactly one place tree-wide). C33's assertion is file-ANCHORED not file-scoped (sites.length===1 && sites[0].endsWith('audit.ts')), so a new insert in a third file is also caught. Test-count claims exact, not approximate — reproduced 164/16/5/43 locally.

## Quality Warnings
None. All findings contain specific file/line references, concrete evidence or execution steps, and actionable recommendations. No [VAGUE], [NO-EVIDENCE], or [UNTESTED-CLAIM] flags triggered.

---

# Plan Review: harden-label-audit-reclaim-deferred (Round 2)
Date: 2026-07-26
Review round: 2

## Changes from Previous Round
Round-1's 13 findings were all resolved. C29's member-set was re-derived by property (4 casts -> 7);
the label-kind domain copy count was corrected from 3 to 6, adding contracts C34/C35/C36; C31 gained
test-isolation invariants after the Critical; C32's denylist was inverted to an allowlist and gained a
unit-tier gate plus dependabot; C30's regex was corrected after execution proved the round-2
replacement itself defective; SEC-F3/F7 were deferred with Anti-Deferral entries (SC38/SC39).

## Round-2 Findings (19: 1 Critical, 6 Major, 12 Minor)

### Critical
- TEST-T1: C35 criterion 4's red proof is two mutually exclusive tree states. ESTABLISHED BY EXECUTION:
  adding a 4th kind yields `pnpm typecheck EXIT=1` (TS2741 on label-kinds.ts) and `next build EXIT=1`,
  so the filter bar cannot render four kinds — the compile error PREVENTS the render.
  RESOLVED: split into 5a (green derivation demo) and 5b (the actual red proof).

### Major
- FN-F1: I35.2 verified render order against two sites where order is unobservable
  (accounts/page.tsx LABEL_FILTERS is membership-only at :66; label-kinds.ts:10 is zod validation),
  and missed LabelFilter.tsx's leading `{value:null,label:'All'}` entry. RESOLVED.
- FN-F2: FR6 not achieved — apps/web/src/lib/api-types.ts (the re-export barrel) is a 7th site
  C35 did not name. RESOLVED: barrel gains a value re-export; decision recorded explicitly.
- FN-F3 / SEC-F-S1: C36's no-import gate tests neither the property I36.1 states nor a scope wider
  than one hardcoded path, and restates a manifest-enforced fact. RESOLVED: rewritten as a glob over
  src/** forbidding require/dynamic import/process/globalThis/non-relative imports + manifest assertion.
- TEST-T2: C34 and C35 red proofs share one tree mutation that breaks typecheck repo-wide; neither
  named the other's trigger. RESOLVED: sequencing note in both.
- TEST-T3: C29 criterion 3's null/42/{}/missing cases are already green pre-C29 (the guard is
  `typeof === 'string'`) and cannot go red. RESOLVED: split into 3 (regression pins, labelled
  not-red-provable) and 3a (the falsifiable null-vs-valid distinction).
- TEST-T4: C29 forbidden pattern 3 false-positives on events.ts:67 and :134 — the EVENT kind, which
  the plan itself warned is one word from the label kind. RESOLVED: named exclusions, asserted by count.
- TEST-T5: I31.4's blast-radius table listed 4 of 6 apiRoutes consumers (missed :688) while claiming
  exhaustiveness. RESOLVED: five listed with verdicts.

### Minor
- FN-F4: I29.4 compared pg_enum as an unordered set while I34.1 required order and cited I29.4 as its
  justification. RESOLVED: criterion 4 made order-sensitive (ORDER BY enumsortorder).
- FN-F5: duplicated consumer block with divergent stale text. RESOLVED: removed.
- FN-F6: SC36 skipped with no record. RESOLVED: recorded as deliberately unallocated, not reused.
- FN-F7: "working tree clean" false; git status is red-proof evidence in C33/C28 probe.
  RESOLVED: corrected, with the --untracked-files=no obligation stated.
- FN-F8 [Adjacent]: C35 criterion 1 omitted the anti-vacuity file-count assertion. RESOLVED.
- SEC-F-S2: C32's `# vN` comment was optional in the regex while criterion 1 required it; the
  anti-vacuity prose was circular. RESOLVED: comment mandatory (15-case probe executed), prose fixed.
- SEC-F-S3: SC38's "if SC30 is lifted" trigger had no detection. RESOLVED: forbidden pattern
  `key:\s*z\.(?!literal)` on saas-apps.ts makes the trigger an executed gate.
- SEC-F-S4: C35's carve-out would false-positive on LABEL_KIND_NAMES property accesses.
  RESOLVED: narrowed to quoted literals only.
- TEST-T6: C30's "two limitations" were seven; four more are behavior-preserving (unquoted args,
  trailing semicolon, line continuation). RESOLVED: full table + guarantee restated as a property.
- TEST-T7: RT7 count of eight was seven. RESOLVED: per-contract fires/does-not table.

## Verified-correct in round 2 (no finding)
Six-copy member-set independently reproduced; 7-cast set exact; corrected C29 signature COMPILES
(built under repo tsc with verbatimModuleSyntax); C31's four sweeps confirmed real; C34's dependency
routing correct (packages/schema lists only drizzle-orm/pg); I29.5's corrected premise matches
migration 0005 verbatim; saas-apps PATCH schema confirmed not to accept `key`; the C8 bundle claim
VERIFIED TRUE (LABEL_KINDS already reaches two 'use client' components, so C29 changes where the
array is declared, not whether one crosses); C32's 4 SHAs and the annotated-tag dereference correct;
RT9 production twin class closed post-C34/C35.

---

# Plan Review: harden-label-audit-reclaim-deferred (Round 3) — scope split
Date: 2026-07-26
Review round: 3 (final)

## Changes from Previous Round
Round-2's 19 findings were all resolved. Round 3 then raised 12 more (1 Critical, 5 Major, 6 Minor).

## Round-3 Findings

### Critical
- TEST-T8: C35 criterion 2 is unimplementable. LabelFilter.tsx's FILTERS is unexported AND
  apps/web/tsconfig.json:14 sets jsx:preserve, so the vitest unit project cannot transform the
  module at all (reviewer executed a probe: "Failed to parse source for import analysis").
  I35.2 therefore had NO gate. The round-3 correction fixed the PROPERTY and broke the MECHANISM.

### Major
- FN-F1: C29 criteria 3 and 3a assert contradictory outcomes for `kind: null` — 3a's subject is
  `before: null` (whole-snapshot null, the `value === null` branch), not `kind: null`.
- FN-F2: FR6 not achieved. packages/schema/src/tables.ts is neither derived nor compile-failing;
  scenario 3 counted three edits where there are five.
- TEST-T9: C30's "derived-count detects any miss" property is FALSE. Reviewer constructed an
  executed false green: duplicating one assert_label_null and deleting another conserves the count
  (8), passes bidirectional set equality, and passes the status-only pairwise check — while
  bob.suzuki has no label assertion at all.
- TEST-T10: C30's seven-row limitation table is still incomplete; the `[a-z_]+` status class drops
  hyphenated and digit-bearing statuses, and `[^"']+` structurally cannot match a quote-escaped email.
- TEST-T11: C29's Decision list named 5 tx.query sites while claiming six casts deleted;
  account-labels.ts:118 was omitted.

### Minor
- FN-F3: C35's quoted-literal carve-out protects LABEL_KIND_NAMES keys, which are UNQUOTED
  identifiers — the carve-out matches nothing.
- SEC-F-S5: the SC30 trigger gate misses value-change (`z.literal('label')`), file-move, and
  seed.ts:185 as a second author of saas_apps.key.
- SEC-F-S6: the mandatory `# vN` comment REJECTS Dependabot's own bump output (`# v5.0.1`),
  breaking the update path C32 adopts to pay its own cost.
- SEC-F-S7: the web barrel becomes a sanctioned value-crossing point with no gate on what crosses next.
- TEST-T12: C36's bare tokens `process`/`globalThis` are substring matches that false-positive on
  plausible future field names and prose in a wire-shape file.
- TEST-T13: the RT7 table conflates a pre-C29-tree proof with a post-C29-mutation proof.

## Resolution: scope split, not a fourth round

Findings by round: 13 -> 19 -> 12. Of these, roughly 25 of 44 were defects introduced by the
PREVIOUS round's fixes, including all three Criticals. The review was not converging.

Diagnosis: the plan had grown to 1055 lines and nine contracts, most of the churn in gate
specifications whose correctness is only observable by executing them. Round 3's Critical
(a unit test that cannot exist), its Majors (a five-of-six grep list, a regex character class
that drops hyphenated statuses, a false green that conserves the count) are all five-minute
discoveries at a keyboard and expensive multi-round discoveries on paper.

RETAINED (cycle 3, locked, proceeding to Phase 2):
  C28 recordLabelAuditBatch     — zero findings across all three rounds
  C29 read-path domain validation — TEST-T11 applied (six sites, derived by executing the grep)
  C31 client_error fallback     — stable since its round-2 Critical was closed
  C32 CI SHA pinning            — SEC-F-S5 and SEC-F-S6 applied; fresh 19-case probe executed
  C33 audit-writer member-set   — zero findings across all three rounds

DEFERRED (cycle 4, recorded as SC40, to be built by writing and running the gates):
  C30 seed-gate literal agreement / C34 drizzle-enum derivation /
  C35 apps/web domain derivation + barrel / C36 C8 amendment gate. FR6 withdrawn.

Every round-3 Critical and Major except TEST-T11 landed on the deferred four.

## Findings NOT adopted, with Anti-Deferral entries
- SEC-F3 (log signal on the projection reject branch) -> SC38. projectAuditPayload is reached via
  four module-level pure functions with no req/logger in scope; threading one through would trade
  the purity that makes the projection unit-testable, for a branch unreachable without direct DB
  write access. Trigger now DETECTABLE via the SC30 gate rather than relying on recall.
- SEC-F7 (seed.ts NODE_ENV guard) -> SC39, with R34's security carve-out honoured.
- SEC-F-S7 (barrel value-crossing gate) -> folded into SC40, which owns the barrel decision.
- TEST-T10's regex loosening -> rejected with a stated reason (optionality caused the round-2
  line-crossing bug); the limitation is recorded instead.

## Process lesson recorded in the plan (risk R-D)
Every regex and member-set in the retained contracts now has an EXECUTED probe recorded beside it,
including two cases where execution refuted the specification as just written:
 - C30's extractor: the round-2 "fix" returned 6 pairs, not 8, reporting a plausible wrong answer
   (under /gm the optional third group's \s+ crossed a newline and swallowed the next line).
 - C32's comment rule: `# v\d+$` looked correct and would have failed every Dependabot PR.
Phase 2 must treat "specified but never executed" as an unmet contract.
