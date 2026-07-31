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

---

# Code Review: package-test-script-parity — Round 2

Date: 2026-07-29
Review round: 2 (incremental, against `7ab1cf7`)

## Changes from Previous Round

All 17 round-1 findings closed and verified by each expert re-executing its own original demonstration rather than reading the disposition table. 18 new findings: **0 Critical, 10 Major**.

## Convergence summary

Every Major this round landed on **assertions added in round 1** — the commit that closed the previous round's findings introduced the next round's.

| Merged | Severity | Raised by | Subject |
|---|---|---|---|
| **N1** | Major (3/3) | Func G1, Test T8, Sec SEC-4 | The `--filter` gate was narrow on **three independent axes**, found one per expert: the flag **spelling** (`pnpm -F` is a documented alias with the identical hazard — a Dockerfile line restored as `pnpm -F @open-smp/web build` passed), the **file kinds** scanned (a hand-enumerated extension list: extensionless executables, `.cjs`, `.mts` all invisible), and the flag **position** (`pnpm -r --filter`, `pnpm -s --filter`, `pnpm --workspace-root --filter` — four of six realistic spellings evaded). R42 committed three ways inside the gate written to close R42. |
| **N2** | Major (3/3) | Func G2, Test T7, Sec SEC-6 | The Dockerfile gate asserted **mention**, not an ordered COPY in the deps stage. Three demonstrations: a comment satisfies it; a COPY moved *after* `RUN pnpm install --frozen-lockfile` satisfies it (the exact defect condition); and — Testing's, the sharpest — deleting two COPY lines **and rewording the comment this same commit added** to name those paths satisfies it, an edit a reviewer would read as an improvement in precision. The same substring-read-of-dialect-bearing-text that C8 explicitly refuses to perform on `ci.yml`. |
| **N3** | Major | Func G3 | The new Dockerfile gate had **no cardinality guard** — `entries.slice(0,0)` → green. Fourth vacuity site in this file, landed in the commit that fixed the other three. |
| **N4** | Major | Test T9 | The scan's exclusion chain had no coverage control, **and one of its two clauses was already dead** (removing `!f.startsWith('docs/')` left the gate green, because the extension filter already excluded `.md`). Adding `scripts/` silently blinded the scan over that path. |
| **N5** | Major | Sec SEC-7 | Control 6's canary list was still enumerated rather than derived — "everything in `apps/api/test/` that reads files, minus one", then "that plus the one the reviewer named". Security supplied a **mechanical discriminator**: a unit-tier test that reads repository files at runtime is enforcing a repository-wide invariant. Applied across all 30 assigned unit files it yields **12**; the list held 8. |
| **N6** | Minor (2/3) | Func G6, Test T10 | `new URL(import.meta.url).pathname` is percent-encoded, so a checkout path containing a space makes the self-exclusion match nothing and the gate red on itself forever. |
| **N7** | Minor | Test T11 | The `nested` assertion was **unreachable for a bare nested manifest** — the D1 ≡ D2 assertion throws first. D2's shape regenerated by appending a new assertion after the one D2 had moved; M34's chosen input happened to be one of the two that reaches it. |
| **N8** | Minor | Func G5 | The skip assertion lost its file/spec identity in the one-walk refactor: a `describe.skip` on a non-canary spec failed with `expected [ Array(1) ]` and named nothing, in a file whose own discipline is that a failure names its cause. |
| **N9** | Minor | Func G4 | Control 6 re-enumerated over `apps/api/test/` only, missing `apps/web/test/page-spec-membership.test.ts`, which meets the rule the same commit wrote down. (Subsumed by N5.) |
| **N10** | Minor | Sec SEC-8 | The `CONTROL_FILES` entry naming the gate file itself has **no failing state**: deleted, nothing runs; present, it is necessarily in the unit set. |
| **N11** | Minor | Func G7, Sec SEC-9 | Both deferrals were argued on costs that do not hold. **SC59**: the live import cannot observe type errors (Vite erases types), and SC50 does not block the fix — a root `tsconfig.json` plus a script-value edit is neither a project-definition nor a job-structure change. **SC58**: pinning `eslint.config.mjs`'s `ignores` by exact equality through C6's live-import idiom is ~3 lines, not control-5-sized; and its trigger is the review-trigger form this very cycle replaced with an executable gate one contract over. |
| **N12** | Minor, adjacent | Sec | `testTimeout: 60_000` was applied to the whole unit project to solve one file's spawn fan-out, widening the failure feedback loop for the other 29 files from 5 s to 60 s. |

## Seed Finding Disposition

No seeds were generated for round 2.

## Answers to the questions put to the experts

- **Is the `--filter` gate the forbidden dialect-bearing inference, or the counting category?** Functionality argued both sides and concluded *counting*, decisively: C8's second half was dropped because it read `presence ⇒ effectiveness`, where a comment, `if: false` and `continue-on-error: true` each preserve the string while removing the invocation. This gate reads `absence ⇒ absence`, which never decides whether a line executes; a commented-out occurrence reds, which is over-strict — the opposite failure direction. **But the verdict was conditional on the needle covering every spelling of the behaviour, and it did not** (N1). Permitted category, wrong on its own terms — a better outcome to have found than a category violation.
- **Is the `import.meta.url` self-exclusion sound?** Security: sound, and better built than the question implied — but it protects **one clause of three**, which is N4. Testing independently reached the same split verdict. Both confirmed the percent-encoding trap is real (N6).
- **Does reading file contents create a new exposure in a `pull_request` job?** Security: no. Contents never reach an output channel; the files are the PR's own public checkout; `.env`, `.claude/` and `e2e/.auth/` are gitignored and therefore absent from the inventory. The `try/catch` is load-bearing rather than defensive padding — `git ls-files --cached` lists a file deleted from the working tree, so without it M14b would crash with ENOENT instead of reaching a named assertion. Residual: `readFileSync` follows symlinks, giving a one-bit oracle with no channel to report it.
- **Does `permissions: contents: read` break anything?** Security: no. No `secrets.` or `GITHUB_TOKEN` reference exists in the workflow; `upload-artifact@v7` and `setup-node`'s cache authenticate with the job-scoped `ACTIONS_RUNTIME_TOKEN`; no job performs a network git operation, so `persist-credentials: false` is safe.
- **Were the two round-1 mutation corrections right?** Testing verified both by execution and judged both correct, with the reasoning stated: a same-file guard cannot catch a same-file reader edit but can catch a data-shape change (M35), and under longest-prefix ownership a nested test directory is legitimate rather than a defect, so the pre-fix red expectation was an artifact of the defect being removed (M40 → M42).

## Quality Warnings

