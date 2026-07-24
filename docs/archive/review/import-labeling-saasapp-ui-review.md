# Plan Review: import-labeling-saasapp-ui

Date: 2026-07-24
Review round: 3 (converged — see round history below)

---

# Round 2 (incremental)

## Changes from Previous Round

All 14 round-1 findings resolved in the plan: C12 gained the 1.5 s interval + 120 s wall-clock timeout via shared `polling.ts` constants; C11's upsert no longer overwrites `created_by` (original-setter semantics) and the empty-string-note 400 boundary is explicit; C13 gained the constraint-name-scoped 23505 catch, the fixed-string error table invariant, and two credential-echo forbidden patterns; testing strategy gained T-L9 (rate-limit sweep) and direct-SQL / mutation-absence tightening across T-L2/L3/L4/L5/L8 + T-W1 tenant-scoping; SC8 cost corrected, SC12 security-annotated, Phase-3 gate gained conformance greps.

## Round-2 Findings

**Functionality — 3 Minor (all fixed in plan):**
- R2-FN-F1: shared polling module extraction didn't require retrofitting `SyncControl.tsx` itself → fixed: retrofit mandated + new forbidden pattern banning `POLL_*_MS =` declarations outside `polling.ts`.
- R2-FN-F2: `SaasAppForm.tsx`'s deliberate divergence from the codebase's `err instanceof Error ? err.message` idiom (`SyncControl.tsx:59`) not flagged for future maintainers → fixed: C13 invariant now names the divergence and requires an in-file comment.
- R2-FN-F3: T-L2 didn't cover `created_by` staying NULL (not resurrected) when a second user PUTs after the original setter's `users` row was deleted (`ON DELETE SET NULL`) → fixed: case added to T-L2.
- Verified: `POLL_INTERVAL_MS = 1500` / `POLL_TIMEOUT_MS = 120_000` confirmed against `SyncControl.tsx:7-8`; `users` table + `ON DELETE SET NULL` semantics confirmed against `0001_init.sql:79`; `polling.ts` is net-new (no merge conflict).

**Security — No findings.**
- Constraint name `saas_apps_tenant_id_key_key` verified EMPIRICALLY against the running Postgres 16 container (`pg_constraint`), not just naming convention.
- Fixed-string-table approach traced through every form branch: implementable without reading `.message`; no remaining leak path (API `safeParse` failures already return fixed `{error}` shapes codebase-wide — no zod-detail echo exists to forward).
- discovery_events skip (SEC-F6 partial) re-examined and accepted: labels gate no authz decision — deferral leaves nothing fail-open.
- Noted (informational, not a finding): regex forbidden patterns are letter-satisfiable by renaming catch bindings; the prose invariant + review remain the backstop, consistent with the plan's existing forbidden-pattern methodology.

**Testing — 2 Minor (all fixed in plan):**
- R2-T1: T-L9's RT7 fallback ("assert member count = 12") was not a valid falsifiability proof → fixed: strip-and-confirm-red is now the only accepted RT7 evidence.
- R2-T2: sweep wording ambiguous between truthy and non-null — a future `rateLimit: false` opt-out would pass a non-null check while being unprotected (`@fastify/rate-limit` treats `false` as configured-but-disabled; app sets `global: false`) → fixed: sweep must assert truthy object (`typeof === 'object'`).
- Verified: T-L9's mechanism confirmed feasible against installed `@fastify/rate-limit@11.1.0` source (its `onRoute` hook only reads `routeOptions.config.rateLimit`, never mutates) and Fastify 5.10.0 hook-inheritance semantics (same mechanism as the existing `apiRoutes` capture at `app.ts:24-30`). No corrected mechanism needed.

## Round-2 Recurring Issue Check deltas

