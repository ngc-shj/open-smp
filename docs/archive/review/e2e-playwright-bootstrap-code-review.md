# Code Review: e2e-playwright-bootstrap

Date: 2026-07-25
Review round: 3 (converged — see round history below)

---

# Round 2 (fix verification + delegated-round-1 testing scrutiny)

Diff reviewed: `200fd48..HEAD` (review(1) commit accfb27).

## Round-2 Findings

**Functionality: No findings.** All four fixes verified: the F1 catch covers both the `newContext` throw and any `ctx.get` rejection with no context-leak path (inner `finally` disposes before the outer catch); F2's removal is behavior-neutral on the non-oversized path and the new comment matches installed v10 semantics; the strengthened CSV parsing splits on the line ending the producer actually emits (`csv-export.ts:73` joins with `\r\n`); the events `.or()` idiom is correct and remains falsifiable.

**Testing: 1 Minor (TEST-R2-F1), fixed.** The round-2 agent ALSO delivered the independent scrutiny the cancelled round-1 agent never did, and its finding invalidates part of the orchestrator's own TEST-F2 fix:
- **TEST-R2-F1 — `events.spec`'s `.or()` never falsifies the empty-state branch**: `<thead>` renders unconditionally (`events/page.tsx:40-47`), so `columnheader 'Source'` always matches and the OR always resolves via branch one — deleting or breaking the "No events yet." empty state would not fail the test, despite the test's name promising both-state coverage.
  → **Fixed**: the unconditional header set is now asserted directly (all four columns, exact match), the body check became `tbody tr` first-row visibility (a real discriminator between a rendered and a broken body without pinning a count), and the test was renamed to match what it actually proves. **Red-proof executed** on a throwaway worktree: adding a non-existent `Tenant` column makes it fail on that exact locator.

Independently verified clean by the round-2 testing agent (evidence in its report): cross-spec state cannot break ordering or repeat runs — `hr-import` only upserts `identities` and the matcher never creates accounts, so E9xx fixtures cannot alter `?status=orphan`'s single row; `labeling.spec`'s teardown is robust because `page.goto` against an RSC page discards any open-editor client state; `session-expiry`'s status-only assertions are sufficient because the session `preHandler` throws before any handler body runs (structural fail-closed, RT8-equivalent); `apps.spec`'s zero-request listeners are attached pre-click; `accounts.spec`'s `toHaveCount(0)` on `matched:` sits on a real mutually-exclusive ternary in `EvidencePopover`; RT1–RT9 all pass.

## Round-2 Deferred Item

**SC-CR1 — `quoteCsvCell` does not escape embedded newlines (pre-existing, latent)** — Skipped this round.
- **Anti-Deferral check**: out of scope (different feature) — a `csv-export.ts` correctness issue predating this plan, surfaced incidentally while verifying the test's CSV parsing.
- **Justification**: Worst case — a label note containing a literal newline produces a CSV whose quoted field spans lines; RFC 4180 readers handle this correctly (the field is quoted), so spreadsheet import is fine; the naive `split('\r\n')` in the E2E assertion would fragment such a row, and any downstream line-oriented consumer would misparse. Likelihood — low today: the only user-writable field reaching the export is `account_labels.note`, and the label UI uses a single-line `<input>`, which cannot contain a newline; the API's zod schema permits one, so a direct API caller could create one. Cost to fix — small (~10 LOC + test) but it belongs with the labeling-v2 cycle that already owns note semantics (SC12/SC13/SC15), where the input-vs-API asymmetry should be settled as a whole (reject newlines at the boundary, or escape at export).
- **Tracker**: `TODO(labeling-v2): reject or escape newlines in account_labels.note — see e2e-playwright-bootstrap-code-review.md SC-CR1`. Recorded here and carried into the next cycle's plan input.
- **Orchestrator sign-off**: out-of-scope exception satisfied — tracked with a grep-able marker, no security control left fail-open (the export is already S4-neutralized against formula injection, which is the security-relevant property).

## Round-2 JSON indexes (raw)

Functionality: `[]` · Testing: 1 Minor (TEST-R2-F1, resolved above).

---

# Round 3 (verification-only — CONVERGED)

Round-3 scope: the round-2 delta is one spec file (`e2e/specs/events.spec.ts`) plus review documentation. Functionality returned No findings on the production state, which round 3 does not touch; security returned No findings in round 1 and neither round-2 nor round-3 altered any security surface (no production code, no CI, no fixtures). The testing perspective — the only one with an open finding — verified its own fix inline:

- **Testing: No findings.** The fix implements the reviewer's own recommendation (assert the unconditional header directly rather than hiding it behind an OR), extends it to all four columns, replaces the vacuous OR with a `tbody tr` discriminator, renames the test to match what it proves, and is backed by an executed red-proof (non-existent `Tenant` column → red on that locator). Full suite re-run green (27/27) after the change.