None on the findings. **One process failure, mine.** I told the Testing expert it was the only agent running mutations this round, then edited the tree myself while the Security expert was mid-review. Security caught it — its first `git diff HEAD~1 HEAD` returned a rendering that disagreed with a line-number grep of the same file — re-verified every finding against file content read directly, and reported two Majors it knew were already closed by the in-flight edit *because it had proven them real by execution*. That is exactly the right handling, and it should not have been necessary. Round 1 recorded this hazard after the experts hit it among themselves; I then reproduced it as the orchestrator. **A round's fixes must not begin until every reviewer for that round has reported.**

## Resolution Status

All 18 findings resolved. Gates after fixes: `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm test:unit` 30 files / 275 tests / 1.38 s · `pnpm test:integration` 6 / 143 / 7.03 s · `pnpm test:e2e` 43 passed.

### N1 [Major] The `--filter` gate narrow on three axes
- **Spelling and position** — the selector is now `/\bpnpm\b.*(^|\s)(--filter|-F)(\s|=)/`: the flag is matched as a token anywhere on a pnpm line rather than as pnpm's first argument. Both narrowings are recorded in the comment as the same error found twice.
- **File kinds** — the extension filter is gone. Every inventory entry is scanned; unreadable or binary content is skipped by catching the read rather than by predicting which files are text. Measured at 31 ms over the previous subset, and the full tracked set is a few hundred small text files.
- **A fourth axis surfaced while fixing these**: pinning *files* cannot distinguish a comment mentioning the form from an invocation using it **inside a file already on the expected list** — and both survivors are such files. Restoring `RUN pnpm -F @open-smp/web build` to the Dockerfile changed nothing. The assertion now pins matched **lines**.
- Red-proven: M43 (`-F` in a file already listed), M44 (extensionless holder), M45 (`.cjs`), M52 (`pnpm -r --filter` in the root `build`), M53 (`pnpm -s --filter` in a shell script).

### N2 [Major] Dockerfile gate asserted mention
- Sliced between `FROM … AS deps` and the following `RUN pnpm install`, anchored to `^COPY\s+<dir>/package\.json\s`, with reachability guards on both indices. Labelled in the comment as strictly weaker than an image-level check, whose strong form (`docker build --target deps`) the manual test plan records.
- Red-proven: M47 (delete two COPY lines **and** reword the comment to name those paths), M48 (COPY moved after `RUN pnpm install`).

### N3 [Major] No cardinality guard
- `expect(entries.length, 'no workspace entries enumerated').toBeGreaterThan(0)`. Red-proven by M49.

### N4 [Major] Exclusion chain uncontrolled, one clause dead
- Exactly one file is excluded — this one — and that is **pinned**: `expect(inventoryFiles.filter(f => !scanned.includes(f))).toEqual([self])`. `docs/` is no longer an exclusion; those files are scanned and then classified as prose *after* matching, so a new document mentioning the form stays fine while a new executable artifact using it reds.
- Red-proven by M46 (widening the exclusion by one directory).

### N5 [Major] Control 6 enumerated, not derived
- The list is now the output of Security's discriminator, run across every assigned unit file: `grep -l "from 'node:fs"` over the unit listing yields **12**, of which 11 are listed (see N10 for the twelfth). The comment states the discriminator and instructs re-running it rather than extending the list by eye — and states **why the list must stay literal**: deriving it at runtime from the unit set would make a deletion shrink both sides and go green.
- The four Security named are all present: `accounts-query-domain`, `link-statuses`, `upsert-link-domain`, `package-edge`.
- Red-proven: M54b (`git rm apps/web/test/link-statuses.test.ts`, chosen because `apps/web` retains five other unit files so C2 clause 1 does not fire first).

### N6–N8, N10 [Minor]
- `import.meta.filename` replaces `new URL(import.meta.url).pathname`.
- The `nested` assertion moved **above** the D1 ≡ D2 agreement, with the ordering reason stated: nesting is a property of the raw enumeration and is logically prior to domain coherence. Red-proven by M50 (bare nested manifest).
- The Playwright walk carries `{file, title}` through every hop, so the skip assertion names `file :: title`.
- The `CONTROL_FILES` self-entry is dropped, with the reason in the comment: it has no failing state.

### N11 [Minor] Both deferrals restated
- **SC59** — the live-import bound removed (Vite erases types, so a type error there is not a runtime error), SC50 shown not to apply, and the real cost stated: a root `tsconfig.json` plus a script-value edit that C8 already pins. Trigger sharpened to "the next cycle touching root tooling — and it should be closed there rather than deferred again."
- **SC58** — cost corrected from control-5-sized to ~3 lines, and the trigger's weakness named explicitly: it is the review-trigger form this very cycle replaced with an executable gate one contract over.

### N12 [Minor, adjacent] Timeout scoped
- `testTimeout` removed from the `unit` project; each of the gate's five `describe` blocks carries `{ timeout: 60_000 }`. The other 29 unit files return to the 5 s default.

## Mutations added this round

| # | Mutation | Result |
|---|---|---|
| M43 | `pnpm -F` restored in a file already on the pinned list | RED — line-level pin |
| M44 | extensionless executable holding the selector | RED |
| M45 | `.cjs` holder | RED |
| M46 | scan exclusion widened by one directory | RED — pinned exclusion set |
| M47 | two COPY lines deleted **and** the comment reworded to name them | RED — deps-stage anchor |
| M48 | COPY moved after `RUN pnpm install` | RED |
| M49 | workspace enumeration returns `[]` | RED — cardinality guard fires in its own `it` |
| M50 | bare nested manifest (no vitest dep, no test files) | RED — `nested` now ordered first |
| M51 | `git rm apps/web/test/page-spec-membership.test.ts` | RED |
| M52 | `pnpm -r --filter` in the root `build` script | RED |
| M53 | `pnpm -s --filter` in a shell script | RED |
| M54b | `git rm apps/web/test/link-statuses.test.ts` | RED — a newly-derived canary |

Three were mis-specified and corrected. M43's first form pinned files and could not red; M46 and M49 returned false greens because the harness's shell escaping silently mangled the edit and because the mutation removed the guard rather than testing it. **That is the fifth measurement-harness failure this cycle** — after a `--config` placed outside the repo, a `sed` that silently failed to match, a JSON probe run through a different invocation than the one under test, and `git checkout` restoring from an unstaged index. In every case the harness reported a confident result about something other than what was being measured.

---

# Code Review: package-test-script-parity — Round 3

Date: 2026-07-29
Review round: 3 (incremental, against `6021097`)

## Changes from Previous Round