- Functionality R2: changed — round-1 interval-value issue fixed; residual relocated-copy exposure raised as R2-FN-F1, now closed by the new forbidden pattern. All other R1–R46 unchanged.
- Security: all R/RS statuses unchanged from round 1 (fix-verification round; no new surface).
- Testing RT7: changed — T-L9 mechanism verified feasible; fallback-proof weakness raised as R2-T1, now closed. All other R/RT unchanged.

## Round-2 JSON indexes (raw)

### Functionality
```json
[
  {"id": "F1", "severity": "Minor", "title": "C12's shared polling module extraction doesn't require retrofitting SyncControl.tsx to import from it, leaving room for a duplicate constants copy (relocated R2 smell)", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 144, "adjacent": false, "escalate": null},
  {"id": "F2", "severity": "Minor", "title": "SaasAppForm.tsx must deliberately avoid the codebase's normal err instanceof Error ? err.message convention (used in SyncControl.tsx:59); plan doesn't flag this as an intentional divergence for future maintainers", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 191, "adjacent": false, "escalate": null},
  {"id": "F3", "severity": "Minor", "title": "T-L2 doesn't test created_by staying NULL (not resurrected) when a second user PUTs a label after the original setter's user row was deleted via ON DELETE SET NULL", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 243, "adjacent": false, "escalate": null}
]
```

### Security
```json
[]
```

### Testing
```json
[
  {"id": "T1", "severity": "Minor", "title": "T-L9's RT7 'prove it can fail' fallback (member-count assertion) is not equivalent to the strip-and-confirm-red proof and should be dropped", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 250, "adjacent": false, "escalate": null},
  {"id": "T2", "severity": "Minor", "title": "T-L9 sweep wording should specify a truthy-object check, not mere non-null, to avoid a false-negative on a future rateLimit: false route", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 250, "adjacent": false, "escalate": null}
]
```

---

# Round 3 (verification-only — CONVERGED)

## Changes from Previous Round

Five round-2 Minor fixes applied to the plan: SyncControl.tsx retrofit mandated + `POLL_*_MS` declaration forbidden pattern (R2-FN-F1); SaasAppForm idiom-divergence note + required in-file comment (R2-FN-F2); T-L2 created_by NULL non-resurrection case (R2-FN-F3); T-L9 RT7 evidence narrowed to strip-and-confirm-red only (R2-T1); T-L9 truthy-object assertion (R2-T2).

## Round-3 Results

- **Functionality: No findings.** All three fixes verified against plan text and live code (`SyncControl.tsx:7-8` consts, `:59` idiom citation exact); the new `POLL_*_MS` forbidden-pattern regex tested against representative post-change code — zero false positives (imports/usages carry no `=`).
- **Security: No findings.** All five edits assessed as neutral-or-strengthening; edits 4/5 close latent gaps in the rate-limit sweep (a security-relevant test), a net improvement. Noted informationally: `typeof null === 'object'` would pass the sweep, but `rateLimit: null` is not a Fastify idiom and appears nowhere in the codebase — not a realistic regression path.
- **Testing: 1 Minor (R3-T1), explicitly non-blocking/optional.** T-L2's new sub-case needs the setter's live `sessions` row(s) deleted before `DELETE FROM users` (`sessions.user_id` has no `ON DELETE` action → 23503 otherwise); fails loudly, not silently; fix pattern exists in the same test file (`DELETE FROM sessions WHERE token_hash = $1`). Both round-2 fixes verified fixed (`typeof false === 'boolean'` correctly fails the truthy-object sweep).

## R3-T1 Resolution

**Fixed in plan** — the expert's own recommended clause was applied verbatim to T-L2 (implementation note naming the sessions-first deletion and the existing pattern).

## Convergence Declaration

Functionality and Security returned "No findings". Testing returned one finding it explicitly marked "Minor... optionally... does not block Phase 3... purely a documentation nicety for the implementer, not a design defect", whose Recommended action text was applied to the plan verbatim with zero interpretation gap. The orchestrator declares plan review converged at round 3 without a fourth verification round: re-reviewing an expert's own literal wording would verify nothing the expert has not already specified. All contracts C10–C14 are in final form; the Go/No-Go gate stands at locked × 5.

