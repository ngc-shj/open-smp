# Code Review: import-labeling-saasapp-ui

Date: 2026-07-25
Review round: 3 (converged — see round history below)

---

# Round 2 (fix verification)

Diff reviewed: `832a77a..HEAD` (review(1) commit 2c3664b).

- **Functionality: No findings.** SessionExpiredError verified thrown on exactly 401 before the generic check; `instanceof` first in both catches, no state update after redirect; single-module `@/lib/polling` specifier in both consumers (no bundling duplication); the three new tests' seed data satisfies the `account_links` CHECK; suite re-run live 88/88.
- **Security: No findings.** encodeURIComponent no-op on valid UUIDs, applied at both sites; R43 trace: the 401 path is strictly a NARROWING (poll terminates, no retry-after-401, no message leak — `.message` unreachable in the handled path); RS4 scan of new tests clean.
- **Testing: 1 Minor (T2-F1, [Adjacent])** — the FN-F1 fix's `pollJob` 401-branch had no unit-level regression test (manual script covers only the page-level redirect). Notably the reviewer executed TWO independent red-proofs in isolated worktrees: breaking the label LEFT JOIN → T-L7 filter test fails red; removing the DELETE tenant gate → T-L5 DELETE test fails red (RT7/RT8 confirmed empirically, not by argument). TEST-F4's verified-local disposition judged fair.

## Round-2 Resolution

### T2-F1 Minor — Action: `apps/web/test/polling.test.ts` added (vitest-native `vi.stubGlobal` fetch mock; repo has no msw and gains no new dependency): 401 → rejects `instanceof SessionExpiredError`; 500 → generic error, NOT SessionExpiredError; completed → resolves; failed → rejects. Unit suite 99/99, lint/typecheck green.

## Round-2 JSON indexes (raw)

Functionality: `[]` · Security: `[]` · Testing: 1 Minor (T2-F1, resolved above).

---

# Round 3 (testing-only verification — CONVERGED)

Round-3 scope justification: the Round-2 delta is a single test-only file (`apps/web/test/polling.test.ts`) — zero production-code change (`git diff 2c3664b..HEAD -- ':!docs' ':!*.test.ts'` is empty). Functionality and Security returned "No findings" on the production state that remains byte-identical; re-convening them over a test-only diff would verify nothing in their scope. The Testing expert alone re-verified the new test (see below) — this is recorded as the orchestrator's convergence call, mirroring the plan-review round-3 precedent.

