
## D3 — Production bug found and fixed: over-limit upload 500 "Premature close" (essence-shift, fix-now)

The plan declared "no app-code changes", but the oversized-upload spec surfaced a REAL shipped bug: @fastify/multipart v10 rejects `toBuffer()` with `FST_REQ_FILE_TOO_LARGE` at the fileSize limit; unhandled, an ~11 MB browser upload through the Next proxy died as HTTP 500 `ERR_STREAM_PREMATURE_CLOSE` instead of the documented 400 — C12's over-limit error mapping was unreachable dead code for real browsers, and the manual script's oversized scenario had evidently never been executed end-to-end. Fix (Anti-Deferral: pre-existing bug in a diff-adjacent feature, fixed now): (a) `apps/api/src/routes/hr-import.ts` maps `FST_REQ_FILE_TOO_LARGE` → 400 `file exceeds 10MB limit` (narrow catch, rethrow otherwise); (b) `apps/web/src/app/import/page.tsx` adds a client-side `file.size` pre-check producing the same mapped error deterministically (a server-aborted mid-stream 400 does not reliably survive the proxy); (c) regression tests at BOTH tiers — new API integration case (11 MB multipart → 400; integration suite now 89) and the e2e oversized spec. This is the E2E tier catching exactly the class of bug it was built for, on its first day.

## D4 — global-setup reuses a still-valid saved session (login-budget hardening)

T-E2's twice-consecutive requirement failed on first attempt: back-to-back runs (plus a preceding single-spec run) stacked login POSTs inside the 5/min/IP window and the second run's setup login 429'd (observed via waitForURL timeout + API 429 logs). Fix: global-setup probes `e2e/.auth/state.json` with an authenticated GET and skips the login when the session is still valid (24 h sliding TTL makes reuse correct). Verified: two immediate consecutive full runs green; a third immediate run 429s auth.spec's real-login test as the production limiter intends — documented in e2e-howto.md as a ~60 s wait guideline, not a suite defect.

## D5 — Spec fixes for two Playwright/Next environment realities

- `getByRole('alert')` collides with Next.js's route announcer (`<div role="alert" id="__next-route-announcer__">`) under strict mode — all alert assertions now use `.filter({ hasText: ... })` (or a non-empty-text filter).
- `browser.newContext()` in @playwright/test inherits the config's contextOptions INCLUDING storageState, so the "fresh context = logged out" assumption in the unauthenticated-redirect spec was false (the test stayed authenticated on /accounts). Fixed with `test.use({ storageState: { cookies: [], origins: [] } })`.

## D6 — Interrupted implementation agent; orchestrator completed by hand (process)

The Phase-2 implementation agent initially delegated to an unauthorized background child (producing nothing but a race artifact — a duplicated workspace line — and a spurious "orchestrator has taken over" stop message to its parent), and its corrected run was cut off by a session restart. The orchestrator finished the remaining ~15% directly: nested `e2e/e2e/.auth/` live-cookie file from a cwd-relative STORAGE_STATE_PATH (fixed to module-absolute resolution — the nested copy escaped the anchored .gitignore pattern), leftover `zz-debug.spec.ts` removed, playwright-report/test-results gitignored, plus all D3–D5 fixes and every verification gate.

## D7 — Round-1 testing reviewer cancelled; perspective covered in two passes (process)

The delegated round-1 testing agent was cancelled mid-run (user-side stop, not a crash). The orchestrator performed that perspective directly against the agent's seven assigned focus items and applied two fixes (TEST-F1 CSV assertion strength, TEST-F2 events race). Round 2's testing agent was then briefed to deliver BOTH fix-verification and the independent scrutiny the cancelled agent owed — it did, and found that the orchestrator's own TEST-F2 fix was structurally vacuous (unconditional `<thead>` meant the `.or()` never falsified the empty-state branch). That finding was fixed with a red-proof. Lesson recorded: an orchestrator self-performed review perspective is weaker than an independent one and should be re-delegated at the next opportunity rather than treated as closed — doing so here caught a real defect in the orchestrator's own patch.

## D8 — SC-CR1 carried to labeling-v2: newline escaping in CSV export

`quoteCsvCell` escapes `"` but not embedded newlines; a label note containing one would span lines in the export. Not reachable through the UI today (single-line `<input>`) but permitted by the API's zod schema. Deferred with a full Anti-Deferral entry in the code-review doc (SC-CR1) and a grep-able TODO marker; belongs with labeling-v2, which owns note semantics.
