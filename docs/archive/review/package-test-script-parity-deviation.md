# Coding Deviation Log: package-test-script-parity

Phase 2. Every entry below was produced by executing something, not by reading it.

## D1 — C6 reversed again: the plan's contracted edit doubles the integration wall clock

**Plan**: remove the dead `poolOptions` key, keep `pool: 'forks'`, on the evidence that `singleFork` has 0 occurrences in vitest 4.1.10 and `poolOptions` appears only inside `logger.deprecate`, making the edit behaviour-neutral.

**Measured**, six files / 143 tests, three runs each where noted:

| config | Duration | deprecation lines |
|---|---|---|
| `pool: 'forks'` + `poolOptions` (pre-change) | 7.20 / 7.17 s | 1 |
| **`pool: 'forks'` alone — the contracted edit** | **13.80 s** | 0 |
| `pool: 'forks'` + `fileParallelism: false` | 14.11 s | 0 |
| **no `pool` key at all — shipped** | **7.19 / 7.18 / 7.35 s** | 0 |

The premise was wrong. `poolOptions`' presence made vitest discard the surrounding pool declaration, so **`pool: 'forks'` was not in effect either** — the tier had been running on the default pool while the config named `forks`. Removing only `poolOptions` makes `forks` newly effective and nearly doubles the tier. Three plan-review rounds reasoned about this key from the shipped dist and all three drew the wrong conclusion from correct measurements.

**Shipped**: both `pool` and `poolOptions` removed, with the measured table recorded in the config so the next reader does not re-add either. C6's invariant ("the declared pool behaviour is the effective pool behaviour") is better served by this than by the contracted edit.

**Consequence**: `pool` is removed from C6's live-import allowlist. Re-adding it is the 13.8 s change and must be a deliberate allowlist edit.

## D2 — the D1 ≡ D2 agreement assertion was unreachable

**Found by M10**, whose expected-assertion column said the agreement must fire *specifically*. It red on C2 clause 2 instead: the per-package loop throws before the agreement is evaluated, so deleting `vitest` from a member's devDependencies never reached the check written to catch that exact edit.

**Shipped**: two passes — the domain is derived and its coherence asserted before any per-package obligation is checked. M10 now reds on `packages with assigned files vs packages declaring vitest`.

This is the expected-assertion column earning its place; "does it go red" would have recorded a pass.

## D3 — C3 control 2 as planned was tautological

**Plan**: assert every member's root-assigned set is non-empty.

**As implemented that cannot fail** — jobs are only pushed when `expected.length > 0`, so the assertion restates the guard. Deleting it left the suite green.

**Shipped**: the executed `(package, tier)` set, compared against a set derived a different way — `jobs` from the workspace enumeration crossed with the tier map, `pairsFromListings` from the root listings' own file paths. A tier map that drops a tier shrinks the first and not the second. M19 reds on it.

## D4 — the Playwright skip assertion was vacuous

**Plan**: assert no spec carries a declaration-level `skip`/`fixme`, using `suites[].specs[].tests[].annotations`.

**Found by M31**, which returned GREEN. Inspecting the report: specs nest under `suites[].suites[]` for anything inside a `test.describe`, and only sit at `suites[].specs` for a top-level `test(...)`. The assertion was iterating an empty array — it passed against `test.describe.skip` on the auth suite.

**Shipped**: a recursive `walkSpecs`, plus a guard asserting the walk reaches a non-zero number of specs. M31 now reds naming three skipped annotations.

The cycle's own subject — an assertion that reports success without examining anything — reproduced inside the gate built to stop it. Only executing the mutation exposed it.

## D5 — three mutations were mis-specified in the plan

