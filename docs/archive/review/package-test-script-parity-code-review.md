# Code Review: package-test-script-parity

Date: 2026-07-29
Review round: 1

## Changes from Previous Round

Initial review. Phase 2's Step 2-5 self-check had already run R1–R46 (+RS*/RT*) and its seven findings were fixed before this round, so this is incremental verification on top of that baseline.

## Seed Finding Disposition

Ollama seeds: **functionality — `No findings`**, **security — `No findings`**, **testing — three findings**. All three testing seeds cited line numbers 10–20 off from the code they described.

| Seed | Disposition |
|---|---|
| Strict stderr assertion is flake-prone; allow-list known-safe deprecation warnings | **Rejected.** The recommended fix is verbatim a C3 Forbidden pattern. The banner the assertion exists to catch is deprecation-shaped, so a deprecation filter swallows it first — and D1 established that this banner was the *only* evidence `pool: 'forks'` had never been in effect. The flake risk is real, already owned by VE5/D11, and pre-committed to a non-filter fallback. |
| Tight coupling to Playwright's JSON reporter | **Verified — adopted as T1, narrowed.** The diagnosis was right and the direction wrong: crashing on a renamed key is the *safe* direction. The unsafe one, which the seed did not name, is two silent-empty accessors below the spec level. Remedy narrowed from a schema validator (a second declaration of Playwright's shape, the `e2e/specs/` hardcode class C3 already rejects) to a reachability guard. |
| `pool` removal relies on vitest's default staying stable | **Rejected.** The actionable half is implemented and red-proven — C6's allowlist omits `pool`, so re-adding it in any spelling reds (M23a/M33). The residual, vitest's own default changing across a major, is not assertable from the config object and is SC51's stated trigger. |

## Convergence summary

17 findings, **0 Critical**, 8 Major. Two convergences:

| Merged | Severity | Raised by | Subject |
|---|---|---|---|
| **C1** | Major (2/3) | Func F3, Test T1 | The Playwright claimant is **file-granular** and its skip control has no reachability guard below the spec level. Two independent demonstrations: `--grep-invert "valid login lands"` → 42 tests in 9 files, gate green; renaming the `annotations` accessor with `test.describe.skip` applied → gate green. **Fourth vacuity site in this file.** |
| **C2** | Major (2/3) | Func F1, Sec 1 | Two more member sets enumerated by name-shape rather than derived: the `Dockerfile` deps-stage COPY list (missing `packages/api-types` and `e2e`; `--frozen-lockfile` is silent on a lockfile importer with no manifest, verified by `docker build --target deps` producing a dangling symlink) and control 6's canary allowlist (two files taken from the plan's motivating sentence, omitting `workflow-pins.test.ts` — the only thing preventing a mutable third-party action ref). **Sixth and seventh instances in this cycle.** |

## Functionality Findings

Re-derived the `pnpm --filter` class from the primitive rather than from the instance list and swept every CI-executed artifact: `pnpm -r <script>` is loud, `pnpm -C` is loud, `docker compose` service names are loud, `pnpm -r --parallel exec` excludes the workspace root. The one live member found is F1.