**Convergence declaration**: all three perspectives are at "No findings" against the final tree. **Code review converged at round 3.**

---

# Round 1 (initial)

Review round: 1 (fixes applied)
Diff base: `bb5f4c4` (plan + checklist commits); implementation `d5b57d6` + docs `200fd48`
Merge method: manual (Ollama unavailable all session — seeds skipped, experts ran full-diff review)

## Changes from Previous Round

Initial review. Round 1 ran as incremental verification on top of the Phase 2 Step 2-5 self-R-check baseline (all three experts: No findings).

## Functionality Findings

**FN-F1 — Major — a corrupt `e2e/.auth/state.json` crashed the entire suite instead of falling back to login** (`e2e/global-setup.ts:61-70`)
`request.newContext({ storageState })` throws synchronously on unparseable JSON, and that call sat OUTSIDE the function's `try` (which wrapped only `ctx.get`/`dispose`). With no catch anywhere in the chain the `SyntaxError` propagated out of `globalSetup`, aborting the run before any spec — precisely defeating the reuse-with-fallback design D4 introduced. Reachable in practice: a killed run, a disk-full write, or a concurrent job can leave the cache half-written between runs. The expert verified the throw empirically.
→ **Fixed**: the probe body is wrapped in try/catch; any error means "no usable session" → fresh login. **Verified live**: with `state.json` deliberately corrupted (`not json{{{`), the suite now re-logs-in and passes 27/27.

**FN-F2 — Minor ([Adjacent]) — dead `file.file.truncated` branch under @fastify/multipart v10** (`apps/api/src/routes/hr-import.ts:132-134`)
Verified against the installed `@fastify/multipart@10.1.0` source: `toBuffer()` throws `FST_REQ_FILE_TOO_LARGE` from inside its read loop whenever truncation occurs, and `throwFileSizeLimit` defaults to `true` (the app never overrides it, `app.ts:37`). Control can therefore never reach the truncated-flag check with the flag set — D3's own diagnosis applied in reverse but the superseded branch was left behind.
→ **Fixed**: branch removed; the comment now states why a post-`toBuffer()` truncated check would be unreachable.

Verified clean (no action): 10 MB boundary semantics identical on both layers (client `>` vs busboy `>` at the same constant — `busboy/multipart.js:196`); the client-check/server-path test layering is coherent and two-tiered (e2e covers the client pre-check in a real browser, the API integration test covers the server mapping via `app.inject`); `sync.spec`'s zero-`/api/match` assertion is structurally sound (SyncControl is sequential `await` code — a failed sync throws before the match fetch is ever reached, so the window is closed before the assertion runs); every file in the plan's Implementation Checklist appears in the diff.

## Security Findings

**No findings.** Independently verified (reading bytes, not summaries): `assert-seed-preserved.sh` uses `mktemp` for both the cookie jar and the response file with a single `trap … EXIT` covering success and failure under `set -euo pipefail`; the login response body is echoed only on non-200 and never contains the session token (it lives in `Set-Cookie` → the temp jar); no shell injection (double-quoted bash interpolation does not re-expand), with JSON-malformation-on-future-change noted as dormant hygiene matching the plan's own SEC-E1 acceptance; the `hasValidSavedSession` probe reads only `res.ok()`; `e2e-import-sjis.csv` hex-dumps to exactly one non-ASCII field (Shift-JIS 山田) in 98 bytes; the client size check is UX-only with the server authoritative; the artifact upload path (`e2e/playwright-report/`) cannot contain `e2e/.auth/state.json`, and `git ls-files e2e/.auth/` is empty across all history.

Informational (no action): the demo password reaches `ps` for the lifetime of the `curl -d` process — standard curl behavior, a fixed non-production literal already committed in `seed.ts`, ephemeral runners. Proportionate.

## Testing Findings

The delegated testing reviewer was cancelled mid-run; the orchestrator performed this perspective directly against the reviewer's seven assigned focus items.

**TEST-F1 — Minor — CSV export assertions were falsifiability-weak** (`e2e/specs/accounts.spec.ts:89-92`)
`expect(csv).toContain('label')` also matches `labelNote`, so dropping the `label` column entirely would have passed; `expect(csv).toContain(status)` matched anywhere in the file (header included), not the account's own row.
→ **Fixed**: header cells asserted exactly (`"label"` / `"labelNote"`), and the status is asserted on the row that contains the account's email. **Red-proof executed** on a throwaway git worktree (never on the real tree): with the `label` column stripped from the downloaded CSV the strengthened assertion fails with `Expected substring: "\"label\"" / Received: …,"candidates","labelNote"` — the exact regression the old form let through.