| # | Plan | Observed | Shipped |
|---|---|---|---|
| M14a | `git rm --cached` a real test file → red via `⊇` | **GREEN** — the inventory is `--cached --others --exclude-standard`, so `--others` picks the untracked file straight back up | a **gitignored-but-present** test file: vitest claims it, the inventory omits it, `⊇` reds |
| M24 | `rm` the canary → red via control 6 | red via **control 5** — `rm` leaves the index entry, so the inventory keeps the file while vitest drops it | `git rm` (index **and** file), which shrinks both sides together so only control 6 can see it |
| M16 | point a member's path at a nonexistent directory → control 2 | **retired** — a directory that does not exist has zero assigned files, so it is not a member and no job exists. The ∅ == ∅ shape is structurally absent rather than guarded |

The plan's note that `git rm` "is not a mutation" is true for an arbitrary test file and false for a canary — deleting a canary outright is exactly what control 6 exists for.

## D6 — mutations that red through more than one path

Recorded so the evidence is not read as proof of the named control alone.

- **M14b** (`rm` a test file, leaving its index entry) reds on the D1 ≡ D2 agreement, because removing `packages/crypto`'s only test file makes D1 false while D2 stays true. Control 5's `⊆` direction is proven by M12/M13 instead.
- **M26** (`e2e/specs/*.integration.test.ts`) reds on the agreement for the same reason — the probe gives `e2e` an assigned file. Pairwise disjointness is unproven by an in-tree mutation: any double-claim must live under Playwright's `testDir`, which necessarily perturbs D1 for `e2e`.
- **M3** (defect in `canonicalArgv`, all eight scripts synced) reds on the **root** listing rather than a member listing, because the edit hits both call sites. The discriminating property still holds and is what matters: it red on a **child's exit status**, not on a string comparison — a gate built from two hand-written copies would have compared the defect against itself and stayed green.

## D7 — implementation was not delegated to sub-agents

Step 2-2's default is to split the work across Sonnet sub-agents. The work is one gate file plus ten mechanical manifest edits; the gate is this cycle's entire risk surface, and R21 requires the orchestrator to re-run and verify everything a sub-agent reports anyway. Delegating would have added a verification round without reducing the work. Recorded rather than silently skipped.

## D8 — CI gate parity: the extractor covers two of five gates, and there is no local aggregate script

`extract-ci-checks.sh` emitted `pnpm lint` and `pnpm typecheck`, then reported that `ci.yml` carries multi-line `run:` blocks it cannot parse. The repository has no `scripts/pre-pr.sh` or equivalent aggregate.

**Disposition**: the five CI-invoked root scripts were enumerated by hand from `ci.yml` (lines 23, 24, 25, 42, 151) — the same enumeration C8's pinned list was chosen from — and all five were run locally. No parity gap remains for this change. Building a local aggregate script is out of scope (SC50 keeps CI job structure untouched) and is not deferred silently: it is recorded here as a standing gap in the repo's tooling, not in this diff.

## D9 — the mutation harness destroyed four manifest edits

The harness restored each mutation with `git checkout -- <file>`, which reads the **index**. The implementation had not been staged, so the index still held HEAD, and each "restore" wrote the pre-change content over the edit. Four files lost their C1 edits (`apps/api`, `packages/crypto`, `packages/matcher`, `packages/schema`), and the six mutations that ran afterwards all observed the same stale state and reported the same assertion — which is what exposed it.

**Recovery**: the edits are the deterministic output of a generator script that was still on disk; it was re-run and each of the nine packages' scripts verified against the plan's locked table. Nothing was committed or pushed, and the tree was clean at session start, so no pre-existing work was at risk.

**Fix**: stage the implementation before running mutations, so `git checkout --` restores to it. All results from the broken batch were voided and re-run from M1.

This is the fourth time in this cycle that a measurement harness returned a confident wrong answer — after a `--config` placed outside the repo (plan round 2), a `sed` that silently failed to match (round 3), and a JSON probe run through a different invocation than the one under test (round 5). It is the first that was destructive.

## D10 — NF1 measured, and what it cost to meet

The gate's first working version cost **4.17 s** because each `it` re-spawned the same listings. Memoising brought it to 1.81 s; starting the independent children at module load so they overlap brought it to the shipped figure.

| | Duration (3 runs) |
|---|---|
| unit suite without the gate (29 files) | 702 / 694 / 831 ms |
| unit suite with the gate (30 files) | 1.31 / 1.31 / 1.32 s, later 1.40 s |