## Round-3 JSON indexes (raw)

Functionality: `[]` · Security: `[]` · Testing: 1 Minor (R3-T1, resolved as above).

---

# Round 1 (initial)

Merge method: manual dedup by orchestrator (Ollama unavailable — `merge-findings` returned empty with stderr warning; the per-expert fenced JSON indexes were used as the join skeleton per the documented fallback).

## Changes from Previous Round

Initial review.

## Functionality Findings

**FN-F1 — Minor — Import page poll interval claim (2 s) mismatches `SyncControl.tsx`'s actual 1.5 s `POLL_INTERVAL_MS`**
C12 claims "every 2 s (same pattern/interval as SyncControl.tsx)" but the real constant is `POLL_INTERVAL_MS = 1500`. Taken literally, the implementer would introduce a second, different polling cadence for the same `GET /api/jobs/:jobId` pattern (R2/R8).
→ Resolution: **Fixed in plan** — C12 now specifies 1.5 s reusing `SyncControl.tsx`'s constants, factored into a shared module.

**FN-F2 — Major — Import page match-polling loop lacks a wall-clock timeout, unlike the `SyncControl.tsx` pattern it claims to follow (R38)**
`SyncControl.tsx` bounds polling with `POLL_TIMEOUT_MS = 120_000` and a terminal error state; C12 only required termination via terminal job state or unmount. A wedged BullMQ job (worker crash, Redis loss) → infinite silent polling with no recovery affordance.
→ Resolution: **Fixed in plan** — C12 now requires a 120 s wall-clock timeout via the shared constants, transitioning to a terminal timed-out state with a user-visible message and retry affordance.

**FN-F3 — Minor — `account_labels` upsert overwrites `created_by` on every relabel, contradicting the column's creation-attribution naming**
(Converges with SEC-F6 — both concern label attribution semantics.) `DO UPDATE SET created_by = EXCLUDED.created_by` makes the column mean "last set by" while its name and the non-bumped `created_at` imply original-creator semantics; SC12 (future audit history) presumes original-setter attribution.
→ Resolution: **Fixed in plan** — `created_by` dropped from the `DO UPDATE SET` list; original setter preserved; semantics documented in C11.

## Security Findings

**SEC-F2 (+SEC-F7 merged) — Major — `SaasAppForm` error paths not forbidden from echoing raw credential text into thrown/displayed errors**
Two sites of the same root cause: (a) `JSON.parse`/shape-validation errors interpolating the raw textarea value or the parse exception's own message (which can echo input snippets) into an Error → React overlay / error hooks / screenshots; (b) fetch catch blocks interpolating the request body into displayed error state (`setError(\`... ${JSON.stringify(body)}\`)`). The console/localStorage bans don't cover these surfaces; a pasted GCP service-account private key (domain-wide delegation) is the payload at risk.
→ Resolution: **Fixed in plan** — C13 invariant added: every error message in `SaasAppForm.tsx` comes from a fixed string table keyed by failure class/HTTP status; never interpolate the textarea value, its substrings, the parse exception's message, or the request body. New forbidden patterns: `JSON.stringify\((body|credentials)` and template-interpolation of caught errors in that file.

**SEC-F1 — Minor — T-L5 must genuinely exercise RLS indistinguishability**
Cross-tenant 404 test must seed a real tenant-B-owned account (valid UUID attached to tenant B), not a random UUID.
→ Resolution: **Fixed in plan** — T-L5 wording now requires seeding a real tenant-B account.

**SEC-F3 — Minor — 23505→409 catch should assert constraint name, not just error code**
Future unique constraints on the same insert path would be mis-mapped to `duplicate_key`.
→ Resolution: **Fixed in plan** — C13 now requires matching `err.code === '23505' && err.constraint === 'saas_apps_tenant_id_key_key'`, rethrow otherwise.

