# Plan: package-test-script-parity

Cycle 6. Branch: `fix/package-test-script-parity`.

Revision 6 — after plan-review round 5 (13 findings, 1 Critical). Five rounds, 89 findings, and the shape of them is the record worth keeping: the core parity gate (C1–C3) has been stable since revision 2 and held under re-attack in rounds 3, 4 and 5; every round after the second found its findings in the *peripheral* contracts added to close CI-side channels. Round 5's Critical was in C8, added in revision 5 — new surface, new blind spot, which is the pattern cycle 5 documented. See `package-test-script-parity-review.md`.

**This is the final revision. Phase 2 implements it.**

## Project context

- **Type**: mixed monorepo — web app (`apps/web`, Next.js), services (`apps/api`, `apps/worker`), libraries (`packages/*`)
- **Test infrastructure**: unit + integration (Testcontainers) + E2E (Playwright) + CI/CD (GitHub Actions)
- **Verification environment constraints**:
  - **VE1** — integration tests require Docker/Testcontainers. Available locally and in CI (`ci.yml:42`). `verifiable-local` + `verifiable-CI`.
  - **VE2** — E2E requires the compose stack plus seed; login rate limit 5/min/IP with the spec budget at 5/5. This cycle adds no spec that logs in. `verifiable-local`.
  - **VE3** — the gate spawns child processes from inside a vitest test. Measured couplings: the workspace `node_modules` layout, `pnpm` on `PATH` inside a vitest worker's child, and the child's stderr surface. The first two were probed (`CI=true` and a simulated worker env give byte-identical output, exit 0; spawning from `packages/queues`, which has no local `node_modules`, still yields 0 stderr bytes).
  - **VE4** — `pnpm test:unit` does not typecheck. All gates (`lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`) must be run separately.
  - **VE5** — **local Node is v26.5.0; `ci.yml` pins `node-version: 22` at lines 20, 35 and 58.** Every stderr measurement here was taken on Node 26; `pnpm`, `node` and `vitest` all write to that stream. **Discharged before C3 is implemented, not after**: the per-child stderr measurement on Node 22 is taken on the branch and recorded alongside the cost baseline. If a Node-22-only ambient writer survives `NODE_NO_WARNINGS=1`, the sanctioned fallback is that C6's enforcement narrows to the live-import assertion alone and the stderr check becomes a **diagnostic printed on failure** — recorded as a deviation with C6's invariant explicitly narrowed. Never a filter (C3 Forbidden patterns). Stating the fallback in advance is what keeps the first red from being answered with deletion.
  - **VE6** — control 5 observes Playwright's discovery via `pnpm -s -C e2e test --list --reporter=json`. Measured locally it launches no browser, the config declares no `webServer`, and `globalSetup` is not executed for `--list`. **Resolved before locking**: Phase 2 confirms on the runner that it succeeds in the `checks` job. If a browser is required, the `checks` job gains the same `pnpm -C e2e exec playwright install --with-deps chromium` step. Moving the Playwright half into a CI-only job is **not** an option — it would violate F3 and split one control across two jobs, so a local `pnpm test:unit` would report control 5 green without observing the Playwright claimant. That is the escape revision 1's SC48 offered and all three experts rejected.
  - No `blocked-deferred` path exists.

## Objective

A package-level `test` script must not report success while skipping the tests it appears to cover — and neither must the gate that enforces it, the root scripts CI invokes, nor the file inventory any of them is measured against.

## Measured current state

Root cause, established by execution: vitest discovers the config file by searching upward but takes `root` from the **cwd**. The root config's `unit` include globs are repo-root-relative (`packages/**`, `apps/**`), so from a package cwd they resolve under that package and match nothing. The `integration` glob (`**/*.integration.test.ts`) is depth-agnostic and still matches. A package script therefore runs integration files only, or nothing.

**Precondition**: the three "silent green" rows resolve *integration* files, so they report green only where Docker is available; without it they are loud red. The defect — resolved set ≠ assigned set — is identical either way.

| Package | Own vitest config | Files its `test` resolves | Files the root assigns | Verdict |
|---|---|---|---|---|
| `apps/api` | – | 1 (integration only) | 14 unit + 1 integration | **silent green** — skips `api-types-boundary` (C39 gate), `saas-app-key-pin` (SC30 gate), `workflow-pins`, `seed-gate-agreement`, +10 |
| `apps/worker` | – | 3 (integration only) | 1 + 3 | **silent green** |
| `packages/schema` | – | 2 (integration only) | 1 + 2 | **silent green** — skips `tables.test.ts` |
| `packages/crypto` | – | 0 → exit 1 | 1 | loud failure |
| `packages/matcher` | – | 0 → exit 1 | 4 | loud failure |
| `packages/connectors/core` | – | 0 → exit 1 | 1 | loud failure |
| `packages/connectors/google-workspace` | – | 0 → exit 1 | 1 | loud failure |
| `packages/queues` | – | 0 → exit 1 | 0 | loud; declares `"test": "vitest run"` with **no dependencies at all** |
| `apps/web` | **yes** | 6 | 6 | correct — only because it carries a second config |
| `packages/api-types` | – (no `test`) | n/a | 0 | consistent |
| `e2e` | – (Playwright) | n/a | 0 vitest files | outside the vitest domain — see C2 |

**CI's root-script invocations**, enumerated from `ci.yml` (the complete set, used to choose C8's pinned list): `pnpm lint` (23), `pnpm typecheck` (24), `pnpm test:unit` (25), `pnpm test:integration` (42), `pnpm test:e2e` (151). Root `test` and `build` are invoked by **no** CI path. Line 148 runs `pnpm -C e2e exec playwright install` — a package command, fixed by C7. Root `test:e2e` is `pnpm --filter e2e test`, so **one CI path does execute a package-level `test` script**; `ci.yml:140-143` documents why (`@playwright/test` is declared in `e2e/package.json` only).

### Five silent-green channels outside the package scripts

All measured. Each was found by a later review round than the one before it, which is why the closures are general controls rather than per-route patches.