- **F1 — Major** — `Dockerfile:17-27`. The deps-stage COPY list omits two workspace manifests. Executed `docker build --target deps`: exit 0, no warning, `apps/api/node_modules/@open-smp/api-types` dangling. Today repaired by accident of stage ordering; the open failure mode is a future package with registry dependencies that never reach the deps layer, producing a green build whose container fails at boot.
- **F2 — Major** — `package-test-parity.test.ts:304`. Prefix-overlapping members cannot red the gate: `expected` and `observed` both apply `startsWith(dir + '/')`, so they are equal by construction for any nesting. Demonstrated by adding `packages/connectors/package.json` — which `pnpm-workspace.yaml`'s `packages/*` glob already matches — and observing 9/9 green while `pnpm -C packages/connectors test` ran both siblings' suites.
- **F3 — Major** — `package-test-parity.test.ts:351`. Playwright claimant reduces to a **file** set, so any narrowing leaving ≥1 spec per file is invisible. Merged into **C1**.
- **F4 — Major** — `package-test-parity.test.ts:326`. Control 2 re-derived package identity as `split('/').slice(0,-2)` while the enumerated member set was in scope. A test file at another depth produces a package name that does not exist; executed with `apps/api/test/sub/probe.test.ts`, the red named a phantom `apps/api/test`.
- **F5 — Minor** — `package-test-parity.test.ts:274`. C2's negative and residual clauses are gated on `scripts.test !== undefined`, so a non-member carrying only `test:integration` is examined by nothing — the `packages/queues` R41 verdict regenerated on the axis the tier split created.
- **F6 — Minor** — `vitest.config.ts:6`. Plan C3 contracted an explicit `testTimeout`; not implemented and not recorded as a deviation.
- **F7 — Minor, [Adjacent → Testing]** — `package.json:11`. `pnpm -r --parallel exec` excludes the workspace root (verified: 11 dirs, none of them the root), and there is no root `tsconfig.json`, so `vitest.config.ts` — a file this diff rewrites and the gate live-imports — is typechecked by nothing.
- **F8 — Minor** — `package-test-script-parity-manual-test.md:7`. Cites `Dockerfile:57` for a `RUN` now at line 60; D17's drift class, reintroduced by the later commit.

## Security Findings

Attacked the gate's child-spawn surface directly. Held: `shell: false` and argv arrays at both spawn sites; every child's `error`/`status`/`stderr` read before stdout; argv-flag injection closed **and fail-loud when forced** (`vitest list … --evilpkg/` → exit 1, `CACError`, 0 stdout — so a dash-leading path reds rather than being absorbed); the `git ls-files` inventory surfaces nothing sensitive (`.env`, `.claude/`, `e2e/.auth/` all gitignored, and both consumers filter before any value reaches an assertion message).

Also corrected a claim in the plan's own framing, in the safe direction: the pre-change silent-green defect was in `pnpm -C apps/api test`, the **reviewer** path. CI ran `pnpm test:unit` from the repo root where the `apps/**` glob resolves, so both security gates *were* executing in the `checks` job. The change closes a reviewer-trust gap, not a live CI blind spot.

- **SEC-1 — Major** — `package-test-parity.test.ts:407`. Control 6's canary allowlist omits `workflow-pins.test.ts`. Merged into **C2**. The failure scenario is concrete: `git rm` it alongside an unrelated cleanup and inventory, unit set, control 3's partition and control 5's equality all stay balanced, with lint/typecheck/test:unit green — after which `uses: someorg/action@main` passes.
- **SEC-2 — Major** — `.github/workflows/ci.yml:13`. No `permissions:` block, and `actions/checkout` defaults to `persist-credentials: true`, leaving a repo-scoped token in `.git/config` in jobs that run `pnpm install` with install scripts permitted for `argon2`/`esbuild`/`sharp`/`protobufjs`/`msgpackr-extract`. Not Critical — fork PRs get a read-only token, and exploitation requires a prior supply-chain compromise. In scope under the pre-existing-in-changed-file rule, and sharpened by this diff: `pnpm test:unit` now evaluates `e2e/playwright.config.ts` in the `checks` job.
- **SEC-3 — Minor** — `package.json:10`. C8 pins the string `eslint .`, but nothing observes its effective file set. Measured: `ignores: ['**/*']` → exit 2 (loud); `ignores: ['apps/api/**']` → **exit 0** with two planted errors silently absent. The same total-loud / partial-silent asymmetry the plan documents for Playwright's `testIgnore`, on a gate control 5 does not claim. Minor today because the ESLint config carries no security rules.

## Testing Findings