**SEC-F4 — Minor — Empty-string note boundary (zod `.min(1)`) implicit and untested**
→ Resolution: **Fixed in plan** — T-L3 gains an explicit empty-string-note → 400 case; invariant stated (absent = NULL, empty string = 400).

**SEC-F5 — Minor — LabelControl accountId sourcing verified safe by construction**
No action needed (server-provided prop; API-side zod UUID + RLS + existence check are the enforcement point). Recorded for audit trail.
→ Resolution: **No change required** (informational confirmation).

**SEC-F6 — Minor — Label overwrite has no audit trail; labeling is a review-suppressing control (SC12-deferred)**
A compromised session could mislabel a compromised account as `known_shared` to suppress orphan-review attention; later edits erase the trace. Low-moderate under the current single-admin-per-tenant threat model.
→ Resolution: **Fixed in plan (scope note)** — SC12 entry amended to state the security angle explicitly so labeling-v2 prioritizes it. The optional `discovery_events` partial mitigation is **Skipped** — see Resolution Status entry below.

**SEC-F8 — [Adjacent → Testing] — T-W1 should assert tenant-scoping of the surviving label row**
→ Resolution: **Fixed in plan** — T-W1 now asserts the surviving label row's `tenant_id` is unchanged/correct, not just value-equality.

**SEC RT8-adjacent note — T-L4/T-L8 denial paths need mutation-absence assertions**
(Converges with TEST-F3.) → Resolution: **Fixed in plan** — see TEST-F3.

## Testing Findings

**TEST-F1 — Major — Rate-limit member-set claim (C11/R42) has no runtime or CI-enforced test, unlike its 401/Origin siblings**
The 401 and Origin sweeps are auto-covering via the `onRoute` hook populating `app.apiRoutes`; no equivalent sweep exists for `config.rateLimit` (verified: no `rateLimit` match in `apps/api/test/*.ts`). The "12/12 with explicit config" claim is prose, not a red-able test.
→ Resolution: **Fixed in plan** — new test T-L9: extend the `onRoute` capture to record `routeOptions.config?.rateLimit` presence and sweep-assert every `/api` route carries a rate-limit config (RT7: prove it can fail by the pre-change red run against a temporarily-stripped route or by construction review).

**TEST-F2 — Minor — T-L2 upsert test must pin a direct DB-level assertion**
→ Resolution: **Fixed in plan** — T-L2 now specifies direct `SELECT` against `account_labels` (row count = 1, values, `updated_at`), not inference from API responses.

**TEST-F3 — Minor — T-L8 Origin-gate test redundant with the existing auto-covering sweep**
(Converges with SEC RT8-adjacent.) → Resolution: **Fixed in plan** — T-L8 rescoped: the generic sweeps already cover the 403 status for the new routes; T-L8 now asserts what the sweep cannot — mutation absence (no `account_labels` row created after an Origin-mismatch PUT), plus T-L4's 404 path asserts no row created.

**TEST-F4 — Minor — T-W1 confirmed adequate (informational)**
RT5 satisfied (real `runMatch`), byte-identical assertion achievable. → Resolution: **No change required.**

**TEST-F5 — Minor — SC8 deferral cost estimate (~15 min) understates the 4-script manual burden**
→ Resolution: **Fixed in plan** — estimate corrected to ~45–60 min per UI-touching change across 4 scripts.

**TEST-F6 — Minor — Forbidden-pattern greps not wired into an executable gate**
→ Resolution: **Fixed in plan** — Gate-before-Phase-3 checklist now includes running the conformance greps for all C10–C14 forbidden patterns (same mechanism as predecessor Phase 2-4).

## Adjacent Findings

- SEC-F8 (Security → Testing): T-W1 tenant-scoping assertion — routed and fixed (see above).
- SEC RT8 note (Security → Testing): denial-path mutation-absence — routed and fixed via TEST-F3/T-L8 rescope.
- TEST-F3 explicitly cross-referenced the Security expert's Origin-gate scope; no unrouted adjacents remain.