All round-2 findings verified closed by each expert re-running its own original demonstration. **Security reported 0 Critical and 0 Major — "`6021097` closed everything material" — for the first time in this phase.** 10 new findings: 3 Major, 7 Minor, and one of the Majors is an argument about method rather than a defect.

## Convergence summary

| Merged | Severity | Raised by | Subject |
|---|---|---|---|
| **P1** | Major (2/3) | Func H1, Test T12 | **Three further selector spellings**, all exit-0 on no-match, all green through the gate on CI-executed paths: `--filter-prod` (fails the boundary *after* `--filter`), clustered short flags `-rF` (fails the boundary *before* `-F`), and a shell **line continuation** splitting `pnpm \` from `--filter …` (the scan's unit was a physical line). Testing planted the continuation on both artifacts, including the browser-install step — restoring the exact form C7 removed, in the file C7 fixed, with every control green. |
| **P2** | Major | Func H2 | The `CONTROL_FILES` discriminator (`reads node:fs`) is **a proxy for the property, not the property**. Reading files is how *some* controls are implemented. Two files meet the written rule and were excluded because they assert by importing symbols rather than reading source: `apps/api/test/label-kinds.test.ts` (C29 — *"Nothing else checks that"*) and `apps/web/test/label-filters.test.ts` (I37.3 — *"without this a reordering or a dropped option ships green"*). Both are the same domain-derivation family as two files that **are** listed. Severity above round 2's G4 because the list is now *claimed* derived — a reader has no cue to re-check — and the instruction "re-run that discriminator" institutionalises the wrong rule for every future addition. |
| **P3** | Minor (3/3) | Func H3, Test T15, Sec SEC-12 | `dir` from `pnpm list -r` interpolated **unescaped** into `new RegExp`. Measured: a dot widens the match in the **fail-open** direction (`apps/api.v2` also accepts `COPY apps/apiXv2/package.json`); a bracket throws an uncaught `SyntaxError`. The plan guards this primitive carefully one layer up for argv and does not cover regexes. |
| **P4** | Minor (2/3) | Test T13, Sec SEC-10 | `CONTROL_FILES` is falsifiable **in the deletion direction only**. Executed: `git rm` a listed canary → RED; de-list an entry with the file present → **GREEN**; add a qualifying file unlisted → **GREEN**. The discriminator lives only in a comment — a review trigger, in the file whose thesis is that review triggers fail, on a list that has already failed it twice. |
| **P5** | Minor | Test T14 | The pinned exclusion set guards **one of two sites**. An exclusion written inside the `holders` loop had the same effect and no coverage: planted holder → GREEN. The pin guarded a *location* where the property is "exactly one file is unread". |
| **P6** | Minor | Sec SEC-11 | The prose exemption is keyed on the `docs/` **directory prefix**, not on the file being prose — the same unbounded-acquisition property the file objects to fourteen lines earlier about scan exclusions, relocated into the classifier. |
| **P7** | Minor | Func H3 | `FROM … AS deps` matched case-sensitively (Dockerfile instructions are not), and `RUN pnpm install` rejected the idiomatic BuildKit `RUN --mount=type=cache,… pnpm install` form — a false red on a legitimate change, which is the class that gets a gate relaxed rather than fixed. |
| **P8** | Minor | Sec SEC-10 | The discriminator's own spelling is narrower than its family: `from "node:fs"` (double quotes — the ESLint config has no quote rule), the bare `fs` specifier, `await import('node:fs')`, and a helper reading on the test's behalf are all missed. Measured complete today (committed and a deliberately wider discriminator both yield the same 12), so it is durability rather than a present gap. |

## The method argument, and what it changed

Functionality's H1 is the round's most important input and is not a defect report:

> Every widening so far has patched one of those two axes after a demonstration. **That method cannot terminate, because it is the same method that produced the misses.**

The scan had been widened four times across three rounds — spelling, position, file kind, match granularity — each time after a demonstration that the previous needle missed a member. Round 3 replaced the method rather than performing a fifth widening:

1. **Normalise** — join shell line-continuations, split on `;`/`&&`/`||`/`|`, so position and line structure stop being properties the needle models.
2. **Tokenise** — a hit is a command mentioning `pnpm` with a later token in the selector **family** `--filter[a-z-]*`, `-F`, or a clustered short group containing `F`. The family, not two literals, is what admits `--filter-prod` and whatever pnpm adds next.
3. **Pin the family against pnpm itself** — this is the cycle-5 lesson applied to this axis: ask the tool rather than recall. **The reachability guard caught the first attempt**: `pnpm --help` mentions no flag at all (measured: zero occurrences of "filter"), so the pin would have asserted over an empty set. `pnpm run --help` carries the "Filtering options" block declaring `--filter` and `--filter-prod`, and that is what is pinned.
4. **State the residue** — a selector held in a variable (`F=--filter; pnpm $F x build`) is invisible to any text scan in every form. **SC60** records that, so the next round reads a green as what it is.

## Quality Warnings

None on the findings. Three process notes, all from the experts, all worth keeping.

- **Functionality corrected itself** on its round-2 G5 disposition: its first pass grepped only vitest's truncated summary line, which still prints `expected [ Array(1) ]`; the diff body carries the full `file :: title` identity that had been asked for. The fix was correct and the initial verdict was not.
- **Testing hit a harness failure of its own** — a `perl` mutation failed to apply silently, and the run that followed printed a red that could have been misread as the probe's result. Every edit after that point asserts its anchor before writing.
- **Security hit one too**, and it was the reassuring direction: a `grep -ql` through the shell's translation proxy returned **empty for both patterns**, which would have read as "the discriminator matches nothing". Re-run in `node` it gave 12/12.

That is **six and seven** measurement-harness false answers in this cycle, and the second and third where the wrong answer was the comfortable one. Every load-bearing measurement in this round was taken in `node` or from a captured exit status.

## Environment Verification Report

Unchanged from round 1 except VE6, which Security's round-3 probes extended: the Playwright listing was already confirmed to work with no browsers (D18) and no `e2e/.auth/` storage state (round 2); round 3 additionally established that `git ls-files --others` does **not** list FIFOs, closing a blocking-read hang at the inventory source rather than at the `try/catch`. **VE5 remains the sole `blocked-deferred` path**, linked to D11 with its pre-committed non-filter fallback.

## Resolution Status

All 10 findings resolved. Gates after fixes: `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm test:unit` 30 files / 275 tests / 1.38 s · `pnpm test:integration` 6 / 143 / 7.2 s warm · `pnpm test:e2e` 43 passed · `docker compose build web` pass.

### P1 [Major] Selector method replaced
- Normalise → tokenise → flag family → pinned against `pnpm run --help`, with the four previous widenings and the reason the method changed recorded in the comment.
- Red-proven: **M55** (`--filter-prod`), **M56** (`-rF`), **M57** (Dockerfile continuation), **M58** (`ci.yml` `run: |` continuation), **M62** (narrowing the family makes `--filter-prod` surface from pnpm's own help as unrecognised).

### P2 [Major] Control-file property corrected
- The rule is restated as the property — *a test that asserts over a domain, a manifest, or a repository-wide relation rather than over the behaviour of one module* — with **both families named**: (a) tests that read repository files, (b) tests that import a domain and compare it against a second declaration. The comment says plainly that the earlier grep was family (a) only, "a proxy for how *some* controls happen to be implemented".
- `label-kinds.test.ts` and `label-filters.test.ts` added; the list is now 13.

### P4, P8 [Minor] Addition-guard
- Strictly additive: the literal list remains the sole authority for detecting **deletion**, and a new assertion catches a file-reading control being **added** unlisted. Both green cases are now red — **M59** (de-list an entry) and **M60** (add a qualifying file).
- The proxy is widened per SEC-10 (double quotes, bare `fs`, dynamic import, `child_process`) and the comment states it cannot see family (b) — **SC61** records that residue rather than letting the guard read as proof of completeness.

### P5 [Minor] Read-set pinned
- The loop records what it actually read; `scanned − read` is asserted empty, which covers both exclusion sites and surfaces whatever the `catch` swallows. Red-proven **M61**.

### P3, P7 [Minor] Deps-stage matchers
- Token comparison replaces the interpolated regex (`tokens[0] === 'COPY' && tokens[1] === \`${dir}/package.json\``), removing the injection surface entirely. `FROM … AS deps` is case-insensitive; `RUN` accepts flags before `pnpm install`.