- **T1 — Major** — `package-test-parity.test.ts:357-363`. Merged into **C1**. Executed three runs: accessor rename + `describe.skip` → green 9/9; accessor restored → red naming `auth.spec.ts` twice; restored → green.
- **T2 — Major** — `vitest.config.ts:6-12`. Same as F6, with measurements: vitest 4.1.10's default `testTimeout` probed at **5000 ms**; the gate's heaviest `it` at 441 ms on 8-way parallelism but **2.16 s** with the same listings serialised. `ci.yml` runs on 2 vCPU with a cold cache.
- **T3 — Minor** — `package-test-parity.test.ts:68,131`. The right half spawns from `REPO_ROOT`, never from the package cwd the production script uses. Verified no divergence exists today; the finding is that the gate infers it rather than exercising it.
- **T4 — Major** — no executable gate on the `pnpm --filter` class after three recurrences in one cycle. SC53 disposes of it as a review trigger, and a review trigger is what already failed three times — a disposition written when the class was believed to live in two known homes.
- **T5 — Minor** — `package-test-parity.test.ts:279,286`. The non-vitest-runner predicate computed twice, byte-identical, ten lines apart, in one loop body.
- **T6 — Minor** — `package-test-parity.test.ts:341`. The describe block names control 5 and encloses controls 5, 3, 6 and 4.

## Adjacent Findings

- Func F7 → Testing: the root is outside `pnpm typecheck`'s scope.
- Test → Functionality: `ci.yml` declares no `timeout-minutes` on any job (SC50 keeps CI job structure out of scope).
- Test → Functionality: C1's "enforced by C3's raw-stdout comparison" claim is satisfied by construction (became F2).

## Quality Warnings

None. Every finding carries an executed demonstration. Three experts independently corrected claims in the shipped artifacts rather than deferring to them.

**One process observation, recorded because it is the D9 hazard class.** The Testing expert reported two untracked probe paths appearing and vanishing in the worktree mid-session — `packages/connectors/package.json` and `packages/connectors/test/probe.test.ts` — which it did not create. They are the Functionality expert's F2 demonstration: three reviewers ran mutations concurrently in one checkout. No measurement was contaminated (both agents confirmed clean baselines and clean final runs), but concurrent mutation of a shared worktree is exactly how D9 destroyed four manifest edits. Future rounds should serialise mutation-running agents or give each a worktree.

## Environment Verification Report

| Constraint | Path | Classification |
|---|---|---|
| **VE1** — integration needs Docker/Testcontainers | `pnpm test:integration` | `verified-local` — 6 files / 143 tests, 6.69–6.79 s warm |
| **VE2** — E2E needs the compose stack; login budget 5/5 | `pnpm test:e2e` | `verified-local` — 43 passed; no spec added |
| **VE3** — the gate spawns children | full unit suite | `verified-local` — 30 files / 275 tests, 1.28 s |
| **VE4** — `test:unit` does not typecheck | `pnpm typecheck` run separately | `verified-local` — exit 0. Func F7 narrows this: the workspace **root** is outside its scope. |
| **VE5** — local Node 26 vs CI's Node 22 stderr surface | per-child stderr on Node 22 | **`blocked-deferred`** — cannot be measured from this machine. Links to the Phase 1 VE5 entry and to deviation **D11**, which carries the pre-committed non-filter fallback. On the pre-merge checklist. |
| **VE6** — Playwright `--list` without installed browsers | `pnpm -s -C e2e test --list --reporter=json` | `verified-local` — **discharged in Phase 2 (D18)** by `PLAYWRIGHT_BROWSERS_PATH=<nonexistent>` → exit 0, 0 bytes stderr, valid JSON. The Testing expert additionally confirmed it succeeds with no `e2e/.auth/` storage state, which D18 had not probed. |

## Resolution Status

All 17 findings resolved in this round. Gates after fixes: `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm test:unit` 30 files / **275** tests / 1.28 s · `pnpm test:integration` 6 / 143 / 6.7 s · `pnpm test:e2e` 43 passed · `docker compose build web` pass.

### C1 [Major] Playwright claimant file-granular, skip control unguarded below spec level
- One walk, three consumers (`specs` → `tests` → `annotations`), so the guards and the skip computation cannot protect different accessors — the `canonicalArgv` lesson applied to a JSON shape.
- Reachability asserted at every hop: non-zero specs, non-zero tests, and every test carrying an `annotations` **array**.
- Spec-granular canaries added: the login proof by exact title, and at least one `redirects to /login on 401` spec for session expiry.
- `package-test-parity.test.ts:349-380`.

