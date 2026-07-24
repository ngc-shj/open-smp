# Code Review: mvp-account-matching
Date: 2026-07-24
Review round: 1

## Changes from Previous Round
Initial code review. Local LLM (Ollama) unavailable throughout — seeds skipped, manual dedup fallback used.

## Functionality Findings
[CF1] Critical: Session cookie Secure:true breaks browser login on plain-HTTP docker-compose demo — login.ts:56 sets secure unconditionally; compose has no TLS; browsers drop the cookie → /accounts 401-redirect loop; curl-based smoke masks it (curl ignores Secure). Fix: secure = APP_ORIGIN protocol === https (via AppDeps).
[CF2] Major: runSync single all-or-nothing withTenant transaction — mid-stream connector failure discards all upserted rows and writes no discovery_events; no partial-failure test. Fix: per-page/batch transactions + failure event row with progress count.
[CF3] Major: ambiguous evidence.candidates carries raw identity UUIDs end-to-end (matcher → DB → API → popover/CSV) — non-actionable for the human-review purpose; SC11 detail page deferred so no click-through. Fix: carry {identityId, displayName} pairs (additive).
[CF4] Minor: worker concurrency:1 is global across tenants (jobId dedup already provides per-tenant serialization) — stricter than C5, throughput bottleneck as tenants grow.
[CF5] Minor: hr-import response adds undeclared `warnings` field — not in C6 contract text nor @open-smp/api-types (D6 single-source goal); no UI consumer for errors/warnings (C8 has no import page — matches C8 page list, but shape should live in api-types).
## Seed Finding Disposition
Seed unavailable — no dispositions to record.
## Recurring Issue Check
R1/R17, R2, R9, R13, R33, R39, R42, R44 checked-clean re-verified; others n/a — no violation evidence in priority files.
```json
[
  {"id": "CF1", "severity": "Critical", "title": "Secure cookie breaks HTTP compose demo", "file": "apps/api/src/routes/login.ts", "line": 56, "adjacent": false, "escalate": null},
  {"id": "CF2", "severity": "Major", "title": "runSync all-or-nothing transaction loses progress", "file": "apps/worker/src/sync.ts", "line": 87, "adjacent": false, "escalate": null},
  {"id": "CF3", "severity": "Major", "title": "ambiguous candidates are raw UUIDs, non-actionable", "file": "packages/matcher/src/match.ts", "line": 46, "adjacent": false, "escalate": null},
  {"id": "CF4", "severity": "Minor", "title": "global worker concurrency stricter than per-tenant contract", "file": "apps/worker/src/main.ts", "line": 35, "adjacent": false, "escalate": null},
  {"id": "CF5", "severity": "Minor", "title": "hr-import warnings field undeclared in contract/api-types", "file": "apps/api/src/routes/hr-import.ts", "line": 187, "adjacent": false, "escalate": null}
]
```

