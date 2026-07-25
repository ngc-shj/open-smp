# Plan: e2e-playwright-bootstrap

Date: 2026-07-25
Branch: `feature/e2e-playwright-bootstrap` (based on `main` @ 3846d2a — both predecessor feature branches are now merged; this is the first plan branched from an up-to-date `main`.)
Predecessor plans: `mvp-account-matching` (C1–C9, SC1–SC11) and `import-labeling-saasapp-ui` (C10–C14, SC12–SC16). Contract numbering continues at **C15**, scope-outs at **SC17**. This plan EXECUTES the deferred **SC8** (E2E browser test infrastructure) — its named owner is this very plan (`e2e-playwright-bootstrap`), and its un-defer trigger ("next plan that adds or materially modifies a page") has fired: the next cycle (identity detail page SC11, apps admin UI SC14, labeling-v2 SC12/13/15) adds at least three UI surfaces.

## Project context

- Type: `web app + service` (pnpm monorepo — Fastify API, BullMQ worker, Next.js 15 web, Postgres 16 RLS)
- Test infrastructure: `unit + integration` (Vitest + Testcontainers) `+ CI/CD` (GitHub Actions; 5 gates incl. a compose-smoke job that already boots the full stack and drives curl checks). **This plan adds the E2E tier.**
- Verification environment constraints:
  - **VE1** *(carried)* — live Google Workspace sync needs a real GWS tenant → any spec exercising a real connector sync is out of scope (`blocked-deferred`, unchanged).
  - **VE4** *(new)* — E2E specs require the docker compose stack running and seeded (`docker compose up -d --build` + seed service exited 0). Local runs and the CI job both satisfy this; the specs are `verifiable-local` AND `verifiable-CI`. Without Docker the E2E suite cannot run — it is deliberately NOT part of `pnpm test:unit`/`test:integration`.
  - **VE2** *(predecessor)* — RESOLVED BY THIS PLAN for the covered flows. Residual manual-only paths are enumerated per spec contract (C16) and in SC17.
- Concurrency probe assessment: no new concurrency-control primitive; Playwright specs run with `workers: 1` against a shared stateful stack (see C15 invariants), which sidesteps intra-suite write races by construction. No plan-stage DB probe required.

## Objective

Stand up a Playwright E2E tier that automates the browser-level flows currently covered only by the four manual scripts (`docs/manual-tests/ui-*.md`), wired into CI on the already-booted compose stack — eliminating the ~45–60 min/change manual burden ahead of the next UI-heavy cycle.

## Requirements

Functional:
- F1: `pnpm test:e2e` runs the Playwright suite against a running, seeded compose stack and passes deterministically, including on REPEATED runs against the same stack (idempotent specs — no reset required between runs).
- F2: The suite (8 specs) covers: login/auth flows; accounts list + status filter + evidence popover + ambiguous candidates + column/freshness smoke + CSV export content; labeling set/survive-rematch/CSV-injection/clear; HR CSV import (happy, re-upload idempotency, row-errors, non-UTF-8, oversized); SaaS-apps list + client-side validation + duplicate-409 + credential-leak DOM check; sync failure path + match gating; session-expiry redirect across all three mutation flows; and a render smoke for every page. Coverage disposition is complete: every scenario in the four manual scripts is either automated (C16), deferred with a justified SC entry (SC17/SC22), or recorded as not-applicable (logout — no UI affordance) — zero silent drops (round-1 TEST-F-1).
- F3: CI runs the suite in the existing compose-smoke job (single stack boot, R33 single-workflow) and fails the build on any spec failure.