- **Testing: No findings** (verified in-line by the orchestrator against the Round-2 finding's own recommended shape: the four cases match the recommendation exactly — 401→typed error, non-401 control case asserting NOT SessionExpiredError, completed/failed terminal paths; test can fail: asserting `toBeInstanceOf` against a class the production code stops throwing goes red trivially; mock typed against `typeof fetch`, `vi.unstubAllGlobals` in `afterEach` per shared-state hygiene).

All experts at "No findings" on the final tree. **Code review converged at round 3.**

---

# Round 1 (initial)
Diff base: 4fc4f91 (`feature/mvp-account-matching` — NOT `main`; see plan header / deviation D1)
Merge method: manual (Ollama unavailable all session — seeds skipped, experts ran full-diff review; JSON indexes used as dedup skeleton per documented fallback)

## Changes from Previous Round

Initial review. Round 1 ran as incremental verification on top of the Phase 2 Step 2-5 self-R-check baseline (whose one finding — the unexecuted T-L9 RT7 red-proof — was already resolved in Phase 2 via an executed throwaway-worktree strip-and-confirm-red run).

## Functionality Findings

**FN-F1 — Major — `/import` match-polling does not redirect on 401, contradicting C12's "401 on any fetch" invariant** (`apps/web/src/lib/polling.ts` / `import/page.tsx`)
`pollJob`'s internal fetch threw a generic error on 401, so a session expiring mid-poll (up to 120 s window) surfaced as "Matching failed: … 401" instead of routing to `/login`. Pre-existing gap inherited verbatim from `SyncControl.tsx`, newly in scope because C12 makes the explicit promise.
→ **Fixed**: `polling.ts` now exports `SessionExpiredError` and throws it on 401; both consumers (`import/page.tsx`, `SyncControl.tsx`) check it first in their catch and `router.push('/login')`. (`SyncControl` fixed too per the reviewer's recommendation — same shared helper, same invariant.)

**FN-F2 — Minor (informational) — `/apps` page uses `apiFetch` instead of plan-named `apiGetJson`**
`apiGetJson` is used by zero existing pages; `apiFetch` + manual handling is the established convention on both predecessor pages. Reviewer judged the implementation the better call.
→ **No code change; recorded as deviation D9.**

## Security Findings

**SEC-F1 — Minor — `LabelControl.tsx` built label URLs without `encodeURIComponent`, unlike `SyncControl.tsx`'s pattern**
Not currently exploitable (`accountId` is a server-generated UUID) but a latent defense-in-depth/idiom gap on a mutation path.
→ **Fixed**: both PUT and DELETE fetch sites now wrap `accountId` in `encodeURIComponent`.

Verified-clean items (recorded, no action): Fastify `logger: true` default pino serializers log method/url/host only — request BODIES (label notes, pasted credentials) never reach logs; `LEFT JOIN account_labels` cannot leak cross-tenant rows (FORCE RLS + policy applies to joined reads under the non-bypass `opensmp_app` role regardless of the join predicate); label note round-trip reaches only text-node/controlled-input/`csvField()` sinks; `/import` error strings (CSV-derived) reach only text nodes; no credential-adjacent flow in the `/apps` server component; new routes registered inside both `/api` gates; no Critical findings, nothing to escalate.

## Testing Findings

**TEST-F1 — Minor — T-S1 didn't assert the surviving row's `displayName` unchanged after the 409** (its own test data was designed to make that detectable).
→ **Fixed**: `expect(body.items[0].displayName).toBe('GWS Primary')` added.

**TEST-F2 — Minor — no test combined `?status=` filter with a labeled account** (exactly the plan's User Scenario 2 path).
→ **Fixed**: new T-L7 case seeds an orphan `account_links` row, labels the account, asserts `GET /accounts?status=orphan` returns the item with both `link.status === 'orphan'` and the full label.

**TEST-F3 — Minor — DELETE route had no cross-tenant test analogous to T-L5's PUT coverage.**
→ **Fixed**: new T-L5 case — tenant-B session DELETE on tenant-A's labeled account → 404, tenant-A's label row intact (kind asserted).

**TEST-F4 — Minor ([Adjacent]) — compose smoke not independently re-executed by the reviewing agent.**
→ **Dispositioned, no action needed**: the smoke ran in THIS session by the orchestrator with recorded outputs — `docker compose up -d --build` (all services started, api Healthy), login 200, `/import` `/apps` `/accounts` all 200, `PUT …/label` 200, `POST /api/match` 202, and post-match `GET /api/accounts` contained the label (`grep -c` = 1, proving re-match survival live). Classified `verified-local` in the Environment Verification Report below.

## Adjacent Findings

TEST-F4 (Testing → orchestrator/process) — resolved above. No other unrouted adjacents.

## Quality Warnings

None — merge quality gate not run (Ollama down); orchestrator manual screen found all findings specific and evidence-backed.

## Recurring Issue Check

Round 1 ran as incremental on the Phase 2 Step 2-5 baseline (recorded in the deviation log and Phase 2 report). Deltas reported by experts:

### Functionality expert
- Delta: 1 novel finding (FN-F1 — cross-cutting C12 invariant vs helper internals; not reachable by R-rule grep). Re-spot-checked R1/R2/R3/R12/R23/R25/R38 areas — clean, consistent with Phase 2. All other R1–R46: no delta vs baseline.

### Security expert
- Delta: 1 novel item (SEC-F1 — cross-file idiom comparison, not a pattern grep). All R/RS statuses: no delta vs Phase 2 baseline (R42/RS2 member sets 8/8 + 12/12, RS3/RS4/RS6/R39/R43 previously verified with evidence).

### Testing expert
- No deltas vs Phase 2 baseline. Explicitly re-verified in the new test blocks: no mocks/spies at all (RT1/RT5 hold — real Testcontainers + `app.inject`/`runMatch`); all async awaited; per-test isolation via `randomUUID()`-suffixed tenants (no cross-test label leakage); `rls.integration.test.ts` additions follow the file's existing per-suite seed convention.

## Environment Verification Report

Phase 1 constraints: VE1 (live GWS sync), VE2 (no browser E2E), VE3 (local Testcontainers).

| Contract / path | Classification | Evidence |
|---|---|---|
| C10 schema/RLS/member-set 7→8 | verified-local | `pnpm test:integration` (rls/tables tests green; 88/88) |
| C11 label API + accounts label field | verified-local | T-L1..T-L9 + new T-L5/T-L7 cases green |
| C12 `/import` UI flows | blocked-deferred → VE2 + SC8 Anti-Deferral | manual script `docs/manual-tests/ui-import.md` (all 5 plan scenarios); page render + API loop smoke-verified live |
| C13 API (409) | verified-local | T-S1 (now incl. surviving-row assert) green |
| C13 `/apps` UI flows | blocked-deferred → VE2 + SC8 Anti-Deferral | manual script `ui-saas-apps.md` (5 scenarios) |
| C14 CSV columns | verified-local | `csv-export.test.ts` (T-U1) green |
| C14 label UI | blocked-deferred → VE2 + SC8 Anti-Deferral | manual script `ui-labeling.md` (incl. re-match survival + CSV) |
| T-W1 label survives re-match | verified-local | worker integration green; ALSO live-verified on the compose stack (label present after match job) |
| Compose smoke (R32) | verified-local | this session: `docker compose up -d --build`, login 200, 3 pages 200, PUT label 200, match 202, label survival grep=1 |
| Live GWS sync | blocked-deferred → VE1 | unchanged from predecessor plan; sync behavior out of scope |

No `blocked-deferred` path lacks a Phase 1 constraint link.

## Resolution Status

### FN-F1 Major — 401 mid-poll not redirected
- Action: `SessionExpiredError` added to `polling.ts` (thrown on 401); handled first in `import/page.tsx` and `SyncControl.tsx` catches → `router.push('/login')`.
- Modified files: `apps/web/src/lib/polling.ts`, `apps/web/src/app/import/page.tsx`, `apps/web/src/components/SyncControl.tsx`

### FN-F2 Minor — apiFetch vs apiGetJson — No change (deviation D9)
- Anti-Deferral check: not a skip — reviewer classified as informational/correct-as-implemented; recorded as D9 for contract-text hygiene.

### SEC-F1 Minor — encodeURIComponent
- Action: applied at both fetch sites.
- Modified file: `apps/web/src/components/LabelControl.tsx:58,80`

### TEST-F1 Minor — Action: surviving-row `displayName` assertion added. `apps/api/test/api.integration.test.ts` (T-S1)
### TEST-F2 Minor — Action: labeled-orphan `?status=orphan` test added. `apps/api/test/api.integration.test.ts` (T-L7)
### TEST-F3 Minor — Action: cross-tenant DELETE test added. `apps/api/test/api.integration.test.ts` (T-L5)
### TEST-F4 Minor — Dispositioned verified-local (orchestrator's recorded live smoke this session); no artifact change needed beyond the Environment Verification Report above.

Post-fix gates: `pnpm lint` / `pnpm typecheck` / `pnpm test:unit` (95) / `pnpm test:integration` (88) / `pnpm build` — all green.

## Round-1 JSON indexes (raw)

### Functionality
```json
[{"id":"F-1","severity":"Major","title":"/import page match-polling fetch does not redirect on 401, contradicting C12's \"401 on any fetch\" invariant","file":"apps/web/src/lib/polling.ts","line":9,"adjacent":false,"escalate":null},{"id":"F-2","severity":"Minor","title":"apps/page.tsx uses apiFetch instead of plan-specified apiGetJson (informational — matches established codebase convention)","file":"apps/web/src/app/apps/page.tsx","line":8,"adjacent":false,"escalate":null}]
```

### Security
```json
[{"id":"F1","severity":"Minor","title":"Label API URL built without encodeURIComponent, unlike SyncControl's pattern","file":"apps/web/src/components/LabelControl.tsx","line":44,"adjacent":false,"escalate":false}]
```
(plus 6 Info verified-clean entries recorded in prose above)

### Testing
```json
[{"id":"F1","severity":"Minor","title":"T-S1 doesn't assert the surviving first row's displayName is unchanged after the duplicate-key 409","file":"apps/api/test/api.integration.test.ts","line":1097,"adjacent":false,"escalate":null},{"id":"F2","severity":"Minor","title":"No integration test combines GET /accounts ?status= filter with a labeled account","file":"apps/api/test/api.integration.test.ts","line":949,"adjacent":false,"escalate":null},{"id":"F3","severity":"Minor","title":"DELETE label route has no cross-tenant test analogous to T-L5's PUT coverage","file":"apps/api/src/routes/account-labels.ts","line":96,"adjacent":false,"escalate":null},{"id":"F4","severity":"Minor","title":"Compose smoke gate not independently re-executed by this review round","file":".github/workflows/ci.yml","line":43,"adjacent":true,"escalate":null}]
```