## Security Findings
[CS1] Critical (escalate:true): non-UUID tenantId in session cookie → NULLIF(...)::uuid throws inside requireSession's UPDATE → not UnauthorizedError → Fastify default 500 with raw pg error text reflected to unauthenticated client. Breaks D4 fail-closed ("forged tenantId → 401"). Zero precondition. Also logs error-level stack per malformed cookie (noise/DoS-adjacent), hits both requireSession and destroySession (logout). Fix: validate tenantId as UUID in parseSessionCookie → return null → UnauthorizedError → clean 401. No cross-tenant data exposure (query still returns zero rows first).
[CS2] Major: hr-import no row-count cap — 10MB byte cap defeated by minimal rows (~150-250k), synchronous one-row-per-round-trip inside one withTenant txn holds a shared-pool connection for minutes → cross-tenant pool starvation from one authed caller. Fix: cap validRows.length (e.g. 20000) → 400, or batch inserts, or async job.
[CS3-A] Minor [Adjacent→infra]: all 3 container targets run as root; no USER directive. Fix: USER node in each final stage.
[CS4-A] Minor [Adjacent→func]: apiFetch forwards whole cookie jar to API_URL, not just session cookie. Latent over-forwarding. Fix: forward only session=... by name.
[CS5-A] informational [Adjacent]: Secure cookie over http://localhost breaks browser demo (same root cause as CF1) — advisory; Secure:true is correct production posture, gap is demo DX (needs conditional-on-APP_ORIGIN).
Verified clean with evidence: SQLi (all parameterized, no sql.raw), D4 (sound for well-formed uuid), D5 (admin/app URL split), D7 (exact-match Origin, non-GET/HEAD, method casing rejected at wire), multipart limits (10MB, truncated check, UTF-8 strict), saas-apps credentials (encrypt-before-store, never logged, GET excludes, Fastify 1MB bodyLimit bounds), worker error logging (String(error) drops .cause → no credential leak), rotate S13 (per-tenant loop, ROTATE_CONFIRM, no HTTP route), crypto AAD (uuids only, unreachable delimiter injection), compose (no postgres/redis host ports, redis requirepass).
## Seed Finding Disposition
Seed unavailable — no dispositions to record.
## Recurring Issue Check
R2/R9/R13/R42 clean; RS1 (single verify call all branches), RS2 (both login limits + route limits), RS3 (.strict() everywhere), RS4 (no secret in logs), RS6 n/a; R14/R31/R39/R43/R44 no contradicting evidence.
```json
[
  {"id": "CS1", "severity": "Critical", "title": "non-UUID tenantId cookie → 500 + raw DB error, breaks D4 fail-closed", "file": "apps/api/src/auth.ts", "line": null, "adjacent": false, "escalate": true},
  {"id": "CS2", "severity": "Major", "title": "hr-import no row-count cap → cross-tenant pool starvation", "file": "apps/api/src/routes/hr-import.ts", "line": null, "adjacent": false, "escalate": false},
  {"id": "CS3-A", "severity": "Minor", "title": "containers run as root, no USER directive", "file": "Dockerfile", "line": null, "adjacent": true, "escalate": null},
  {"id": "CS4-A", "severity": "Minor", "title": "apiFetch forwards whole cookie jar to API host", "file": "apps/web/src/lib/api-server.ts", "line": null, "adjacent": true, "escalate": null},
  {"id": "CS5-A", "severity": "Minor", "title": "Secure cookie over http breaks browser demo (advisory)", "file": "apps/api/src/routes/login.ts", "line": null, "adjacent": true, "escalate": null}
]
```