1. **The root config's globs are the unaudited ancestor of every derivation.** Narrowing the `unit` include by one token (`apps/**/*.test.ts` → `apps/we*/**/*.test.ts`) drops the root unit set from **29 to 14** and `apps/api`'s assignment to **0**, exit 0 throughout. `apps/api` then leaves the domain, its script stops being required, and `ci.yml:25` is green — with the C39 boundary gate and the `saas_apps.key` pin no longer executing anywhere. A reconciliation of the form `union(partition(X)) == X` cannot detect this: it is an identity for **every** X. Closed by C3 control 5.
2. **The globs match `.ts` only, and a naive inventory would share that blind spot.** Asked of vitest directly: `apps/web/test/zzprobe.test.tsx` and `packages/crypto/test/zzprobe.test.mts`, both containing a passing test, are assigned to **neither** project — the unit total stays 29 and both listings return zero matches. `apps/web` is the Next.js app with 20 `.tsx` files. **The repo already recorded this hazard**: `sc42-derive-link-status-domain-plan.md:50` (VE7) states the root config "matches `.ts` only … a `.tsx` module cannot be unit-tested" and that missing it "is the cycle-3 Critical's exact shape". Closed by control 5's deliberately wider inventory family.
3. **`pnpm --filter` is exit-0 silent on two distinct routes.** `pnpm --filter <pkg> test` where the package lacks the script → **exit 0, no output** (specific to `test` being a pnpm built-in shorthand; `--filter <pkg> testnothere` → exit 1). `pnpm --filter <nonexistent> test` → **exit 0**, `No projects matched the filters` — same for `exec`. So deleting `e2e`'s `test` script, *or* renaming the `e2e` package, makes `ci.yml:151` run zero Playwright specs while `compose-smoke` and `assert-seed-preserved.sh` both pass. Closed by C2 clause 3 and C7 at **both** `--filter` sites.
4. **Playwright's own discovery narrows silently.** Adding `testIgnore: ['**/auth.spec.ts','**/session-expiry.spec.ts']` → **exit 0**, `Total: 37 tests in 7 files`, both auth specs absent. Total wipeout is loud (exit 1); **partial** narrowing is silent, and partial narrowing is what drops the login and session-expiry proofs. Closed by control 5's Playwright claimant — which, because C7 chose the script form, also detects the `e2e` script itself being neutered (measured: `playwright test --grep-invert auth` → 8 files, `auth.spec.ts` unclaimed → red).
5. **The root's own scripts are bound by nothing.** D0 correctly removes the repo root from C1–C3's member domain, but that is a subtraction with nothing added back. Gutting root `test:e2e` leaves control 5 green — it observes the *package* script — while `ci.yml:151` runs zero specs. Replacing root `typecheck` with `true` leaves CI green having typechecked nothing, and VE4 establishes that `pnpm typecheck` is the only type gate CI runs. Closed by C8.

Channels 3, 4 and 5 are three routes found in three successive rounds to one outcome — CI reporting the authentication flow verified when it never ran. That recurrence is why control 5 is generalized across runners and why C8 exists rather than a sixth point fix. **The residue that remains after C8 is recorded as SC56, in its general form, rather than implied to be closed.**

## Requirements

- **F1** — every workspace package in the vitest domain executes exactly the set of test files the root runner assigns to that package's directory, per tier.
- **F2** — a package's `test` declaration and its actual test assignment agree in both directions, on both tiers.
- **F3** — a gate enforces F1 and F2, runs under `pnpm test:unit`, and therefore runs in CI **provided CI still invokes it** (SC56). A CI-only placement is not an acceptable outcome for the gate or any part of it.
- **F4** — the gate is proven able to fail, by executed mutation, for every distinct way it could go silently green. Each mutation states its precondition and the assertion whose message must appear.
- **F5** — **every test-shaped file that exists in the working tree and is not gitignored is claimed by exactly one runner's observed discovery** — "exactly one" enforced pairwise across all claimants. "Test-shaped" is a deliberately wider family than any runner's own patterns.
- **F6** — the root scripts CI invokes still **mean** what their names say: their values are pinned. Whether CI still invokes them is **not** claimed — see SC56.
- **NF1** — the gate's wall-clock cost is measured and stays within a stated numeric budget.
- **NF2** — the 29 pre-existing unit files and 6 integration files retain identical membership; the only permitted addition to the unit set is the new gate file, named explicitly. Control 5's bidirectional equality is the standing enforcement.

## Technical approach

### Tiering

Package `test` scripts mirror the root's tier split, because the integration tier needs Docker (VE1) and a single spanning script would make `pnpm -C apps/api test` require a daemon — the reviewer flow in scenario 1. Each domain member declares `test` (unit) and `test:integration`, each iff it has files in that tier. `pnpm -r test` then runs only unit tiers rather than three concurrent integration runs against one database. The three package-level `test:integration` scripts are developer-only; CI uses the root script.

### Canonical script forms, from one producer

Verified from a depth-2 package, a depth-3 package and the repo root, for both projects, with the trailing slash:

```
test              →  pnpm -w exec vitest run --project unit <dir>/
test:integration  →  pnpm -w exec vitest run --project integration <dir>/
```

- `pnpm -w exec` runs with cwd at the workspace root, so the config `root` is the repo root. It encodes no relative depth; nested invocation from a package cwd resolves to the repo root with exit 0.
- The positional argument is a **plain substring filter matched against the project-relative path**. Verified: `vitest list --project unit <checkout-dir-fragment>` → 0 and `ghq/` → 0 (both appear only in the absolute prefix), `apps/api/` → 14. So a checkout directory containing a member's path fragment cannot inject matches, and CI's `/home/runner/work/open-smp/open-smp` behaves identically to a local path. The trailing slash keeps `packages/connectors/core/` from sweeping a future `core-v2/`.
- `pnpm -w exec` propagates a child's exit status faithfully (`node -e 'process.exit(3)'` → 3).

**One producer, two consumers.** A single `canonicalArgv(dir, tier)` returns the argv array; the left half compares `scripts[…]` against `.join(' ')`, the right half spawns the same array with `run` replaced by `list --filesOnly`. Authored independently, a producer defect would be written into all eight manifests, compared against itself, and bypassed by the right half's separately-correct argv: eight scripts broken on invocation, gate green.

### How the gate observes without parsing and without recursion

No single act can both execute a package's real `test` script and yield a file set: `vitest run --filesOnly` does not exist (`CACError`), only the `list` subcommand lists without executing, and running the script from a gate inside a member package recurses. A one-act design is therefore the forbidden parser, a recursion, or a comparison of the root config against itself.

The gate is **two structurally independent halves**: a **left half** binding `scripts[…]` by exact string equality to a value computed from the package's own directory (no dialect, no partial match, every deviation fails, failure direction always false-red — the allowlist-of-one shape `apps/api/test/api-types-boundary.test.ts` already uses), and a **right half** spawning the canonical argv with `run` → `list --filesOnly` and comparing sets. The residual — that `run` and `list` resolve identically — is vitest's own invariant, recorded as SC51. Rejected: a sibling `"test:list"` script, an RT9 twin of the script under verification.

### How the domain is derived

- **D0** — the workspace entry's `path` is not the workspace root. Derived from `pnpm list -r`.
- **D1** — root `vitest list --filesOnly` assigns the package ≥1 file.
- **D2** — the package declares `vitest` in its own `dependencies` or `devDependencies`.

**D0 is not optional.** Revision 2 stated the domain as `D1 ∧ D2` and claimed the two were "exactly equal — the same eight packages". That was wrong: the repo root declares `vitest@^4.1.10` and `vitest list --project unit ./` assigns it all 29 files. Both yield **nine** entries. **D0 is a subtraction requiring C8 as its complement** — channel 5.