Gate adds **≈ 0.6 s** against a ≤ 1.0 s budget; suite stays under the 2.5 s ceiling.

## D11 — VE5 and VE6 remain open by design

Both are plan-mandated **pre-merge** items and neither is dischargeable from this machine:

- **VE5** — every stderr measurement here was taken on Node v26.5.0; `ci.yml` pins Node 22 at three sites. The per-child stderr measurement on Node 22, and the sanctioned fallback if an ambient writer survives `NODE_NO_WARNINGS=1`, are recorded in the plan.
- **VE6** — `pnpm -s -C e2e test --list --reporter=json` was verified locally, on a machine that has Playwright browsers installed. Whether it succeeds in the `checks` job, which runs only `pnpm install --frozen-lockfile`, is unverified.

Neither is a silent deferral: both carry a stated fallback in the plan, and both are on the pre-merge checklist.

## Mutation results

31 falsifiability mutations executed, all RED on the intended assertion. 2 documented-limit probes executed, both GREEN as required. 1 retired (M16, D5).

**M28b** is the one worth naming: narrowing root `test:unit` to `packages/` and running the real `pnpm test:unit` produced **8 files / 72 tests, exit 0, with the gate never executing**. SC56's residue — a gate cannot detect that it was not run — is now an observed fact rather than a stated caveat.

---

# Step 2-5 self-R-check — findings and fixes

Three sub-agents ran against the **staged** diff. Note first: the eight mechanical pre-step hooks were run against `main...HEAD`, which is empty because nothing is committed. **All eight reported "no changed files" — they examined nothing and are recorded as NOT RUN**, not as clean. Their obligations were discharged by hand instead.

## D12 — a third `pnpm --filter` site, on the CI-executed path (3/3 convergent, Major)

All three agents independently derived the class from the primitive and found what the plan's enumeration missed:

```
Dockerfile:57   RUN pnpm --filter @open-smp/web build
```

It is not out of CI's reach: `ci.yml:63` runs `docker compose up -d --build`; `docker-compose.yml` builds service `web` with `target: web`, which inherits from the `web-build` stage containing line 57. Renaming `@open-smp/web` makes the stage **exit 0 having produced no `.next`**, and the production image is built from an empty build stage. Reproduced: `pnpm --filter @open-smp/nope build` → **exit 0**; `pnpm -C apps/web-nope build` → **exit 1**.

Two shipped statements were false: SC53's *"C7 removes **both** of the repo's uses"* and the round-4 review's *"no third invocation surface"*.

**Root cause is the recurring one.** The member set was derived from `.github/workflows/` + `package.json` — a supplied list — rather than from the defining primitive across every CI-executed artifact. `git grep -- 'pnpm --filter'` over the tree yields three. This is the **fifth** instance of that shape in this cycle, recorded in a document that already names it as the cycle's signature error and notes it is the fourth cycle running.

**Shipped**: `Dockerfile:57` → `pnpm -C apps/web build`, with the reason in a comment. SC53 corrected to name all three sites. `docker compose build web` verified green.

## D13 — C5's config class omitted `vite.config.*` (Major, R42)

Vitest also resolves `vite.config.*` carrying a `test` key, so a re-added declaration in that spelling was invisible to the one control that watches for it. The class is empty today, so nothing was broken — but the regex asserted a universal it did not cover.

**Shipped**: `/(^|\/)vite(st)?\.(config|workspace)\.[^/]+$/`. Red-proven by **M32** (add `apps/api/vite.config.ts` → red).

## D14 — the developer's checkout username was pasted into two committed artifacts (Major, RS4)

`plan.md` and `review.md` both quoted a probe verbatim as `vitest list --project unit noguchi`. The same review file already elides `/Users/…` elsewhere, so the redaction existed and simply had not propagated. Nothing is newly disclosed (public repo, git author already carries the name), but the artifacts are new and the rule is about what a diff adds.

