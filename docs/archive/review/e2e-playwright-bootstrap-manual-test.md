# Manual Test Plan: e2e-playwright-bootstrap (R35 — CI/CD workflow change)

Deployment artifact in diff: `.github/workflows/ci.yml` (compose-smoke job gains the Playwright E2E gate). The repo has NO git remote, so the workflow cannot execute in CI yet — every step below was executed LOCALLY with the identical commands the job runs (C17's parity-by-construction), and this plan doubles as the first-CI-run checklist for when a remote is added.

## Pre-conditions

- Docker running; repo at the plan's implementation commit.
- No stale login-rate-limit state: no more than 2 full suite runs in the last minute (see e2e-howto.md rate-limit note).

## Steps (mirror of the CI job, run locally)

1. `docker compose up -d --build` and `docker compose wait seed` — all services healthy, seed exits 0.
2. `pnpm install --frozen-lockfile`
3. `pnpm exec playwright install --with-deps chromium` (first run only)
4. `pnpm test:e2e`
5. `bash e2e/scripts/assert-seed-preserved.sh`
6. Repeat step 4 immediately (T-E2 twice-consecutive).

## Expected results

- Step 4: 27/27 specs pass (observed: 27 passed, ~4.5 s).
- Step 5: four seeded emails report their original statuses, orphan label null, script exits 0 (observed).
- Step 6: 27/27 again with ZERO additional login POSTs from global-setup (session reuse; observed).
- Failure mode check: with web+api stopped, step 4 fails fast with `StackNotRunningError` naming the compose command (observed — T-E1a).

## Rollback

The workflow change is additive steps in one job; revert = `git revert` of the implementation commit. No infrastructure state to unwind (artifacts expire in 7 days; browsers are per-runner ephemeral).

## Adversarial scenarios (Tier-2)

- **Artifact credential capture**: on a forced failure, the uploaded `playwright-report/` may contain traces/screenshots showing the typed demo password. Posture accepted ONLY because the credential is already committed plaintext (seed.ts/ci.yml); retention bounded at 7 days; the acceptance explicitly does NOT transfer to any non-demo stack (plan C17). Verified the report path (`e2e/playwright-report/`) does NOT include `e2e/.auth/state.json` (live cookie) — separate directory, gitignored, `git ls-files e2e/.auth/` empty.
- **Gate evasion**: `continue-on-error` is absent from the e2e steps (forbidden pattern) — a failing suite fails the job; `.only(` in specs is grep-banned so a committed focus cannot silently shrink CI coverage.
- **Rate-limit interplay under CI retry**: worst case per CI run = 1 setup login (first run of the day on a fresh runner) + 2 auth.spec logins + ≤2 retry logins = 5 ≤ 5/min limit; session reuse keeps retried setups at 0. A 429 mid-suite fails loudly (asserted error text mismatch), never passes vacuously.
- **Cross-tenant/session**: the suite authenticates only the demo tenant; session-expiry specs clear browser cookies without touching server sessions (no fixation surface — no pre-auth session exists in this codebase, per plan review SEC-E7).