The **D1 ≡ D2 agreement** is asserted bidirectionally (`D1 \ D2` and `D2 \ D1` each empty, naming the offending package). Without it, deleting `vitest` from `apps/api`'s devDependencies would drop it from the domain and stop binding its script.

Membership enumeration is by `pnpm list -r --depth -1 --json`, never by globbing `*/package.json` (which would miss `packages/connectors/*`).

**Reading `package.json` for a key's presence or for exact string equality is not the prohibited pattern**, and neither is enumerating files that exist, nor importing a config module and inspecting the resulting object. The prohibition is on **inferring behavior from dialect-bearing text** — which is why C8 does not attempt to read `ci.yml`.

## Contracts

### C1 — tiered package `test` scripts delegating to the root runner

- **Applies to**: every domain member (**D0 ∧ D1 ∧ D2**).
- **Invariant** (gate-verified by C3): for each member `P` and tier `T` it participates in, the set of files resolved by `P`'s tier-`T` script equals the set of root-assigned tier-`T` files under `P/`. **Set equality over repo-root-relative paths — not cardinality.**
- **Member set** (recomputed independently in rounds 2, 3, 4 and 5; unchanged):

  | Member | unit | integration | declares `vitest` |
  |---|---|---|---|
  | `apps/api` | 14 (→15, gains the gate) | 1 | yes |
  | `apps/web` | 6 | – | yes |
  | `apps/worker` | 1 | 3 | yes |
  | `packages/crypto` | 1 | – | yes |
  | `packages/matcher` | 4 | – | yes |
  | `packages/schema` | 1 | 2 | yes |
  | `packages/connectors/core` | 1 | – | yes |
  | `packages/connectors/google-workspace` | 1 | – | yes |

  Non-members: repo root (**D0** false — C8 instead), `packages/api-types` (D1/D2 false, no `test`), `packages/queues` (D1/D2 false — C2), `e2e` (D1/D2 false; declares `@playwright/test` — C2). Totals: 29 unit (30 after the gate) and 6 integration.
- **Consumer-flow walkthrough**:
  - *A developer or reviewer* (`pnpm -C <pkg> test`) needs a green exit to imply every root-assigned **unit** file ran, **without a Docker daemon** — which the tier split provides.
  - *`pnpm -r test` / `pnpm --filter <pkg> test`* reads each member's exit status: the unit tier for the eight members, Playwright for `e2e`.
  - *CI* invokes root scripts for unit and integration (values pinned by C8), and — via C7's `pnpm -C e2e test` — **`e2e`'s own `test` script** for the E2E tier. Keeping CI on the package's own script rather than a re-declaration is deliberate twice over: a flag later added to that script is honored automatically instead of bypassed, **and** control 5's Playwright claimant then observes the same command CI runs, so neutering that script (`--grep-invert auth`, a positional spec argument) is gate-detected. Measured: 9 → 8 claimed files → red.
- **Forbidden**: any package-local vitest config re-declaring include globs — enforced by C5. A member's filter argument must not be a prefix-substring of another member's path (no pair violates this today) — enforced by C3's raw-stdout comparison, not by review.
- **Retained deliberately**: each member's own `vitest` devDependency. `pnpm typecheck` is `pnpm -r --parallel exec tsc --noEmit` over tsconfigs that `include: ["src","test"]`, so those devDeps stay load-bearing for typecheck even once scripts resolve the binary from the root. They are also D2's evidence; **their removal is gate-detected by the D1 ≡ D2 assertion (M10), which does not depend on typecheck** — typecheck is the secondary control, and C8 pins its value.
- **Noted convention divergence**: `ci.yml:140-143` records "`--filter e2e`, not a bare `pnpm exec`: `@playwright/test` is declared in `e2e/package.json` only." C1 does the opposite for vitest — resolving the binary from the root, safe because root `devDependencies` declares `vitest@^4.1.10`. C7 keeps the convention intact for Playwright by using `-C e2e`.
- **Acceptance**: for each member and tier, running its script resolves exactly the root-assigned **set** (path-equal), exiting 0 when those tests pass.

### C2 — script declaration and test assignment agree in both directions

- **Invariant** (gate-verified by C3), four derived clauses:
  1. **Positive, symmetric**: a domain member declares the canonical `test` **iff** it has ≥1 assigned unit file, and the canonical `test:integration` **iff** it has ≥1 assigned integration file — both over the same derived per-project tier map. **The symmetry matters**: D1 is satisfied by ≥1 file in *either* project, so an integration-only member is a domain member. Revision 3 demanded `test` unconditionally, which would have minted a script that can only fail — measured: `pnpm -w exec vitest run --project unit packages/queues/` → **exit 1** — regenerating the `packages/queues` R41 shape from inside the contract that removes it.
  2. **Negative**: a non-domain package declaring a `test` script must declare a dependency in `KNOWN_TEST_RUNNERS` other than `vitest`.
  3. **Positive, reverse**: a package declaring a `KNOWN_TEST_RUNNERS` member other than `vitest` **must** declare a `test` script. This pins `e2e`'s script without naming it; under C7, CI depends on it directly.
  4. **Residual**: a package declaring `test` with no recognized runner is a violation — the `packages/queues` verdict.
- **`KNOWN_TEST_RUNNERS` is a named allowlist**, today `{vitest, @playwright/test}`. **It is permitted where the rejected `e2e` name-exemption was not, and the distinguishing property is the failure direction**: an unrecognized runner makes clause 2 red (false red, investigated), whereas a name-keyed exemption would have made the gate green over a package it stopped checking. A package testing via `node --test` declares no runner dependency and would red clause 2 — correct, forcing a deliberate entry. `testcontainers` / `@testcontainers/*` are not runners.
- `packages/queues`'s `test` script is removed, matching `packages/api-types`.
- Rejected: `--passWithNoTests`; a package-name exemption list for `e2e`.
- **Acceptance**: `pnpm -C packages/queues test` exits **non-zero with pnpm reporting a missing script**, and **no vitest process starts**. Measured post-change shape: exit **254**, `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`. Revision 2 asserted exit 1 — the wrong number *and* the value the **pre-change** state already returns, so it could not discriminate. The rationale is R41, not comprehensibility.

### C3 — the parity gate

- **Signature**: an executed test file in the `unit` project, placed in `apps/api/test/` following `workflow-pins.test.ts` and `seed-gate-agreement.test.ts`. It enumerates workspace packages via `pnpm list -r --depth -1 --json`, computes D0/D1/D2, and asserts C1's, C2's and C8's invariants. Noted departure: those three existing gates are entirely in-process; this is the repo's first gate that spawns children.
- **Left half**: `scripts.test === canonicalArgv(dir,'unit').join(' ')` and, per the derived tier map, the same for `test:integration`.
- **Right half**: for each member and tier, `spawn('pnpm', canonicalArgv(dir,tier) with run→['list','--filesOnly'], { shell: false, stdio: separate pipes, env: pinned })`, run **concurrently**.
  - **Compare the child's raw stdout set**, not a prefix-re-filtered one. Revision 3 re-filtered by `<dir>/` inside the gate; that re-filter exists only in the gate, not in the real script, so an over-matching filter argument would be discarded, compare equal, and stay green while `pnpm -C <pkg> test` executed a superset. Under-match → subset → red; over-match → superset → red. The prefix check survives as a diagnostic naming which foreign paths appeared.
  - **Provenance**: the root-assigned side is the `<dir>/`-prefix filter of the two unfiltered root listings from control 3 — never a re-spawn of the child's own command.