## Quality Warnings

None — merge quality gate not run (Ollama unavailable); orchestrator manual screen found no VAGUE / NO-EVIDENCE / UNTESTED-CLAIM findings (all findings cite specific plan sections and verified code references).

## Resolution Status

All Critical/Major findings (FN-F2, SEC-F2+F7, TEST-F1): fixed in plan. Minor findings FN-F1, FN-F3, SEC-F1, SEC-F3, SEC-F4, TEST-F2, TEST-F3, TEST-F5, TEST-F6: all straightforward — fixed in plan. SEC-F5, TEST-F4: informational confirmations, no change.

### SEC-F6 (partial) Minor — Optional `discovery_events` emission on label change — Skipped
- **Anti-Deferral check**: out of scope (different feature)
- **Justification**: The blocking part of SEC-F6 (SC12 security-angle annotation) is fixed in the plan. The optional partial mitigation (emit `discovery_events` kind `label_changed`) is deferred: it is the first slice of the audit-history feature that SC12 already owns and tracks (`future labeling-v2`), and the reviewing expert explicitly marked it "a suggestion, not a blocking finding" under the current single-admin-per-tenant threat model. Cited tracker: **SC12** in `import-labeling-saasapp-ui-plan.md` (Scope contract), now annotated with the security rationale. Worst case: a mislabeling by a compromised admin session leaves no event trail (labels themselves remain visible and correctable); Likelihood: low — requires an already-compromised admin session in a single-admin tenant, at which point the attacker has full tenant control regardless; Cost to fix now: ~1 h (event emission + payload design + tests) and it would pre-empt the SC12 design (payload/retention decisions) out of order.
- **Orchestrator sign-off**: Out-of-scope exception satisfied — tracked by SC12 with explicit security annotation; deferral does not leave a security control fail-open (labels do not gate any authz decision).

## Recurring Issue Check

### Functionality expert
- R1: Checked — no issue (withTenant, csvField/neutralizeCell, apiGetJson/apiFetch, rate-limit constants, api-types barrel all reused; verified against source).
- R2: Finding FN-F1 — second, differently-valued poll-interval constant instead of reusing SyncControl.tsx's POLL_INTERVAL_MS.
- R3: Checked — no issue (Origin/session gates automatic via scope-root registration; verified app.ts onRoute hook).
- R4: N/A — account_labels correctly excluded from discovery_events (SC12), consistent with design.
- R5: Checked — no issue (PUT/DELETE inside one withTenant each).
- R6: Checked — no issue (ON DELETE CASCADE on saas_account_id).
- R7: N/A — no E2E infra (SC8 carried forward).
- R8: folded into FN-F1/FN-F2.
- R9: N/A — no queue dispatch introduced.
- R10: Checked — no issue (api-types → api/web layering preserved).
- R11: N/A. R12: Checked — no issue (3-value closed enum in lockstep: PG enum, zod, display map). R13: N/A.
- R14: Checked — no issue (GRANT S/I/U/D matches route needs).
- R15: Checked — no issue. R16: N/A. R17: Checked — no issue. R18: N/A. R19: N/A. R20: N/A. R21: N/A.
- R22: Checked — no issue beyond FN-F1.
- R23: Checked — no issue (maxLength passive cap).
- R24: Checked — no issue (0003 purely additive; DROP/DELETE forbidden by pattern).
- R25: Checked — no issue (PUT persist ↔ GET /accounts hydrate, C11 Consumer 1).
- R26: Checked — no issue (disabled+spinner specified).
- R27: Checked — no issue (500-cap consistent across CHECK/zod).
- R28: Checked — no issue (display strings defined once).
- R29: N/A — no external spec citations. R30: N/A.
- R31: N/A — label DELETE is low-stakes, reversible, tenant-own data.
- R32: Checked — no issue (compose smoke gate before Phase 3).
- R33: N/A. R34: Checked — no issue (saas-apps duplicate-500 bug is being FIXED, not deferred). R35: Checked — no issue (3 manual scripts specified). R36: N/A.
- R37: Checked — no issue (raw API errors mapped, raw preserved in small print).
- R38: Finding FN-F2 — /import poll loop lacks timeout escape from matching(jobId) transient state.
- R39: N/A (credential path unchanged; note not a secret).
- R40: Checked — no issue (wire shapes consumed exactly as declared per walkthroughs).
- R41: Checked — no issue (all capabilities trace to real backing routes).
- R42: Checked — no issue. Both derivations independently recomputed and matched exactly: (a) rg "tenant_id uuid" migrations → 7 tables pre-change matching tables.test.ts assertion; (b) rg route registrations → 10 pre-change, plan's 10→12 correct.
- R43: N/A. R44: N/A. R45: N/A. R46: N/A.

