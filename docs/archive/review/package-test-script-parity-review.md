# Plan Review: package-test-script-parity

Date: 2026-07-28
Review round: 1

## Changes from Previous Round

Initial review.

## Merge notes (process deviation, recorded)

The mechanical json-index join across the three experts was performed by the orchestrator from the experts' fenced `json` indices. The Ollama `merge-findings` prose merge was **skipped**: it requires writing the three ~8 000-word raw outputs to disk first, and all three were already fully in the orchestrator's context with machine-readable indices, so the local-LLM pass would have cost a large re-emission for a join already available. `pre-review.sh plan` (Step 1-3) did run and returned `No issues found`.

The per-expert `## Recurring Issue Check` sections are preserved below, with one compression: rules each expert marked purely `N/A` (no applicable surface in this plan) are collapsed into a single line naming their IDs. Every rule an expert marked `OK`, `Clear`, `FINDING`, `Hit`, or `Partial` is preserved with its verbatim reasoning. This is a deliberate deviation from verbatim preservation, taken because the evidentiary content of an `N/A` row is the ID itself.

## Convergence summary

| Merged | Severity | Raised by | Subject |
|---|---|---|---|
| **M1** | **Critical** | Func F1, Sec F2, Test F1 — **3/3** | C3's gate has no stated observation mechanism; every available design is either the forbidden parser, unbounded recursion, or tautologically green |
| **M2** | **Critical** | Sec F1 (escalated), Func F4 | C2's universal quantifier sweeps in `e2e`; the contract as written prescribes deleting its `test` script, and `pnpm --filter` exits **0** on a missing script — silently disabling the Playwright auth suite in CI |
| **M3** | **Critical** | Test F2, Sec F4, Func F7 — **3/3** | `vitest list` exits 0 with empty stdout on a non-matching filter, so ∅ == ∅ reads green; no positive control exists |
| **M4** | **Major** | Func F5, Sec F5, Test F5 — **3/3** | R45: gate measured at 2.6–2.8 s against a 0.99 s unit suite; SC48's threshold is unfalsifiable and its CI-only fallback contradicts F3 and SC50 |
| **M5** | **Major** | Func F3, Sec F7, Test F12 — **3/3** | C1 defines one script where the root defines two tiers; three members' `test` would require Docker, breaking the plan's own headline reviewer scenario |
| **M6** | **Major** | Func F2, Sec F2(rec), Test F1(rec) | C1 is locked without ever writing down the delegating script string |
| **M7** | **Major** | Sec F3 | C1's acceptance compares **counts**, not set membership; 14 wrong files pass |
| **M8** | **Major** | Sec F4, Test F4, Func F7 | Child exit status, stdout/stderr separation, `[project]` prefix, and path relativity all unspecified — four reproduced fail-open or false-red shapes |
| **M9** | **Major** | Test F3 | RT7 mutation set covers one direction of C2's iff; mutation 4 is a cleanup step, not a mutation |
| **M10** | **Major** | Test F6 | NF2's "still 29 files" fails **by construction** (the gate is the 30th), and the invariant it guards holds by construction anyway |
| **M11** | **Major** | Test F7 | C4's one-config invariant has no enforcing gate; the parity gate is structurally blind to the twin's return |
| **M12** | **Major** | Test F8 | R21: the plan never says a subagent's green report is not gate evidence |
| **M13** | **Major** | Test F11 (adj), Sec F6 | Child argv built from `pnpm list` output; a template-string `execSync` would be shell injection on the `checks` job |
| **M14** | **Minor** | Func F6 (adj) | Root config's `poolOptions`/`singleFork` is **inert** under vitest 4; the integration tier is not serialized as declared, and the DEPRECATED banner pollutes every child's stderr |
| **M15** | **Minor** | Func F8 | Two repo conventions unaccounted for: `ci.yml`'s declared-package-runs-its-own-binary rule, and per-package `vitest` devDeps that stay load-bearing for `pnpm typecheck` |
| **M16** | **Minor** | Func F9 | "Silent green" for api/worker/schema holds only where Docker is available; precondition unstated |
| **M17** | **Minor** | Sec F6, Test F10 | vitest positional filters are plain **substring** matches, not directory paths |
| **M18** | **Minor** | Test F9 | R16: VE3's `pnpm`-on-PATH coupling is asserted but no plan step verifies it |

Perspective convergence (≥2 experts, same root cause) raised M3 to Critical and M4/M5 to a Major floor.

## Functionality Findings

Reviewer independently reproduced the plan's entire measured-state table, the 29/6 authoritative sets, all three `ci.yml` line numbers, `packages/crypto` exit 1, and the `packages/connectors/*` separate-glob claim. **C1's member set was re-derived and found identical — 8 members, no delta.**

- **F1 — Critical** — C3 as locked has no implementable design. Three admissible branches: (1) gate reproduces the command itself → RT7 mutation #1 stays green because the script is never read; (2) gate transforms the script string → explicitly forbidden by C3; (3) gate executes the script verbatim → the gate lives in `apps/api/test/`, so `pnpm -C apps/api test` re-collects the gate → unbounded recursion. Measured supporting fact: `vitest list --filesOnly` with cwd `apps/api` yields the **broken** 1-file result, so a cwd-based reproduction reproduces pre-change behavior.
- **F2 — Major** — C1 is `locked` without stating the artifact. Line 54's depth-independence justification is satisfied by at least two materially different forms (`pnpm -w exec vitest run "$PWD"` — byte-identical across packages, gate-reproducible; vs. a repo-relative directory argument — per-package, not gate-reproducible). The choice is load-bearing for whether C3 is buildable at all.
- **F3 — Major** — C1's consumer walkthrough is insufficient. (a) The root deliberately splits `test:unit` / `test:integration` into separate CI jobs because the second needs Docker; C1 defines **one** script spanning both, so the developer whose need is "run this package's unit gates without a Docker daemon" — scenario 1's reviewer — has no command. The missing requirement is not a field, it is a **tier selector**. (b) Walkthrough entry 2 omits that `pnpm -r test` today reports `Scope: 11 of 12` and fans into `e2e`, running Playwright; after the change it would also launch three concurrent integration runs. Scenario 4 is wrong in two ways.
- **F4 — Major** — C2's invariant domain is unbounded. `pnpm list -r --depth -1 --json` returns 12 entries including `e2e` and the repo root; the carve-outs exist only as prose in C1 and SC49, not in the invariant C3 implements. **And the plan's twice-stated claim that "CI invokes only root scripts" is false**: root `test:e2e` is literally `pnpm --filter e2e test` (`package.json:15`, `ci.yml:147`), and `ci.yml:140-143` carries a comment explaining why that indirection is required.
- **F5 — Major** — R45 measured: root `pnpm test:unit` ≈ **1.00 s** (652 ms reported, 29 files, 264 tests); 8 per-member + 1 root `vitest list` spawns sequential ≈ **2.64 s**. The gate is ~2.6× the suite it joins. SC48's threshold ("a reasonable unit-suite budget") names no number so it can never be found to have fired, and its fallback ("CI-only placement") contradicts F3 and SC50 — three locked statements cannot all hold.
- **F6 — Minor — [Adjacent, Testing]** — `vitest.config.ts` declares `pool: 'forks', poolOptions: { forks: { singleFork: true } }` under vitest 4.1.10, which prints `DEPRECATED test.poolOptions was removed in Vitest 4`. **`singleFork` is not applied** — the integration tier is not serialized as the config states. The banner goes to **stderr** on every invocation (stdout verified clean), so the gate must not merge `2>&1`.
- **F7 — Minor** — R44: `vitest list --filesOnly` returns **exit 0 with empty stdout** on a zero-file resolve, so "no lines" is indistinguishable from "child crashed". Verified in the other direction that the delegation layers are *not* lossy: `pnpm -w exec node -e 'process.exit(3)'` → 3.
- **F8 — Minor** — (a) `ci.yml:140-143` records the convention "`--filter e2e`, not a bare `pnpm exec`: `@playwright/test` is declared in `e2e/package.json` only"; C1's form does the opposite for vitest (safe — root declares `vitest@^4.1.10` — but should be said). (b) Every member except `packages/queues` declares `vitest` in its **own** devDependencies, and `pnpm typecheck` is `pnpm -r --parallel exec tsc --noEmit` over tsconfigs that `include: ["src","test"]`, so those devDeps stay load-bearing after the scripts stop resolving vitest locally. Also: `packages/queues` declares `"test": "vitest run"` with **no dependencies at all** — a second, independent R41 instance.
- **F9 — Minor** — The three "silent green" packages resolve integration files only, so they report green **only where a Docker daemon is available**; without one the same scripts are loud red. A Phase-2 engineer reproducing the table without Docker will conclude the measurement is wrong.

## Security Findings

Reviewer independently confirmed the 12-entry workspace membership, the 29/6 assignment, that all 44 tracked test-like files fall inside one of the two projects, and that `apps/web/vitest.config.ts` declares only `include` — no `environment`, no `setupFiles` — so **C4's deletion is resolution-neutral. No finding on C4.** Also measured: vitest's positional filter is a **plain substring, not a regex** (`apps/.pi` → 0 matches).

- **F1 — Critical — `escalate: true`** — F2/C2 read literally delete `e2e`'s `test` script, and `pnpm --filter` turns that into a green CI E2E job. `e2e` is a workspace package by the plan's own enumeration authority, declares `"test": "playwright test"`, and has zero vitest assignment; C2 says "Equality, not containment — both directions are failures", and neither F2 nor C2's invariant nor its acceptance encodes SC49's carve-out. **Measured**: `pnpm --filter <pkg> test` where the package lacks the script → **exit 0, no output** (unlike `pnpm -C <pkg> test` → exit 1). Root `test:e2e` is `pnpm --filter e2e test` at `ci.yml:147`, so removing the script makes `compose-smoke` pass while running zero Playwright specs — silently dropping `auth.spec.ts`, `session-expiry.spec.ts`, and seven other flows. `assert-seed-preserved.sh` also passes, because nothing mutated the seed.
  `escalate_reason`: crosses a trust boundary (CI verification of the authn/session E2E suite) and chains three individually-benign steps — a universal contract clause, the deletion it prescribes, and pnpm's exit-0 masking — into silent removal of the only end-to-end auth gate.
