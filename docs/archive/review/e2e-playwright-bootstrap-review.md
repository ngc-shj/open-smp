# Plan Review: e2e-playwright-bootstrap

Date: 2026-07-25
Review round: 3 (converged — see round history below)

---

# Round 2 (incremental)

## Changes from Previous Round

All 19 round-1 findings resolved (Critical 1, Major 4, Minor 10, Info 4 — see Round 1 below).

## Round-2 Findings

**Functionality: No findings.** Verified: login-budget arithmetic recounted correct (3 POSTs/run; auth.spec's third case is a GET; session-expiry adds zero re-logins); nameDomainRule fix exact; TTL citation accurate (24 h sliding — auth.ts:25, refresh at :196-198); sync.spec determinism PROVEN from source — fake-credential failure happens at synchronous PEM signing BEFORE any network call, zero retries (401/403 and no-status errors bypass the retry gate), worker `attempts: 1`, job fails in single-digit ms vs the 120 s poll ceiling; clearCookies is per-context and touches neither state.json nor the DB session row — no cross-spec leakage possible.

**Security: 2 Minor (both fixed in plan):**
- SEC-E8: "gitignored" for `e2e/.auth/state.json` (a LIVE session cookie) was prose-only → now a `.gitignore` contract line in C15's layout + T-E4 asserts `git ls-files e2e/.auth/` is empty.
- SEC-E9: seed-preservation script's cookie handling unspecified → `mktemp` jar + `trap` cleanup on success AND failure, in the contract text.
- Also verified: state.json is structurally outside the `playwright-report/` upload path (no artifact sweep); R43 — all four round-1 security fixes only narrowed boundaries.

**Testing: 1 Minor + 1 Info (both fixed in plan):**
- T2-F-1: ui-labeling.md step 4 (edit-note-on-existing-label) was the single residual silent drop (R42 same-shape recurrence at reduced severity) → edit-note case added to labeling.spec.
- T2-F-2 (Info): "malformed JSON" silently consolidated manual steps 5+6 → both failure shapes now named in the apps.spec bullet.
- Also verified: coverage mapping now 32/32 manual steps dispositioned; conditional teardown implementable; CSV-injection order-safe; oversized generation conflicts with no ban; N6's wording correctly tolerates persistent E9xx identities (upsert keeps row count fixed at 3 across runs — no unbounded growth); session-expiry cases add zero login POSTs.

## Round-2 JSON indexes (raw)

Functionality: `[]` · Security: `[{"id":"SEC-E8",...},{"id":"SEC-E9",...}]` (2 Minor) · Testing: `[{"id":"T2-F-1",...}]` (1 Minor) + T2-F-2 Info.

---

# Round 3 (verification-only — CONVERGED)

## Round-3 Results

- **Security: 1 residual Minor (SEC-E8 partial)** — C15's layout comment referenced a `git ls-files e2e/.auth/` check that T-E4's own definition lacked (dangling cross-reference). → **Fixed immediately**: the assertion added to T-E4's definition using the expert's own recommended wording verbatim.
- **Testing: No findings** — both round-2 fixes verified in place and correctly worded; edit-note case order-safe within labeling.spec's sequence; 32/32 manual-step disposition re-confirmed; AND the SEC-E8 T-E4 fix independently verified intact (line-145 cross-reference correct) since the testing agent ran after the fix was applied.
- **Functionality**: returned No findings in round 2; round-3 edits touched only security/testing scope areas (a .gitignore contract line, a shell-script hygiene clause, two spec-bullet wordings) — no functionality surface changed.

## Convergence Declaration

All three experts are at "No findings" against the final plan text: functionality (round 2), testing (round 3), and security (round 3's single residual was closed with the expert's verbatim recommended wording and independently verified in place by the testing agent's later pass). Contracts C15–C17 are in final form; Go/No-Go stands at locked × 3. **Plan review converged at round 3.**

---

# Round 1 (initial)

Merge method: manual dedup by orchestrator (Ollama unavailable — documented fallback; JSON indexes as skeleton).

## Changes from Previous Round

Initial review.

## Functionality Findings

**FN-F1 — CRITICAL — Login rate limits (5/min/IP + 20/hr/account-bucket) very likely tripped by the per-spec-file (worse: Playwright default per-TEST) login fixture, especially under T-E2's twice-consecutive requirement** — converges with TEST-F-2 (independent detection by two experts; severity floor confirmed).
→ **Fixed in plan**: single-login storageState design — global setup performs exactly ONE UI login, saves `e2e/.auth/state.json`; all specs ride the storage state; only auth.spec.ts does 2 real form POSTs. Budget arithmetic recorded in-plan: ≤3 POSTs/run, 6/hr across the double-run vs 20/hr; ≤3/min vs 5/min.

**FN-F2 — Major — `nameDomainRule` (displayName + email-domain match, email-local-part-independent) missed by the two-rule collision-safety analysis** (R42: the class primitive is the FULL matcher rule set).
→ **Fixed in plan**: fixture display names must not equal any seeded `display_name`; `E2E Import Row *` style mandated + cross-ref comment to `rules.ts` in the fixtures module.

**FN-F3 — Major [Adjacent] — shared storageState needs a session-TTL vs suite-duration check.**
→ **Fixed in plan (verified against source)**: `SESSION_TTL_MS = 24 h` + sliding refresh on every authenticated request (`auth.ts:25,174`) vs 2–4 min suite — ample headroom; no per-file re-login needed.

**FN-F4 — Minor — apps.spec "zero requests" proof under-specified (risked disguised-sleep).**
→ **Fixed in plan**: listener-before-interaction → web-first wait for the visible inline error → assert captured list empty at that settled point.

**FN-F5 — Minor — CSV assertion ambiguous on label values (order-fragility).**
→ **Fixed in plan**: accounts.spec asserts header + presence + status only; label-value/injection assertions live in labeling.spec while its label is set.

## Security Findings

**SEC-E3 — Major — CI failure artifact (playwright-report) captures the typed demo password in traces/screenshots; no retention bound or stated posture.**
→ **Fixed in plan**: `retention-days: 7`; explicit posture note (accepted ONLY because the credential is already committed plaintext; the acceptance does NOT extend to any future non-demo stack — redaction required before reuse).

**SEC-E1 — Minor — "single source" overstated (3 comment-synced literals).**
→ **Fixed in plan**: `E2E_DEMO_EMAIL`/`E2E_DEMO_PASSWORD` env plumbing; CI job-level `env:` consumed by both curl and Playwright steps; literals reduced to seed.ts (canonical) + one default in auth.ts.

**SEC-E2 — Minor — RS4 allowlist was lexical (substring bypass possible).**
→ **Fixed in plan**: structural gate — SA-JSON-shaped content allowed ONLY in `e2e/fixtures/fake-service-account.ts`; pattern extended to `iam\.gserviceaccount\.com|private_key_id`.

**SEC-E5 — Minor — @playwright/test pin policy unstated.**
→ **Fixed in plan**: caret range per repo npm convention, noted in C15.

Verified clean (recorded): no new CI secrets (SEC-E4); `postgres://|DATABASE_URL` ban sound (SEC-E6); clearCookies spec cannot mask session fixation — no pre-auth session exists (SEC-E7). RS2 watch note (login budget) resolved by the FN-F1 fix's arithmetic.

## Testing Findings

**TEST-F-1 — Major — 8 manual-script scenarios silently dropped with no SC entry** (import oversized + mid-flow-401; saas-apps credential-DOM check; orphan-list evidence popover, ambiguous candidates, column/freshness smoke, CSV-injection, SyncControl).
→ **Fixed in plan**: ALL folded into specs — accounts.spec gained popover/candidates/column-freshness; labeling.spec gained the CSV-injection check; import.spec gained oversized (SC21 un-deferred — its "cost" justification was disproven by the manual script's own one-liner); session-expiry.spec expanded to 3 cases (label/upload/match); new **sync.spec.ts** (8th spec) covers the sync-failure + match-gating path (VE1's failure branch is locally testable). F2 requirement now states the zero-silent-drop disposition.

**TEST-F-2 — Major — login rate-limit risk** → converged with FN-F1, fixed as above.

**TEST-F-3 — Minor — teardown-via-UI not robust when the label was never set** → fixed: conditional teardown (inspect label state before clearing).

**TEST-F-4 — Minor — "3 imported" upsert-count semantics unstated** → fixed: spelled out in import.spec bullet with hr-import.ts cross-ref.

**TEST-F-5 — Minor — flake-pattern ban incomplete** → fixed: `networkidle` added to the hard ban; `{ timeout:` overrides require same-line justification (soft review gate).

**TEST-F-6 — Minor — seed-preservation was a manual curl gate despite N6 being load-bearing** → fixed: automated `e2e/scripts/assert-seed-preserved.sh`, run locally (Phase-3 gate) AND as a CI step after `pnpm test:e2e` (existing curl-gate idiom).

**TEST-F-7 — Minor — pagination gap + logout absence unrecorded** → fixed: SC22 (pagination — needs >50-account fixture; trigger on pagination-code change); logout recorded as not-a-gap (no UI affordance; joins auth.spec when a button ships).

**TEST-F-8 — Info — retries/trace-on-first-retry checked sound (no action).**
**TEST-F-9 — Info — double-lock phrasing overstated for the integration project (suffix-only lock)** → fixed: precise lock inventory in C15.
**TEST-F-10 — Info — T-E1 red-proof design verified adequate.**

## Adjacent Findings

FN-F3 (harness/session architecture) — resolved with source-verified TTL. TEST-F-2 ↔ FN-F1 convergence noted. No unrouted adjacents.

## Quality Warnings

None (manual screen; all findings cited file:line or plan-section evidence; two experts independently computed the rate-limit arithmetic).

## Recurring Issue Check

### Functionality expert
- R1: not triggered (reuses matcher/seed patterns). R7: advisory — captured via FN-F4/F5. R16: not triggered. R17: not triggered. R33: pass (single ci.yml verified). **R42: triggered → FN-F2** (rule-set class walked incompletely; fixed); page member-set derivation independently recomputed and correct. R44: pass. RT7: pass (T-E1 adequate). All other R1–R46: not implicated (test-infrastructure-only plan).

### Security expert
- R2 pass; R7 pass (accepted tradeoff); R32 pass; **R33 pass (verified single workflow)**; R42 pass (page member set); R44 pass. RS1 n/a; **RS2 watch → resolved via FN-F1 fix arithmetic**; RS3 n/a; **RS4 pass-with-note → SEC-E2 fixed (structural gate)**; RS5 n/a; RS6 n/a. All others: not applicable (full table in expert output, retained in raw index below).

### Testing expert
- R2 pass; R7 acknowledged; R24 n/a; R32 pass; R33 pass; R37 pass (inherited); R38 n/a (inherited, implemented); **R42: pass but noted coarser than scenario granularity — the gap that produced TEST-F-1, addressed by the zero-silent-drop disposition in F2**; R44 pass; **RT4: partially → TEST-F-5 fixed**; RT5 pass (browser-only boundary + DB ban); **RT7: pass (T-E1)**; RT8 n/a. Others: not implicated.

## Resolution Status

All findings above: fixed in plan (see per-finding arrows). No skips, no deferrals except SC22 (pagination), which carries its own SC entry with trigger — and SC21, which was UN-deferred (folded into import.spec) because its cost justification failed review scrutiny. No Anti-Deferral entries required beyond the SC rows themselves.

## Round-1 JSON indexes (raw)

### Functionality
```json
[
  {"id": "F1", "severity": "Critical", "title": "Login rate limits (5/min/IP + 20/hr/account-bucket) very likely tripped by per-test loggedInPage fixture across suite + required double-run", "file": "apps/api/src/rate-limits.ts", "line": 11, "adjacent": false, "escalate": null},
  {"id": "F2", "severity": "Major", "title": "name-domain matcher rule (email-independent) not accounted for in fixture collision-safety argument", "file": "packages/matcher/src/rules.ts", "line": 42, "adjacent": false, "escalate": null},
  {"id": "F3", "severity": "Major", "title": "Shared storageState fix for F1 needs session-TTL vs suite-duration check, unaddressed in plan", "file": "docs/archive/review/e2e-playwright-bootstrap-plan.md", "line": 41, "adjacent": true, "escalate": null},
  {"id": "F4", "severity": "Minor", "title": "apps.spec 'zero requests' assertion technique under-specified, risks disguised-sleep flake", "file": "docs/archive/review/e2e-playwright-bootstrap-plan.md", "line": 85, "adjacent": false, "escalate": null},
  {"id": "F5", "severity": "Minor", "title": "CSV export assertion ambiguous on label-value vs header-only, order-fragility risk", "file": "docs/archive/review/e2e-playwright-bootstrap-plan.md", "line": 82, "adjacent": false, "escalate": null}
]
```

### Security
```json
[
  {"id": "SEC-E1", "severity": "Minor", "title": "Demo-credential triple-write claimed as 'single source' but is comment-synced literals in 3 files", "adjacent": false},
  {"id": "SEC-E2", "severity": "Minor", "title": "RS4 forbidden-pattern allowlist for fake SA key is lexical-only, narrow (PEM header only), and has a substring-based bypass", "adjacent": false},
  {"id": "SEC-E3", "severity": "Major", "title": "CI failure-artifact upload (playwright-report) will capture demo password in traces/screenshots with no retention bound or stated posture", "adjacent": false, "escalate": false},
  {"id": "SEC-E5", "severity": "Minor", "title": "@playwright/test version pinning policy unstated; repo's caret-range convention should be made explicit in C15", "adjacent": false}
]
```

### Testing
```json
[
  {"id": "F-1", "severity": "Major", "title": "Seven manual-test scenarios silently dropped with no SC entry", "area": "coverage-mapping"},
  {"id": "F-2", "severity": "Major", "title": "workers:1 UI-login-per-spec-file design risks hitting LOGIN_IP_RATE_LIMIT (5/min) under the twice-consecutive idempotency requirement", "area": "test-design", "adjacent": true},
  {"id": "F-3", "severity": "Minor", "title": "Labeling spec teardown-via-UI is not robust to a failure before the label was ever set (Clear button only renders when a label exists)", "area": "idempotency"},
  {"id": "F-4", "severity": "Minor", "title": "Re-import '3 imported' semantics rely on upsert-count vs new-row-count distinction not spelled out in the plan", "area": "idempotency"},
  {"id": "F-5", "severity": "Minor", "title": "Forbidden-pattern ban omits networkidle and arbitrary expect timeout overrides", "area": "flaky-test-prevention"},
  {"id": "F-6", "severity": "Minor", "title": "Seed-preservation check is a manual curl gate, not an automated CI assertion, despite N6 being a load-bearing requirement", "area": "ci-integration"},
  {"id": "F-7", "severity": "Minor", "title": "Pagination/keyset-cursor coverage gap and logout UI absence are unrecorded in the Scope contract", "area": "coverage-mapping"},
  {"id": "F-8", "severity": "Info", "title": "Retries/trace-on-first-retry artifact story checked and found sound; no action needed", "area": "ci-integration"},
  {"id": "F-9", "severity": "Info", "title": "T-E4 double-lock claim is directionally accurate but slightly overstates uniform applicability across both vitest projects", "area": "gate-separation"},
  {"id": "F-10", "severity": "Info", "title": "RT7/T-E1 red-proof design verified adequate (stopped-stack + wrong-assertion throwaway proofs)", "area": "red-proof"}
]
```