**Shipped**: replaced with `<checkout-dir-fragment>`; the argument the sentence makes — a substring appearing only in the absolute prefix matches nothing — survives intact. Zero bare occurrences remain.

## D15 — C6's per-project loop had no cardinality guard (Minor, RT4)

Proven by execution rather than by reading: replacing `projects` with `[]` left the `it` **passing** — `Object.keys({projects: []})` is `['projects']`, `Array.isArray([])` holds, the loop body never runs. This is the only enforcement keeping `pool` out of the config, i.e. D1's entire subject.

**Shipped**: `expect(projects.length, 'no projects inspected').toBeGreaterThan(0)`. Red-proven by **M33**. Same class as D3 and D4 — the third vacuous assertion found in this file, all three by executing a mutation.

## D16 — `git ls-files` was spawned twice, and the second copy bypassed the per-child discipline (Minor, R1/R3/R17)

`assertChildOk`'s own docblock claims it governs "EVERY child this gate spawns … `git ls-files` alike", and C5's test spawned an identical child checking only `status` — no `error`, no stderr assertion. Not fail-open (a spawn failure yields `status === null`, which reds), but the flag triple `--cached --others --exclude-standard` is load-bearing (D5/M14a exists because of `--others`) and lived in two places.

**Shipped**: one `trackedOrUntrackedFiles()` producer, routed through `assertChildOk`, consumed by both `inventory()` and C5.

## D17 — stale `ci.yml` line citations (Minor, R3)

C7's edit added four comment lines, shifting `test:e2e` from 147 to 151 and the browser-install step from 144 to 148. Three citations still named the pre-change positions — and those numbers are C8's stated provenance for how its pinned list was *chosen*, which the plan leans on precisely because the list is a literal rather than derived. Corrected in the plan and in the gate's comment.

## D18 — VE6 discharged by execution, ahead of CI

The Testing agent probed the browserless case directly: `PLAYWRIGHT_BROWSERS_PATH=<nonexistent> pnpm -s -C e2e test --list --reporter=json` → **exit 0, 0 bytes stderr, valid JSON**. The `checks` job's lack of installed browsers is not a blocker for control 5's Playwright claimant. VE6 closes; VE5 (Node 22 stderr) remains open by design.

## D19 — correction to D6, in the safe direction

D6 recorded "pairwise disjointness is unproven by an in-tree mutation". It is proven: the M26 probe reds on **both** the D1 ≡ D2 agreement and, in a separate `it`, on `claimed by vitest integration and playwright`. Two of the three pairs remain reachable only through a config-glob edit; the third is observed.

## Post-fix gate state

`pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm test:unit` 30 files / 273 tests / 1.33 s · `pnpm test:integration` 6 files / 143 tests / 8.27 s · `pnpm test:e2e` 43 passed · `docker compose build web` green.

33 falsifiability mutations executed, all red on the intended assertion. 2 documented-limit probes green as required. 1 retired.

## D20 — C9 and C10 were rewritten after plan-review round 6, and C11 was added (8 Major-class, revision 8)

Revision 7 contracted the two controls that code review had invented (C9, C10) and submitted them
to the plan review the other eight contracts had. **The review did not clear them.** 28 findings
across three experts, 8 Major-class, four changing an invariant. Every claim below was
re-measured by the orchestrator in `node` or from a captured exit status before being acted on.

**What was wrong, and the shape it had:**