- **Per-child discipline — governs EVERY child the gate spawns**, including the two control 5 adds (`git ls-files`, the Playwright listing):
  - Assert `error == null && code === 0` **keyed by that child's own identity**, before its stdout is used, failing with that identity and its stderr. `git ls-files` exits **128** with empty stdout outside a repository, so an unread status would report "inventory empty" rather than "git failed".
  - Parse **stdout only**; assert each child's **stderr is exactly empty**, printing the offending bytes. This is C6's first enforcement mechanism. Measured: `--project unit` children 0 bytes, `--project integration` children 196 bytes (the banner C6 removes), Playwright JSON child 0 bytes.
  - **Pinned child env**: `CI=1`, `NO_UPDATE_NOTIFIER=1`, `npm_config_update_notifier=false`, `NODE_NO_WARNINGS=1`. The last is the sanctioned answer to the one ambient writer that cannot be silenced at source — Node's runtime warnings, which differ across VE5's boundary. **Verified safe**: with it set the integration child still emits the full 196-byte `DEPRECATED` banner, because vitest writes it through `logger.deprecate` rather than `process.emitWarning`. (Note: C6's live import runs in the gate's **own** process, not a spawned child, so the pinned env does not affect it; the `[MODULE_TYPELESS_PACKAGE_JSON]` warning it may emit is asserted on by nothing.)
  - Strip the leading `[unit] ` / `[integration] ` prefix by matching the leading bracketed token, **not** by whitespace splitting. Normalize to repo-root-relative POSIX; never by `basename`.
- **Positive controls against vacuity.** `vitest list --filesOnly <nonexistent-dir>` exits **0 with empty stdout**, so ∅ == ∅ passes both a set-equality and an exit-status check. The gate therefore also asserts:
  1. the enumerated member set is non-empty;
  2. every member's root-assigned set is non-empty;
  3. **enumeration reconciliation** — the union of the per-member root-assigned sets equals the full root `unit ∪ integration` set, the right-hand side from **two unfiltered root listings obtained without reference to the tier map**. This detects *enumeration* loss; it does **not** detect glob narrowing, because `union(partition(X)) == X` is an identity for every X. Revision 2's claim that it "turns NF2's counts into an executed assertion" was wrong and is withdrawn — control 5 supplies that anchor.
  4. `pnpm --version` succeeds, so a PATH failure reads as a PATH failure (VE3);
  5. **inventory ↔ discovery reconciliation** — below;
  6. **named canaries**: `apps/api`'s observed unit set contains `test/api-types-boundary.test.ts` and `test/saas-app-key-pin.test.ts` by name. Everything else is relative, so deleting a canary shrinks the inventory and the unit set *together* and control 5 stays green — only control 6 can see it. A hardcoded expectation, justified on the same axis as the rest: false-red direction, an allowlist-of-two over the files whose absence *is* the security event.
- **Control 5 — inventory ↔ discovery reconciliation.**
  - **Inventory source**: `git ls-files --cached --others --exclude-standard` — tracked files **plus untracked-but-not-ignored**. Revision 4 used bare `git ls-files`, which is index-derived while every claimant globs the **working tree**. Measured: a newly written `packages/crypto/test/zzunstaged.test.ts` is **absent from `git ls-files`** and **claimed by vitest**, so the `⊇` direction reds on the most ordinary developer action; worse, mutations M12/M13 create exactly such files, so **both would have passed green**. The widened form yields the same 44 test-shaped entries today, adds 2 untracked non-test files, and leaks **0** from `node_modules` (`.gitignore` declares it, along with `dist/`, `.next/`, `coverage/`, `e2e/.auth/`, `e2e/playwright-report/`, `e2e/test-results/`). Narrowing resistance survives for the tracked half: `.gitignore` does not untrack a tracked file, so shrinking the inventory of existing tests requires a visible deletion. Unlike `eslint.config.mjs`, `.gitignore` is the repo's own declaration of what counts as content. (`node_modules` holds **311** `*.test.ts`, so an exclusion is genuinely required.)
  - **Inventory family**: `*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` — **deliberately wider than any runner's own patterns**. A control whose pattern equals the config's pattern can only see narrowing *within* it.
  - **Claimants**: `unitSet`, `integrationSet` (from the unfiltered root listings) and `playwrightSet`. Verified exhaustive — the only runner configs tracked are `vitest.config.ts`, `apps/web/vitest.config.ts` (deleted by C4) and `e2e/playwright.config.ts`.
  - **`playwrightSet` invocation**: `pnpm -s -C e2e test --list --reporter=json`. Three measured shape differences, all addressed by this form: (a) without `-s`, pnpm prepends its script banner to **stdout** and `JSON.parse` **fails** (`Unexpected token '>'`) — verified, and verified fixed by `-s`; (b) the human reporter emits **testDir-relative** paths, forcing a hardcoded `e2e/specs/` — a second declaration of `testDir`, the RT9 shape C7 was rewritten to avoid, going stale on exactly the narrowing control 5 exists to catch; (c) the JSON reporter supplies `config.rootDir` (absolute, authoritative) alongside `suites[].file`, so the join base comes from Playwright itself. Verified: exit 0, parse OK, `rootDir` present, 9 files, 0 bytes stderr. `basename` forbidden here too.
  - **Assertion**: `inventory == (unitSet ∪ integrationSet ∪ playwrightSet)` **bidirectionally**, plus **pairwise disjointness across all three claimants**, plus `inventory` non-empty. Revision 3 asserted only `⊆`, vacuous over a shrunken inventory; revision 4 added `⊇` but asserted disjointness only between the two vitest projects, so F5's "exactly one" was implemented as "at least one". **Measured false-green**: `e2e/specs/zzprobe.integration.test.ts` is claimed by the vitest `integration` project (depth-agnostic glob) **and** by Playwright (default `testMatch` accepts `.test.ts`, no override in the config) — the union still equalled the inventory. Verified today: 35 `*.test.ts` == 29 unit + 6 integration, 9 `*.spec.ts` == Playwright's 9, **44 == 44**, all intersections empty. After the gate lands, **45 == 30 + 6 + 9** — this is NF2's standing anchor.
  - **Declaration-level skips**: the JSON already parsed carries `suites[].specs[].tests[].annotations` (present, `[]` today). Assert no spec carries a declaration-level `skip`/`fixme` annotation — free, since the data is in hand, and it protects the auth specs against `test.describe.skip`, which would otherwise leave a file claimed, discovered, and unexecuted. Runtime-conditional skips and the vitest-side equivalent are **not** covered — SC57.
  - **No carve-out.** With Playwright as a claimant every file is claimed by exactly one runner, `e2e/` included. An exemption that excludes nothing today is a mechanism that acquires a job later without anyone re-deriving its predicate.
  - **Consequence, stated deliberately**: the gate pins the repo's test-file naming convention — `.test.*` under `apps/`/`packages/`, `.spec.*` under `e2e/specs/`. A developer writing `apps/web/test/foo.spec.ts` expecting vitest to pick it up meets a red rather than a silent no-op; the failure message must say which runners were asked and none claimed it.