## Testing Findings
[CT1] Major: no test for D7 empty-GUC ('' not unset) on reused pooled connection — the exact fd4e1f4 failure mode. Fix: raw query with GUC='' asserts zero rows, no cast error.
[CT2] Critical: 20/h account bucket FIRING untested — suite passes even if the limiter didn't exist (independence test caps at 5 attempts). Fix: 21 attempts one bucket, varied remoteAddress, assert 429.
[CT3] Major: S7 route-schema tenantId sweep does not exist anywhere. Fix: iterate app.apiRoutes schemas asserting no tenantId in body/query properties.
[CT4-A] Minor: last_synced_at monotonicity uses >= (would pass on verbatim reuse). Fix: strict > with controlled clock separation.
[CT5] Minor: Origin sweep second test lacks the route-count>0 guard the first has.
[CT6] Critical: C7 acceptance "session expired → 401; session row deleted → 401" has ZERO integration coverage. Fix: backdate expires_at / delete row, assert 401 on protected route.
[CT7] Major: sliding-TTL refresh untested (expires_at advance on authenticated request).
[CT8] Minor: OWASP citation retrieval date equals review date — confirm not back-filled.
[CT9] Minor: manual-test run-log tables empty (expected at R1; do not conflate with verified).
[CT10] Minor: C9/S11 buffer zeroing untested; zeroing code lives in worker call sites, not packages/crypto — accepted-residual per plan.
[CT11] Critical: S13 static check (no HTTP route invokes rotation) not automated — a future rotation endpoint would ship unflagged. Fix: vitest test reading route files asserting no rotate reference.
[CT-CI1] Major: compose-smoke needs only checks — runs parallel to integration, deviating from plan's sequential order; partial-green possible. Fix: needs [checks, integration] or document.
Acceptance-criteria mapping + Environment Verification Report draft delivered (V1b/V4/M1 blocked-deferred with links; V2/V3/T6 verified-local+CI).
## Seed Finding Disposition
Seed unavailable — no dispositions to record.
## Recurring Issue Check
R33/R44/R42/R39 checked with evidence; no .skip/.only anywhere; RT1 PASS (boundary-only mocking); RT8 PASS (re-query pattern genuine); RT9 CLOSED re-verified; RT2 applied; others n/a.
Note: json index deviated from standard schema (contract/area/type keys) — prose authoritative, accepted.
```json
[
  {"id": "CT1", "severity": "Major", "title": "empty-GUC pooled-connection RLS path untested", "file": "packages/schema/test/rls.integration.test.ts", "line": 271, "adjacent": false, "escalate": null},
  {"id": "CT2", "severity": "Critical", "title": "20/h account bucket firing untested (vacuous)", "file": "apps/api/test/api.integration.test.ts", "line": 206, "adjacent": false, "escalate": null},
  {"id": "CT3", "severity": "Major", "title": "S7 tenantId route-schema sweep missing", "file": "apps/api/test/api.integration.test.ts", "line": null, "adjacent": false, "escalate": null},
  {"id": "CT4-A", "severity": "Minor", "title": "monotonicity assertion weak (>=)", "file": "apps/worker/test/sync.integration.test.ts", "line": 157, "adjacent": true, "escalate": null},
  {"id": "CT5", "severity": "Minor", "title": "Origin sweep 2nd test lacks count guard", "file": "apps/api/test/api.integration.test.ts", "line": 155, "adjacent": false, "escalate": null},
  {"id": "CT6", "severity": "Critical", "title": "expired/deleted session 401 tests missing", "file": "apps/api/test/api.integration.test.ts", "line": null, "adjacent": false, "escalate": null},
  {"id": "CT7", "severity": "Major", "title": "sliding-TTL refresh untested", "file": "apps/api/test/api.integration.test.ts", "line": null, "adjacent": false, "escalate": null},
  {"id": "CT8", "severity": "Minor", "title": "OWASP citation date suspicious", "file": "apps/api/src/auth.ts", "line": 10, "adjacent": false, "escalate": null},
  {"id": "CT9", "severity": "Minor", "title": "manual-test run logs empty", "file": "docs/manual-tests/ui-orphan-list.md", "line": null, "adjacent": false, "escalate": null},
  {"id": "CT10", "severity": "Minor", "title": "buffer zeroing untested / lives outside crypto pkg", "file": "packages/crypto/src/index.ts", "line": null, "adjacent": false, "escalate": null},
  {"id": "CT11", "severity": "Critical", "title": "S13 no-rotation-route static check not automated", "file": "apps/api/test/api.integration.test.ts", "line": null, "adjacent": false, "escalate": null},
  {"id": "CT-CI1", "severity": "Major", "title": "compose-smoke not gated on integration job", "file": ".github/workflows/ci.yml", "line": 43, "adjacent": false, "escalate": null}
]
```

## Adjacent Findings
- CS3-A (→ infra/deployment): containers as root — routed to functionality/deployment scope, evaluated directly (Minor, defense-in-depth).
- CS4-A (→ functionality): apiFetch cookie over-forwarding — evaluated directly.
- CS5-A / CF1 convergence: Secure-cookie-over-HTTP flagged by BOTH security (CS5-A) and functionality (CF1). Perspective convergence → severity floor Major; functionality raised it to Critical (broken primary demo flow). Merged: tracked as CF1 Critical.
- CT4-A (→ functionality): last_synced_at weak assertion.