| | Defect | Shape |
|---|---|---|
| 1 | C9's family pin compared a regex against strings extracted by the same production — **empty for every possible input** | Ninth vacuous assertion in this file; **first of the nine found by review rather than by executing a mutation**. Its certifying mutation (M62) edited the gate's own reader. |
| 2 | The prose classifier `/^docs\/.*\.md: /` was applied to the composed `file: line` string, so `.*` spanned the boundary and any line containing `.md:` plus a space was exempted | **Fail-open**, introduced by round 3's fix for the previous fail-open |
| 3 | Quoted and JSON-array selector forms were invisible — a form already used by three Dockerfile `CMD` lines and one compose `command` | The "axes removed" claim was false for an axis never removed |
| 4 | YAML folded scalars (`run: >`) were invisible | Same |
| 5 | Three legitimate inputs redded: `pnpm exec grep -F`, `README.md` prose, `COPY --link` | RT10 — no allow side existed at all |
| 6 | C10's stage slice ran to end of file, not to the next `FROM` | The invariant said "in that stage" and the code did not |
| 7 | C10 compared only the COPY *source*, so a mis-targeted destination passed | Reproduced the exact defect the contract exists for |
| 8 | C10's cardinality guard was on the raw enumeration, not the derived list | Fourth vacuity site in this `it`'s lineage |
| 9 | `--frozen-lockfile` was unpinned although the whole Problem statement is a property of it | — |
| 10 | The root manifest was subtracted by `filter(Boolean)` with nothing taking responsibility | The D0 shape, which this plan calls load-bearing |
| 11 | 11 of 17 cited mutations — **all four** of C10's — were proofs against implementations round 3 replaced | Red-proof is not transitive across a rewrite |

**Root cause, and it is not any of the eleven.** The selector scan had been widened four times
across three rounds, each widening following a demonstrated miss. Round 3 relabelled the method
as "removing the axes" and the contract made that the invariant. Round 6 found two axes never
removed and one introduced. The reason the sequence would not terminate is that **the control was
at the wrong level**: it judged notation for a property that only pnpm can decide. SC60 had
recorded for three rounds that closing the residue "needs a runtime observer of the invocation,
not a reader of the text" — and then deferred it, three times, while the residue kept acquiring
members.

**Shipped**:

- **C11 (new)** — `failIfNoMatch: true` in `pnpm-workspace.yaml`. Measured: `pnpm --filter <no-match>`
  exits **0 → 1**; `pnpm --filter e2e exec playwright --version` and `pnpm -C apps/web build`
  unaffected. This closes every route C9 cannot see, including all of SC60's three-round residue,
  because the decision happens inside pnpm. It holds when no test runs — the one control here that
  SC56 does not reach. Asserted behaviourally, not by reading the setting.
- **C9 rewritten** as a declared best-effort tripwire: comments stripped so the expected set is
  **empty** (the pinned literal list was itself a name-shape member set, and it had grown to three);
  decisions scoped to pnpm's own argv; markdown excluded by file kind, deleting the classifier
  rather than patching its leak; the family pinned against the declaration column of pnpm's
  "Filtering options" block; anti-vacuity self-tests in both directions, because an empty expected
  set makes a dead predicate pass.
- **C10 corrected** on all six counts, with `pnpm-workspace.yaml` added to the pinned root COPY —
  C11's setting has to reach the image or the no-match route is silent inside every build stage.
- **28 mutations re-executed against the shipped tree**, 22 red with their observed messages
  recorded and 6 allow-side controls green. Four of the six allow controls redded in revision 7.