- **Forbidden patterns**: a regex or string parse over a `test` script's value; a regex or parse over `vitest.config.ts` or `playwright.config.ts` source; **any inference about CI behavior from `ci.yml` source text** (SC56); a hardcoded expected file list (the two named canaries excepted); a hardcoded `e2e/specs/` prefix; `execSync`/`spawnSync` with a template-string command or `shell: true` (child argv is built from `pnpm list` output and `ci.yml` triggers on `pull_request`, so package paths are PR-influenceable); `2>&1` stream merging; **relaxing the stderr assertion to a substring or regex filter**. If a legitimate ambient writer appears, the fix is to silence it at source or pin it in the child env. Should narrowing prove unavoidable, it must be a **positive allowlist of tolerated exact lines**, with any line carrying a deprecation or warning shape explicitly non-tolerable.
- **Budget (NF1)**: **419 ms for the complete set of 11 vitest children** measured concurrently with argv arrays, all exit 0 (an independent probe measured 376 ms; 419 ms is the conservative figure). Sequential spawning costs ~2.7 s. Control 5 adds one `git ls-files` and one Playwright listing, no filesystem walk; C8 adds no child at all. Current unit suite: **0.99 s** / 29 files / 264 tests. Budget: **the gate adds ≤ 1.0 s wall and the unit suite stays under 2.5 s.** Explicit `testTimeout` well above the measured value. Re-measured on the CI runner before merge — cost, stderr bytes per child (VE5), and VE6.
- **Recursion**: `vitest list` and `playwright test --list` both resolve without executing.

### C4 — delete `apps/web/vitest.config.ts`

- **Rationale**: it declares only `include: ['test/**/*.test.ts']` — no `environment`, no `setupFiles` — and the root `unit` project already reaches the same 6 files via `apps/**`. A parallel-implementation twin (RT9), and strictly weaker: no `exclude`, so a future `apps/web/**.integration.test.ts` would be swept into what developers read as the unit run.
- **Consumer-flow walkthrough**: (a) `pnpm -C apps/web test` resolves through the root config after C1; (b) root `pnpm test:unit` — `vitest.config.ts` declares `projects` as **inline objects**, not config paths, so a root-cwd run never discovers the twin. Deleting it cannot change root resolution; provable, not merely likely. No third consumer.
- **Acceptance**: `pnpm -C apps/web test` resolves the same 6 files before and after.

### C5 — enforce the one-config invariant

- **Problem C4 alone leaves open**: nothing prevents the twin's return, and the parity gate is structurally blind to it — under the delegating form the child's cwd is the repo root, so a re-added twin is never consulted.
- **Invariant** (gate-verified): the files matching `vitest.config.*` and `vitest.workspace.*` in `git ls-files --cached --others --exclude-standard` are exactly `['vitest.config.ts']`.
- **Source**: the same inventory command as control 5. Revision 3's `eslint.config.mjs`-derived exclusion would have let an added `apps/web/**` ignore entry hide a re-added twin, defeating M22 after the fact.

### C6 — remove the dead pool configuration and record the decision

- **What is broken**: `vitest.config.ts` declares `pool: 'forks', poolOptions: { forks: { singleFork: true } }`. Under vitest 4.1.10 this prints `DEPRECATED test.poolOptions was removed in Vitest 4` on every invocation loading the integration project, and **`singleFork` is not applied**.
- **Revision 2's premise was wrong.** Measured: **`singleFork` has 0 occurrences in vitest 4.1.10**; `poolOptions` occurs exactly once in the shipped dist, inside `logger.deprecate`; `resolved.pool ??= "forks"` is independent. Removing the key while keeping `pool: 'forks'` is provably behavior-neutral.
- **And the intent is not wanted.** Every integration file constructs its own containers (`apps/api` two including Redis, the other five one each), and the config declares no `globalSetup` or `setupFiles` — so the shared-database contention `singleFork` addresses does not exist. The tier runs un-serialized and green: 143 tests / 6 files, **7.00 s wall against 16.10 s of test time**.
- **Contract**: remove the dead `poolOptions` key (keeping `pool: 'forks'`) and record in the config, in one line, that the integration tier is deliberately parallel because each file provisions its own containers.
- **Enforcement, two complementary mechanisms** — neither substitutes:
  - C3's per-child **stderr-empty** assertion catches the key *coming back*, and any future warning nobody has thought of.
  - A **live import** of the root config catches the decision being reversed by a *different* key. The assertion is an **allowlist** over permitted keys, applied at the **correct object level**: to `cfg.test` and to **`cfg.test.projects[i].test`**. This matters — measured by executing the import, `cfg.test` keys are `["projects"]`, each `projects[i]`'s own keys are `["test"]`, and the options live at `projects[i].test` (`["name","include","exclude"]` and `["name","include","exclude","testTimeout","hookTimeout","pool","poolOptions"]`). Revision 5 specified the allowlist against `projects[i]`, which would have **redded on the correct current config**, and the obvious repair — adding `test` to the allowlist — would have made the check inspect only the two wrappers, so **M23a would have passed green**. Permitted keys: `projects` at `cfg.test`; `name`, `include`, `exclude`, `testTimeout`, `hookTimeout`, `pool` at each `projects[i].test`. Assert each `projects[i]` is an object whose only key is `test` (vitest also permits string entries, which would make `Object.keys` meaningless). Revision 4 specified a two-key **denylist**, the shape `api-types-boundary.test.ts` records as twice-rejected in cycle 3 — *"a denylist can only forbid what someone thought to list"*; `maxWorkers: '50%'` resolves to 1 on a 2-core runner, and vitest 5 may rename all of them.
  - **The allowlist's reach deliberately exceeds C6's invariant.** Any config key addition requires a deliberate allowlist edit — that is the point, and the direction is false-red. The foreseeable next entries are `environment` and `setupFiles`, because control 5 reds on `apps/web/test/NavBar.test.tsx` (scenario 4) and the natural response is to widen the unit `include` to `.tsx` **and** add jsdom support. Recorded here so the two controls' interaction is known rather than discovered.