### Security expert
- R1: Checked — no issue. R2: Checked — no issue (display map centralized). R3: Checked — no issue (gates automatic via scope-root).
- R4: N/A. R5: Checked — no issue (single withTenant per flow). R6: Checked — no issue (CASCADE; no external storage).
- R7: N/A. R8: N/A (non-security). R9: N/A. R10: N/A (non-security). R11: N/A.
- R12: Checked — no issue (enum schema-enforced + zod-mirrored). R13: N/A.
- R14: Checked — no issue (GRANT matches existing 7-table pattern; upsert needs no extra grant).
- R15: Checked — no issue. R16–R23: N/A or non-security.
- R24: Checked — no issue (0003 purely additive; DROP/DELETE banned).
- R25–R37: N/A or out of security scope, except:
- R38: Checked — no issue on auth/session angle (no session/token material in polling state machine).
- R39: Checked — Findings SEC-F2/SEC-F7 raised (credential error-path under-specified in forbidden-pattern coverage).
- R40: N/A (functionality). R41: N/A.
- R42: Checked — no issue. Independently recomputed both member sets (7 RLS tables pre-change; 10 rate-limited routes pre-change, 10/10 with config; plan's 12/12 post-change target correct).
- R43: N/A — no boundary predicate widening.
- R44: N/A. R45: N/A. R46: N/A.
- RS1: N/A — no new credential/token comparison.
- RS2: Checked — no issue (both new mutation routes specified with MUTATION_RATE_LIMIT; cross-checked with R42 recomputation).
- RS3: Checked — no issue (params UUID + body strict zod at boundary, matching every existing route).
- RS4: Checked — no issue (manual-test SA JSON explicitly dummy).
- RS5: N/A — no externally-supplied security parameter.
- RS6: Checked — no issue (csvField = quoteCsvCell(neutralizeCell(v)); ordering verified safe; pre-existing unmodified logic, plan adds two columns through same path).

### Testing expert
- R1: N/A — plan reuses existing helpers; no reimplementation observed.
- R2: Checked — no issue (label kind display strings centralized per C14).
- R3: Checked — no issue (23505→409 mapping explicitly scoped).
- R4–R41: reviewed; not triggered by this plan's testing-relevant surface (no distinguishing pattern match) except as covered by findings above.
- R42: (see TEST-F1 — the rate-limit member-set claim lacked mechanical enforcement; fixed via T-L9.)
- RT1: Checked — no issue (all new integration tests run against real Testcontainers Postgres/Redis via app.inject/runMatch; no mocks proposed).
- RT2: Checked — all proposed tests are implementable with existing infra (no untestable finding raised).
- RT3: Checked — no issue (tests reuse rate-limit constants / shared helpers rather than duplicating values).
- RT4: N/A — no race test proposed or required (single-statement atomic upserts).
- RT5: Checked — no issue (T-W1 calls the real exported runMatch; verified via source read).
- RT6: Checked — new production exports (route module, wire types) all carry test diffs in the plan (T-L*, T-S1, T-U1).
- RT7: Checked — no issue for T-W1 and RLS/upsert tests (structurally red-provable). Partial gap for the rate-limit member-set claim — TEST-F1 (absence of any test was the finding).
- RT8: Checked — T-L5 asserts tenant-A data untouched; T-L4/T-L8 gained mutation-absence assertions via TEST-F3 resolution.
- RT9: N/A — no twin files; packages/api-types is the single source (N5).

## Expert JSON indexes (round 1, raw)

### Functionality
```json
[
  {"id": "F1", "severity": "Minor", "title": "Import page poll interval claim (2s) mismatches SyncControl.tsx's actual 1.5s POLL_INTERVAL_MS", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 144, "adjacent": false, "escalate": null},
  {"id": "F2", "severity": "Major", "title": "Import page match-polling loop lacks a wall-clock timeout, unlike the SyncControl.tsx pattern it claims to follow", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 147, "adjacent": false, "escalate": null},
  {"id": "F3", "severity": "Minor", "title": "account_labels upsert overwrites created_by on every relabel, contradicting the column's creation-attribution naming", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 110, "adjacent": false, "escalate": null}
]
```

### Security
```json
[
  {"id": "F1", "severity": "Minor", "title": "404 disclosure posture test must distinguish real-account-wrong-tenant from nonexistent-account", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 240, "adjacent": false, "escalate": null},
  {"id": "F2", "severity": "Major", "title": "SaasAppForm JSON.parse/validation error paths not forbidden from echoing raw credential text into Error messages", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 173, "adjacent": false, "escalate": null},
  {"id": "F3", "severity": "Minor", "title": "23505 mapping should assert constraint name, not just error code", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 169, "adjacent": false, "escalate": null},
  {"id": "F4", "severity": "Minor", "title": "Empty-string note validation boundary (zod .min(1)) left implicit, untested", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 108, "adjacent": false, "escalate": null},
  {"id": "F5", "severity": "Minor", "title": "LabelControl accountId sourcing verified safe by construction — no action needed", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 202, "adjacent": false, "escalate": null},
  {"id": "F6", "severity": "Minor", "title": "Label overwrite has no audit trail (SC12-deferred) — review-suppressing control without forensic trace", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 272, "adjacent": false, "escalate": null},
  {"id": "F7", "severity": "Minor", "title": "SaasAppForm fetch error-handling not backed by grep preventing credential body echo into displayed error state", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 184, "adjacent": false, "escalate": null},
  {"id": "F8", "severity": "Minor", "title": "T-W1 should assert tenant-scoping of the surviving label row, not just value-equality", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 247, "adjacent": true, "escalate": null}
]
```

### Testing
```json
[
  {"id": "F1", "severity": "Major", "title": "Rate-limit member-set claim (C11/R42) has no runtime or CI-enforced test", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 117, "adjacent": false, "escalate": null},
  {"id": "F2", "severity": "Minor", "title": "T-L2 upsert test doesn't pin down a direct DB row-count assertion", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 237, "adjacent": false, "escalate": null},
  {"id": "F3", "severity": "Minor", "title": "T-L8 Origin-gate test is redundant with the existing auto-covering sweep", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 243, "adjacent": false, "escalate": null},
  {"id": "F4", "severity": "Minor", "title": "T-W1 verification note (no issue found, confirmed adequate)", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 247, "adjacent": false, "escalate": null},
  {"id": "F5", "severity": "Minor", "title": "SC8 deferral cost estimate (~15 min) understates actual 4-script manual test burden", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 271, "adjacent": false, "escalate": null},
  {"id": "F6", "severity": "Minor", "title": "No test/CI step confirms forbidden-pattern greps (C10-C14) are actually executed", "file": "docs/archive/review/import-labeling-saasapp-ui-plan.md", "line": 231, "adjacent": false, "escalate": null}
]
```