### C2 [Major] Two more member sets enumerated by name-shape
- `Dockerfile:17-29` — `packages/api-types` and `e2e` added, with the silent-`--frozen-lockfile` reason in a comment. New gate assertion: every `pnpm list -r` member's `<dir>/package.json` appears in the Dockerfile.
- Control 6 — canary list widened to seven files, with **the membership rule written down** ("a file belongs here when it is not a unit test of product code but a control whose deletion removes a repository-wide invariant") so the next addition is mechanical rather than remembered.
- `package-test-parity.test.ts:407-450`.

### F2 [Major] Prefix-overlapping members
- Explicit assertion: no workspace member directory may be a prefix of another's. Not left to the right half, whose two sides apply the same predicate.
- `package-test-parity.test.ts:262-270`.

### F4 [Major] Control 2's positional package identity
- Longest-prefix match against the enumerated member dirs, plus an explicit red for any assigned file no member claims.
- `package-test-parity.test.ts:326-345`.

### T4 [Major] No executable gate on the `pnpm --filter` class
- New assertion: the set of tracked, non-`docs/` files containing the literal equals the two comment sites. The gate excludes itself, derived from `import.meta.url` rather than hardcoded.
- Found a third holder on its first run — itself. `package-test-parity.test.ts:417-440`.

### SEC-2 [Major] CI token exposure
- `permissions: contents: read` at workflow level; `persist-credentials: false` on all three `actions/checkout` steps.
- `.github/workflows/ci.yml:19-20, 26-30, 45-49, 71-75`.

### T2 / F6 [Major/Minor] Missing `testTimeout`
- `testTimeout: 60_000` on the `unit` project — already permitted by C6's allowlist, so no allowlist edit.
- `vitest.config.ts:16`.

### F5 [Minor] C2 clauses 2/4 unit-tier only
- Both tiers now checked, per requirement F2's "on both tiers". `package-test-parity.test.ts:281-291`.

### T3, T5, T6, F8 [Minor]
- `memberListing` spawns with the package directory as cwd (`:139`).
- The non-vitest-runner predicate hoisted to one `const` (`:274`).
- `describe` renamed to `C3 positive controls: inventory, reconciliation, canaries, environment`.
- Manual-test citation corrected to `Dockerfile:60`.

### SEC-3, F7 [Minor] — accepted with an Anti-Deferral entry

Both are gates whose **scope** no control observes, and closing either needs machinery outside this cycle's contracts.

- **SEC-3** — `eslint .`'s effective file set. Worst case: a partial `ignores` entry silently un-lints a directory; today the config carries no security rules, so what goes un-linted is style and unused-symbol detection. Likelihood: low — `eslint.config.mjs` is edited rarely and its ignore list is short. Cost to fix: an eslint-scope reconciliation control analogous to control 5, roughly the size of control 5 itself. **Recorded as SC58.**
- **F7** — the workspace root is outside `pnpm typecheck`. Worst case: a type error in `vitest.config.ts` or another root file reaches main. Likelihood: low, and bounded — the gate live-imports `vitest.config.ts`, so a *runtime* error there reds `pnpm test:unit`. Cost to fix: a root `tsconfig.json` plus a root `typecheck` step, which changes CI job structure (SC50). **Recorded as SC59.**

## Recurring Issue Check

Compressed as in prior artifacts; every non-N/A row preserved.