- **Ordering**: C6 lands **before** C3's mutation runs, and M17 (restore `poolOptions`, observe the banner return and the gate red) supplies the executed evidence for both C6's first mechanism and C3's stdout-only rule. M17 is executed against the **post-C6** tree.
- **Acceptance**: `pnpm test:integration` green with 143 tests / 6 files unchanged and wall clock **within 10 s** against the 7.00 s baseline (serialization pushes toward 16 s+); no `DEPRECATED` line from any invocation; M17, M23a and M23b red-proven.

### C7 — make CI's E2E invocation fail loudly, at both sites

- **Contract**:

  | Site | Before | After |
  |---|---|---|
  | `package.json:15` | `pnpm --filter e2e test` | `pnpm -C e2e test` |
  | `.github/workflows/ci.yml:144` | `pnpm --filter e2e exec playwright install --with-deps chromium` | `pnpm -C e2e exec playwright install --with-deps chromium` |

  Revision 3 changed only the first and claimed in SC53 it removed "the repo's one security-relevant use". There are two; the survivor sat four lines above the line M9a exercises, and R33's whole subject is a fix applied to one site and not its duplicate.
- **`pnpm -C e2e test`, not `exec playwright test`.** The `exec` form re-declares how the suite runs, creating an RT9 twin with `e2e`'s own `test` script — which C2 clause 3 requires to exist and `pnpm -r test` keeps using. It would also mean control 5 observed a command CI no longer ran; the script form buys the neutering detection recorded under channel 4.
- **Verified**: `pnpm -C e2e test --list` → **exit 0, `Total: 43 tests in 9 files`** (arguments forwarded); `pnpm -C e2e-nope test` → **exit 1, `ENOENT`**; `pnpm -C <pkg-without-script> test` → **exit 254**. `pnpm -C e2e exec playwright --version` → `Version 1.62.0`.
- **Third invocation surface: none.** Every e2e-coupled `ci.yml` line enumerated — 144 (fixed), 147 (root script → C8), 150 (`assert-seed-preserved.sh`, exits 127 on a directory move), 155 (failure-only artifact upload).
- **A package-*name* rename is now a no-op and correctly stays green** — `-C` resolves a directory. M9b is its positive control.
- **Acceptance**: `pnpm test:e2e` runs the full 43-spec suite; renaming or moving the `e2e` **directory** makes both sites exit non-zero.

### C8 — pin the values of the root scripts CI invokes

- **Problem** (channel 5): D0 removes the repo root from C1–C3's domain for a correct reason, and nothing takes responsibility for it afterwards. Gutting root `test:e2e` leaves control 5 green while `ci.yml:151` runs zero specs. Replacing root `typecheck` with `true` leaves CI green having typechecked nothing — and VE4 establishes that `pnpm typecheck` is the only type gate CI runs, while C1's devDependency-retention paragraph names it as a secondary control.
- **Invariant** (gate-verified): each of the following root scripts is **exactly string-equal** to its pinned value:

  ```
  lint              →  eslint .
  typecheck         →  pnpm -r --parallel exec tsc --noEmit
  test:unit         →  vitest run --project unit
  test:integration  →  vitest run --project integration
  test:e2e          →  pnpm -C e2e test          # post-C7 value
  ```

  Same allowlist-of-one exact-equality idiom as C3's left half; same false-red direction.
- **The pinned list is a literal, not derived from `ci.yml`.** Deriving it from the workflow would make the *set* shrink whenever the workflow shrank — the same silent-narrowing shape control 5 exists to close, relocated into C8's own input. The list was **chosen** by enumerating `ci.yml`'s `run: pnpm …` lines (23, 24, 25, 42, 151) and is recorded above as evidence; a future CI job adding a sixth root-script invocation is a gap this list will not notice, which is part of SC56.
- **Root `test` and `build` are deliberately unpinned**: no CI path invokes either. `test` is a developer convenience; `build` is invoked only by `pnpm -r build` locally. Stated rather than silently omitted, because revision 5 pinned `test` — which CI never runs — while missing `lint` and `typecheck`, which it does. That was a member set chosen by name-shape rather than derived from the defining primitive, and it is the fourth cycle running in which that error appeared.
- **C8 does not read `ci.yml`.** Revision 5's second half asserted that the workflow *invokes* the pinned scripts, via an in-process text read borrowing `workflow-pins.test.ts`'s idiom. That idiom **deliberately does not collect commented-out lines** — correct for its own invariant (no unpinned action exists), fatal for a presence-and-effectiveness invariant. A substring read passes on `# - run: pnpm test:unit`, on `if: false`, and on `continue-on-error: true`, each of which removes the invocation while leaving the string. That is inferring behavior from dialect-bearing text, the one thing this plan forbids everywhere else. Closing it properly needs a structured YAML parse — which needs a new root devDependency (`yaml` is not resolvable from the repo root today; it exists only as a vitest transitive) and would still close only 3 of SC56's routes. **The half is dropped and recorded as SC56 rather than implemented weakly.**
- **Acceptance**: M27 (gut root `test:e2e`) and M30 (replace root `typecheck` with `true`) both red; M28a reds; M28b stays green as SC56's executed demonstration.

## Go/No-Go Gate

| ID | Subject | Status |
|---|---|---|
| C1 | Tiered package `test` scripts delegating to the root runner | locked |
| C2 | Script declaration and test assignment agree in both directions, symmetrically | locked |
| C3 | Parity gate: one-producer binding + executed behavior proof + six positive controls | locked |
| C4 | Delete the redundant `apps/web` vitest config | locked |
| C5 | Enforce the one-config invariant from the git inventory | locked |
| C6 | Remove the dead pool configuration and record the decision | locked |
| C7 | Make CI's E2E invocation fail loudly, at both sites | locked |
| C8 | Pin the values of the root scripts CI invokes | locked |

## Testing strategy

### Falsifiability (RT7)

Each mutation is **executed**, and its **observed failing assertion message** recorded and compared against the expected one. A red from an unrelated control is a **failed** mutation, not a pass. "Restore and confirm green" is a cleanup step, not a mutation.