**TEST-F2 — Minor — `events.spec` raced the render** (`e2e/specs/events.spec.ts:10-12`)
`isVisible().catch(() => false)` is an immediate, non-waiting check on both branches, so a slow render could report false/false and fail spuriously (or, with a different page state, pass for the wrong reason).
→ **Fixed**: replaced with an or-locator (`columnheader 'Source'` OR `'No events yet.'`) under a single web-first `toBeVisible()`, so Playwright auto-waits for whichever branch renders.

Verified clean (no action): the freshness assertion is regex-based (`/Data as of|No sync data yet/`) and pins no timestamp, so repeat runs and matcher-driven `computed_at` churn cannot destabilize it; `import.spec`'s re-upload case performs both uploads inside one test (self-contained, not cross-run dependent); `session-expiry`'s three cases each clear cookies on their own context and only then act, and the server session is untouched so later specs' contexts remain valid; a fresh CI stack has no `state.json` → login, and a stale one whose sessions table was recreated fails the probe → re-login (both paths now additionally guarded by FN-F1's catch); the 8 specs match C16's contracted assertions.

## Adjacent Findings

FN-F2 (functionality → API production code) — fixed in the same round. No unrouted adjacents.

## Quality Warnings

None (manual screen; every finding cites file:line and was reproduced or verified against installed sources).

## Environment Verification Report

Phase 1 constraints: VE1 (live GWS sync), VE2 (no browser E2E — **this plan resolves it for the covered flows**), VE3 (Testcontainers), VE4 (E2E needs the compose stack).

| Contract / path | Classification | Evidence |
|---|---|---|
| C15 harness (config, global-setup, fixtures, gate separation) | verified-local | suite boots; `vitest --list` shows zero `e2e/` entries; `git ls-files e2e/.auth/` empty |
| C16 8-spec suite | verified-local | `pnpm test:e2e` 27/27 green, twice consecutively; labeling.spec alone green (T-E3) |
| C16 seed preservation (N6) | verified-local | `e2e/scripts/assert-seed-preserved.sh` green after the suite (4 statuses + orphan label null) |
| T-E1 red-proofs | verified-local | (a) stack stopped → `StackNotRunningError` naming the compose command; (b) throwaway wrong-assertion spec → red, deleted; (c) NEW this round: label-column-drop → strengthened CSV assertion red |
| FN-F1 fix (corrupt state fallback) | verified-local | corrupted `state.json` → suite re-logs-in, 27/27 |
| C17 CI wiring | blocked-deferred → no git remote (predecessor constraint) | every job step executed locally with identical commands (parity by construction); `docs/archive/review/e2e-playwright-bootstrap-manual-test.md` is the first-CI-run checklist (R35 Tier-2 artifact) |
| Live GWS sync | blocked-deferred → VE1 | unchanged; sync.spec covers only the failure path, which is locally testable |

## Resolution Status

### FN-F1 Major — corrupt state.json aborted the suite
- Action: try/catch around the whole probe; any error → `false` → fresh login.
- Modified file: `e2e/global-setup.ts:61-76`

### FN-F2 Minor — dead truncated branch
- Action: branch removed, comment corrected.
- Modified file: `apps/api/src/routes/hr-import.ts:117-131`

### TEST-F1 Minor — weak CSV assertions
- Action: exact header cells + per-row status assertion; red-proof executed on a throwaway worktree.
- Modified file: `e2e/specs/accounts.spec.ts:87-100`

### TEST-F2 Minor — racing visibility checks
- Action: or-locator with a single web-first assertion.
- Modified file: `e2e/specs/events.spec.ts:7-15`

Post-fix gates: `pnpm lint` / `pnpm typecheck` / `pnpm test:unit` (99) / `pnpm test:integration` (89) / `pnpm test:e2e` (27) / `assert-seed-preserved.sh` — all green.

## Round-1 JSON indexes (raw)

### Functionality
```json
[
  {"id":"F1","severity":"Major","file":"e2e/global-setup.ts","line":61,"title":"hasValidSavedSession does not catch request.newContext throw on corrupt state.json — aborts the whole suite instead of falling back to login","adjacent":false,"escalate":null},
  {"id":"F2","severity":"Minor","file":"apps/api/src/routes/hr-import.ts","line":132,"title":"file.file.truncated branch is dead code under @fastify/multipart v10 defaults","adjacent":true,"escalate":null}
]
```

### Security
```json
[]
```

### Testing (orchestrator-performed after the delegated reviewer was cancelled)
```json
[
  {"id":"TEST-F1","severity":"Minor","file":"e2e/specs/accounts.spec.ts","line":89,"title":"CSV assertions falsifiability-weak: toContain('label') matches labelNote; status matched anywhere in file","adjacent":false,"escalate":null},
  {"id":"TEST-F2","severity":"Minor","file":"e2e/specs/events.spec.ts","line":10,"title":"isVisible().catch(false) on both branches races the render instead of auto-waiting","adjacent":false,"escalate":null}
]
```