- **F2 — Critical — `escalate: false`** — The gate cannot observe what C3 says it observes. `vitest run --filesOnly` → `CACError: Unknown option --filesOnly` (verified, vitest 4.1.10); only the `list` subcommand lists without executing, and no member's script will contain `list`. So the gate must construct the command itself, encoding its own belief with no coupling to the script's actual value; if the root side is computed the same way, both sides are the same computation on the same inputs and the assertion is a tautology. Consequence: `apps/api`'s script could be reverted to bare `vitest run` — restoring today's state where `api-types-boundary.test.ts` and `saas-app-key-pin.test.ts` never execute — and the parity gate stays green.
  `escalate_reason`: self-contained gate-design defect with a single named remedy and an existing mutation (RT7 #1) that detects it.
- **F3 — Major** — Counts are a lossy identity channel. C3's invariant says "set equality", but C1's Acceptance and the Testing strategy both measure **counts**. Any 14 files under `apps/api/test/` satisfy it. The path shapes make the lazy route attractive: root list emits repo-root-relative paths, a package-cwd list emits package-relative ones. Recommend: normalize to repo-root-relative and compare sets; add named canaries for `api-types-boundary.test.ts` and `saas-app-key-pin.test.ts` — two files whose absence *is* the security event this cycle was opened for.
- **F4 — Major** — No fail-closed handling of child failure. If the spawn mechanism breaks systemically (vitest major bump changing `list` output, different installer layout, `pnpm -w exec` removed), every child returns non-zero or empty stdout, **both** sides become ∅, and the gate reports green having verified nothing. Second channel: the `DEPRECATED poolOptions` banner on stderr is parsed as a file if streams are merged.
- **F5 — Major** — Measured 265–320 ms per spawn warm, **2.6 s for 9**, against vitest's default `testTimeout` of 5000 ms — and the gate runs inside the unit pool while 28 other files execute across worker threads, on a 2-core hosted runner with cold caches. Assessed against R45's Critical criterion and **not** escalated: it fails red, not open. The damage is second-order (timeout inflated, `.skip`ped, or relocated) and SC48 pre-authorizes exactly that relocation.
- **F6 — Minor** — Construct child commands as argv arrays. `ci.yml` triggers on `pull_request`, so the package list is attacker-influenceable via a PR; a template-string `execSync` injects into the runner's shell. Honest calibration: the `checks` job already runs `pnpm install --frozen-lockfile` and the PR's own tests, so arbitrary execution there is the pre-existing baseline — it is gratuitous, not novel. Separately, substring semantics over-match nesting (`packages/connectors/google-workspace-admin` would be swept into `google-workspace`'s run).
- **F7 — Minor — [Adjacent, Functionality]** — After C1, `pnpm -C apps/api test` resolves 15 files including `api.integration.test.ts`, so a reviewer without Docker gets a red run for a reason unrelated to the gate they came to check. Fail-closed, so no exposure — but a command that is red on a clean clone teaches people to route around it.

## Testing Findings

Reviewer independently reproduced 29/6 and the full member table, confirmed `packages/queues` contains `src/index.ts` only, confirmed **only two** vitest configs exist repo-wide, measured the unit suite at **0.99 s** (648 ms, 29 files, 264 tests, green) and nine sequential list-spawns at **2.77 s**, and established that the three existing gates in `apps/api/test/` are **entirely in-process** (`readFile`/`readdir` plus a live import) — none spawns a child. The proposed gate is a departure from that convention, not an instance of it.

- **F1 — Critical** — The gate has no stated mechanism, and every mechanism that exists is either the forbidden parser, recursion, or vacuous. Verified: `vitest run --filesOnly` → `CACError`. Under the constructed-command design, **RT7 mutation 1 would stay GREEN** and be recorded as proof. Recommended decomposition: **left half** asserts `pkg.scripts.test` is *exactly equal* to a canonical string computed from that package's own directory — an allowlist-of-one, the shape `api-types-boundary.test.ts` already uses, neither regex nor parse; **right half** spawns the canonical form and asserts the resolved set equals the root-assigned set. Neither side derived from the other. Add a discriminating mutation: change one script to a **valid but wrong-scope** command (e.g. `--project integration`) — a tautological gate stays green, a correct one reds on the left half. Reject in advance the tempting `"test:list"` sibling script — that is an RT9 twin of the script under verification.
- **F2 — Critical** — Verified vacuous-pass path: `vitest list --filesOnly packages/nonexistent` → **exit 0, 0 lines**. If enumeration ever produces a path that is not a real directory (rename, relativization bug, trailing-slash bug), both sides resolve zero, the child exits 0, and equality passes. Exit-status checking cannot catch it; set equality cannot catch it. Recommend three derived positive controls: member set non-empty; every member's root assignment non-empty; and a **reconciliation** — the union of per-member assigned sets plus the named non-members' zero sets equals the full root `unit ∪ integration` set. Plus mutations M5 (member path → nonexistent dir) and M6 (enumeration forced to `[]`).
- **F3 — Major** — RT7: mutations 2 and 3 are the **same direction** (the plan says so itself), and mutation 4 is a cleanup step, not a probe — the list looks like four but is two-and-a-half. C2 claims "both directions are failures" and the other direction is never mutated. The unmutated direction is the one a naive implementation gets wrong: a gate iterating over *packages declaring a `test` script* silently drops a package that has tests but no script. Proposed eight-mutation table: M1 bare-revert → red; M2 `api-types` gains a script → red; **M3 delete `test` from `packages/crypto`** (tests-without-script, the missing direction) → red; M4 valid-but-wrong-scope → red; M5 nonexistent dir → red; M6 empty enumeration → red; M7 child forced non-zero (`--project bogus`) → red; M8 re-add `apps/web/vitest.config.ts` → red.
- **F4 — Major** — R44, four reproduced shapes: (a) `vitest list --filesOnly --project bogus` → exit 1, **0 stdout lines**, error on stderr; also `vitest list --json <dir>` → exit 1 with `EISDIR` because `--json` takes an optional value and swallows the positional. (b) The `DEPRECATED poolOptions` banner is on stderr for **every** invocation, and the plan's own documented capture idiom is `> file 2>&1` — merging it inserts a phantom file. (c) Output lines carry a `[unit] `/`[integration] ` prefix; stripping via `split(' ')[1]` breaks on paths containing spaces. (d) Path relativity differs by cwd; normalizing by `basename` collides across packages.
- **F5 — Major** — R45 with both numbers measured (0.99 s suite, 2.77 s gate ≈ **4×**). There is no "reasonable budget" under which this is a judgment call. Recommend a numeric budget, concurrent spawns (`Promise.all` over `spawn`, collapsing to roughly one vitest startup), and — if the CI-only fallback is nevertheless taken — an explicit job timeout with a note that a timed-out gate is a red, not a skip.
- **F6 — Major** — NF2 is mis-specified and **fails by construction**: the gate is itself a new unit-project file, so root `test:unit` resolves **30** after the change. Whoever runs it will "adjust" it, and an adjusted acceptance criterion is the one that stops catching things. Separately it has no teeth: `vitest.config.ts` declares `projects` as **inline objects**, not config paths, so a root-cwd run never discovers `apps/web/vitest.config.ts` at all — deleting it *cannot* change root resolution. Recommend restating NF2 as "the 29 pre-existing files retain identical membership; the only permitted diff entry is the new gate file, named explicitly", and promoting the check that can actually regress (`pnpm -C apps/web test` → same 6) into NF2 proper.
- **F7 — Major** — RT9: deleting `apps/web/vitest.config.ts` is the **right call** (confirmed sole twin; the local config's `include: ['test/**/*.test.ts']` with no `exclude` is strictly weaker and would sweep a future `apps/web/**.integration.test.ts` into the unit-ish run). But C4's invariant has **no enforcing gate**: C1's forbidden-pattern grep is review-time, and C3 forbids the gate from parsing config source. Worse, the parity gate is structurally blind — under the delegating form the child's cwd is the repo root, so a re-added twin is never consulted, the resolved set stays 6, and the gate stays green. Recommend a **filesystem existence check** (enumerate `vitest.config.*` / `vitest.workspace.*` excluding `node_modules`, assert exactly `['vitest.config.ts']`) — counting files that exist is not inferring behavior from dialect-bearing text, and the plan should say so explicitly so Phase 2 does not talk itself out of it.
- **F8 — Major** — R21: the Testing strategy says which gates run but never says *by whom*, and never states that a subagent's green report is not evidence. The specific regression invited: a subagent edits eight `package.json` files, reports green, and the mutation results are recorded from that report — leaving a tautological gate believing it was proven.
- **F9 — Minor** — R16: VE3's coupling is asserted, never verified. Probed and found the **format stable**: `CI=true` and a simulated vitest-worker env (`VITEST=true VITEST_WORKER_ID=1 VITEST_POOL_ID=1`) both produce identical output and exit 0. Residual risk is narrower than VE3 implies — it is `pnpm` being resolvable on PATH inside a vitest worker's spawned child, and nothing else.
- **F10 — Minor** — Positional filters are substring, not directory containment. Latent today (no member path is a prefix of another — verified across all 12 entries), but `packages/connectors/core-v2` would over-match. Recommend re-filtering returned paths to those starting with `<dir>/` so the substring filter is a performance hint and the directory boundary is the predicate.

## Adjacent Findings

- **Func F6 → Testing** — Major-adjacent: root config's `poolOptions`/`singleFork` inert under vitest 4; integration tier not serialized as declared; DEPRECATED banner on every child's stderr.
- **Func RT3 → Testing** — the recommended exact-equality design introduces a shared canonical-string constant; its placement is the Testing expert's call.
- **Func RT7 → Testing** — mutation #1 unsatisfiable under the only branch consistent with C3's other clauses.
- **Sec F7 → Functionality** — Minor: delegating form makes `pnpm -C apps/api test` require Docker, degrading the reviewer path.
- **Test F11 → Security** — Major: child argv built from `pnpm list` output; a template-string `execSync` is shell injection on the `checks` job. Recommend `spawnSync(bin, argsArray, { shell: false })` in C3's signature.
- **Test F12 → Functionality** — Minor: C1's acceptance silently requires Docker for 3 of 8 members, including scenario 1's reviewer flow. Confirmed **not a regression** (those three already need Docker today), but the resulting developer contract is never stated.

## Quality Warnings

None. Every finding above carries reproduced evidence — commands run and outputs observed — rather than an assertion from reading. All three experts measured the plan's own claims independently before reporting, and all three explicitly credited the parts that reproduced exactly (the 29/6 sets, the full per-member table, the `ci.yml` line numbers, C1's member set, and C4's behavioral neutrality).

## Recurring Issue Check

### Functionality expert

- R1: OK — no existing workspace-enumeration or subprocess helper (`child_process`/`execSync`/`spawnSync` grep across `apps`, `packages`, `e2e` returns nothing); the gate introduces the first.
- R2: OK — no constant duplicated; the plan explicitly forbids a hardcoded expected file list.
- R3: FINDING F4 — member-set reasoning applied to C1 and not propagated to C2.
- R10: OK — no module cycle; the only circularity risk is process-level (F1 branch 3).
- R13: FINDING F1 — branch 3 is a re-entrant dispatch loop with no depth bound.
- R16: FINDING F2 (partial) — verified `pnpm -w exec` resolves to the repo root and propagates exit codes locally, and CI's `pnpm install --frozen-lockfile` gives the same layout with the same pinned `pnpm@10.34.5`; the unverified divergence is `"$PWD"` expansion under pnpm's script shell on `ubuntu-latest` vs `darwin`. `packages/queues` and `packages/api-types` have **no `node_modules` at all** locally — the gate must not assume per-package installs.
- R20: OK — the `package.json` edits are single-value replacements.
- R29: OK — no external spec cited; the vitest `root`-from-cwd behavior is asserted from execution and was reproduced.
- R30: OK — no autolink-prone citations.
- R31: OK — the one destructive act (deleting `apps/web/vitest.config.ts`) is contracted in C4 with a walkthrough and acceptance criterion; confirmed safe (root `test:unit` already reaches those exact 6 files and passes).
- R33: FINDING F4 — only one workflow exists, so no duplicated config, but the plan's claim that no CI path executes a package-level `test` script is false (`ci.yml:147` → `pnpm --filter e2e test`).
- R34: FINDING F6 — inert `poolOptions`/`singleFork` deferred without cost justification.
- R36: OK — no warning suppressed; the live vitest DEPRECATED warning is the opposite case (F6).
- R40: OK — no cross-boundary serialization; the one cross-process shape is addressed in F6/F7.
- R41: FINDING F1, F4, F8(b) — the plan's subject is an R41 instance and the fix closes it for the eight members, but (i) the *gate* may itself be a declared-but-non-working capability and (ii) `packages/queues` is a second R41 shape closed without naming the mechanism.
- R42: FINDING F4 — **C1's member set independently re-derived and correct (8 members, no delta, including the indirect `packages/connectors/*` glob members)**; C2's is not, and its literal domain (12 entries) sweeps in `e2e` and the repo root.
- R44: FINDING F7 — the delegating chain is verified non-lossy (`pnpm -w exec` propagates exit 3), but per-child status attribution is unspecified and `vitest list` exits 0 on an empty resolve.
- R45: FINDING F5 — ~2.64 s of gate spawns against a ~1.00 s unit suite; SC48's threshold unstated, fallback contradicts F3 and SC50.
- RT2: OK — every proposed check is executable locally and in CI (VE3 correct).
- RT3: [Adjacent] — F1's exact-equality design introduces a shared canonical constant; placement is Testing's call.
- RT7: FINDING F1 — the four mutations are correctly demanded, but #1 is unsatisfiable under the only branch consistent with C3's other clauses. [Adjacent → Testing]
- RT9: OK — C4 correctly identifies the twin and removes it; verified the root config already resolves the identical 6 files and that no consumer references the file (repo-wide grep over `*.ts`, `*.json`, `*.md`, `*.yml`, `*.mjs`, `*.js` outside `docs/archive/`).
- N/A (no applicable surface): R4, R5, R6, R7, R8, R9, R11, R12, R14, R15, R17, R18, R19, R21, R22, R23, R24, R25, R26, R27, R28, R32, R35, R37, R38, R39, R43, R46, RS1–RS6, RT1, RT4, RT5, RT6, RT8.

### Security expert

- R1: No shared utility reimplemented; the gate is new logic with no existing twin. Clean.
- R2: F3 recommends one shared canonical `test` literal rather than eight copies — currently the plan implies eight identical strings with nothing binding them.
- R3: Propagation across the 8 members verified complete against `pnpm list -r`; the incomplete propagation is at the **domain** level — F1.
- R7: No E2E selector change; the E2E risk here is the suite not running at all (F1).
- R10: No circular module dependency; the gate importing nothing from `apps/api/src` keeps it acyclic. Clean.
- R13: Recursion assessed — `vitest list` does not execute files, so no self-invocation; but the recursion-free choice is precisely what forces the tautology in F2.
- R16: VE3 flags the `node_modules`-layout dependency but derives no gate obligation from it — folded into F4.
- R17: 8/8 members must adopt the delegating form; membership verified complete. Clean at member level.
- R18: The `e2e` carve-out is an unstated safelist entry — F1.
- R20: Mechanical edit across 9 `package.json` files; all scripts are single commands (verified). Clean.
- R21: Plan mandates observed results over asserted ones. Clean, **provided RT7 mutation 1 is actually executed** — F2.
- R29: No external spec citation; vitest behavior claims re-verified by execution. Clean.
- R30: No markdown autolinks. Clean.
- R31: C4 deletes `apps/web/vitest.config.ts` and C2 deletes a `test` script — both reversible, both with stated acceptance evidence; C4's neutrality independently confirmed (config declares only `include`). Clean.
- R33: One workflow, one `test:unit` site (L25), one `test:e2e` site (L147) — no duplicate CI config to drift, **not** escalated. Inverse risk live: SC48 pre-authorizes moving the gate CI-only, creating a control present in CI and absent locally — F5.
- R34: SC47 is cost-justified and ownership-assigned. Clean.
- R36: The plan explicitly rejects `--passWithNoTests` as suppression — good instinct. Clean.
- R40: The gate consumes `pnpm list --json` and `vitest list` stdout across a process boundary with no shape validation and no empty-output handling — F4.
- R41: C3 declares "observes by running the script" and no such path exists (`vitest run --filesOnly` → `CACError`) — **F2**.
- R42: **Recomputed independently.** `pnpm list -r --depth -1` yields exactly the plan's 8 members + 4 named non-members; per-package counts match line for line; 29/6 reconcile; all 44 tracked test files accounted for. **C1's member set is correct and complete.** The class-membership defect is one level up, in C2's universal quantifier, where `e2e` is a member the contract text does not exempt — **F1, Critical (fail-open)**.
- R43: Assessed. `pnpm -C apps/api test` goes 1 → 15 files, adding the integration tier — widens what executes, fail-closed, and widens no trust or privilege. No credential, key, session, or privileged-operation recipient added — F7 (Adjacent, Minor).
- R44: **Three distinct instances** — the gate's tautology (F2, Critical), count-vs-set comparison (F3), unread child status / empty-set equality (F4). Plus the pre-existing `pnpm --filter` exit-0 channel that makes F1 silent.
- R45: **Measured** 2.6 s for 9 warm spawns vs a 5000 ms default `testTimeout`, under pool oversubscription in CI. Fails **red**, so it does not meet R45's Critical criterion; rated Major — F5.
- RS2: No new routes; login rate limit untouched (VE2 adds no logging-in spec). Clean.
- RS3: The gate's boundary is child-process stdout — unvalidated for shape or emptiness (F4); package paths crossing into command construction (F6).
- RS4: Checked. The remedy commits no artifacts. `e2e/.auth/`, `e2e/playwright-report/`, `e2e/test-results/` are all gitignored (`.gitignore:15,18,19`) and untracked. `ci.yml:50-51` carries seeded demo credentials as literals — pre-existing, out of scope. No finding.
- RS6: No escaping/sanitization ordering; vitest's positional filter is substring, not regex (verified), so no escaping required — F6 covers the shell-argv side.
- RT2: Every finding above is testable in this environment; all were verified by execution.
- RT3: F2's recommendation is exactly RT3 applied to the eight `test` script strings.
- RT5: The gate's call path must include the real primitive (the package script) and currently cannot — F2.
- RT7: Four mutations stated, sound in form; mutation 1 is the single check that detects F2, and mutation 2 collides with the `e2e` domain question in F1 — the set needs a fifth: remove `e2e`'s `test` script → root `test:e2e` must not stay green.
- RT9: `apps/web/vitest.config.ts` correctly identified as a twin and deleted; independently confirmed behavior-neutral. **Clean — this part of the plan is right.**
- N/A (no applicable surface): R4, R5, R6, R8, R9, R11, R12, R14, R15, R19, R22, R23, R24, R25, R26, R27, R28, R32, R35, R37, R38, R39, R46, RS1, RS5, RT1, RT4, RT6, RT8.

### Testing expert

- R3: **Hit (F7)** — the "one resolution authority" pattern is applied to package scripts but not propagated to an enforced config-uniqueness check.
- R7: Clear — VE2 correctly records that no new E2E spec is added; login rate budget 5/5 untouched.
- R10: Clear — the "recursion question" note addresses the module-cycle analogue; the note is only sound under the constructed-command designs, folded into F1.
- R12: **Hit (F3)** — C2's iff is an enum-of-two-directions and only one direction is mutated.
- R13: Clear — the gate's self-invocation risk is covered under F1(b).
- R16: **Hit (F9)** — VE3's coupling asserted, not verified; probed and found low-risk but unchecked by the plan.
- R17: Clear — the delegating form is adopted by all eight members, no partial adoption.
- R18: Clear — the plan correctly picks the executed enumeration (`pnpm list -r`) over the `pnpm-workspace.yaml` glob, closing the allowlist-sync risk.
- R19: N/A — no mocks in the gate; existing gates use real filesystem reads.
- R20: Clear — the eight `package.json` script edits are single-statement mechanical edits.
- R21: **Hit (F8)** — no requirement to re-run gates after subagent work.
- R27: Clear — the "29 / 6" counts live in a plan doc, not shipped strings (but see F6 for the 29 being wrong post-change).
- R29: Clear — the vitest behavior cited (config found upward, `root` from cwd; `list` does not execute) was verified by execution, not quoted from docs.
- R30: Clear — no autolink-bearing citations.
- R31: **Partial** — `packages/queues`'s `test` script and `apps/web/vitest.config.ts` are both deletions; both recorded with a walkthrough and rationale, neither destroys user data. Acceptable.
- R33: Clear — one CI workflow only; no duplicate config to drift. Confirmed by file listing.
- R34: Clear — SC47 deferred with a named owner and an explicit statement that the change makes the gap visible without filling it. Cost-justified.
- R36: Clear — C2 explicitly rejects `--passWithNoTests`, which is the suppression-as-fix move here; the rejection is correctly reasoned.
- R37: Clear — C2's acceptance requires pnpm's missing-script error rather than vitest's no-files error, on comprehensibility grounds. Good.
- R40: Clear — no cross-boundary serialization; but see F4 on the `[project] ` prefix and cwd-relative path shapes, the same class in miniature.
- R41: **Hit (F7)** — C4 declares an invariant with no backing enforcement path.
- R42: **Hit (F2)** — the plan derives the member set from `pnpm list` (correct) but has no anti-vacuity control if that derivation yields an empty or wrong set.
- R44: **Hit (F4)** — child exit status and output channel unspecified; two fail-open shapes reproduced.
- R45: **Hit (F5)** — gate cost ~4× the entire unit suite, measured; deferral criterion unfalsifiable.
- RS3: Clear in scope; see the Adjacent security flag on argument construction from `pnpm list` output.
- RS4: Clear — no personal-identifying data in the plan or the proposed gate.
- RT1: Clear — no mocks anywhere; both sides are real executions. **The plan's strongest property.**
- RT2: Discharged — every recommendation checked against this infrastructure: `spawnSync` from a vitest unit test is viable (measured 2.77 s for nine children), filesystem existence checks match the existing `workflow-pins.test.ts` idiom, and the mutation list is executable by editing `package.json` files and re-running `pnpm test:unit` (0.99 s). No untestable recommendation made.
- RT3: Clear — F2's reconciliation recommendation is explicitly derived, not a shared constant.
- RT4: **Hit (F1, F2)** — the constructed-command design makes both sides the root config; and `∅ == ∅` with exit 0 is a verified vacuous pass.
- RT5: **Partially satisfied, at risk** — vitest's own resolver is the production primitive and `vitest list` does reach it, but under the constructed-command design the gate reaches the resolver *for a command it invented*, never for the artifact under test.
- RT7: **Hit (F1, F2, F3)** — four mutations listed, one of which is not a mutation, two of which are the same direction, none covering the silent-vacuity shapes. Eight replacements proposed.
- RT8: **Hit (F2)** — the C2 direction is asserted as a status without the mutation that proves it can fire in the tests-without-script direction.
- RT9: **Hit (F7)** — the twin deletion is correct and no other twin exists (verified), but nothing prevents its return, and the parity gate is structurally blind to it.
- N/A (no applicable surface): R4, R5, R6, R8, R9, R11, R14, R15, R22, R23, R24, R25, R26, R28, R32, R35, R38, R39, R43, R46, RS1, RS2, RS5, RS6, RT6.

---

# Plan Review: package-test-script-parity — Round 2

Date: 2026-07-28
Review round: 2 (incremental)

## Changes from Previous Round

Revision 2 of the plan: C1–C3 redesigned (tiering, canonical script forms, two-half gate), C5 (one-config enforcement) and C6 (pool repair) added, NF2 restated, mutations expanded 4 → 9, SC51/SC52 added, SC48 deleted. All 19 round-1 merged findings were reflected. Round 2 asked each expert to verify the fixes rather than trust the disposition table, and specifically to recompute D2.

## Convergence summary

| Merged | Severity | Raised by | Subject |
|---|---|---|---|
| **N1** | **Critical** | Sec F1 | Every derivation descends from the root `vitest list` output, which nothing audits. Narrowing one glob shrinks D1, the partition and the reconciliation in lockstep — reconciliation is `union(partition(X)) == X`, an identity for **every** X. Both security gates leave CI silently. |
| **N2** | **Critical** (escalated) | Sec F2 | SC52 defers a channel still open by a second route: `pnpm --filter <nonexistent> test` exits **0** (`No projects matched the filters`), so renaming the `e2e` package reproduces round 1's escalated Critical in full. C2 clause 3 gates only the script-deletion route. |
| **N3** | **Major** | Func F1, Test F6 — **2/3** | The domain formula `D1 ∧ D2` admits the **repo root** (declares `vitest@^4.1.10`, assigned 29 files). "Exactly equal — the same eight packages" is refuted: both yield nine. The exclusion lived only in C1's non-member prose. Also breaks C3 control 3's "non-members' zero sets" clause, which is false for the root. |
| **N4** | **Major** | Func F2, Test F3, Sec F5 — **3/3** | C6 was locked on a repair that does not exist: **`singleFork` has 0 occurrences in vitest 4.1.10** (removed, not relocated; top-level options are `fileParallelism`/`maxWorkers`/`minWorkers`/`isolate`). Its acceptance ("no `DEPRECATED` line") is satisfied by *deleting* the declaration — the R36 suppression shape. Func additionally showed the intent is not wanted: every integration file provisions its own containers, and the tier runs green in parallel (7.00 s wall vs 16.10 s test time). |
| **N5** | **Major** | Func F3, Sec F3 — **2/3** | C2 clauses 2 and 3 rest on an undefined "test-runner dependency" predicate. Both implicit readings fail: a named allowlist contradicts C2's own rejection of name-keyed lists unless justified; "declares any dependency" makes clause 2's exemption free and clause 3 a false red everywhere. |
| **N6** | **Major** | Test F1 | `canonical()` and the gate's spawn argv are two independently hand-written copies, so a defect in the producer is written into all eight scripts, compared against itself by the left half, and bypassed by the right half's separately-correct argv — eight broken scripts, gate green. No mutation reaches it. |
| **N7** | **Major** | Func F4 | C2's acceptance asserts exit **1** for the missing-script case. Measured: **254** (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`) — and exit 1 is the **pre-change** value, so the criterion cannot discriminate the change from its absence. Its stated comprehensibility rationale is also refuted by the actual message. |
| **N8** | **Major** | Sec F4 | D1 ≡ D2 is asserted in prose only — absent from C3's assertion list and from every mutation. Deleting `vitest` from `apps/api`'s devDeps would drop it from the domain and restore today's condition for both security gates. |
| **N9** | **Major** | Test F2, Sec F6 — **2/3** | Tiering doubled the artifact-binding surface and no mutation touches `scripts['test:integration']` in either direction. C3's "where applicable" leaves the tier predicate to implementer judgement. |
| **N10** | **Major** | Test F4, Func F6 — **2/3** | C6 removes the only observable stderr producer in the repo, so C3's stdout-only rule loses its evidence and becomes unenforceable. Conversely, if C3 asserts stderr-emptiness, integration children red until C6 lands — an unstated ordering dependency that would corrupt the M-runs. |
| **N11** | **Minor** | Test F5 | Tier-map collapse is fail-red but unexercised; reconciliation's independence from the tier map is unstated (else it is `union(partition(S)) == S`, true by construction). |
| **N12** | **Minor** | Test F7 | NF1's 338 ms covers 8 of 11 children; the complete concurrent set measures **419 ms**. The scheduled CI re-measurement would have compared unlike quantities. |
| **N13** | **Minor** | Test F8 | The `pnpm --filter` script-missing masking is specific to `test` being a pnpm built-in shorthand (`pnpm --filter <pkg> testnothere` → exit 1). Distinct from N2's route, which holds for any script name. |
| **N14** | **Minor** | Func F5 | C5's exclusion set (`node_modules` only) is narrower than the repo's declared ignore set at `eslint.config.mjs:5`; it walks `apps/web/.next` (138 files) and `.git`. |
| **N15** | **Minor** | Sec F1 | SC49's claim that D1 would flip for `e2e` is **false** — the unit globs (`packages/**`, `apps/**`) cannot reach `e2e/`. An `e2e/foo.test.ts` would be assigned by no project and run by nothing. |

**Contradiction between experts, resolved by the orchestrator.** Functionality reported D1/D2 both admit the repo root (nine entries); Security reported D1 ≡ D2 = exactly eight. Both are right about different things: Security computed D2 over the non-root entries, implicitly applying D0. The orchestrator re-measured directly — root declares `vitest@^4.1.10` and `vitest list --project unit ./` → 29 files — confirming that the formula **as written** admits the root. Functionality's finding stands; the eight-member set is correct only once D0 is stated. Both experts converge on the same remedy.

**Orchestrator re-verification of the two Criticals** (neither taken on trust):

- N1 reproduced cleanly after discarding a first attempt contaminated by placing the modified config outside the repo (which moves vitest's resolution base). With the narrowed config inside the repo root: root unit **29 → 14**, `apps/api/` partition → **0**, exit 0 throughout.
- N2 reproduced exactly: `pnpm --filter e2e-renamed test` → exit **0**, `No projects matched the filters`. The proposed remedy was verified both ways: `pnpm -C e2e exec playwright test --list` → **43 tests in 9 files**, exit 0 — identical to `pnpm --filter e2e exec playwright test --list`; `pnpm -C e2e-nope exec playwright test` → exit **1**, `ENOENT`.

## Functionality Findings (Round 2)

All nine round-1 dispositions verified correct, with the plan's premises independently re-measured (`CACError` on `run --filesOnly`; both canonical forms from `apps/worker`; `pnpm -r test` → `Scope: 11 of 12`; 8 concurrent children at **351 ms**, all exit 0, all stderr empty; integration baseline 6 files / 143 tests green at 7.00 s wall).

- **F1 — Major** — N3. Includes the observation that C3 control 3's "non-members' zero sets" clause cannot be implemented: the root's assigned set is 29, not zero. Recommends `D0 ∧ D1 ∧ D2` with D0 derived from `pnpm list -r` itself.
- **F2 — Major** — N4, with the stronger form: the repair named does not exist, the acceptance passes on the outcome it exists to prevent, and the plan never asks whether serialization is wanted. NF1 imposes a hard budget on the gate while C6 — the larger blast radius — gets none.
- **F3 — Major** — N5.
- **F4 — Major** — N7.
- **F5 — Minor** — N14.
- **F6 — Minor** — N10 (ordering half).

## Security Findings (Round 2)

Round-1 dispositions verified fixed. D2 recomputed independently over non-root entries and found equal to D1. New measurements: `pnpm --filter` with a non-matching filter → exit 0; per-file Testcontainer construction confirmed at `packages/schema/test/rls.integration.test.ts:207` and `apps/api/test/api.integration.test.ts:91-92`; no job-level `timeout-minutes` in `ci.yml` (the only one is the 2-minute `compose wait seed` step at line 82), so neither the gate's cost nor C6 creates a timeout exposure.

- **F1 — Critical, `escalate: false`** — N1. `escalate_reason`: single unaudited input with a single derived remedy reusing machinery the gate already has; no multi-step auth flow or chained vulnerability.
- **F2 — Critical, `escalate: true`** — N2. `escalate_reason`: same trust boundary as round 1's escalated finding — CI verification of the authn/session E2E suite — reached by a route the new control does not cover, chaining a routine rename with pnpm's exit-0 masking.
- **F3 — Major** — N5.
- **F4 — Major** — N8.
- **F5 — Minor, adjacent** — N4. Records a **security clearance for C6**: per-file Testcontainer construction is the isolation mechanism and is unaffected, so C6 cannot weaken the RLS/tenancy proof in either direction. The spelling probe was reported **inconclusive** rather than asserted.
- **F6 — Minor, adjacent** — N9.

Answers to the round's questions: C2 clause 3 creates **no** acquirable exemption for a package that has vitest tests (traced: adding a Playwright dependency leaves D1/D2 true; a new package with vitest tests declaring Playwright is caught by reconciliation). C6 is security-neutral. The tiering split creates no tier CI runs that a developer cannot. SC51 is an acceptable deferral; **SC52 is not**.

## Testing Findings (Round 2)

All twelve round-1 findings verified correctly addressed, several better than recommended. D2 recomputed and confirmed. New measurements: 11 concurrent children → **419 ms**; C5's enumeration surface → 116 directories excluding `node_modules` (5 618 including), zero `vitest.config.*` under `node_modules`; vitest 4 top-level types carry `fileParallelism` and `maxWorkers` with **no** top-level `forks` key.

- **F1 — Major** — N6.
- **F2 — Major** — N9.
- **F3 — Major** — N4, with the recommendation to assert the *effective* value via live import rather than the absence of a warning.
- **F4 — Major** — N10.
- **F5 — Minor** — N11. Traced reconciliation × tiering: both collapse directions fail red. **No defect.**
- **F6 — Minor** — N3 (third-conjunct half).
- **F7 — Minor** — N12.
- **F8 — Minor** — N13.
- **F9, F10 — Minor, adjacent** — the vitest-4 replacement key is a config-semantics decision; SC52's remedy set should include renaming the E2E entry point off pnpm's built-in `test` name.

Answers to the round's questions: the nine-mutation set is **not** sufficient — it covers everything revision 1 had and leaves revision 2's added surface unmutated. Exactly one silently-green path is uncovered by every mutation: **F1/N6**. One regression was introduced by a revision-2 fix: **F4/N10**. Reconciliation does **not** interact badly with tiering.

## Adjacent Findings (Round 2)

- Test F9 → Functionality — the correct vitest-4 replacement key (`fileParallelism` vs `maxWorkers` vs project-level placement) is a config-semantics decision; confirm against the resolved config object before locking.
- Test F10 → Security — SC52's remedy set should include renaming the E2E entry point off `test`.
- Sec F5 → Testing — C6's acceptance is satisfied by abandoning C6's invariant.
- Sec F6 → Testing — no mutation covers the `test:integration` iff.

## Quality Warnings (Round 2)

None. Every finding carries reproduced evidence. Two experts explicitly reported the limits of their own probes rather than overclaiming: Security marked its C6 spelling probe **inconclusive** (a config placed outside the repo cannot resolve `vitest/config`), and the orchestrator hit and corrected the same class of contamination when reproducing N1. Both are recorded because the contaminated numbers differed from the clean ones (16/2 versus 14/0), and the difference would have been invisible without re-running.

## Recurring Issue Check (Round 2)

Compression as in round 1: rules marked purely `N/A` are collapsed; every `OK`/`Clear`/`Hit`/`FINDING` row is preserved.

### Functionality expert
- R3: FINDING F1 — the member-set reasoning correct for C1 was not extended to the D-formula; the root falls through.
- R12: OK — C2's iff now has both directions mutated (M3, M4), closing round 1's enum-coverage gap.
- R13: OK — round 1's branch-3 recursion is named and rejected in the plan text.
- R16: OK — VE3 carries the round-1 probe results; added a probe the plan lacked (nested `pnpm -w exec` from a package cwd → repo root, exit 0). `packages/queues` and `packages/api-types` still have no local `node_modules`; the `-w` makes the gate's root-resolved chain structural rather than incidental.
- R18: FINDING F5 — C5's exclusion set does not mirror `eslint.config.mjs:5`.
- R21: OK — round 1's gap closed.
- R29: FINDING F2 — the deprecation banner's own wording was cited as authority for a repair the installed package does not support (`singleFork`: **0 occurrences**). The citation was read, not verified against the artifact.
- R31: OK for two of three deletions; the third is FINDING F2, where deletion is *too* easy a way to satisfy the acceptance.
- R33: OK — round 1's false CI claim is corrected with the `package.json:15` / `ci.yml:147` / `ci.yml:140-143` chain spelled out.
- R34: OK for the surfaced defect; the residue is F2's *content*, not its deferral.
- R36: FINDING F2 — C6's acceptance is satisfiable by suppressing the warning rather than repairing the behavior.
- R37: FINDING F4 (secondary) — the acceptance's comprehensibility rationale is refuted by the actual message.
- R40: OK — all four cross-process shapes specified. Round 1 closed.
- R41: FINDING F2 — `singleFork` is itself a declared capability with no backing path in vitest 4.
- R42: FINDING F1 — C1's eight-member set re-derived a third time and confirmed; the defect moved into the **formula**. The orchestrator's D1 ≡ D2 question is **refuted** as posed.
- R43: OK — nothing widens a trust or privilege boundary; the tier split narrows.
- R44: OK — round 1's F7 closed; `pnpm -w exec` propagates exit 3, re-confirmed.
- R45: OK — 351 ms measured independently against a 0.99 s suite; budget stated. One residual noted rather than raised: under `pnpm -r test` the gate runs inside `apps/api`'s tier while seven sibling runs are in flight.
- RT7: OK — materially stronger than revision 1. One gap in scope: F4's acceptance criterion is covered by no mutation and passes on the pre-change state.
- RT9: OK — C4 + C5 close the twin permanently; C4's neutrality is now provable.
- N/A: R4–R11, R14, R15, R17, R19, R20, R22–R28, R30, R32, R35, R38, R39, R46, RS1–RS6, RT1–RT6, RT8.

### Security expert
- R3: Propagation across the 8 members verified complete; the unpropagated case is the root config's globs — F1.
- R12: C2's iff has both directions with M3/M4/M5 mutating three; the integration-tier direction is unmutated — F6.
- R13: Recursion closed; the two-half design no longer depends on the recursion-free choice for soundness.
- R16: VE3 records the probed coupling; control 4 asserts it. Clean.
- R18: The `e2e` carve-out is now derived, not name-keyed — the right fix. But the deriving predicate is undefined (F3) and the workspace-name resolution behind `--filter e2e` is unpinned (F2).
- R21: Now explicit — round 1's gap closed.
- R31: Both deletions contracted; C4's neutrality re-confirmed.
- R33: Not escalated — one workflow, no duplicate config. Round 1's inverse risk gone (CI-only fallback deleted).
- R34: SC47 and SC51 cost-justified. **SC52 is not** — it names a one-line fix and defers it while a second route to the same Critical stays open — F2.
- R36: `--passWithNoTests` still rejected; C6's acceptance is the suppression shape one level down — F5.
- R40: Cross-process shapes fully specified; the one unvalidated shape (`pnpm list -r --json`) is covered by control 1.
- R41: **Hit — F1.** Control 3 declares it turns NF2's 29/6 into an executed assertion; it cannot, because both sides derive from the same listing.
- R42: Both derivations recomputed; 29/6 reconcile. Defects: (i) the shared ancestor unaudited — **F1, Critical**; (ii) D1 ≡ D2 unasserted and unmutated — F4; (iii) SC49's `e2e` claim false — folded into F1.
- R43: Revision 2 **narrows** rather than widens. Clean.
- R44: Round 1's three instances closed. Two lossy channels remain: `--filter` exit-0 on a non-matching filter (**F2, Critical**) and the reconciliation's identity form (**F1, Critical**).
- R45: **Closed.** No finding.
- RS3: Boundary validation specified for the gate's one untrusted-shaped input. Satisfied.
- RS4: Re-checked; no artifacts committed; gitignores confirmed. No finding.
- RS6: Positional filter re-confirmed substring, not regex; shell construction forbidden.
- RT4: Vacuous-pass guards present; the residual vacuity is the reconciliation's identity form — F1.
- RT5: Left half binds the real artifact byte-exactly; SC51 correctly scoped.
- RT7: Strong. Gaps: no mutation for glob narrowing (F1), package rename (F2), the runner predicate (F3), D1 ≡ D2 (F4), or the integration-tier iff (F6).
- RT8: Three of four directions mutated; the integration-tier direction is not — F6.
- RT9: Twin deleted **and** enforced; round 1's gap closed. C5's carve-out reasoning is the same reasoning F1's remedy reuses.
- N/A: R4–R11, R14, R15, R17, R19, R20, R22–R30, R32, R35, R37–R39, R46, RS1, RS2, RS5, RT1–RT3, RT6.

### Testing expert
- R1: Clear. **F1 is the inverse case** — the plan should introduce one shared producer where it implies two copies.
- R2: **Hit (F1)** — the canonical command exists as two independently authored literals plus eight manifest copies, with nothing binding the first two.
- R3: Clear — revision 2 propagates the domain reasoning into C2's derived clauses.
- R7: Clear — C2 clause 3 and M5 now actively protect the existing E2E specs.
- R10, R13: Clear — the design no longer contains a branch that runs a member's real script from inside a member package.
- R12: **Hit (F2)** — C2 clause 1's iff gains a second axis and only the first is mutated.
- R16: Clear — VE3 rewritten; control 4 converts a PATH failure into a PATH-shaped error. The 11-child run (419 ms) adds no new coupling.
- R17, R18, R20: Clear.
- R21: Clear — exactly what round 1 asked for.
- R27: Clear — C1 now states counts are a reconciliation aid, not the acceptance criterion.
- R29: Clear — I re-verified the `pnpm --filter` exit-0 claim and narrowed its cause (F8).
- R31: Clear — both deletions contracted and reversible.
- R33: Clear — round 1's error corrected and made load-bearing for C2.
- R34: Clear — **C6 is the R34 case resolved in the fix direction**; F3 is about whether the fix can be shown to have taken.
- R36: Clear on `--passWithNoTests`; but "no DEPRECATED line" as the sole acceptance is silencing-shaped — F3.
- R40: Clear — F4 is about the evidence for one of these, not the specification.
- R41: **Hit (F3)** — C6 declares "declared == effective" with an acceptance that cannot distinguish repair from deletion.
- R42: Clear — **D2 independently recomputed and confirmed**. See F6 for the unstated third conjunct.
- R43, R44: Clear — M8 exercises per-child status; the ∅==∅ channel is closed by controls 1–3.
- R45: Clear — 419 ms against a 0.99 s suite; the budget holds. F7 is a baseline correction.
- RS3: Clear — child stdout is shape-validated rather than consumed raw.
- RS6: Clear — argv arrays with `shell: false` remove the shell sink entirely.
- RT1: Clear — still no mocks; both halves are real reads and real executions. Remains the plan's strongest property.
- RT2: Discharged — M10–M15 all executable here; F3's live-import assertion matches the existing `api-types-boundary.test.ts` idiom; the 11-child spawn was run to completion rather than estimated.
- RT3: **Hit (F1)** — the canonical command needs a single home. My call: one producer function, consumed by both halves.
- RT4: **Hit (F1)** — file-set-level vacuity closed; a string-level instance remains.
- RT5: Clear — a genuine improvement over revision 1; SC51 honestly scoped rather than claimed away.
- RT7: **Hit (F1–F5)** — revision 2's added surface is unmutated. Six additions proposed.
- RT8: **Hit (F2)** — the integration-tier direction is asserted with no mutation proving it can fire.
- RT9: Clear — **fully closed.** Only two vitest configs repo-wide; C5's surface is 116 directories; the `"test:list"` twin is explicitly rejected in the plan text.
- N/A: R4–R6, R8, R9, R11, R14, R15, R19, R22–R26, R28, R30, R32, R35, R37–R39, R46, RS1, RS2, RS4, RS5, RT6.

---

# Plan Review: package-test-script-parity — Round 3

Date: 2026-07-28
Review round: 3 (incremental)

## Changes from Previous Round

Revision 3: domain corrected to `D0 ∧ D1 ∧ D2` with the D1 ≡ D2 agreement lifted into the gate's assertions; C3 positive control 5 (filesystem↔resolver) added and control 3 corrected and demoted; C6 redirected after `singleFork` was found removed rather than relocated; C7 added, closing SC52 in-cycle; one canonical producer; mutations 9 → 18.

## Convergence summary

| Merged | Severity | Raised by | Subject |
|---|---|---|---|
| **P1** | **Critical** (escalated) | Sec F1 | C7 closes the E2E *invocation* channel; the *discovery* channel is open. Partial Playwright narrowing → **exit 0, 37 tests in 7 files**, both auth specs gone. Total wipeout is loud (exit 1); partial is silent. Third route to one boundary across three rounds. |
| **P2** | **Major** (3/3 convergence) | Sec F2, Func F1, Test F1 | Control 5 enumerates `*.test.ts` — the same extension the globs match — so it can only observe narrowing *within* that family. `.test.tsx` / `.test.mts` are assigned by no project and enumerated by no control. **The repo recorded this hazard two cycles ago** (`sc42-…-plan.md:50`, VE7: "matches `.ts` only … missing it is the cycle-3 Critical's exact shape"). |
| **P3** | **Major** (2/3) | Sec F3, Test F2b | Control 5's exclusion set is borrowed from `eslint.config.mjs:5` — a lint config edited for lint reasons. `**/test/**` added there silently shrinks the inventory. Also governs C5, so an `apps/web/**` entry would hide a re-added twin and defeat its mutation after the fact. |
| **P4** | **Major** (2/3) | Sec F4, Test F3 | The stderr-empty assertion is ambient (pnpm, node and vitest all write to it) and calibrated on **Node v26.5.0** while `ci.yml` pins **node-version: 22** at three sites. False-red direction; and its natural repair — a regex filter over stderr — is the forbidden parser and would take C6's only enforcement with it. |
| **P5** | **Major** | Test F2a | Control 5 is one-directional (`inventory ⊆ union`) with no non-emptiness check, so a shrunken or empty inventory satisfies it vacuously. M11 mutates the resolver side; nothing mutates the enumeration side. |
| **P6** | **Major** | Func F2 | C2 clause 1's tier map is asymmetric: `test` demanded unconditionally, `test:integration` only iff. D1 is satisfied by a file in *either* project, so an integration-only member would be required to declare a `test` script that can only fail — measured `pnpm -w exec vitest run --project unit packages/queues/` → **exit 1** — regenerating the `packages/queues` R41 shape from inside the contract that removes it. SC47 names the cycle that reaches it. |
| **P7** | **Major** | Func F3 | C1's prefix-substring invariant is review-time only, **and** C3's gate-side prefix re-filter *masks* an over-matching filter: the gate discards the extra paths, compares equal, stays green, while the real script (which has no re-filter) executes a superset. The gate's normalization hiding the gate's subject. |
| **P8** | **Major** | Func F4 + orchestrator | C7 changed `package.json:15` and left `.github/workflows/ci.yml:144` on `pnpm --filter e2e exec playwright install`. Measured: `pnpm --filter <nonexistent> exec <anything>` → **exit 0**. SC53's "the repo's one security-relevant use" is false — there are two. R33's exact subject. |
| **P9** | **Minor** (2/3) | Test F5 | C7's `exec` form re-declares how the suite runs, creating an RT9 twin with `e2e`'s own `test` script — which C2 clause 3 requires to exist and `pnpm -r test` keeps using. A flag later added to that script would be honored locally and bypassed in CI. `pnpm -C e2e test` meets every C7 requirement without the twin. |
| **P10** | **Minor** (2/3) | Sec F6, Test F6 | M9's stated mutation cannot red C7: `-C` resolves a **directory**, so a package-*name* rename is harmless and correctly stays green — which is C7's improvement, not a gap. Executed as written (and as user scenario 6 describes it), M9 would record a false conclusion about a security control's falsifiability. |
| **P11** | **Minor** (2/3) | Func F5, Test F8 | SC49 self-contradicts: control 5 must red on `e2e/foo.test.ts` *and* has an `e2e` carve-out. Measured, no carve-out is needed — all nine e2e files are `*.spec.ts`. An exemption that excludes nothing acquires a job later without its predicate being re-derived. |
| **P12** | **Minor** (2/3) | Sec F5, Func F7 | C1's walkthrough entry 3 and M8's rationale are stale after C7's `exec` form: CI would no longer consume `e2e`'s `test` script. (Dissolved by adopting P9's `pnpm -C e2e test`.) |
| **P13** | **Minor** | Func F6 | C6's "wall clock unchanged within noise" states no band while NF1 states a hard number. Baseline 7.00 s / 143 tests / 6 files. |
| **P14** | **Minor** | Test F4 | The stderr assertion enforces C6's *symptom* (the key coming back) but not C6's *decision*: `fileParallelism: false` is a valid vitest 4 option that emits no warning, so it reverses the parallel decision with the gate green. The decision is comment-only. |
| **P15** | **Minor** | Test F7, Sec F7 | The right half's root-assigned side has no stated provenance — the gap control 3 just closed for itself. And the named canaries are a C1 acceptance line, not a standing C3 assertion, so outright deletion satisfies every relative control. |

## Orchestrator verification

Neither Critical nor the 3/3-convergent finding was taken on trust.

- **P1 reproduced** — but only on the second attempt. A first run reported "43 tests unchanged" because the `sed` editing `playwright.config.ts` silently failed to match. Rewriting the edit in Node produced the real result: `testIgnore: ['**/auth.spec.ts','**/session-expiry.spec.ts']` → **exit 0, `Total: 37 tests in 7 files`**, zero occurrences of either auth spec. **The failed edit is recorded because it produced a confident, wrong "not reproduced" verdict** — the same contamination class as round 2's misplaced `--config`, and the second time in two rounds that an unvalidated mutation harness reported the mutation as inert.
- **P2 confirmed by asking vitest, not by reasoning about globs.** `apps/web/test/zzprobe.test.tsx` and `packages/crypto/test/zzprobe.test.mts`, each containing a passing test, were written and listed: unit total stayed **29**, both listings returned **zero** matches. (An attempt to verify via `picomatch` directly failed to resolve the module — the execution route was both cheaper and authoritative.) The `sc42-…-plan.md:50` VE7 record was confirmed to exist and to say what Func F1 quoted.
- **P6 confirmed**: `pnpm -w exec vitest run --project unit packages/queues/` → exit 1, `No test files found`.
- **P8 confirmed independently of the reviewers**, by reading `ci.yml` around the seed instance rather than assuming the class had one member.
- **P9's alternative verified**: `pnpm -C e2e test --list` → **exit 0, `Total: 43 tests in 9 files`** (arguments forwarded); `pnpm -C e2e-nope test` → exit 1 `ENOENT`; `pnpm -C packages/api-types test` → exit 254.
- **P4 confirmed**: local `node --version` = **v26.5.0**; `ci.yml` `node-version: 22` at lines 20, 35, 58.

## Functionality Findings (Round 3)

All six round-2 dispositions verified correct. Independently re-verified that `poolOptions` appears **exactly once** in vitest 4.1.10's dist — inside `logger.deprecate` — and nowhere else, with `resolved.pool ??= "forks"` independent, making C6's contracted edit provably behavior-neutral. Measured the full 11-child set at **376 ms** (plan's 419 ms is conservative). Probed a spawn from `packages/queues`, which has no local `node_modules`: still 0 stderr bytes.

- **F1 Major** — P2. **"The most likely real instance of the failure class this cycle exists to close, against a hazard the repo explicitly recorded so it would 'constrain design rather than being rediscovered'."**
- **F2 Major** — P6. **F3 Major** — P7. **F4 Major** — P8. **F5 Minor** — P11. **F6 Minor** — P13. **F7 Minor** — P12.

Answers: the *membership* formula `D0 ∧ D1 ∧ D2` is complete (re-derived a fourth time, yields C1's eight with no residue); the residue has moved into the *obligations* membership triggers (F2) and into conditions that are prose rather than derivation (F3). C6's redirect is right and its acceptance is not vacuous — it fires if Phase 2 over-shoots — but has no band. C7 introduces no working-path regression. No `*.test.ts` can be legitimately unassigned, so control 5 has no false-red surface; the defect is the opposite one (F1).

## Security Findings (Round 3)

Round-2 dispositions verified fixed. Re-traced the vitest side for further shrink routes and **found none the mechanism misses**: removing the unit project's `exclude` assigns the 6 integration files to both projects → "exactly one" reds; deleting or renaming a project makes `--project unit` fail loudly. Residuals are in control 5's *inputs*, not its mechanism. Measured **311** `*.test.ts` under `node_modules` (an exclusion is genuinely required), and `git ls-files` → 35 `.test.ts` + 9 `.spec.ts` = 44 tracked, zero from `node_modules`/`.next`/`dist`.

- **F1 Critical, `escalate: true`** — P1. `escalate_reason`: the trust boundary is CI's verification of the multi-step login/session-expiry flow — the same boundary escalated in rounds 1 and 2 — reached by a third route the new contract does not cover. Three point fixes to one boundary across three rounds warrants confirming the general control rather than patching the third route.
- **F2 Major** — P2, with the additional observation that the `e2e` carve-out SC49 demands be *derived* is in fact achieved by a **spelling**, which is the defect `saas-app-key-pin.test.ts` devotes its own comment block to warning against.
- **F3 Major** — P3, with the `git ls-files` remedy and its key property: `.gitignore` does not untrack an already-tracked file, so shrinking the inventory requires a visible deletion rather than a config tweak.
- **F4 Major** — P4. **F5 Minor** — P12. **F6 Minor adjacent** — P10. **F7 Minor** — P15 (canaries).

Answers: (a) no further vitest-side shrink route beyond control 5's inputs; (b) **yes, a third route exists** — discovery narrowing; (c) the `KNOWN_TEST_RUNNERS` allowlist has **no false-green direction** — a domain member cannot escape by declaring a second runner, and an unrecognized runner reds clause 2; (d) the stderr assertion has hazards in both directions.

## Testing Findings (Round 3)

All eight round-2 findings verified correctly addressed, three better than proposed. Independently re-verified `singleFork`'s 0 occurrences, `pool`'s continued validity as a vitest 4 option, the 43/9 Playwright counts, the 196-byte stderr figure, and that `vitest.config.ts` declares no `globalSetup`/`setupFiles` — so the shared-database rationale for `singleFork` genuinely does not exist. Records that its own round-2 F3 "rested on a premise the plan has now refuted with better evidence than I had".

- **F1 Major** — P2. **"The most serious finding of the round."** Proven against the repo's own `picomatch@4.0.5` rather than reasoned.
- **F2 Major** — P5 + P3, with the observation that bidirectional equality also gives NF2 the executed anchor the plan concedes it lacks.
- **F3 Major** — P4. **F4 Minor** — P14, including an explicit judgment that the stderr substitution is *strictly better* than its own round-2 live-import proposal for the case C6 names, and not a substitute for enforcing C6's decision — "the two are complements, not substitutes".
- **F5 Minor** — P9. **F6 Minor** — P10. **F7 Minor** — P15. **F8 Minor** — P11.

Answers: the 18-mutation set is **not** sufficient; the gap has moved cleanly onto control 5's own inputs (extension family, inventory). Two silently-green paths remain, both proven rather than argued. Control 5 does have a vacuity of its own — the one-directional quantifier — though not control 3's identity problem, since `onDisk` and the root listings are genuinely two observations of two systems.

## Adjacent Findings (Round 3)

- Sec F6 → Testing — M9's expected red is wrong for one of its two spellings.
- Test F4 → Functionality — the vitest-4 replacement-key question is config semantics, resolved by C6's redirect.

## Quality Warnings (Round 3)

None. Every finding carries reproduced evidence, and the round contains three explicit self-corrections worth recording as process evidence: the Testing expert retracted its own round-2 premise; the Security expert's round-2 `singleFork` framing was superseded by better evidence and it said so; and the orchestrator's first attempt to reproduce the round's Critical produced a false "not reproduced" because a `sed` silently failed to match. **All three of the round's contamination events were in the measurement harness, not in the reasoning** — which is the same shape as cycle 5's decisive lesson, arriving through the verification tooling rather than through the gate.

## Recurring Issue Check (Round 3)

Compression as in prior rounds.

### Functionality expert
- R2: OK — `canonicalArgv` is one producer feeding both halves, and M3 proves a producer defect surfaces. Closes a hole neither round 1 nor I named.
- R3: FINDING F1, F4 — the `.ts`-only enumeration does not propagate the reconciliation's intent to the extension axis; C7's idiom is applied to `package.json:15` and not to `ci.yml:144`.
- R7: OK — C2 clause 3 plus C7 now protect `auth.spec.ts` and `session-expiry.spec.ts` on both measured exit-0 routes.
- R12: FINDING F2 — the tier map is a two-member enum and only the integration axis carries the iff.
- R16: OK — my additional probe (spawn from a package with no `node_modules`) yields 0 stderr bytes, so the assertion is not locally brittle; the hosted runner remains uncovered.
- R18: OK — C5 reuses a single ignore authority; `KNOWN_TEST_RUNNERS` is named with a stated failure direction and a defined residual.
- R29: OK **and improved** — revision 2's misreading of the deprecation banner is explicitly retracted with the measurement that refutes it. FINDING F1 cites the repo's *own* prior record (`sc40:52`, `sc42:50`) as what this plan does not honor.
- R31: OK — three deletions, each contracted and each red-proven by a mutation.
- R33: FINDING F4 — the E2E idiom is fixed at one site and left at the other.
- R34: OK — SC52 closed by C7 rather than deferred, with the plan stating why deferring a named one-line fix fails R34's cost test.
- R36: OK — C6's enforcement moved off "no DEPRECATED line", with the reasoning that the former is satisfied equally by deleting the declaration. The R36 shape correctly identified and closed.
- R41: FINDING F2 (C2 would mint an always-failing script), FINDING F3 (the prefix invariant is declared with no backing enforcement path — the shape C5 was created to fix).
- R42: OK — **`D0 ∧ D1 ∧ D2` is complete for membership**, re-derived a fourth time; the round-2 refutation is recorded accurately.
- R45: OK — 376 ms measured independently against the plan's conservative 419 ms; control 5's walk is 57 directories.
- RT7: OK and much stronger. Gaps in scope: no mutation for the extension axis (F1), a zero-unit-file member (F2), or an over-matching member path (F3).
- RT9: OK — C4 + C5 close the twin permanently; C5's exclusion set corrected after measuring the `.next` walk.
- N/A: R4–R6, R8–R11, R13–R15, R17, R19, R20, R22–R28, R30, R32, R35, R37–R40, R43, R44, R46, RS1–RS6, RT1–RT6, RT8.

### Security expert
- R3: Propagation across the 8 members complete. The unpropagated pattern is the requirement itself — "shrinking a runner's reach must red" is stated for vitest and not for Playwright — F1.
- R18: `KNOWN_TEST_RUNNERS` is the right resolution of round 2's F3. Its residual exposure is not the allowlist but what the carve-out it grants exempts from control 5 — F2.
- R29: **Exemplary** — revision 2 inferred `singleFork`'s relocation from a deprecation message's wording; revision 3 measured the installed package (0 occurrences) and reversed the contract.
- R33: One workflow; C7 changes one root script, not the job graph. Not escalated.
- R34: SC47, SC51, SC53 carry owners or triggers; SC52 correctly closed rather than deferred — round 2's cost objection accepted.
- R36: The plan names the suppression shape when rejecting revision 2's C6 acceptance, then leaves the same door open on C6's *enforcement* — F4.
- R41: Round 2's instance (control 3's withdrawn claim) fixed, and the withdrawal is in the plan's own text. New instance: the capability a reader will infer — that CI notices when E2E stops covering the auth flow — has no backing path — F1.
- R42: Recomputed. D0 verified necessary by direct measurement. The class-membership residual is the **inventory** class, not the member class — F2, F3.
- R43: Revision 3 widens nothing.
- R44: Round 2's two instances closed (three C7 failure modes re-measured loud: 1, 254, 1). New lossy read: Playwright's exit status is faithful for "suite absent" and says nothing about "suite shrunk" — F1.
- R45: Budget restated like-for-like; control 5's walk explicitly measured rather than assumed. No finding.
- RS3: The gate's boundaries are validated; the inventory's *source* is the unvalidated one — F3.
- RS4: Re-checked; no artifacts committed; gitignores confirmed; C7 adds no credential surface.
- RT4: The residual vacuity is control 5 having nothing to reconcile when its inventory shrinks — F2, F3.
- RT5: On the E2E tier the production primitive (Playwright's own discovery) is reached by no control — F1.
- RT7: Gaps: Playwright discovery (F1), extension (F2), inventory source (F3), stderr relaxation (F4); and M9's expected result is wrong for one spelling (F6).
- RT9: Twin deleted and enforced; C5's carve-out reasoning is the same reasoning F1's remedy reuses.
- N/A: R1, R4–R6, R8–R11, R13–R15, R17, R19–R28, R30–R32, R35, R37–R40, R46, RS1, RS2, RS5, RS6, RT1–RT3, RT6, RT8.

### Testing expert
- R3: **Hit (F1)** — control 5's reach is propagated to the directory axis (M12) but not to the extension axis; the same check, incompletely applied.
- R12: Clear — C2's four clauses cover both directions on both tiers, and M4–M7 probe all four. The enum-coverage gap from rounds 1 and 2 is closed.
- R16: **Hit (F3)** — calibrated on Node v26.5.0 locally, enforced on `node-version: 22` in CI. Cost is re-measured; the stricter assertion is not.
- R18: **Hit (F2b)** — `eslint.config.mjs:5` is now a synchronization point between the lint config and two gate controls, unstated in the lint config's direction.
- R27: Clear — counts explicitly demoted to "a reconciliation aid, not the acceptance criterion".
- R29: Clear — I independently re-verified the `singleFork`, `pool`, 43/9 and 196-byte claims; all exact.
- R34: Clear — C6 and C7 are pre-existing adjacent defects pulled **into** scope, and the plan's self-assessment that revision 2's SC52 deferral "fails R34's cost test" is correct.
- R36: **Hit (F3)** — the stderr assertion's most likely repair path is a warning filter, which would take C6's enforcement with it. The plan identifies R36 in C6's enforcement paragraph but does not apply it to the assertion it chose instead.
- R41: **Hit (F4)** — C6 replaces a declaration that said one thing while the runtime did another with a comment that has no backing enforcement for the parallel decision. Mirror-image of the defect C6 repairs.
- R42: Clear — the domain is `D0 ∧ D1 ∧ D2` with all three derived and M10 probing the agreement. **Fully discharged.**
- R45: Clear — budget and CI re-measurement scheduled against the right baseline.
- RT2: Discharged — F1's `.tsx` blind spot **proven** with the repo's own picomatch rather than reasoned; F5's alternative **executed**; F2's bidirectional equality checked to hold today (35 == 29 + 6); F4's container premise verified file by file.
- RT4: **Hit (F2a, F7)** — control 5's universal quantifier is vacuously true over an empty enumeration, and the right half's root-assigned side lacks control 3's provenance statement.
- RT7: **Hit (F1, F2, F6)** — every axis from rounds 1 and 2 covered; control 5's own inputs unmutated, and M9's stated edit does not red the contract it targets.
- RT8: Clear — every denial path in C2 has a mutation on both directions.
- RT9: **Hit (F5)** — C5 + M18 fully close the vitest-config twin, but C7's `exec` form creates a **new** twin between CI's E2E command and `e2e`'s own script.
- N/A: R4–R6, R8, R9, R11, R14, R15, R19, R22–R26, R28, R30, R32, R35, R37–R39, R46, RS1, RS2, RS5, RT6.

---

# Plan Review: package-test-script-parity — Round 4

Date: 2026-07-28
Review round: 4 (incremental)

## Changes from Previous Round

Revision 4: inventory family widened to `*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`; control 5 made bidirectional and re-sourced to `git ls-files`; Playwright discovery added as a third claimant, closing round 3's Critical; C7 changed to `pnpm -C e2e test` and extended to `ci.yml:144`; C2 clause 1 made symmetric; right half moved to raw-stdout comparison; canaries promoted to control 6; C6 gained a live-import complement; mutations 18 → 25.

## Convergence summary

**Zero Critical findings.** Round-by-round: 19/4 → 22/2 → 22/1 → **13/0**. The Security expert states explicitly: *"Every failure mode I could construct in revision 4's new surface fails red. No Critical or Major false-green found this round."* That is the failure-direction inversion cycle 5 identified as the convergence signal — rounds 1–3 were dominated by false-green, round 4 by false-red and under-specification. Two genuine false-greens remained, both narrow, both measured, both closed in revision 5.

| Merged | Severity | Raised by | Subject | Direction |
|---|---|---|---|---|
| **Q1** | **Major** (2/3) | Sec F1, Test F1 | The inventory is **index**-derived (`git ls-files`) while every claimant globs the **working tree**. The two diverge for any unstaged file — and **M12 and M13 create exactly such files, so both mutations pass green**: the two probes that prove the control closing channels 1 and 2. Conversely a developer writing a test and running `pnpm test:unit` before staging gets a red about inventory reconciliation. | both |
| **Q2** | **Major** | Test F2 | F5 says "exactly one runner"; the assertion implements "at least one" — disjointness was checked only between the two vitest projects. **Measured false-green**: `e2e/specs/*.integration.test.ts` is claimed by vitest-integration (depth-agnostic glob) **and** Playwright (default `testMatch` accepts `.test.ts`, no override in the config), and the union still equals the inventory. | **false-green** |
| **Q3** | **Major** (2/3) | Func F1, Test F3 (partly) | **D0 removes the repo root from every contract and nothing replaces it.** The root is the only one of twelve workspace entries with no contract, and its scripts are what CI runs. Gutting root `test:e2e` leaves control 5 green (it observes the *package* script) while `ci.yml:147` runs zero specs. Narrowing root `test:unit` to `packages/` makes the gate itself never execute. Fifth route to the same outcome in as many rounds. | **false-green** |
| **Q4** | **Major** | Test F3 | `git ls-files` and the Playwright child sit outside C3's per-child discipline. `git ls-files` exits **128** with empty stdout outside a repo, and its status is never read. Playwright's stdout carries pnpm's script banner (`JSON.parse` fails — verified), emits **testDir-relative** paths, and the human reporter offers no base — forcing a hardcoded `e2e/specs/`, an RT9 twin of `testDir` that goes stale on the very narrowing control 5 exists to catch. | false-red / hardcoded |
| **Q5** | **Minor** (2/3) | Sec F2, Test F2 | Same as Q2 from the requirements side: the stated invariant and the implemented one differ. |
| **Q6** | **Minor** | Sec F3 | `playwrightSet`'s path normalization unspecified; `--list --reporter=json` supplies `config.rootDir` as an authoritative base. |
| **Q7** | **Minor** | Sec F4, Test F4 | C3 is `locked` while VE5 declares its stderr assertion only provisionally CI-verifiable, and VE6's fallback (move the Playwright half to `compose-smoke`) **contradicts requirement F3** — structurally the same pre-authorized escape as revision 1's SC48, which all three experts rejected. |
| **Q8** | **Minor** (2/3) | Test F6, Func F2 | C6's live-import assertion is a **two-key denylist** — the shape `api-types-boundary.test.ts` records as twice-rejected in cycle 3 (*"a denylist can only forbid what someone thought to list"*). `maxWorkers: '50%'` resolves to 1 on a 2-core runner; `sequence.concurrent` and `isolate` also serialize. It is also **project-scoped**, so a top-level `test.fileParallelism: false` is inherited and evades it. |
| **Q9** | **Minor** | Test F5 | The mutation table needs **precondition** and **expected failing assertion** columns: six rows can pass or red for the wrong reason. M9a alone reds through at least three independent paths. |
| **Q10** | **Minor** | Func F3 | The "never filter the stream" rule has no sanctioned escape for Node's own runtime warnings, which cannot be silenced at source and differ across VE5's boundary — and C6's own live import triggers one (`[MODULE_TYPELESS_PACKAGE_JSON]`). |

## Orchestrator verification

- **Q1 reproduced**: a newly written `packages/crypto/test/zzunstaged.test.ts` is absent from `git ls-files` (0) and claimed by vitest (1) → `⊇` reds. `git ls-files --cached --others --exclude-standard` lists it (1). Both forms yield **44** test-shaped entries today; the widened form leaks **0** from `node_modules`.
- **Q2 reproduced**: `e2e/specs/zzprobe.integration.test.ts` → claimed by the vitest `integration` project **and** by Playwright. The double-claim is real.
- **Q4/Q6 reproduced**: `pnpm -C e2e test --list --reporter=json` → stdout begins `"\n> e2e@ test /Users/…"`, `JSON.parse` **fails**. With `-s`: stdout begins `{`, `JSON.parse` **OK**, `config.rootDir = …/e2e/specs`, 9 files, **0 bytes stderr**.
- **Q10 reproduced**: with `NODE_NO_WARNINGS=1` the integration child still emits the full **196-byte** `DEPRECATED` banner (`hasDEPRECATED=true`), because vitest writes it through `logger.deprecate` rather than `process.emitWarning`. The escape cannot weaken C6.

## Functionality Findings (Round 4)

All seven round-3 dispositions verified correct. Re-derived membership a **fifth** time (D0 ∧ D1 ∧ D2 = the eight in C1's table, no residue) and walked every obligation membership triggers — nothing in the member domain is unbound. Additionally closed an R16 risk by measurement: the positional filter matches the **project-relative** path (`<checkout-dir-fragment>` → 0, `ghq/` → 0, `apps/api/` → 14), so a checkout directory containing a member's path fragment cannot inject matches and CI/local behave identically.

- **F1 Major, adjacent** — Q3. *"The generalization stopped one level short of the invocation layer."*
- **F2 Minor** — Q8 (top-level scoping half). Executed the live import to confirm the mechanism: `defineConfig` is identity, top-level `test` keys are `['projects']` only, project 1 shows `poolOptions` inspectable.
- **F3 Minor** — Q10, with the `NODE_NO_WARNINGS` safety measurement.

Answers: (a) complete *within* the member domain; the gap is its complement (F1). (b) No false red — verified, including the checkout-path coupling. (c) C7's two-site fix is complete; every e2e-coupled `ci.yml` line enumerated (144, 147, 150, 155). (d) No false reds; two near-misses are true reds. One consequence worth stating: the gate now pins the repo's test-file naming convention.

## Security Findings (Round 4)

All seven round-3 dispositions verified closed. Re-traced control 5's failure modes: because the assertion is bidirectional equality against a non-empty inventory, **every way its inputs can break fails closed** — a failed root listing gives `unitSet = ∅` → red; a failed Playwright child → red; a failed `git ls-files` → caught by non-emptiness. *"That is the exact inversion of the `∅ == ∅` shape that opened this review cycle, and it is the strongest single property revision 4 adds."*

- **F1 Major** — Q1. Notes that the fix invited by the false red is removing the `⊇` direction, which is the only direction detecting untracking.
- **F2 Minor** — Q5. **F3 Minor** — Q6. **F4 Minor** — Q7.

Answers: (a) the claimant set is exhaustive (three runner configs, one being deleted) and `playwrightSet` cannot shrink silently; (b) `git ls-files` has no quiet narrowing route — `git rm --cached` leaves the file on disk so `⊇` reds, `.gitignore` does not untrack, sparse checkout leaves index entries — but it has the F1 cost; (c) **keep** the stderr assertion — the two C6 mechanisms enforce disjoint things and neither substitutes; (d) **no false-green found**.

## Testing Findings (Round 4)

All eight round-3 findings verified addressed, several beyond what was asked. Records that revision 4 found something the expert had missed: *"the prefix re-filter I had endorsed in Round 1 masks the over-match direction, and revision 4 removes it… That is a correction to my own earlier recommendation and it is right."*

- **F1 Major** — Q1, including the M14 three-behaviors problem (`git rm --cached` → red via ⊇; `rm` → red via ⊆; `git rm` → **green**, correctly, as a legitimate deletion).
- **F2 Major** — Q2, proven against the real configs after confirming `playwright.config.ts` has no `testMatch` override.
- **F3 Major** — Q4/Q6, with the verified `pnpm -C e2e --silent test --list --reporter=json` recipe.
- **F4 Minor** — Q7. **F5 Minor** — Q9. **F6 Minor** — Q8.

Answers: the 25-mutation table is **not too large** — *"cutting for size would be trading the only evidence the gate can fail for a modest time saving"* — but six rows need preconditions. Two silently-green paths remain, both introduced by revision 4's own new surface (Q1, Q2). `playwrightSet` introduces no green-direction vacuity: a failed `--list` leaves the nine specs unclaimed and reds.

## Quality Warnings (Round 4)

None. Notable process evidence: all three experts recorded at least one correction to their own earlier position — the Testing expert on the prefix re-filter it had endorsed in round 1 and on its own round-2 C6 premise, the Security expert on its round-2 D2 computation and its inconclusive `singleFork` probe, and the Functionality expert on the round-3 measurement it had queued as a risk and then closed by measurement. Every finding in this round carries a command and an observed output.

## Recurring Issue Check (Round 4)

Compression as in prior rounds; every non-N/A row preserved.

### Functionality expert
- R3: OK — the pattern that closed channel 1 is propagated across extensions, `--filter` sites and runners. FINDING F1 is where propagation stops: the invocation layer.
- R7: OK — the auth proofs are guarded on three routes; FINDING F1 is a fourth route to the same outcome.
- R12/R13/R17/R20/R21: OK.
- R16: OK **and strengthened** — the positional filter matches the project-relative path, so checkout directory cannot inject matches. FINDING F3 concerns VE5's escape hatch.
- R18: OK — `git ls-files` replaces the borrowed `eslint.config.mjs` set for both control 5 and C5; the round-3 defect fixed at source rather than at the call site.
- R29: OK — the `sc42-…-plan.md:50` VE7 record re-confirmed to say what is quoted.
- R31: OK — four deletions, each contracted and red-proven.
- R33: OK — both `--filter` sites covered; every e2e-coupled `ci.yml` line re-enumerated; no third invocation surface.
- R34: OK — SC47/SC51/SC53/SC54 carry owners and triggers.
- R36: OK — C6's two complementary mechanisms; line 206 names why the single-mechanism version was the R36 shape.
- R40: OK — the raw-stdout comparison plus the provenance rule closes the last shape.
- R41: FINDING F1 — root scripts are declared capabilities CI depends on with nothing verifying they still do what their names say.
- R42: OK — membership re-derived a fifth time; obligations complete *within* the domain. F1 is the complement of the domain.
- R43: OK — C7's `-C` form makes a package rename harmless rather than red, a genuine narrowing.
- R44/R45: OK.
- RT4: OK — controls 1, 2, 3, 5 (bidirectional + non-empty), 6 close every vacuity shape found across four rounds.
- RT7: OK — 25 executed mutations including a positive control. Gaps in scope: no mutation for a gutted root script (F1); M23 covers only the project-scoped placement (F2).
- RT9: OK — C7 avoids creating a new twin, with the reasoning stated in the contract.
- N/A: R4–R6, R8–R11, R14, R15, R19, R22–R28, R30, R32, R35, R37–R39, R46, RS1–RS6, RT1–RT3, RT5, RT6, RT8.

### Security expert
- R3: Propagation complete across members and all three claimant runners; the round-3 gap is closed at the requirement level, not per route.
- R13: Recursion closed for both runners.
- R16: Dev/CI parity is now the plan's most explicitly tracked risk (VE5, VE6). The residual is that C3 locks ahead of VE5's discharge — F4.
- R18: SC49's carve-out deleted rather than derived, which is better.
- R29: C6's evidence measured against the installed dist rather than inferred from a warning's wording.
- R31: Four deletions, each contracted with rationale and a mutation.
- R33: **Closed at both sites**; the second `--filter` instance was the exact R33 shape, premise verified independently.
- R34: SC54 is an honest statement of control 5's residual with a trigger.
- R36: The suppression shape is named in three places and banned, including the specific escape.
- R40: Cross-process shapes specified for the vitest halves; the Playwright half's shape is unspecified — F3.
- R41: Round 3's instance closed — the capability a reader infers now has a backing path. C2 clause 1's symmetry closes a prospective R41.
- R42: Re-derived; the class under scrutiny this round is the *inventory* class, and it reconciles exactly (44 == 29 + 6 + 9). The residual is the not-yet-tracked side — F1.
- R43: Revision 4 widens nothing; control 5 adds two read-only observations and removes a filesystem walk.
- R44: **No lossy channel remains open.** Bidirectional equality makes control 5's every input failure fail closed.
- R45: Budget restated conservatively; control 5's added cost bounded.
- RS3: Boundary validation specified for stdout, status, stderr and the inventory; the Playwright listing is the one unspecified shape — F3.
- RS4: Re-checked; `git ls-files --others --exclude-standard` returns 2 untracked non-test files and nothing sensitive.
- RT4: Vacuity guards complete.
- RT5: The Playwright half reaches Playwright's real discovery **through the same script CI invokes**, which is stronger than SC51's residual on the vitest side.
- RT7: The round-3 gaps are all covered. Residual: M14's spelling, and M13 reds for two reasons at once until F1 is fixed.
- RT9: The one remaining twin risk is a hardcoded `e2e/specs/` prefix — F3.
- N/A: R4–R6, R8–R11, R14, R15, R19, R22–R28, R30, R32, R35, R37–R39, R46, RS1, RS2, RS5, RS6, RT1–RT3, RT6, RT8.

### Testing expert
- R3: **Hit (F3)** — C3's per-child discipline is written for the right half's vitest children and not propagated to the two children control 5 adds.
- R12: Clear — C2 clause 1 symmetric on both tiers with M5/M6/M7/M25 covering all four directions.
- R16: Clear — VE5 and VE6 are now stated obligations rather than assumptions. F4 is a contract conflict, not a parity gap.
- R18: Clear — the `eslint.config.mjs` coupling is **removed**, not merely documented. **Fully discharged.**
- R29: Clear — independently confirmed the 44-file inventory, the 311 figure, the 43/9 counts, the 0-byte Playwright stderr, and `git ls-files`' exit-128 mode.
- R33: Clear — this round's own `ci.yml:144` finding is R33 applied correctly.
- R34: Clear — C6, C7 and the second `--filter` site all pulled into scope with the cost stated.
- R36: **Hit (F1b, F6)** — the untracked-file false red creates a direct incentive to drop the `⊇` direction; C6's live-import denylist is the twice-rejected shape.
- R40: **Hit (F3)** — the Playwright child's stdout is a different serialization shape from every other child.
- R41: Clear — C2 clause 1's symmetry prevents minting an always-failing script.
- R42: Clear — D1 ≡ D2 asserted bidirectionally with M10 probing it.
- R44: **Hit (F3a)** — `git ls-files` exits 128 with empty stdout outside a repository and its status is never read.
- R45: Clear — control 5 adds one `git ls-files` and one `playwright --list`, both sub-second.
- RS4: Clear — `.gitignore` already excludes `e2e/.auth/`, so the inventory widening cannot sweep in the live session cookie.
- RT2: Discharged — every recommendation executed before being made, including the `--silent --reporter=json` recipe end to end and the double-claim proof against the actual configs.
- RT4: **Hit (F2)** — `inventory == union` with two-way disjointness cannot distinguish "each file claimed once" from "one file claimed twice".
- RT7: **Hit (F1, F2, F5)** — M12/M13 do not fire on untracked probes, M14 conflates three behaviors, the double-claim direction has no mutation, six rows lack preconditions.
- RT9: Clear — **fully discharged.** C7's form deliberately avoids re-declaring how the suite runs.
- N/A: R4–R6, R8–R11, R14, R15, R17, R19–R28, R30–R32, R35, R37–R39, R43, R46, RS1–RS3, RS5, RS6, RT1, RT3, RT5, RT6, RT8.

---

# Plan Review: package-test-script-parity — Round 5 (confirmation)

Date: 2026-07-28
Review round: 5 (incremental, confirmation)

## Changes from Previous Round

Revision 5: inventory moved to `git ls-files --cached --others --exclude-standard`; pairwise disjointness across all three claimants; per-child discipline extended to every child; Playwright child specified as `pnpm -s -C e2e test --list --reporter=json`; **C8 added** (pin the root scripts and assert `ci.yml` invokes them); `NODE_NO_WARNINGS=1`; C6's denylist inverted to an allowlist; mutations 25 → 28.

## Convergence summary

**13 findings, 1 Critical — and its location is the point.** Security re-attacked every previously-closed chain end to end and reported: *"Genuinely closed, and I could not construct a route through any of them"* — glob narrowing, the extension family, both `--filter` routes at both sites, Playwright discovery narrowing, `e2e` script neutering (verified 9→8 detected), root-script gutting, the domain-escape routes, and every ∅-shaped vacuity. **The Critical is in C8, added in revision 5.** New surface, new blind spot — the pattern cycle 5 documented.

| Merged | Severity | Raised by | Subject |
|---|---|---|---|
| **R1** | **Critical** | Sec F1 (esc: false), Test F3 | **C8's `ci.yml` half infers invocation from dialect-bearing text — the one thing the plan forbids everywhere else.** `# - run: pnpm test:unit`, `if: false`, and `continue-on-error: true` each leave the asserted string intact while removing the invocation. The borrowed idiom makes it worse: `workflow-pins.test.ts` **deliberately does not collect commented lines** (its own test case at line 128 asserts this), which is correct for "no unpinned action exists" and fatal for "this step is present and effective". Sixth route to the same outcome, defeating the control added to close the fifth. |
| **R2** | **Major** | Test F1 | **C6's allowlist targets the wrong object level.** Measured by executing the live import: `cfg.test` keys are `["projects"]`, each `projects[i]`'s own keys are `["test"]`, and the options live at `projects[i].test`. Applied as written it **reds on the correct current config**, and the obvious repair — adding `test` to the allowlist — makes the check inspect only the two wrappers, so **M23a would pass green** and its green would be recorded as proof. |
| **R3** | **Major** | Test F2 | **M28 is exactly the case SC55 declares undetectable**, so it will be green. Narrowing root `test:unit` to `packages/` stops the gate — which lives in `apps/api/test/` — from running at all. The mutation table and SC55 contradicted each other, and Phase 2 would have spent a round on it. |
| **R4** | **Major** (3/3) | Func F1, Test F4, Sec F2 | **`lint` and `typecheck` are CI-invoked root scripts left outside C8's pin**, while `test` — which no CI path invokes — was pinned. VE4 establishes `pnpm typecheck` is the only type gate CI runs, and C1's devDependency-retention paragraph names it as a control. The member set was chosen by **name-shape** rather than derived from the defining primitive (`ci.yml`'s `run:` lines) — the fourth cycle running in which that error appeared. |
| **R5** | **Minor** (2/3) | Func F2, Sec F1(5) | SC55 records one instance of "the gate did not run"; the general form covers a CI step disabled, a job deleted or `needs:`-rewired, the workflow deleted, and the gate file itself deleted. |
| **R6** | **Minor** | Sec F3 | **Declaration-level skips** leave a file claimed, discovered and unexecuted. `test.describe.skip` on `auth.spec.ts` passes control 5 and exits 0. Nearly free to close on the Playwright side: `suites[].specs[].tests[].annotations` is in the JSON the gate already parses (measured present, `[]` today). |
| **R7** | **Minor** | Func F3 | C6's allowlist reach exceeds its invariant, and **control 5 induces the most foreseeable red**: the `.tsx` finding (scenario 4 / M13) pushes a developer toward `environment: 'jsdom'` + `setupFiles`, which the allowlist reds. |
| **R8** | **Minor** | Test F5 | C8's four pinned values are never written down, and C7 changes one of them in the same cycle. |
| **R9** | **Minor** | Test F6 | NF2's anchor stated as **36** in one place and **44** in another where both should be **45**. Round 1's F6 was the same class. |
| **R10** | **Minor** | Test F7 | M4's expected clause is wrong (clause 2, not 1/2 — `api-types` is not a domain member) and M8 lacks M9a's multi-path note. |

## Orchestrator verification

- **R2 reproduced** by executing the live import under tsx: `cfg.test → ["projects"]`; `projects[0] → ["test"]`, `projects[0].test → ["name","include","exclude"]`; `projects[1] → ["test"]`, `projects[1].test → ["name","include","exclude","testTimeout","hookTimeout","pool","poolOptions"]`.
- **R4 reproduced**: root scripts are `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:e2e`, `build`; `ci.yml` `run: pnpm` lines are 22 (install), 23 `lint`, 24 `typecheck`, 25 `test:unit`, 37 (install), 42 `test:integration`, 60 (install), 144 (`--filter e2e exec`), 147 `test:e2e`. Root `test` appears in **zero** CI paths.
- **R1's idiom premise** confirmed by reading `apps/api/test/workflow-pins.test.ts:25-41`: the file carries an explicit comment that widening its collector to "anywhere on the line" would fire on a comment reading `# uses: …`, and it splits `USES_LINE` from `PINNED` precisely so the two fail differently.
- Security additionally verified that no YAML parser is resolvable from the repo root (`require('yaml')` → `MODULE_NOT_FOUND`; `yaml@2.9.0` exists only as a vitest transitive), which makes the structural fix a supply-chain decision rather than a free one.

## Findings by expert

**Functionality** — 3 findings (1 Major adjacent, 2 Minor). Verdict: *"The gate as specified in revision 5 has no silent-green path I could find, and I looked at each control against the specific mutation that would defeat it."* Re-derived membership a fifth time, unchanged. Credited a property nobody had claimed: because C7 chose the script form, control 5's Playwright child runs the same script CI runs, so neutering that script is gate-detected.

**Security** — 3 findings (1 Critical, 2 Minor). Attacked each chain CI step → root script → runner config → discovery → execution. Verified `e2e` script neutering is detected (`--grep-invert auth` → 8 files → red) and that the widened inventory creates no `pull_request` injection vector (`actions/checkout` materializes only tracked files, so `--others` contributes nothing in CI; a gitignored-but-present test file is claimed by vitest and absent from the inventory → `⊇` reds).

**Testing** — 7 findings (4 Major, 3 Minor). Opened with: *"The coordinator asked for an honest answer, including 'No findings' if that is what the evidence supports. It is not, quite."* Verified all six round-4 dispositions correct. Noted that M24's necessity — deleting a canary shrinks the inventory and the unit set together, so only control 6 can see it — *"is the sharpest reasoning in the table"*.

## Quality Warnings (Round 5)

None. All three experts continued the pattern of correcting their own earlier positions where the evidence moved: Security recorded that its round-4 JSON measurement had used `pnpm -C e2e exec`, which does not emit pnpm's banner, so `JSON.parse` succeeded for it and would have failed for the plan's actual invocation — *"the `-s` is a real defect I missed"*.

## Disposition in revision 6

| Merged | Action |
|---|---|
| R1 | **C8's `ci.yml` half dropped**, not implemented weakly. Recorded as SC56 in general form. User decision: the structured-YAML alternative would need a new root devDependency and would still close only 3 of SC56's 5 routes. |
| R2 | Allowlist re-specified against `cfg.test` and `cfg.test.projects[i].test`, with the wrapper shape named so the first implementer does not "fix" the red by widening. String-entry case handled. |
| R3 | Split into **M28a** (narrow to `apps/api/` — gate still runs → red) and **M28b** (narrow to `packages/` → **must stay green**, SC56's residue converted from a stated caveat into an observed one). |
| R4 | C8's pinned list is now `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e` with literal values written out. `test` and `build` deliberately unpinned, stated. **The list is a literal, not derived from `ci.yml`** — deriving it would make the set shrink whenever the workflow shrank, the same silent-narrowing shape control 5 exists to close, relocated into C8's own input. |
| R5 | SC55 generalized and renumbered SC56, enumerating all five routes. |
| R6 | Skip-annotation assertion added to control 5's Playwright half (data already parsed); **M31**. Runtime-conditional and vitest-side skips recorded as **SC57**. |
| R7 | Recorded in C6: the allowlist's reach deliberately exceeds its invariant, with `environment`/`setupFiles` named as the foreseeable next entries given control 5's `.tsx` behavior. |
| R8 | Five literals written into C8. |
| R9 | Corrected to **44 == 29 + 6 + 9** today and **45 == 30 + 6 + 9** after the gate. |
| R10 | M4's cell corrected to clause 2; M8 given the multi-path note. |

Mutations 28 → **31 falsifiability mutations + 3 documented-limit probes** (M9b, M28b, `git rm`).

## Recurring Issue Check (Round 5)

Compression as in prior rounds.

### Functionality expert
- R3: OK — every closure is a general control. FINDING F1 is where propagation stops: C8 covers the test-named scripts, not the CI-invoked set.
- R7: OK — the auth proofs are guarded on four independent routes.
- R16: OK — the checkout-directory coupling closed by measurement; VE5 discharges before implementation and VE6 resolves before locking, with the CI-only escape explicitly rejected. *"The strongest treatment of dev/CI parity across the five rounds."*
- R18: OK — the inventory is `.gitignore`-derived, the repo's own content declaration; 0 leakage verified.
- R21: OK — the expected-assertion column closes the last way falsifiability evidence could be self-satisfying.
- R29: OK — Playwright's `@(spec|test)` default confirmed in the installed `playwright/lib`; `config.rootDir` confirmed present and absolute.
- R31: OK — the table now separates `git rm` (legitimate, stays green) from M14a/M14b.
- R33: OK — C7's third-surface enumeration recorded. FINDING F1 is the same rule applied to `ci.yml`'s other two verification steps.
- R41: FINDING F1 — root `lint`/`typecheck` are declared capabilities CI depends on with nothing verifying them.
- R42: OK — membership re-derived a fifth time; obligations complete within the domain. F1 is a class-membership question one level out: which scripts belong to "the commands CI invokes".
- R44: OK — per-child status governs every child, `git ls-files`'s exit 128 named.
- RT4: OK — every vacuity shape from five rounds retired.
- RT7: OK — 28 mutations with preconditions and expected assertions. Gaps in scope: no mutation gutting root `typecheck` (F1); M23 covers only the project-scoped placement (F2).
- RT9: OK — three distinct twins refused for the same stated reason.
- N/A: R4–R6, R8–R11, R14, R15, R19, R22–R28, R30, R32, R34, R35, R37–R40, R43, R45, R46, RS1–RS6, RT1–RT3, RT5, RT6, RT8.

### Security expert
- R1: The reuse of `workflow-pins.test.ts`'s idiom is correct in form; the borrowed idiom's **semantics** are wrong for C8's invariant — F1.
- R16: VE5 and VE6 both discharge before locking with sanctioned fallbacks stated in advance. Clean.
- R21: "A red from an unrelated control is a failed mutation" closes the loophole where M9a's three independent reds could have been recorded as proof of C7. Clean.
- R33: Both `--filter` sites fixed, with the plan naming R33 as the reason the second was missed. The residual R33-shaped risk is C8's workflow assertion — F1.
- R40: The one cross-boundary read without a specified shape is the workflow YAML — F1.
- R41: **Hit — F1.** C8 declares "`ci.yml` is asserted to invoke them" and the specified mechanism cannot establish invocation. Secondary in F2.
- R42: Re-derived; the class enumerated this round was *invocation sites*, and C7's enumeration is complete.
- R43: Revision 5 widens nothing; `NODE_NO_WARNINGS=1` verified not to weaken C6.
- R44: Every lossy channel from rounds 1–4 closed and re-verified. One remains: C8 reads invocation through substring presence — F1.
- RS4: `.gitignore` covers all artifact paths, so the widened inventory cannot surface session state.
- RS6: The filter matches the **project-relative** path, so a checkout directory cannot inject matches.
- RT5: The production primitive for C8's second half is the GitHub Actions runner, which no in-process check reaches — F1.
- RT7: The mutation set is now being reasoned about as evidence rather than as a checklist. Missing: F1's routes.
- N/A: R4–R6, R8–R11, R13–R15, R17–R20, R22–R32, R34–R39, R45, R46, RS1–RS3, RS5, RT1–RT4, RT6, RT8, RT9.

### Testing expert
- R2: **Hit (F5)** — C8's four pinned values exist only as the phrase "their pinned values", and one is changed by C7 in the same cycle.
- R3: **Hit (F4)** — the root-script pin is not propagated to the other two root scripts `ci.yml` invokes.
- R16: Clear — VE5's fallback stated in advance; `NODE_NO_WARNINGS=1` verified (196 bytes preserved).
- R21: Clear — observed messages compared against expected.
- R27: **Hit (F6)** — NF2's anchor stated as 36 and as 44 where both should be 45.
- R29: Clear — config object structure, `NODE_NO_WARNINGS` behavior, root script inventory and every `ci.yml` invocation line independently confirmed.
- R33: **Hit (F4)** — C7 fixed both `--filter` sites; C8 has the identical shape with two survivors.
- R36: Clear on stderr. **But** the first red from C6's misaimed allowlist has an obvious repair that silently disables the mechanism, and nothing warns against it.
- R41: **Hit (F1)** — C6's live-import allowlist is a declared capability whose backing path, as spelled, inspects the wrong objects and therefore never worked.
- R42: Clear — fully discharged.
- R44: Clear on children. **Partially hit (F3)**: C8's assertion shape is unstated, so a step that exists as text and never executes reads as an invocation.
- RT2: Discharged — F1's object shape came from running `await import()` on the real config; F4's premise from enumerating every `run: pnpm` line; F6's arithmetic from the measured 29/6/9.
- RT3: **Hit (F5)** — C8's pinned values are a shared constant with no written home.
- RT4: Clear — *"I could not construct a self-comparison anywhere in revision 5."*
- RT7: **Hit (F2, F3, F7)** — M28 cannot red; C8's `ci.yml` half has no mutation; M4 and M8's cells misname what would fire.
- RT9: Clear — fully discharged.
- N/A: R4–R6, R8–R11, R13–R15, R17–R20, R22–R26, R28, R30–R32, R34, R35, R37–R40, R43, R45, R46, RS1–RS3, RS5, RS6, RT1, RT5, RT6, RT8.

---

## Phase 1 close

Five rounds, **89 findings**, 8 Critical. The record worth carrying forward:

- **The core deliverable was never the problem.** C1/C2/C3 — the parity gate itself — stabilized in revision 2 and was re-attacked in rounds 3, 4 and 5 without a single new defect found in it. Every round after the second found its findings in the peripheral contracts added to close CI-side channels (C6, C7, C8) and in the mutation table's fidelity.
- **Each structural fix was correct on its axis and inherited the next axis's blind spot** — the cycle-5 pattern, reproduced exactly: gate design → the config the gate reads → the inventory the config is measured against → the file family the inventory enumerates → the scripts CI invokes → whether CI invokes them at all. Six levels, one per round, each found by attacking the previous round's fix.
- **The convergence signal was the failure-direction inversion, not the finding count.** Rounds 1–3 were dominated by false-green; round 4 produced zero Critical and Security stated plainly that every constructible failure in the new surface failed red. Round 5's Critical was in surface that did not exist in round 4.
- **Three member-set errors, all from enumerating by name-shape rather than deriving from the defining primitive**: revision 2's `D1 ∧ D2` admitting the repo root, revision 3's SC53 counting one `--filter` site where there were two, and revision 5's C8 pinning the "test-shaped" scripts instead of the CI-invoked ones. Fourth cycle running.
- **The measurement harness was itself a source of three false conclusions**: a `--config` placed outside the repo (round 2), a `sed` that silently failed to match (round 3), and a JSON probe run through `pnpm exec` rather than the plan's actual `pnpm -C … test` invocation (round 5, self-reported by Security). Every one produced a confident wrong answer that only re-running differently exposed.