### P6 [Minor] Prose exemption
- Keyed on the file being markdown (`/^docs\/.*\.md: /`) rather than on the directory. Behaviour-neutral today — all 39 tracked files under `docs/` are `.md` — and no longer unbounded in what it can acquire.

## Mutations added this round

| # | Mutation | Result |
|---|---|---|
| M55 | `pnpm --filter-prod` in the Dockerfile | RED |
| M56 | clustered short flags `pnpm -rF` | RED |
| M57 | Dockerfile line continuation | RED |
| M58 | `ci.yml` `run: \|` block with a continuation | RED |
| M59 | de-list a `CONTROL_FILES` entry | RED — addition-guard |
| M60 | add a qualifying control unlisted | RED — addition-guard |
| M61 | exclusion applied inside the `holders` loop | RED — read-set pin |
| M62 | narrow the selector family so pnpm declares one it does not recognise | RED — the `pnpm run --help` pin |

Cumulative: **62 falsifiability mutations**, 3 documented-limit probes, 1 retired.

---

# Code Review: package-test-script-parity — Round 4
Date: 2026-07-30
Review round: 4

## Changes from Previous Round

Round 3 closed 10 findings in C9/C10. Plan-review round 6 then reviewed those two contracts —
the first review either had ever had — and did not clear them; revision 8 rewrote both, added
**C11** (`failIfNoMatch: true`), and re-executed 30 mutations. Round 4's primary subject is that
new surface, `8fde007..HEAD`, on the cycle's own recurring evidence that each round's findings
land in whatever the previous round created.

## Convergence summary

26 findings across three experts. **Two Critical**, both in text revision 8 wrote to close
round 6's Criticals.

| # | Finding | Convergence | Severity |
|---|---|---|---|
| **P1** | **C11 is not an enforceable boundary.** `--no-fail-if-no-match` and `--fail-if-no-match=false` disable it per invocation — measured exit 0 in the workspace and inside the built `deps` image. Security attacked every other context (`.npmrc`, `npm_config_*`/`PNPM_CONFIG_*`, nested workspace file, member-subdirectory cwd, `-r`, `-C`, every image stage) and the setting held; **the CLI flag is the only bypass, and it is total**. The overstatement was load-bearing: revision 8 demoted C9, closed SC60 with "Trigger: none — closed", and accepted C9's residue on it. Worse, `--fail-if-no-match` sat in C9's *reviewed non-selector allowlist*, so the one control that could observe the off-switch was told to ignore it. | 2/3 (Sec Critical, Func Major) | **Critical** |
| **P2** | **C10's anti-vacuity self-tests were vacuous.** Three assertions re-typed the matcher regexes rather than using them, so they asserted over their own copies. Executed: narrowing the shipped `FROM … AS deps` matcher to drop `(--\S+\s+)*` leaves the real `FROM base AS deps` still matching and the self-test still passing — the whole `it` green with the property gone. **Tenth vacuous assertion in this file, in the lines labelled "anti-vacuity".** RT9, RT3 and RT5 at one site. | 1/3 (Test Critical) | **Critical** |
| **P3** | **A working selector spelling the family missed.** `pnpm -F=<pkg>` and `-rF=<pkg>` resolve (measured exit 0); the short alternative had no `(=.*)?`. Composed with P1: `pnpm -F=e2e --no-fail-if-no-match test` is plain text, invisible to C9, and defeats C11 — the exact channel the cycle exists to close, in the commit declaring it shut. | 1/3 (Sec Major) | Major |
| **P4** | **Only the first `pnpm` per command was scanned**, so `pnpm -w exec pnpm --filter …` was a MISS — and `pnpm -w exec` is the canonical form of every member `test` script this cycle wrote. | 3/3 (Func Major, Sec Major, Test Minor) | Major |
| **P5** | **The sanctioned-exclusions guard restated its own predicate**, so it was empty for every repository state. Its only failing mode was a one-sided edit of two adjacent lines — which is what its mutation exercised. | 2/3 (Func Major, Test Major) | Major |
| **P6** | **C10's root-COPY set was three hand-written filenames.** The defining primitive is "root-level inputs `pnpm install` reads", which also covers `.npmrc`, `.pnpmfile.cjs` and `patches/`. Complete today by coincidence — the condition under which the member list was complete before someone added `packages/api-types`. A missing `.npmrc` is the silent direction. | 2/3 (Func Major, Sec Minor) | Major |
| **P7** | **The rollback runbook described a control the same commit deleted** — C9's "pinned list", an instruction to update it, and a quoted failing assertion that exists nowhere in the tree, against a test count that was already stale. | 3/3 | Major |
| **P8** | **RT7 gap**: eight assertion sites had no mutation, including the three guards that exist *because of* round 6's vacuous pin, and six of C11's seven assertions. | 1/3 (Test Major) | Major |
| **P9** | **Mutation totals irreconcilable with the table** — 28 / 22 / 6 stated against 21 deny + 9 allow rows, and both per-contract sub-counts wrong. N7's shape, one revision after N7 closed. | 2/3 | Major |
| **P10–P17** | Comments stripped after continuations joined (a trailing `#` swallowed the joined line); `COPY --from=<stage>` accepted as a build-context copy; the `WORKDIR`-absolute destination redded; matchers anchored at column 0 despite a declared whitespace tolerance; C11's allow probe filtered the workspace **root**, not a member; NF1's wall figure taken at ~5.7× parallelism; `pnpm@10` floating while `--frozen-lockfile` was pinned; the `--filter exits 0` comments in `Dockerfile` and `ci.yml` made false by C11 and updated at neither site (R33). | mixed | Minor |