## Environment Verification Report
Per the testing expert's draft: V1a fixture tests verified-local+CI; V1b GWS-live blocked-deferred (docs/manual-tests/google-workspace-sync.md, run-log empty, links V1); V2 RLS verified-local+CI (rls.integration, postgres:16, 55/55 green); V3 BullMQ/Redis verified-local+CI; V4 UI-E2E blocked-deferred (no infra, links V4/SC8, ui-orphan-list.md run-log empty); T6 compose-smoke verified-local+CI (live: seed 0, counts 1/1/1/1, login 200, CSRF 403); M1 blocked-deferred (post-implementation by design, does not gate). No blocked-deferred path lacks a Phase-1 constraint link.

## Convergence / merge notes
- CF1 = CS5-A (Secure cookie): convergent functionality+security, floor Major, functionality Critical wins.
- CT10 = CF-adjacent / S11 buffer zeroing: accepted-residual per plan, not re-litigated.

## Recurring Issue Check
### Functionality expert
R1/R17, R2, R9, R13, R33, R39, R42, R44 checked-clean re-verified; R3-R8/R10-R12/R14-R16/R18-R32/R34-R38/R40-R41/R43/R45-R46 n/a — no violation in priority files.
### Security expert
R2/R9/R13/R42 clean; RS1 (single verify call all branches), RS2 (IP+account+route limits wired), RS3 (.strict() everywhere), RS4 (no secret in logs), RS6 n/a; R14/R31/R39/R43/R44 no contradicting evidence.
### Testing expert
R33/R44/R42/R39 evidence-checked; no .skip/.only; RT1 PASS (boundary-only mocking), RT8 PASS (genuine re-query), RT9 CLOSED re-verified, RT2 applied; RT3-RT7 no distinct findings.

---

# Code Review: mvp-account-matching — Round 2
Date: 2026-07-24

## Changes from Previous Round
All 22 round-1 findings fixed and verified. Round-2 incremental review of the fix diff surfaced 8 new findings (2 introduced by round-1 fixes).

## Round-2 Findings & Resolution
- CF6 Major (introduced by CF1 fix): APP_ORIGIN not URL-validated → new URL() 500 on misconfig. FIXED: env.ts APP_ORIGIN = z.string().url() (startup fail-fast).
- CF7 Minor / CS7-A Minor (introduced by D8 fix; convergent functionality+security): account-bucket Map unbounded growth (memory-DoS). FIXED: per-window lazy sweep in account-bucket.ts + eviction unit test.
- CF8 Minor: hr-import warnings shape not in api-types (CF5 carryover). FIXED: HrImportResponse single-sourced in @open-smp/api-types, wired into hr-import.ts.
- CT13 Major (RT8): account-bucket 429 test didn't prove login halted. FIXED: added correct-password 21st-attempt test asserting 429 + no session cookie + zero sessions rows.
- CT14 Minor [Adjacent]: ambiguous candidates shape untested at worker level. FIXED: match.integration.test.ts asserts persisted evidence.candidates {identityId, displayName} pairs.
- CS1/CS2/CS3-A/CS4-A/CT2-fix: all verified correct by the security expert (preHandler 429 empirically proven to halt login; enumeration-resistance preserved).
- R43 boundary-widening review: CF1's conditional Secure flag assessed as operator-gated (APP_ORIGIN is server config, not attacker-influenced), CSRF defense is the independent unconditional Origin gate — acceptable, not a widening. All other fixes narrow boundaries.
- Process finding (security expert): .claude/settings.json (a sub-agent permission-grant residue) had leaked into commit f003866. REMOVED and gitignored.