### Functionality expert
- **R42 — HIT (F1, F4)**: `Dockerfile:17-27` is the fifth instance of this cycle's signature error and the second in that file; control 2 re-derived package identity positionally while the authoritative set was in scope.
- **R3 — HIT (F5, F8)**: C2's negative/residual clauses propagated to the unit tier only; citation drift reintroduced.
- **R45 — HIT (F6)**: one child per member on the 5 s default, growing linearly, no explicit budget.
- **R41 — HIT (F2)**: C1's Forbidden clause declares an enforcement mechanism that cannot fire.
- R33 — Clean: all three `--filter` sites converted; class re-derived and swept across every CI-executed artifact.
- R21 — Clean: D7 records no delegation; every mutation re-run by the orchestrator.
- R35 — Clean: Tier-2 plan present and executed with observed values.
- R1 — Clean: no reimplementation against the three neighbouring gates; idiom consistent.
- R16 — Clean: D8's disposition stands; VE5 is the one open item and carries a stated fallback.
- RT4/RT7 — Clean as a process, three more sites found (F2, F3, F5) that the M-table did not reach because no mutation created a nested member, a sub-file narrowing, or a stray `test:integration`.
- N/A: R2, R4–R15, R17–R20, R22–R32, R34, R36–R40, R43, R44, R46.

### Security expert
- **member-set derivation — HIT (SEC-1)**: sixth instance, inside control 6 itself.
- R1/R3/R17 — Clean: D16's unification holds; D17's citations re-verified against the post-change line numbers.
- R21 — Clean: `pnpm test:unit` re-run in the reviewer's own shell rather than trusted from a log.
- R33 — Clean, re-derived: `git grep -- '--filter'` yields only explanatory comments.
- R35, R41, R42, RT4/RT7, RT9, RS4 — Clean, each re-verified by execution.
- RS4 — Clean: `git grep -i noguchi` returns no hit outside `.git` metadata; D14's redaction held.
- N/A: R4–R6, R8–R11, R13–R15, R19, R20, R22–R32, R34, R36–R40, R43, R45, R46, RS1, RS2, RS5.

### Testing expert
- **RT4 — HIT (T1)**: fourth vacuity site, after D3/D4/D15.
- **RT5 — HIT (T3)**: the right half never spawns from the production cwd.
- **R45/R16 — HIT (T2)**: 5000 ms default against a 2-vCPU runner.
- **R42 — HIT (T4)**: the `--filter` class has no executable gate.
- **R1/RT9 — HIT (T5)**: one predicate, two copies.
- R2 — Clean: `canonicalArgv` is the single producer; C8's five literals are the deliberate pin.
- R12, R18, R19, R20, R21, R32–R36, R41, R44 — Clean, each re-verified.
- R36 — Clean **with a note**: `NODE_NO_WARNINGS=1` is a suppression, but it is argued in the code and *verified* not to suppress the banner the assertion targets — a scoped silencing at source, not a warning swept under.
- RT7 — Substantially clean: 33 mutations red-proven, two re-executed independently.
- N/A: R4–R6, R8–R11, R13–R15, R22–R31, R37–R40, R43, R46, RT1, RT6, RT8.

## Mutations added this round

| # | Mutation | Result |
|---|---|---|
| M34 | nested workspace member (`packages/connectors`) | RED — `workspace members nested inside one another` |
| M35 | Playwright drops the `annotations` field (data-side) | RED — `43 tests without an annotations array` |
| M36 | `e2e` script narrowed below file granularity | RED — `the login proof` |
| M37 | `git rm` the `workflow-pins` SHA-pin gate | RED — `security-control test files no longer assigned` |
| M38 | drop a `package.json` COPY line from the Dockerfile | RED — `workspace members absent from the Dockerfile deps stage` |
| M39 | reintroduce `pnpm --filter` in a CI-executed artifact | RED — `files still containing pnpm --filter` |
| M41 | non-member declares an unbacked `test:integration` | RED — `declares test:integration but no recognised runner` |
| M42 | **PROBE** — nested test directory | GREEN, as required: legitimately owned by longest-prefix match |

**Two mutations were mis-specified and corrected, which is the round's own instance of the pattern this cycle keeps recording.** M35 first mutated the gate's *reader* — but a guard living in the same file cannot protect against an edit to that file; the threat it exists for is Playwright renaming the field, so the mutation had to move to the data side. M40 was specified expecting a red for a nested test directory; with longest-prefix ownership that is legitimate, so it was reclassified as the M42 probe. In both cases the expected-assertion column caught the mis-specification rather than the mutation quietly passing.