## What was done

All 26 were fixed or explicitly dispositioned; nothing was deferred. The two structural changes:

- **C11's class is restated** as a fail-closed default with one enumerated CLI opt-out, the opt-out
  moved into C9's **deny** set, and its existence asserted — so a pnpm release removing the negation
  re-derives the contract instead of leaving a stale record. SC60 is **reopened**, two-sided: C11
  sees selectors C9 cannot read, C9 sees exemptions C11 cannot refuse, and neither closes the other.
- **C10's matchers are single declarations** used by both the parse and the self-tests, and its
  root-input set is derived from the working tree.

**50 mutations re-executed** against the shipped tree — 38 red-proofs, 12 allow-side. Four were
mis-specified on the first run; three were harness errors, and the fourth was not: re-adding a
`docs/` directory anchor stayed **green** against the repaired exclusion guard, because all 39
tracked files under `docs/` are markdown and no comparison of *sets* can distinguish two predicates
that produce the same set. That forced the predicate-level assertion that shipped.

## Recurring Issue Check

| Pattern | Status |
|---|---|
| The vacuous assertion (nine prior) | **Recurred** — tenth, in the lines labelled "anti-vacuity", written to close the ninth. |
| The same production twice (round 6's mechanism) | **Recurred twice** — a duplicated regex literal and a restated predicate. |
| A member set enumerated by name-shape | **Recurred twice** — C10's root-input triple, and C9's residue enumerated as two members with three more measurable. |
| Red-proof not transitive across a rewrite | **Recurred** — in the rollback runbook, quoting a message and a count from a superseded implementation. |
| The mutation table's own fidelity | **Recurred** — four totals, none matching the rows shipped beside them. |
| Notation versus resolution | **Recurred one level down** — `./` normalised, `WORKDIR`-absolute not. |
| A control at the wrong level | **Not recurred.** C11 is the right level; the defect was the strength claimed for it, not the placement. |
| Harness destruction (D9) | **Not recurred** — no reviewer executed a mutation; the tree was unmodified throughout. |

## Environment Verification Report

| ID | Classification | Basis |
|---|---|---|
| VE1 | `verified-local` + `verified-CI` | `pnpm test:integration` exit 0, 6 files / 143 tests; `ci.yml` runs it. |
| VE2 | `verified-local` | `pnpm test:e2e` exit 0, 43 passed. No spec added; the 5/5 login budget is untouched. |
| VE3 | `verified-local` | 12/12 in the gate file, including the four new C11 children. |
| VE4 | `verified-local` | lint / typecheck / test:unit / test:integration each run separately, all exit 0. |
| VE5 | `blocked-deferred` | Local Node v26.5.0; `ci.yml` pins 22. Security measured the two new pnpm children **on the Node 22 image**: `pnpm run --help` and `pnpm list -r` both exit 0 with **0 bytes stderr**. C11's probes assert status and message, not stderr, so they carry no VE5 exposure. The vitest listings' Node-22 stderr remains the open item. |
| VE6 | `verified-local` | Playwright `--list` green inside the passing gate; the runner-side leg is still the open CI question. |

---

# Code Review: package-test-script-parity — Round 5
Date: 2026-07-30
Review round: 5

## Changes from Previous Round

Round 4 closed 26 findings, including two Criticals, and revision 9 declared C9, C10 and C11 locked.
Round 5's subject is `7ecfae6` — that fix. **33 findings, three Critical**, and once again the
Criticals are inside the text the previous round wrote to close its own.

## Convergence summary

| # | Finding | Convergence | Severity |
|---|---|---|---|
| **Q1** | **C11's opt-out enumeration was wrong in both directions.** Revision 9 corrected the *class* and wrote a two-spelling deny list beneath it. Measured on pnpm 10.34.5: **eleven** spellings disable the setting — any unambiguous prefix with or without `no-` (`--no-fa`, `--fail-if=false`), `--config.fail-if-no-match=false` and `--config.failIfNoMatch=false`, the double negation `--no-fail-if-no-match=true`, and `--fail-if-no-match false`, whose bare token was in the *reviewed-benign allowlist*. Two spellings the list carried (`=0`, `=no`) pnpm rejects. Controls (`--no-color`, `--config.bogus-zzz=false`) confirm the disabling is specific, not blanket. **`pnpm -F=e2e --no-fa test` defeats C11 and passes C9.** | 2/3 (Sec Critical/escalate, Func Critical) | **Critical** |
| **Q2** | **The tautological exclusion guard survived the round that named it.** `scanned = filter(f => !isExcluded(f))`, then `filter(f => !scanned.includes(f) && !isExcluded(f))` — `X \ X`, empty for every repository state. Round 4 diagnosed it, added predicate self-tests, and left it. The self-tests do not close it either: a **third clause** passes all of them, and `\|\| extname(f) === '.yml'` drops `ci.yml`, `docker-compose.yml` and `dependabot.yml` from the scan with the suite green — silencing M-T2 and M-T4's subjects and re-hiding C11's off-switch. | 3/3 (Test Critical, Func Major, Sec Minor) | **Critical** |
| **Q3** | **`ANY_STAGE` was the one hoisted production with no self-test**, and narrowing it is invisible against a Dockerfile with one `pnpm install` — the `docs/`-anchor situation in the code written to close the `docs/`-anchor situation. | 1/3 (Test Major) | Major |
| **Q4** | **The pnpm pin was unbounded and substring-matched.** `pnpm@10.34.55`, `pnpm@10.34.5-rc.1`, a trailing comment naming the version, `RUN npm i -g pnpm@10 && echo pnpm@10.34.5`, and a pinned install in a stage production never inherits all passed — the standard the same `it` raises for `installAt`, thirty lines above. | 3/3 | Major |
| **Q5** | **`WORKDIR = '/repo/'` was a hand-typed copy** of a value the parsed Dockerfile states, in the commit whose theme was tying literals to their source. A bare `/repo` destination also false-redded. | 3/3 | Major |
| **Q6** | **The `run`-family allow cell was vacuous** — `--help` short-circuits before selector resolution, so `pnpm --filter <no-match> run --help` exits 0 too. The run family was unproved on both sides. | 2/3 | Major |
| **Q7** | **`pnpm-workspace.yaml` still carried round 4's Critical claim verbatim** — "it holds for every invocation" — at the one site a reader of the setting opens first. Round 4's correction reached the Dockerfile, `ci.yml`, the test and the plan, and not the declaration site. | 2/3 | Major |
| **Q8** | **Root-input membership came from `existsSync`, not git**, so a developer's local `.npmrc` — where a registry `_authToken` lives, and which `.dockerignore` does not exclude — would red the gate with a message instructing the operator to COPY it into the image. `patches/` was named in the comment and omitted from the code. | 2/3 | Major |
| **Q9** | **RT7 gap: fourteen assertions added by `7ecfae6` had no mutation**, and MT12 masked seven of the eight synthetic self-tests by redding at the first. | 1/3 (Test Major) | Major |
| **Q10** | `pnpm` matched by exact token, so a path invocation was invisible; a whole-line comment inside a continuation was a MISS because blanking it stopped the join Docker performs anyway; two COPY recognisers in one `it`; the opt-out probe asserted status without cause; the `impossible` name's non-match property was assumed; `packageManager`'s `+sha512` form was rejected with the wrong message; the `catch`'s stated benign-skip is contradicted by the read-completeness assertion; three doc figures unreproducible. | mixed | Minor |

**Found by the orchestrator while verifying Q7:** `ci.yml` claimed "the repository carried no git remote for three cycles, so CI never ran and the error stayed hidden". False. `origin` is configured, CI runs are green on `main`, and run **30321653394** (2026-07-28, `compose-smoke`) executed the Playwright install step and the E2E suite — **43 passed (23.1s)** on the runner. That claim had been load-bearing for deferring VE5 and VE6. Recorded as **SC65**; VE6 is restated.

## What was done

All 33 were fixed or dispositioned. The structural changes, each replacing an enumeration with a derivation:

- **The off-switch predicate is derived from the setting's name** — strip `-`, an optional `no-`, an optional `config.`, take the part before `=`, de-hyphenate, and deny any prefix of `failifnomatch` two characters or longer. Verified in both directions: denies all twelve disabling spellings, passes `--filter`, `--force`, `--fail-fast`, `--frozen-lockfile`, `--no-color`, `-C`, `-w`. Any *mention* is denied regardless of polarity, because no tracked artifact has a legitimate reason to write the setting.
- **The exclusions are a named list whose reasons are pinned**, so a third clause has to be named and naming it reds.
- **`WORKDIR` is derived from the Dockerfile**, root-input membership from git, `pnpm` matched by basename, the pnpm pin bounded to the stage and compared as a token.

**63 mutations executed** against the shipped tree — 49 red-proofs, 14 allow-side. Two were
mis-specified: MT21 stayed green because the self-test cell it targeted carried a `--filter` and
passed through `SELECTOR_FAMILY` — the shape this very round raised about round 4's cells,
reproduced in round 5's first draft; and MC19 is green **by design** once the workdir is derived,
since every deps-stage destination is relative.

## Recurring Issue Check

| Pattern | Status |
|---|---|
| An enumeration written where a derivation belongs | **Recurred — three times** (off-switch spellings, root inputs, `WORKDIR`). Thirteenth, fourteenth and fifteenth on record. |
| The correction repeating the original error one level down | **Recurred.** Round 4 found a working off-switch classified benign in C9's allowlist; round 5 found the same token, with a separated value, still classified benign — plus nine more the new deny set missed. |
| The vacuous assertion | **Twelfth, and it is the tenth left in place**: round 4 diagnosed the tautology and shipped it. A thirteenth in the `run --help` allow cell. |
| Findings land in the surface the previous round created | **Recurred** — 9 of 11 functionality findings are inside `7ecfae6`'s own lines. |
| Notation versus resolution | **Recurred** — substring versus token for the pin, `/repo/` versus a derived workdir. |
| Harness destruction (D9) | **Not recurred** — no reviewer executed a mutation; the tree was unmodified throughout. |
| A control at the wrong level | **Not recurred.** |

## Environment Verification Report

| ID | Classification | Basis |
|---|---|---|
| VE1 | `verified-CI` | `ci.yml` runs `pnpm test:integration`; green on `main`. Locally 6 files / 143 tests, exit 0. |
| VE2 | `verified-local` + `verified-CI` | `pnpm test:e2e` exit 0 / 43 passed locally; **43 passed (23.1s)** on the runner in run 30321653394. |
| VE3 | `verified-local` | 12/12 in the gate file, including the six C11 children. |
| VE4 | `verified-local` | lint / typecheck / test:unit / test:integration each run separately, all exit 0. |
| VE5 | **`verified-CI`** (revision 11) | Local Node v26.5.0; CI pins 22. Local pnpm 10.34.5 is byte-identical to `packageManager` and to the Dockerfile pin, so every flag measurement this round is on the version CI and the image run. The parity gate has never run in CI only because the branch is unpushed (SC65). |
| VE6 | **`verified-CI`** (revision 11) | Playwright installs and runs on the runner (measured, above). The gate's `--list` inside `checks`, which installs no browser, remains the open leg. |

---

# Code Review: package-test-script-parity — Round 6
Date: 2026-07-30
Review round: 6

## Changes from Previous Round — and a change of method

Rounds 1–5 ran three experts over the same diff. Every Critical any of them produced came from
**executing a tool**; none came from reading. Round 6 therefore replaced the three overlapping
reviews with three disjoint, measurement-first missions, each required to output a *derived set*
rather than an opinion, and each told that reporting **"No findings"** accurately would be more
valuable than surfacing something marginal:

- **A — derivation audit**: enumerate every hand-written set in the gate, execute its defining primitive, diff both directions.
- **B — falsifiability audit**: for all 110 assertions, name the single edit that reds it; verdict PROVABLE / VACUOUS / MASKED.
- **C — claim reconciliation**: re-derive every environmental and quantitative claim; REPRODUCED / CONTRADICTED / UNVERIFIABLE.

**33 findings, three Critical.** All three Criticals are ones five rounds of reading passed over.

## Convergence summary

| # | Finding | Mission | Severity |
|---|---|---|---|
| **R1** | **`test.only` removes 42 of 43 E2E specs with every gate green.** Playwright has four declaration-level modifiers; the control named two. `only` emits **no annotation**, so the listing still reports 43 specs / 0 annotations, both canaries match, the gate stays 12/12, and `pnpm -C e2e test` runs `1 passed (542ms)`, exit 0. `test.fail` inverts the login proof instead. Verified on the real repository, one token, tree restored. | A | **Critical** |
| **R2** | **The Dockerfile contract never bound its stage to the images that ship.** Appending `RUN pnpm install --no-frozen-lockfile` to the `source` stage leaves every assertion **byte-identically green** while every compose-built image resolves outside the reviewed lockfile. The selector scan misses the line too. | A | **Critical** |
| **R3** | **The exclusion-reason pin binds inert labels.** Folding `.yml` into the existing markdown clause keeps the reason list and all five predicate cells intact and drops `ci.yml`, `docker-compose.yml`, `dependabot.yml` from the scan — the two artifacts M-T2/M-T4 red-prove against, and C11's off-switch with them. | B | **Critical** |
| **R4** | `basename === 'pnpm'` is one filename where `npm i -g pnpm` installs `…/pnpm/bin/pnpm.cjs`. `RUN node …/pnpm.cjs --no-fail-if-no-match --filter x` is a working invocation that hides both a selector and C11's off-switch. | A | Major |
| **R5** | VE2/VE6 were classified `verified-CI` on run 30321653394 — `main`@`f8ae6c3`, executing the **pre-C7** `--filter` form. **Closed by PR #9's run**, which executed the shipped `-C` forms: `pnpm -C e2e exec playwright install`, root `test:e2e` = `pnpm -C e2e test`, 43 passed (24.9s). | C | Critical→closed |
| **R6** | `expect(entries.length).toBeGreaterThan(0)` has no failing state at two sites — `pnpm list -r --json` never returns `[]` with exit 0. | B | Major |
| **R7** | The derived `WORKDIR` has no assertion on its **value**: four derivation mutants and a hardcoded `/nonsense/` all leave the `it` green. Deriving without a self-test reduces observation. | B | Major |
| **R8** | NF1 states 11 vitest children; the gate spawns 13 vitest and 23 total — and that list *is* VE5's checklist. | C | Major |
| **R9** | C6's permitted-key list still contains `pool`, which the shipped gate rejects and D1 removed for doubling the integration tier. A reader repairing the gate against the plan would re-admit it. | C | Major |
| **R10** | Per-contract acceptance counts and in-gate self-test counts contradict the shipped tables — **three different values for one quantity in one document**, in the revision whose purpose was to make it code-derived. | B, C | Major |
| **R11–R33** | Masked assertions (three spawn-error guards, the opt-out cause, `scanned.length`); `-g` vs `--global` divergence; two `vitest.config.ts` literals; `Tier` duplicated from the config; `rootInputs` documented as "DERIVED" while being a filtered literal; MB8's and M15's recorded observations not reproducing; stale line citations; an unreproducible char count. | all | Minor |

## What was done

Each Critical's fix climbs to the tool rather than widening a list:

- **`forbidOnly: true` in `e2e/playwright.config.ts`** — Playwright itself refuses a committed `only`, and `--list` exits 1 with one present (measured). The annotation filter became an **allowlist over annotation types with an empty sanctioned set**, so a future modifier reds instead of being enumerated. The gate pins `report.config.forbidOnly`; the `--forbid-only` CLI flag was deliberately **not** used, because passing it made the pin read a value the gate had just set — caught by a mutation, and the reason the config is the single source.
- **The install is bound to what ships**: `pnpm install` must be unique in the Dockerfile and appear at the examined line, and every `target:` in `docker-compose.yml` must inherit the stage it lives in — computed from the `FROM` edge list.
- **The exclusion set is compared against an independently written predicate** *and* against synthetic cells. Neither subsumes the other: a clause differing on a file that exists reds in the comparison; one agreeing on every existing file but differing in principle (the `docs/` anchor) reds in the cells. Round 4 deleted the comparison because its form was `X \ X`; the repair was to make it independent.

**71 mutations executed** against the shipped tree — 57 red-proofs, 14 allow-side. Two were
mis-specified and both were informative: one revealed the self-referential `forbidOnly` pin, the
other a masking between two self-test cells.

**Every count in the plan's falsifiability section is now generated from the code**, not typed.

## Recurring Issue Check

| Pattern | Status |
|---|---|
| An enumeration written where a derivation belongs | **Recurred — three times** (Playwright modifiers, the pnpm filename, the Dockerfile stage name). Sixteenth through eighteenth on record. |
| The Critical is inside the previous round's fix | **Recurred — sixth consecutive round.** R3 is inside round 5's replacement for round 4's tautology. |
| A check that compares something to a copy of itself | **Recurred, at a new remove** — the reason pin compares retyped *labels*, which have no behaviour. Fourth instance, and the hardest to see. |
| Deriving without a self-test | **New** (R7). The derivation removed the "a reader can see it is wrong" property of a literal and put nothing in its place. |
| Counts typed rather than generated | **Recurred** — and is now closed by generating them. |
| Harness destruction (D9) | **Not recurred.** All three missions were read-only; the tree was clean before and after. |

## Environment Verification Report

| ID | Classification | Basis |
|---|---|---|
| VE1 | `verified-CI` | PR #9 run 30523473020, job `integration`: pass. |
| VE2 | `verified-CI` | Same run, `compose-smoke`: `pnpm -C e2e test` → **43 passed (24.9s)** on the runner. The shipped form, not the pre-C7 one. |
| VE3 | `verified-local` + `verified-CI` | 12/12 locally; the gate ran in `checks` on the runner. |
| VE4 | `verified-local` + `verified-CI` | lint / typecheck / test:unit are three separate steps in `checks`, all pass. |
| **VE5** | **`verified-CI` — discharged** | `checks` on **Node 22.23.1**: 30 files / 276 tests, zero assertion failures. `assertChildOk` demands byte-exact empty stderr from every child, so the green run *is* the measurement. Corroborated in-image beforehand with a positive control proving the zero was not vacuous. The sanctioned fallback is not needed. |
| **VE6** | **`verified-CI` — discharged** | The gate's Playwright `--list` ran inside `checks`, which installs no browser, and passed. The browser-install step ran in `compose-smoke` in its shipped `-C` form. |

---

# Code Review: package-test-script-parity — Round 7
Date: 2026-07-31
Review round: 7

## Changes from Previous Round

Round 6 changed the method and it held, so round 7 kept it and pushed the question one
generalisation further. Three disjoint missions: **what are all the ways a runner can be told to
run less than it appears to** (both runners, by execution); **audit round 6's own fix**; and **what
decides CI coverage that no gate reads**.

**21 findings, four Critical.** The branch was also pushed and PR #9 opened mid-round, which
discharged VE5 and VE6 on the runner.

## Convergence summary

| # | Finding | Mission | Severity |
|---|---|---|---|
| **S1** | **`globalSetup` calling `process.exit(0)` removes 100 % of e2e coverage.** `playwright test --list` never executes `globalSetup`, and the gate's only Playwright child is a listing. Verified: listing byte-identical (43 specs, 0 annotations, both canaries, `forbidOnly` true), parity gate 12/12, `pnpm -C e2e test` exit 0 with **zero specs run**. Worse than round 6's `test.only`, which left one running. The file already has a `StackNotRunningError` early-return path, so "exit gracefully when the stack is down" is the natural next edit and it is the one silent spelling. | A | **Critical** |
| **S2** | **`allInstalls` reuses an anchored matcher**, so five working install spellings walk past the uniqueness pin: `apt-get update && pnpm install`, `cd /repo && pnpm install`, **`pnpm i`** (a documented alias), `node …/pnpm/bin/pnpm.cjs install`, and the JSON exec form. The same commit had just derived `isPnpm` as a filename family for C9 and anchored on a literal one level down. | B | **Critical** |
| **S3** | **The compose `target:` regex requires end-of-line.** `target: base # comment` is dropped from the collected set entirely — the service goes unchecked while docker resolves it to a stage with no install. `target: "api"` captures the quotes and a long-syntax volume's `target:` is collected as a build target: two false reds in the same line. | B | **Critical** |
| **S4** | **The "independent" exclusion predicate shares its population.** Independent on the exclusion axis, `X \ X` on the population axis — and the `scanned.length > 0` guard that partly covered it was deleted in the same edit. A pathspec on `git ls-files` drops `ci.yml` and `docker-compose.yml` from the scan with both sides agreeing. Third consecutive appearance of `X \ X` in that block. | B | **Critical** |
| **S5** | **The vitest half observes no skip form at all.** `--filesOnly` is skip-invariant. `describe.skip` on `workflow-pins.test.ts` — the repository's only pin on third-party action SHAs — leaves it claimed, assigned, and the gate 12/12 green, with `pnpm test:unit` exit 0 at `251 passed \| 25 skipped`. SC57's stated reason ("not observable from a listing") is **measurably false**: the same subcommand without `--filesOnly` omits the file. | A | Major |
| **S6** | **`e2e`'s test script value is unpinned.** `--grep` with nine titles keeps all 9 files and both canaries and cuts 43 specs to 11, gate green. | C | Major |
| **S7** | **`pnpm typecheck`'s file set is read by nothing.** `apps/api` with `include: ["src"]` → exit 0, planted `TS2322` gone. SC58's asymmetry on the only type gate CI runs, recorded nowhere. | C | Major |
| **S8** | **SC58's own trigger fired in this cycle and the pin was deferred again.** Its text: "the next cycle touching root tooling — closed there with the three-line pin, not deferred again." This cycle rewrote root `package.json`, `pnpm-workspace.yaml` and `vitest.config.ts`. | C | Major |
| **S9** | **The seed gate's assertion bodies are unguarded.** `seed-gate-agreement` reconciles the *calls*; changing a comparison to `if false` leaves it 13/13 green while the CI step can no longer fail. | C | Major |
| **S10** | **SC56's route list omits two cheaper routes** — narrowing `on:` and `paths-ignore` — neither touching a job or a step. | C | Major |
| **S11** | **Required status checks are 403 on this repository.** `branches/main/protection` and `rulesets` both return `Upgrade to GitHub Pro or make this repository public`. SC56 deferred the out-of-band observer as a cost decision; it is structurally unavailable. **A red check does not block a merge here.** | C | Major |
| S12–S21 | `rel()` cells built from `workdir` so they pass for every value including the `/nonsense/` mutant they name; `stageOf`/`parentOf`/`inherits`/the 32-hop bound with no self-test; a comment crediting a `--forbid-only` flag the same commit deliberately does not pass; the `isPnpm` anchor cell passing under all four anchor variants; SC57's covered/uncovered boundary mis-stated; vitest `-t`/`--shard` invisible to `--filesOnly`; `allowOnly` environment-derived and unpinned; the `ci.yml` history comment false for the third round running. | all | Minor |

## What was done — the tools adjudicate

The user's decision was to stop widening text scans and move each verdict to whatever can actually
decide it. Concretely:

- **`globalSetup`/runtime-skip → the run's own report.** Playwright gains a JSON reporter; a CI step
  compares the *run's* `stats` against the *listing's* spec count and requires `skipped == 0`.
  Red-proven: with `process.exit(0)` planted, `pnpm test:e2e` still exits 0 and the step exits 1
  naming the absent report.
- **vitest whole-file skips → `vitest list --json`.** Compared per tier against `--filesOnly`;
  passes today, reds on `describe.skip`.
- **The Dockerfile stage graph → the built images.** The compose-ancestry text parse is **deleted**,
  not patched, and `compose-smoke` gains a step asserting every built image carries every member
  manifest from `pnpm list -r` with no dangling workspace symlink. It found a real defect on its
  first local run — a stale `open-smp-seed` image missing `e2e/package.json`, which text cannot see
  at all.
- **The install uniqueness pin → tokenised**, basename-compared, over a subcommand set including the
  `i` alias.
- **The scan population → two independent `git ls-files` spawns plus a floor**, and four named
  artifacts asserted to be in the population.
- **`typecheck` coverage → `tsc --listFilesOnly` in CI** (SC66), because the resolver's answer costs
  33 s wall and does not fit the unit tier's budget. The first attempt pattern-matched `include`
  globs and redded on `apps/web`, whose `**/*.ts` covers `test/` correctly — the contract's own
  error, committed while writing the assertion against it.
- **`lint` and `test:e2e` → pinned**, closing SC58 two cycles after its trigger.

## Recurring Issue Check

| Pattern | Status |
|---|---|
| "The listing is not the command that runs" | **Third and fourth occurrence** (globalSetup, vitest skips). Now stated as a rule rather than three SC entries: *an assertion whose subject is a listing can only see what collection sees.* |
| An enumeration written where a derivation belongs | **Recurred** (install spellings, compose `target:`). Nineteenth and twentieth. |
| A check that compares something to a copy of itself | **Recurred** — `X \ X` on the population axis, third consecutive appearance in that block. |
| Residue whose stated justification is false | **Recurred** — SC57's "not observable from a listing", the same defect SC60 had. |
| A derivation with no self-test | **Recurred** — `rel()`, `stageOf`/`parentOf`/`inherits`. |
| Judging a glob by its spelling instead of asking the resolver | **New, and self-inflicted** — in the assertion written against exactly that error. |
| The Critical is inside the previous round's fix | **Seventh consecutive round.** |