## Recurring Issue Check (Round 2)
### Functionality: R43 checked (no widening); RS2 re-verified enforced; R33/R39/R42/R44 clean in diff.
### Security: RS2 both limits now genuinely independent+enforced; RS1/RS3-RS6 not implicated; R43 full review done (CF1 acceptable); R2 constants centralized.
### Testing: RT8 recurred (CT13) → fixed; RT9 clean (no new twin); RT1-RT7 no recurrence (real Testcontainers, own-tenant isolation, falsifiable assertions).

---

# Code Review: mvp-account-matching — Round 3 (verification)
Date: 2026-07-24

## Changes from Previous Round
Round-2 fixes (CF6, CF7/CS7-A, CF8, CT13, CT14, config removal) reviewed incrementally.

## Result
All three experts returned **No findings**. Review loop converged at round 3 of 10.

Key verifications:
- CF7 sweep: deletion predicate (resetAt <= t) is identical to the handler's own expiry check → cannot evict an active bucket → no rate-limit-evasion bypass introduced (security).
- CT13: red-provable halt-proof (correct password on 21st → 429 + no cookie + 0 sessions rows) (testing).
- CF6/CF8/CT14: functionally consistent, no field drift, round-1 fixes intact (functionality).
- R43: no boundary widening across any round-2 fix.

## Environment Verification Report
| Path | Classification | Evidence |
|------|----------------|----------|
| V1a — GWS fixture connector tests | verified-local + verified-CI | packages/connectors/google-workspace/test/list-users.test.ts; run in CI `checks` job |
| V1b — GWS live-tenant | blocked-deferred | docs/manual-tests/google-workspace-sync.md (run-log empty); links Phase-1 V1 + its Anti-Deferral cost-justification (paid sandbox not justified pre-release) |
| V2 — Postgres RLS cross-tenant | verified-local + verified-CI | packages/schema/test/rls.integration.test.ts, Testcontainers postgres:16; CI `integration` job; ran locally 63/63 green |
| V3 — BullMQ/Redis | verified-local + verified-CI | apps/worker/test/*.integration.test.ts, redis:7; same CI job |
| V4 — Next.js UI E2E | blocked-deferred | no E2E infra (SC8); docs/manual-tests/ui-orphan-list.md (run-log empty); links Phase-1 V4 + SC8 |
| T6 — compose smoke (NFR1/C8 seeded demo) | verified-local + verified-CI | ran live locally: seed exit 0, per-status counts 1/1/1/1, login 200, login-CSRF 403; CI `compose-smoke` job (now gated on integration per CT-CI1) |
| M1 — real-tenant precision ≥0.90, 0 Critical mislinks | blocked-deferred | bar locked in plan; execution post-implementation by design (does not gate); links Phase-1 M1 |

No blocked-deferred path lacks a Phase-1 constraint link (no process failure).

## Total findings across Phase 3
- Round 1: 22 (CS1/CF1/CT2/CT6/CT11 Critical; CF2/CF3/CS2/CT1/CT3/CT7/CT-CI1 Major; rest Minor). CT2 surfaced a real production bug (S12 account bucket never fired).
- Round 2: 8 (CF6/CT13 Major; CF7/CS7-A/CF8/CT14 Minor; CF1-widening assessed acceptable; leaked config removed).
- Round 3: 0 — converged.
All findings resolved; zero Skipped/Accepted/Deferred (Anti-Deferral log empty).

---

# Post-Round-3 live fix: D9 (numeric confidence coercion)
Manual compose smoke (user) hit a 500 on /accounts: numeric(3,2) confidence returned by pg as a string broke the UI's toFixed(). Fixed in apps/api/src/routes/accounts.ts (Number() coercion + corrected row type) with a typeof-number regression test. This is an R40/RT1 cross-boundary-shape defect that presence-only integration assertions and hand-built unit fixtures could not catch — surfaced only by a real-DB round-trip through the real consumer. Does not reopen review (single localized fix + regression test, verified live); recorded as deviation D9.