Non-functional:
- N6: Specs are order-independent and self-cleaning — any spec may run alone or after any other, and a full-suite run leaves the seed acceptance bar intact (≥1 orphan AND ≥1 ghost still present; the seeded demo dataset's link statuses for the four seeded accounts are unchanged at suite end).
- N7: No fixed sleeps — Playwright auto-waiting and `expect(...).toPass`/web-first assertions only (forbidden pattern below).
- N8: Selectors are role/label/text-based (accessible queries); `data-testid` only where no accessible query can disambiguate, and each such addition is enumerated in the spec contract.
- N9: The E2E tier is invisible to the existing unit/integration gates: vitest picks up nothing under `e2e/` (spec suffix `.spec.ts` + directory outside the vitest globs), `pnpm lint`/`typecheck` cover the new package with the existing flat config.
- N10: No real credentials anywhere; specs reuse the seed's fake service-account shape for negative-path input (RS4).

## Technical approach

- **Target = compose stack, not dev servers.** The stack (`postgres`, `redis`, `api` :3001, `worker`, `web` :3000, `seed`) is production-like, already boots in CI (compose-smoke), and the seed (`apps/api/src/seed.ts`) is idempotent and deterministic: exactly 4 accounts with one of each link status (`matched`=alice, `ghost`=bob, `ambiguous`=shared-mailbox, `orphan`=unknown-contractor), demo login `demo` / `admin@demo.example` / `demo-admin-password`. Specs assert against these stable facts.
- **New workspace package `e2e/`** (added to `pnpm-workspace.yaml`): `@playwright/test` + config + specs + fixtures. Chromium only (MVP; matrix later). Not a vitest project; `playwright.config.ts` with `baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000'`, `workers: 1`, `retries: 0` locally / `1` in CI, trace `on-first-retry`.
- **No webServer auto-boot** in the Playwright config: the stack lifecycle belongs to compose (locally: `docker compose up -d --build` first; CI: the job already booted it). A tiny readiness helper polls `/healthz` + login-page render before the suite (global setup), failing fast with a clear "stack not running" message.
- **Data strategy — namespace + self-clean**: import fixtures use employee IDs `E9xx` and emails `e2e-*@demo.example` that (a) collide with no seed identity/account and (b) match no seeded account under ANY of the matcher's FOUR rules (round-1 FN-F2 — the original two-rule analysis missed `nameDomainRule`, which matches on displayName + email DOMAIN alone and ignores local parts): fixture `name` values MUST NOT equal any seeded account's `display_name` ("Alice Tanaka", "Bob Suzuki", "Shared Mailbox", "Unknown Contractor") — fixtures use the distinct prefix style `E2E Import Row One/Two/Three`, and the fixtures module carries a comment cross-referencing `packages/matcher/src/rules.ts`'s `nameDomainRule` as the reason (same cross-ref pattern as the demo-credential note). Label specs label the seeded orphan and ALWAYS clear in the same spec (`try/finally`-equivalent via Playwright fixtures). The apps-registration happy path (201) is impossible against the seeded stack (seed already registered `google-workspace`; UNIQUE(tenant_id, key); no delete API until SC14) — E2E covers list/validation/duplicate-409 and the happy path stays on the manual script + API integration test (SC17).
- **Auth helper — single-login storageState design (round-1 FN-F1 Critical + TEST-F-2, converged)**: the login rate limits are live on the compose stack with no bypass (`LOGIN_IP_RATE_LIMIT` 5/min/IP, account bucket 20/hr — `rate-limits.ts`; `global: false` registration has no test-mode escape). A login-per-spec-file fixture (let alone Playwright's default per-TEST `test.extend` scope) blows both budgets under the twice-consecutive T-E2 requirement. Therefore: **global setup performs exactly ONE UI login** via the real `/login` form (the flow stays a covered surface) and saves Playwright `storageState` to `e2e/.auth/state.json` (gitignored); every spec context loads that storage state (zero further login POSTs). ONLY `auth.spec.ts` performs additional real form logins (valid + invalid = 2 POSTs). **Login budget arithmetic**: one full run = 1 (setup) + 2 (auth.spec) = 3 POSTs; T-E2's two consecutive runs = 6/hr vs the 20/hr bucket; worst 60-second window ≤ 3 vs 5/min IP; a CI retry of auth.spec adds ≤ 2. Headroom holds. **Session TTL (round-1 FN-F3)**: `SESSION_TTL_MS = 24 h` with sliding refresh on every authenticated request (`auth.ts:25,174`) — the suite's 2–4 min wall-clock cannot expire a shared session; verified against source, no per-file re-login needed.
- **CI**: extend the existing `compose-smoke` job — after the current curl gates, add `pnpm install` (already present in other jobs; compose-smoke currently has no Node setup — add pnpm/node steps), `pnpm exec playwright install --with-deps chromium`, `pnpm test:e2e`. Single stack boot serves both curl gates and E2E. Root `package.json` gains `"test:e2e": "pnpm --filter e2e test"`.

## Contracts

### C15 — E2E harness package (`e2e/`)

**Signatures / layout:**

```
pnpm-workspace.yaml            # + 'e2e'
package.json                   # + "test:e2e": "pnpm --filter e2e test"
.gitignore                     # + 'e2e/.auth/' — CONTRACT LINE, not prose (round-2 SEC-E8): state.json
                               #   holds a LIVE session cookie; T-E4 additionally asserts
                               #   `git ls-files e2e/.auth/` is empty so a tracked cookie fails the gate
e2e/package.json               # name "e2e", devDep @playwright/test (caret range ^1.x — the repo's
                               #   npm-dep convention; exact pins are for container images only — SEC-E5)
                               #   script "test": "playwright test"
e2e/playwright.config.ts       # baseURL env-overridable, workers: 1, chromium project only,
                               # globalSetup readiness check, retries: process.env.CI ? 1 : 0
e2e/global-setup.ts            # poll http://localhost:3001/healthz + GET / (web) until 200 or 60s → throw
e2e/global-setup.ts            # ALSO performs the single UI login and writes e2e/.auth/state.json
e2e/fixtures/auth.ts           # exports demo creds (env-overridable) + storageState path; NO per-spec login
e2e/fixtures/files/            # e2e-import.csv (E901..E903, e2e-*@demo.example), e2e-import-bad.csv,
                               #   e2e-import-sjis.csv (Shift_JIS bytes, generated once, committed)
e2e/specs/*.spec.ts            # C16
```

**Invariants:**
- *App-enforced*: `workers: 1` (shared stateful stack — parallel specs would race on tenant-global state like match runs); every spec passes standalone AND in full-suite order AND on a second consecutive full-suite run (F1/N6 — the idempotency triple); no spec depends on artifacts of another spec.
- *App-enforced*: demo credentials in the E2E tier are read from `E2E_DEMO_EMAIL` / `E2E_DEMO_PASSWORD` env vars with the current literals as in-code defaults in `e2e/fixtures/auth.ts` ONLY; the CI job exports them once as job-level `env:` so both the existing curl step and the Playwright step consume the same two values. Net literal sites: `seed.ts` (real code, canonical) + one default in `auth.ts`; `ci.yml`'s independent literal payload is replaced by the env refs. `seed.ts`'s "keep in sync" comment is updated to name the new sites. (Round-1 SEC-E1 — honest posture: single-source-of-truth by env plumbing, not by comment discipline.)
- *Config-enforced*: vitest cannot see the suite. Precise lock inventory (round-1 TEST-F-9): the `unit` project is locked twice (directory globs `packages/**`/`apps/**` exclude `e2e/`, AND `.spec.ts` ≠ `.test.ts`); the `integration` project's glob (`**/*.integration.test.ts`) has NO directory restriction, so its ONLY lock is the suffix (`.spec.ts` ≠ `*.integration.test.ts`). T-E4's `vitest --list` assertion is the mechanism that catches a regression on either project.
- **Member-set derivation (R42) — "every web page has at least one E2E render/smoke assertion"**: defining primitive `ls apps/web/src/app/*/page.tsx` → `login`, `accounts`, `events`, `import`, `apps` (5 pages; root `page.tsx` is a redirect stub covered transitively by the accounts smoke). C16's spec list must cover all 5; the plan reviewer recomputes.

**Forbidden patterns:**
- `pattern: waitForTimeout|page\.waitFor\(|sleep\(|networkidle` in `e2e/**` — reason: N7, fixed sleeps are the canonical flaky-test source (RT4-adjacent), and `networkidle` never settles reliably on pages with background polling (this app's import/sync pages poll — round-1 TEST-F-5); Playwright auto-wait + web-first assertions only. Soft review gate (not grep-enforced): any `{ timeout:` override in `e2e/specs/**` requires a same-line justification comment.
- `pattern: \.only\(` in `e2e/specs/**` — reason: a committed `.only` silently disables the rest of the suite in CI (vacuous green).
- `pattern: BEGIN PRIVATE KEY|iam\.gserviceaccount\.com|private_key_id` in `e2e/**` EXCEPT inside the single fixtures module `e2e/fixtures/fake-service-account.ts` — reason: RS4. STRUCTURAL gate, not lexical (round-1 SEC-E2): any spec needing SA-JSON-shaped input imports the one fixture constant (mirroring `seed.ts`'s `FAKE_SERVICE_ACCOUNT_CREDENTIALS`, `DEMO-NOT-A-REAL-KEY` marker) — ad-hoc hand-typed SA JSON in spec files is banned even when obviously fake, closing the substring-allowlist bypass.
- `pattern: postgres://|DATABASE_URL` in `e2e/**` — reason: E2E drives the system through the browser only; direct DB access in specs would bypass the boundary the tier exists to exercise (RT5 inverse: the browser IS the production primitive here).

**Acceptance criteria:** `pnpm test:e2e` fails fast with a clear message when the stack is down; passes twice consecutively against one seeded stack; `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration` all remain green and none of them execute any `e2e/` file.

### C16 — Spec suite

Specs and their per-spec acceptance (all use role/label/text locators; any `data-testid` addition to `apps/web` is listed here — currently expected: NONE, to be confirmed at implementation; if one becomes necessary it is added to this contract via the deviation log):

1. **auth.spec.ts** — valid login lands on `/accounts` (nav visible); invalid password shows the login error and stays; unauthenticated direct `GET /accounts` (fresh context, no storageState) redirects to `/login`. (The ONLY spec performing real form logins — 2 POSTs; everything else rides the global-setup storageState.)
2. **accounts.spec.ts** — seeded list shows all 4 accounts with their 4 distinct status chips (asserts each seeded email's row carries the right chip); column-set + freshness smoke: table headers match the shipped column set and the last-synced/freshness text renders (manual ui-orphan-list step 6); ghost row's evidence popover opens showing rule id + matched value (step 4); ambiguous row shows the candidate list and NO single identity name (step 5); `?status=orphan` filter shows exactly `unknown.contractor@demo.example`; CSV export yields a download whose header contains `label,labelNote` and whose rows include the 4 seeded emails with their status columns — **header + presence + status only, NO label-value assertions** (label state is transient across specs — round-1 FN-F5 order-shuffle safety).
3. **labeling.spec.ts** — on the orphan row: set kind "Service account" + note → chip appears after refresh; navigate to `/import`, Run matching → completed; back on `/accounts` the chip is still present (end-to-end C10 survival); **edit-note case (manual ui-labeling step 4 — round-2 T2-F-1)**: reopen the control on the already-set label, change ONLY the note, Save — chip kind unchanged, reopened note field shows the new text (the update path is a distinct branch from set-from-scratch); **CSV-injection check (manual ui-orphan-list step 7)**: while the label is set with a note beginning `=2+5`, export CSV and assert the note cell arrives neutralized with the leading `'` (S4 browser-level regression); then clear → chip gone. Teardown is CONDITIONAL (round-1 TEST-F-3): fixture teardown inspects the orphan row's label state (button shows a kind name vs plain "Label") and clears only when a label exists — a spec failing before Save must not cascade a teardown error masking the original failure.
4. **import.spec.ts** — upload `e2e-import.csv` (3 novel rows, display names `E2E Import Row *` per the name-domain constraint) → "3 imported, 0 skipped"; re-upload → same "3 imported" — asserting UPSERT-COUNT semantics (`imported` counts processed valid rows, not new rows — `hr-import.ts`; round-1 TEST-F-4, stated so the assertion is not coincidentally green); `e2e-import-bad.csv` → row-numbered error table; Shift_JIS fixture → mapped UTF-8 error; **oversized upload (manual step 7 — un-deferred, SC21 removed)**: generate an ~11 MB file at runtime into the OS temp dir (one Buffer write; the manual script's own one-liner proves generation is trivial) → mapped over-limit error renders; Run matching → completed with `/accounts` link.
5. **apps.spec.ts** — list shows the seeded "Google Workspace" app; duplicate registration (fake SA JSON imported from the single fixtures module) → 409 message; the two client-validation failure shapes — unparseable JSON (manual step 5) AND well-formed JSON missing `private_key` (manual step 6), both routed through the same `validateServiceAccountJson` guard (round-2 T2-F-2) — each show their inline validation error AND zero requests to `/api/saas-apps` — proof technique (round-1 FN-F4): attach `page.on('request')` BEFORE interacting, wait web-first for the visible inline error, THEN assert the captured request list is empty at that already-settled point (no timer race, no disguised sleep); **credential-leak DOM check (manual ui-saas-apps step 8)**: after both failure paths, assert page body text and captured console messages contain no `private_key` material outside the textarea's own value (dynamic backstop to C13's static greps). (Happy-path 201 out of scope — SC17.)
6. **events.spec.ts** — `/events` renders (header/table skeleton or the "No events yet." empty state) — content-agnostic smoke (no count assertion).
7. **session-expiry.spec.ts** — three 401-mid-flow cases, each: context from storageState → `context.clearCookies()` → action → lands on `/login`: (a) label save (C14), (b) CSV upload attempt (C12 upload branch), (c) Run matching (C12 match branch) — covers both `import/page.tsx` 401 branches a single label-save case would miss (manual ui-import step 8).
8. **sync.spec.ts** — on `/accounts`, click "Sync google-workspace" → sync FAILS (seeded credentials are fake — VE1's failure path is locally testable) → error phase renders, and match is NEVER triggered (C8 F6 gating: match only fires after sync completes) — manual ui-orphan-list step 8; afterward the 4 seeded chips are unchanged (a failed sync must not corrupt links).

**Invariants:** every spec independently passes against a fresh seeded stack (order-shuffle tolerant); suite end-state preserves the seed acceptance bar (N6) — verified by acceptance check below.

**Consumer-flow walkthrough:** the suite consumes only stable public surfaces: seeded demo data facts (4 emails + statuses + app display name — sourced from `seed.ts`, cross-referenced in a fixtures constants module), page routes, and UI text. Consumer 1 (CI job) reads the playwright exit code only. Consumer 2 (developers) read the HTML report artifact on failure (CI uploads `playwright-report/` on failure). No new API/DB shape is produced → no shape-consumer analysis beyond this.

**Acceptance criteria:** full suite green twice consecutively on one stack (local, Docker); after the second run, the seed-preservation check passes. **The seed-preservation check is AUTOMATED, not a manual curl gate (round-1 TEST-F-6)**: a small script `e2e/scripts/assert-seed-preserved.sh` (login via curl with a `mktemp`-created cookie jar removed on exit via `trap` — success AND failure paths, round-2 SEC-E9; `GET /api/accounts`, assert the 4 seeded emails carry their original statuses AND the orphan has `"label":null`) runs (a) locally as part of the Phase-3 gate and (b) as a CI step immediately after `pnpm test:e2e` (same curl-gate idiom `ci.yml` already uses for the orphan/ghost seed bar) — N6 is a load-bearing requirement and fails loudly in CI, not only under a human's eyeball.

### C17 — CI wiring + local runner

**Signatures:**

```yaml
# .github/workflows/ci.yml — compose-smoke job gains (after existing curl steps):
#   job-level env: E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD (single literal site in the job;
#     the existing curl login step switches to these env refs — SEC-E1),
#   pnpm/action-setup, setup-node (node 22, cache pnpm), pnpm install --frozen-lockfile,
#   pnpm exec playwright install --with-deps chromium,
#   pnpm test:e2e   (E2E_BASE_URL defaults to http://localhost:3000)
#   bash e2e/scripts/assert-seed-preserved.sh   (automated N6 gate — TEST-F-6)
#   upload-artifact playwright-report (if: failure(), retention-days: 7)
```

**Artifact-content posture (round-1 SEC-E3, Major)**: Playwright traces/screenshots on failure can capture the login form with the typed demo password (Playwright does not auto-mask password inputs). Accepted EXPLICITLY because this credential is already committed in plaintext (`seed.ts`, `ci.yml`) — the artifact adds a format, not a secret. Bounds and limits: `retention-days: 7` on the upload step (no inherited default); this acceptance does NOT extend to any future non-demo stack — a plan that points E2E at a staging/production-like environment MUST add trace redaction (masked fills / trace scrubbing) before reusing this job, and this sentence is the hook a reviewer cites when that happens.

- Job name stays `compose-smoke` (now "compose-smoke + e2e"; comment updated). Existing curl gates remain as fast-fail preludes (R44: each judged by its own exit status).
- Local: `docs/manual-tests/` gains a short `e2e-howto.md` (or README section) documenting: `docker compose up -d --build` → wait for seed → `pnpm test:e2e`; full reset via `docker compose down -v`.

**Invariants:** single workflow file (R33 — no duplicated config to drift); the playwright step runs AFTER the seed-wait step that already exists (`docker compose wait seed`); browsers install is scoped to chromium (`--with-deps chromium`).

**Forbidden patterns:**
- `pattern: playwright` in any NEW workflow file — reason: R33, the E2E steps live in the existing `ci.yml` only.
- `pattern: continue-on-error` in the e2e steps — reason: F3, a failing suite must fail the build.

**Acceptance criteria:** `extract-ci-checks.sh` (or direct read) shows the e2e gate present; the full CI gate set remains locally reproducible (the e2e steps are exactly the documented local flow). CI itself still cannot run (no remote — predecessor constraint, unchanged); the job is exercised for real when a remote is added (recorded, not silently assumed: local execution of the identical steps is this plan's evidence).

## Go/No-Go Gate

| ID  | Subject                                                   | Status |
|-----|-----------------------------------------------------------|--------|
| C15 | `e2e/` harness package, config, fixtures, workspace wiring | locked |
| C16 | 8-spec suite with idempotency + seed-preservation invariants (full manual-scenario disposition) | locked |
| C17 | CI compose-smoke job extension + local runner docs         | locked |

## Testing strategy

The deliverable IS a test tier; its own verification:

- **T-E1 (RT7 for the suite)**: prove the suite can fail — run one spec against a stopped stack (global-setup must fail with the clear message), and run the labeling spec with a deliberately wrong expected chip text on a throwaway copy (goes red). Both proofs executed on throwaway copies/scratch runs, never committed mutations.
- **T-E2 (idempotency triple, F1/N6)**: full suite twice consecutively on one seeded stack — both green; then `e2e/scripts/assert-seed-preserved.sh` passes (the same automated script CI runs — TEST-F-6).
- **T-E3 (isolation)**: run `labeling.spec.ts` ALONE on a fresh stack (proves no hidden dependency on import.spec having run).
- **T-E4 (gate separation, N9 + SEC-E8)**: `pnpm test:unit` and `pnpm test:integration` file lists contain zero `e2e/` entries (assert via vitest `--list` or run output inspection); lint/typecheck cover `e2e/`; AND `git ls-files e2e/.auth/` outputs nothing — the gate fails if the live-cookie state file were ever tracked (this is the check C15's `.gitignore` contract line references; round-3 SEC-E8 closure).
- Existing suites unchanged: unit 99 / integration 88 stay green.
- Manual: none new — this plan RETIRES manual re-runs for the covered flows; `docs/manual-tests/ui-*.md` each gain a header note stating which scenarios are now automated (and which remain manual-only, e.g. apps happy-path 201).

Gate before Phase 3: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration` green; compose stack up; `pnpm test:e2e` green **twice**; T-E1 red-proofs executed and recorded; seed-preservation check clean.

## Considerations & constraints

- **CI duration**: playwright install + chromium + suite adds ~2–4 min to compose-smoke. Accepted; browser caching is a follow-up (SC18).
- **Flake policy**: `retries: 1` in CI only. A spec that needs the retry to pass is a bug (investigate, don't normalize); locally `retries: 0` keeps flakes visible.
- **`workers: 1` scaling**: acceptable at 7 specs; per-spec tenant isolation (worker-scoped tenants via an admin API) is deliberately out (SC19) until a tenant-provisioning API exists.
- **Selector churn (R7)**: role/label locators track visible text; UI copy changes will break specs visibly and cheaply — accepted as the standard E2E tradeoff; no snapshot tests.

### Scope contract

| ID   | Deferred item                                                                  | Owner / trigger |
|------|--------------------------------------------------------------------------------|-----------------|
| SC17 | Apps-registration happy-path (201) E2E — impossible on a seeded stack (UNIQUE(tenant_id,key), no delete API). Covered today by API integration test T-S1 + manual script. | unlocks with SC14 (apps admin delete) in the next cycle |
| SC18 | CI browser caching (actions/cache for `~/.cache/ms-playwright`)                | future CI-tuning change |
| SC19 | Parallel E2E workers with per-worker tenant isolation                          | needs tenant-provisioning API; future |
| SC20 | Cross-browser matrix (firefox/webkit)                                          | future; chromium-only is the MVP bar |
| SC21 | ~~Oversized (>10 MB) upload E2E~~ — **UN-DEFERRED in round 1** (TEST-F-1: the original justification was fixture-generation cost, which the manual script's own one-liner disproves). Folded into import.spec.ts (runtime-generated temp file). ID retained for audit trail; no longer a deferral. | executed by this plan (C16 spec 4) |
| SC22 | Pagination / keyset-cursor E2E (`PAGE_SIZE=50`, "Load more") — infeasible against the 4-account seed; needs a >50-account fixture strategy | future plan that grows seed volume or adds a pagination fixture; trigger: any change to the accounts pagination code |
| — | Logout E2E: NOT a suite gap — no logout UI affordance exists (NavBar has none; only the API route). Recorded here so reviewers don't mistake it for a dropped scenario. When a logout button ships, its spec joins auth.spec.ts. | n/a (blocked on UI, not on E2E infra) |

## User operation scenarios

1. **Developer changes a UI page**: runs `docker compose up -d --build && pnpm test:e2e` locally (~2 min) instead of 45–60 min of manual scripts; a broken flow fails with a trace.
2. **CI on PR**: compose-smoke boots the stack once, curl gates fast-fail infra issues, then the browser suite validates the five pages' real flows; on failure the HTML report artifact pinpoints the step.
3. **Next cycle (SC11/SC14/labeling-v2)**: each new page/flow ships with its spec added to `e2e/specs/` — the R42 page member-set check makes a missing spec a review finding.
4. **Flake appears**: CI retry masks it once but the retry itself is the signal (report shows flaky); developer reproduces locally with `retries: 0` and fixes the root cause (no sleep-tuning — forbidden pattern blocks the lazy fix).

## Implementation Checklist

Step 2-1 (2026-07-25). CI parity: gates already enumerated (lint/typecheck/test:unit/test:integration/compose-smoke); this plan ADDS the e2e gate to compose-smoke — parity by construction (local flow = CI steps). Inventory: reuse `seed.ts` facts via a constants module in e2e/fixtures; no app-code changes AT ALL in this plan (forbidden: any diff under apps/ or packages/ except the comment-only seed.ts note; wiring files pnpm-workspace.yaml, package.json, .gitignore, ci.yml are expected).

Files to create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/fixtures/auth.ts`, `e2e/fixtures/fake-service-account.ts`, `e2e/fixtures/seed-facts.ts`, `e2e/fixtures/files/e2e-import.csv`, `e2e-import-bad.csv`, `e2e-import-sjis.csv`, `e2e/specs/{auth,accounts,labeling,import,apps,events,session-expiry,sync}.spec.ts`, `e2e/scripts/assert-seed-preserved.sh`, `e2e/tsconfig.json` (if needed for lint/typecheck coverage).

Files to modify: `pnpm-workspace.yaml` (+e2e), root `package.json` (+test:e2e), `.gitignore` (+e2e/.auth/), `.github/workflows/ci.yml` (compose-smoke job: env vars, node/pnpm setup, playwright install, test:e2e, seed-preservation step, artifact upload retention 7), `apps/api/src/seed.ts` (comment-only: extend keep-in-sync note), `docs/manual-tests/ui-*.md` (header notes: automated vs manual-only), + `docs/manual-tests/e2e-howto.md`.

Stack prerequisite: the currently-running compose stack carries a leftover manual label from an earlier session (orphan account labeled during a smoke test). Clean it with a targeted row delete (psql `DELETE FROM account_labels` for the demo tenant) or a full stack recreation per e2e-howto; the seed itself is idempotent, so `docker compose up -d --build` restores everything else. A full volume wipe (`docker compose down -v`) also works but is gated by a local destructive-op hook — the targeted delete is preferred.