| # | Mutation | Precondition | Expected failing assertion |
|---|---|---|---|
| M1 | Revert one member's `test` to bare `vitest run` | — | C1 left half. **Executed first** — the mutation a tautological gate survives. |
| M2 | One member's `test` → `--project integration` where unit is meant | — | C1 left half |
| M3 | Defect in `canonicalArgv`, all eight scripts synced to match | — | right half, child non-zero |
| M4 | Add `test` to `packages/api-types` | — | C2 **clause 2** (it is D1/D2 false, so clause 1 does not apply); clause 4 as residual |
| M5 | Delete `test` from `packages/crypto` | — | C2 clause 1 |
| M6 | Delete `test:integration` from `packages/schema` | — | C2 clause 1, integration axis |
| M7 | Add `test:integration` to `packages/matcher` | — | C2 clause 1, integration axis |
| M8 | Delete `test` from `e2e` | — | C2 clause 3. **Multi-path**: also breaks `pnpm -C e2e test`, so control 5's Playwright child fails independently; recorded evidence must name clause 3 specifically. |
| M9a | Rename/move the `e2e` **directory** | — | C7. **Multi-path** (the entry leaves `pnpm list -r`, C2 clause 3's domain changes, the Playwright child fails); evidence must name C7's assertion. |
| M10 | Delete `vitest` from `apps/api`'s `devDependencies` | — | D1 ≡ D2 agreement **specifically** |
| M11 | Narrow the `unit` include by one token | revert byte-exactly before M12 | control 5, unclaimed files named |
| M12 | Place a `*.test.ts` in a directory no glob covers | need not be staged | control 5 |
| M13 | Add `apps/web/test/probe.test.tsx` with one passing test | need not be staged | control 5, **extension axis** |
| M14a | `git rm --cached` a real test file | — | control 5, `⊇` direction |
| M14b | `rm` a real test file, leaving its index entry | — | control 5, `⊆` direction |
| M15 | `testIgnore: ['**/auth.spec.ts']` in `e2e/playwright.config.ts` | — | control 5, Playwright claimant |
| M16 | Point one member's path at a nonexistent directory | — | control 2 |
| M17 | Restore `poolOptions` | **post-C6 tree** | stderr-empty assertion |
| M18 | Force the member enumeration to return `[]` | — | control 1 |
| M19 | Force the tier map to omit the integration tier | — | control 3 |
| M20 | Force one child non-zero (`--project bogus`) | — | per-child status, naming that child |
| M21 | Give one member an over-matching filter argument | — | C1 raw-stdout, superset direction |
| M22 | Re-add `apps/web/vitest.config.ts` | — | C5 |
| M23a | `fileParallelism: false` in `projects[1].test` | — | C6 live-import allowlist |
| M23b | `fileParallelism: false` at `cfg.test` (top level) | — | C6 live-import allowlist |
| M24 | Delete `apps/api/test/saas-app-key-pin.test.ts` | — | control 6, canaries |
| M25 | Force the tier map to report zero unit files for a member | — | C2 clause 1, unit axis |
| M26 | Add `e2e/specs/probe.integration.test.ts` | — | control 5, **pairwise disjointness** |
| M27 | Gut root `test:e2e` | — | C8 |
| M28a | Narrow root `test:unit` to `vitest run --project unit apps/api/` | gate still runs | C8 |
| M30 | Replace root `typecheck` with `true` | — | C8 |
| M31 | `test.describe.skip` on `e2e/specs/auth.spec.ts` | — | control 5, skip-annotation assertion |

**Not falsifiability mutations, executed as documented-limit probes:**

- **M9b** — rename the `e2e` package *name* to `@open-smp/e2e` → **must stay green**, 43 tests still reported. This is what C7 bought.
- **M28b** — narrow root `test:unit` to `vitest run --project unit packages/` → **must stay green**. The gate lives in `apps/api/test/`, so it does not run at all and nothing can observe the narrowing. This is SC56's residue, converted from a stated caveat into an observed one. Revision 5 listed this as a mutation expected to red, which contradicted its own SC55.
- `git rm` (index **and** file together) → **stays green**, correctly: a legitimate deletion.

### Other verification

- **NF2** — control 5's bidirectional equality is the standing enforcement: **44 == 29 + 6 + 9** today, **45 == 30 + 6 + 9** after the gate, the delta being the single gate file. (Revision 5 stated this as "36 == 30 + 6 + 9" in one place and "44 == 30 + 6 + 9" in another; both were arithmetically wrong, and round 1's F6 was the same class of error.)
- **C4's real regression path** — `pnpm -C apps/web test` resolving the same 6 files before and after.
- **Per-member execution** — each member's `test` (and `test:integration` where declared) actually run once, and the resolved **set** compared against the assignment.
- **All gates run**: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`. `test:unit` does not typecheck (VE4).
- **R21 — subagent reports are not gate evidence.** Any change produced by a subagent is followed by the orchestrator re-running the full gate set in its own shell. Mutation results are recorded from the orchestrator's own observed output, including the failing assertion message, compared against the expected column.
- **CI re-measurement before merge** — cost against the 419 ms / 11-children baseline, stderr bytes per child on Node 22 (VE5), and whether the Playwright listing succeeds in the `checks` job (VE6).

## Considerations & constraints

### Scope contract

- **SC47** — `packages/queues` has zero test coverage. Removing its `test` script makes the gap visible; C2 clause 1's symmetry keeps the cycle that fills it from minting an always-failing script. Owner: the next cycle touching queue code.
- **SC49** — `e2e` is outside C1's domain, derived from its own declared runner dependency. Control 5 has **no carve-out**.
- **SC50** — no change to the root config's project definitions or the CI job structure. C6 removes a dead key; C7 changes two commands; C8 adds assertions only.
- **SC51** — the gate proves `vitest list` with the canonical arguments resolves the assigned set, and separately that the script is byte-identical to the canonical `run` form. It does not prove `run` and `list` resolve identically; that is vitest's invariant and cannot be closed from outside without recursion. Trigger: a vitest major upgrade, or any observed divergence.
- **SC52** — closed by C7.
- **SC53** — `pnpm --filter <nonexistent> …` exits 0 repo-wide. C7 removes **all three** of the repo's uses (`package.json:15`, `ci.yml:148`, `Dockerfile:57`); any future `--filter`-based script re-introduces it. Trigger: adding a root script that dispatches by `--filter`.
- **SC54** — control 5 pins the inventory-to-discovery relation but not the inventory family's own completeness: a test file named outside `*.{test,spec}.*` entirely is invisible to it. Additionally, `--exclude-standard` honors `.git/info/exclude` and the user's global `core.excludesFile`, which differ per machine and per runner; a global ignore hiding a file claimed by nobody would shrink both sides together. Trigger: adopting a new test-file naming convention.
- **SC55 / SC56** *(SC55 generalized and renumbered)* — **a gate cannot detect that it was not run.** The known routes: (a) a vitest glob narrowing that excludes `apps/api/` from the unit project (executed as M28b); (b) a CI step commented out, `if:`-guarded, or `continue-on-error: true`; (c) a CI job deleted or its `needs:` rewired; (d) the workflow file deleted; (e) the gate file itself deleted. **C8 closes the orthogonal case** — the script still invoked but gutted — for the five scripts CI runs today, measurably and with a false-red direction. It does **not** establish that CI still invokes them, and revision 5's attempt to do so by reading `ci.yml` as text passed on (b) in all three of its forms. Closing (b) needs a structured YAML parse, which requires a new root devDependency and still leaves (c)–(e); closing the class needs an out-of-band observer (a CI step asserting a reported test-file count against a committed number). Both are out of scope. A sixth CI-invoked root script added later is also not noticed by C8's literal list. Trigger: the next cycle that touches CI job structure.
- **SC57** *(new)* — control 5 pins *claim and discovery*, not *execution*. The Playwright half asserts no spec carries a declaration-level `skip`/`fixme` annotation, using data already parsed. Not covered: runtime-conditional `test.skip(cond)` inside a body, and the vitest-side equivalent (`describe.skip` in a gate file), neither of which is observable from a listing. Both are visible in reporter output and in review. Trigger: the same out-of-band observer SC56 defers.
- Out of scope: adding tests, changing CI job structure, filling `packages/queues`' coverage.

### Risks

- The delegating form makes a package script depend on being inside the workspace and on `pnpm` being resolvable; asserted explicitly (control 4).
- The stderr-empty assertion is expected to be **version-brittle** (VE5). `NODE_NO_WARNINGS=1` covers Node's ambient class and is verified not to suppress vitest's banner. The first CI flake is a designed cost with a sanctioned answer — never a filter.
- The inventory is "exists in the working tree and is not gitignored", **not** "is committed". Stated so a future reader does not re-tighten it to `git ls-files` and reintroduce the unstaged-file false red and the M12/M13 green.
- C6's allowlist reds on any new config key, including legitimate ones (`environment`, `setupFiles`). Intended, and its interaction with control 5's `.tsx` behavior is recorded in C6.
- Control 5's Playwright half depends on `--list` working without installed browsers in the `checks` job (VE6).
- The gate is the repo's first child-spawning test.

## User operation scenarios

1. **A reviewer verifies the C39 boundary gate.** They run `pnpm -C apps/api test`. Today they get green without the gate executing. After the change the same command runs 15 unit files including `api-types-boundary.test.ts`, and needs no Docker daemon.
2. **A developer deletes the last unit test in a library.** Root `test:unit` stays green. The package's unit assignment drops to zero while it still declares `test`, so C2 clause 1's symmetric iff reds; if `vitest` is also removed, the D1 ≡ D2 agreement reds.
3. **Someone adds a new workspace package with tests** and copies an existing `package.json` without the delegating form. The gate reds naming the mismatch. Tests without a script → clause 1; a package outside every glob → control 5.
4. **A developer writes `apps/web/test/NavBar.test.tsx`.** Today it is matched by no project, executed by nothing, and green everywhere. Control 5 reds naming it as claimed by zero runners — the hazard `sc42-…-plan.md:50` recorded two cycles ago — and it reds **before** the file is staged, because the inventory is working-tree-based.
5. **Someone removes `e2e`'s `test` script** during an unrelated cleanup. Today `pnpm test:e2e` exits 0 having run zero specs. C2 clause 3 reds it, and under C7 the CI command fails too.
6. **Someone namespaces the `e2e` package** to `@open-smp/e2e`. Today `pnpm --filter e2e test` exits 0 printing `No projects matched the filters`, and CI is green with the auth suites never run. After C7 the command is directory-keyed, so **the rename is harmless and CI keeps running all 43 specs**.
7. **Someone tightens a glob in `vitest.config.ts`**, or adds a `testIgnore` to `playwright.config.ts` — measured at 29 → 14 unit files and 43 → 37 specs. Control 5 reds, naming the files that stopped being claimed.
8. **Someone edits a root script** — swapping `test:e2e` for a placeholder while debugging, replacing `typecheck` with `true` while bisecting — and forgets to restore it. Today every control stays green while CI verifies nothing. C8 reds.
9. **Someone disables a CI step** with `if: false` while chasing a flaky job. **Nothing reds** — this is SC56's residue, stated so it is a known limit rather than an assumed coverage.
- **SC58** *(code review round 1, cost corrected in round 2)* — `pnpm lint`'s effective file set is observed by nothing. C8 pins the string `eslint .`, but measured: `ignores: ['**/*']` exits 2 (loud) while `ignores: ['apps/api/**']` exits **0** with planted errors silently absent — the same total-loud / partial-silent asymmetry the plan documents for Playwright's `testIgnore`. **Round 2 corrected the cost**: closing the described route does not need a control-5-sized reconciliation of the file set. Pinning `eslint.config.mjs`'s `ignores` array by exact equality, through the same live-import idiom C6 already uses, is roughly three lines. It is deferred because this cycle's diff is already large and the ESLint config carries no security rules today, not because it is expensive — and the deferral is recorded with that correction so the next reader does not inherit the inflated estimate. **Round 2 also flagged the trigger**: "adding a security rule" is the review-trigger form this very cycle replaced with an executable gate for the `--filter` class, so the trigger is the weaker mechanism applied one contract over. Trigger: the next cycle touching root tooling — closed there with the three-line pin, not deferred again.
- **SC59** *(code review round 1, restated after round 2)* — `pnpm typecheck` is `pnpm -r --parallel exec tsc --noEmit`, and `pnpm -r exec` **excludes the workspace root** (verified: 11 directories, none of them the root). There is no root `tsconfig.json`, so `vitest.config.ts` — which this cycle rewrites and the gate live-imports — is typechecked by nothing. **Round 2 refuted both halves of the original justification.** The live import does *not* bound it: Vite erases types at transform time, so a type error there is by construction not a runtime error and the import cannot observe it. And SC50 does *not* block the fix: SC50 forbids changing the root config's project definitions or the CI job structure, and `"typecheck": "tsc --noEmit -p tsconfig.json && pnpm -r --parallel exec tsc --noEmit"` plus a root `tsconfig.json` is neither — it needs no new CI step and no new job, and C8 already pins that value so the change is gate-enforced from the moment it lands. Deferred on the accurate basis instead: the exposed surface is one config file, the cost is a script edit plus a C8 pin update, and this cycle's diff is already large. Trigger: the next cycle touching root tooling — and it should be closed there rather than deferred again.
- **SC60** *(code review round 3)* — the selector scan sees **literal selector text in tracked artifacts**, and that is its honest scope. A selector held in a variable (`F=--filter; pnpm $F x build`), read from the environment, or hidden behind a wrapper script is invisible to any text scan in every form. The scan was widened four times across three rounds — spelling, position, file kind, then match granularity — and each widening followed a demonstration that the previous needle missed a member. Round 3 replaced the widening method with one that removes the axes (normalise continuations and command separators, tokenise, match the flag *family*, and pin that family against `pnpm run --help`) rather than enumerating points on them. What remains is not another axis to widen but a different mechanism entirely: closing it needs a runtime observer of the invocation, not a reader of the text. Trigger: an invocation form that defeats the scan being observed in practice, or any move to a wrapper-script convention for pnpm calls.
- **SC61** *(code review round 3)* — control 6's list covers two families: tests that read repository files, and tests that import a domain and compare it against a second declaration. The addition-guard is mechanical for the first family only; the second must still be added by hand. A control of the second family added without being listed is invisible, and its later deletion would then be invisible too — two events rather than one, which is why it is recorded rather than blocking. Trigger: adding a domain-derivation pin, or finding a mechanical discriminator for family (b).