- **Two structural alternatives measured and declined** with the cost named: `pnpm fetch` (deletes
  C10's member set; moves the `argon2` native build onto every source edit) and a `find`-derived
  manifests stage (keeps the cache; restructures the production image path). Recorded in SC62.

**The finding worth keeping**: revision 7 argued that the difference between C1–C8 (zero Major in
two code-review rounds) and C9/C10 (twelve) was the plan review the latter skipped. That was a
correlation. Round 6 made it causal — one review round on two contracts produced eight Major-class
findings, including a vacuous assertion at the centre of the control, in code that had already
survived three code-review rounds and 62 mutations. **Mutation testing did not find it, because
the mutation that would have exposed it was the one nobody could write: it required changing
pnpm's output, not the gate's.**

## D21 — code-review round 4: two Criticals in revision 8's own repairs

Revision 8 answered round 6's Critical (a vacuous family pin) and declared C9, C10 and C11 locked.
Round 4 attacked that surface and found **26 findings, two Critical**, both inside the text written
to close the previous Criticals.

**1. C11 was declared an enforceable boundary and is not.** `--no-fail-if-no-match` and
`--fail-if-no-match=false` disable `failIfNoMatch` for that invocation — measured **exit 0**, in the
workspace and inside the built `deps` image. Every other context was attacked and held: `.npmrc`,
`npm_config_*` / `PNPM_CONFIG_*`, a nested `pnpm-workspace.yaml`, a member-subdirectory cwd, `-r`,
`-C`, and every image stage. The CLI flag is the only bypass mechanism, and round 5 measured that the *mechanism* has at least eleven spellings — prefix abbreviations, a `--config.<key>=` channel in two cases, a double negation, and a space-separated value. Revision 9's enumeration of two was wrong in both directions, and revision 10 replaced it with a derivation over the setting's name.

The overstatement was load-bearing, which is what made it Critical rather than a wording defect:
revision 8 demoted C9 to defense-in-depth, closed SC60 with "Trigger: none — closed", and accepted
C9's remaining residue *because C11 was believed to cover it*. And `--fail-if-no-match` had been
filed in C9's **reviewed non-selector allowlist** — accurate as a description, exactly wrong as a
disposition, because that scan is the only thing in the repository that can observe an invocation
disabling C11. The composed line `pnpm -F=e2e --no-fail-if-no-match test` is plain text with no
quoting, no folding and no wrapper, and it passed both controls.

**2. C10's anti-vacuity self-tests were themselves vacuous.** They re-typed the matcher regexes
instead of using them, so they asserted over private copies. Executed: narrowing the shipped
`FROM … AS deps` matcher to drop `(--\S+\s+)*` leaves the real `FROM base AS deps` still matching
and the self-test still passing — the `it` green with the property it names removed. **Tenth vacuous
assertion in this file, in the lines labelled "anti-vacuity".**

**Also measured and closed rather than declared**: `-F=<pkg>` and `-rF=<pkg>` are working selectors
the family did not match; only the first `pnpm` per command was scanned, so `pnpm -w exec pnpm
--filter …` was invisible — and `pnpm -w exec` is the canonical form of every member `test` script
this cycle wrote; comments were stripped after continuations were joined, so a trailing `#`
swallowed the line joined onto it, which neither the Dockerfile parser nor the shell does.

**Shipped**: C11's class restated as a fail-closed default with one enumerated CLI opt-out, the
opt-out moved into C9's deny set and its existence asserted; C10's matchers hoisted to single
declarations; C10's root-input set derived from the working tree rather than three names; the
Dockerfile's pnpm pinned to the root `packageManager` and gate-tied to it; `COPY --from=` rejected
in the deps stage; `WORKDIR`-absolute destinations resolved; SC60 reopened as two-sided; NF1
restated in CPU-seconds; the rollback runbook rewritten against the shipped gate and re-measured.

**50 mutations executed** against the shipped tree — 38 red, 12 allow-side green.

**Four were mis-specified on the first run, and the fourth is the one worth keeping.** Three were
harness errors: a deny probe whose failure had the same cause it was meant to differ from, a family
narrowing caught by an earlier self-test rather than the assertion it targeted, and a guard
inversion that filled the parsed set with garbage instead of emptying it. The fourth was not an
error in the mutation: re-adding a `docs/` directory anchor stayed **green** against the *repaired*
exclusion guard. All 39 tracked files under `docs/` are markdown, so the directory predicate and the
extension predicate produce identical sets — and **no comparison of sets can distinguish two
predicates that agree on every file that currently exists**. The guard now asserts the predicate
against synthetic paths instead. The first repair had been reviewed, looked correct, and was wrong.

**What the round says about the method.** Nine vacuous assertions were found by mutation, the tenth
and eleventh by review. Both new ones were in code written to fix the previous one, and both took
the same form the previous one took: **a check that compares something to a copy of itself.** The
pattern is not carelessness about assertions; it is that the natural way to write a self-check is to
restate the thing being checked, and restating it is exactly what makes it vacuous. C1–C8, which
were reviewed before implementation, have taken zero Major findings across four code-review rounds.
C9–C11, implemented before they were contracted, have taken twelve Major and three Critical across
two reviews.
