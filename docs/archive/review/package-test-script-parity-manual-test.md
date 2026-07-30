# Manual Test Plan: package-test-script-parity

**R35 Tier-2.** The diff touches two deployment artifacts:

| File | Change |
|---|---|
| `Dockerfile:60` | `pnpm --filter @open-smp/web build` → `pnpm -C apps/web build` |
| `.github/workflows/ci.yml:148` | `pnpm --filter e2e exec playwright install …` → `pnpm -C e2e exec …` |

Both sit on the path that produces the production web image and the CI E2E run. The reason they are in this diff is that `pnpm --filter` **exits 0 when the filter matches nothing**, so a package rename would have produced a green build with no `.next` and a green CI job with no browser. Everything below was executed; the Expected-result column carries observed values, not intentions.

## Pre-conditions

- Docker running; the compose stack reachable (`docker compose ps` shows `postgres`, `redis`, `api`, `web`, `worker`).
- Working tree on `fix/package-test-script-parity`, clean.
- `pnpm install --frozen-lockfile` already run.
- Ports 3000 (web) and 3001 (api) free or already served by the stack.

## Steps and expected results

### 1. The web image still builds, and the build stage still produces output

```bash
docker compose build web
docker compose up -d web
```

| Check | Expected | Observed |
|---|---|---|
| `docker compose build web` exit status | 0 | **0**, `Image open-smp-web Built` |
| `.next` exists inside the image | present, non-empty | **present** — `BUILD_ID`, `app-build-manifest.json`, `app-path-routes-manifest.json` |
| `curl -o /dev/null -w '%{http_code}' localhost:3000/` | 307 (redirect to login) | **307** |
| `curl -o /dev/null -w '%{http_code}' localhost:3000/login` | 200 | **200** |

The `.next` check is the one that matters. A build stage that silently produced nothing would still yield a green `docker compose build`; only inspecting the artifact distinguishes the two.

### 2. The Playwright browser-install step still resolves its binary

```bash
pnpm -C e2e exec playwright --version
```

| Check | Expected | Observed |
|---|---|---|
| exit status | 0 | **0** |
| version reported | the version declared in `e2e/package.json` | **Version 1.62.0** |

This confirms the `ci.yml:140-146` convention still holds under `-C`: `@playwright/test` is declared only in `e2e/package.json`, and `-C e2e` resolves it from that package's own `node_modules` exactly as `--filter e2e` did.

### 3. The full E2E suite still runs through the changed root script

```bash
pnpm test:e2e
```

| Check | Expected | Observed |
|---|---|---|
| exit status | 0 | **0** |
| specs run | 43 | **43 passed** |

### 4. The dependency stage installs every workspace member

C10 asserts this from the Dockerfile's **text**. This step is the image-level form, and it is the only observation in this cycle that inspects a built artifact rather than a file (SC62).

```bash
docker build --target deps -t open-smp-deps-probe .
docker run --rm open-smp-deps-probe sh -c 'find /repo -maxdepth 5 -type l ! -exec test -e {} \; -print'
docker run --rm open-smp-deps-probe sh -c 'ls -l /repo/apps/api/node_modules/@open-smp/'
```

| Check | Expected | Observed |
|---|---|---|
| `docker build --target deps` exit status | 0 | **0** |
| dangling symlinks under `/repo` | none | **none** — empty output, exit 0 |
| `apps/api/node_modules/@open-smp/api-types` | resolves | **resolves** → `../../../../packages/api-types` |
| members with a manifest in the image | 11 of 11 | **11 of 11** |

### 4b. The no-match boundary holds inside the image

C11 is a `pnpm-workspace.yaml` setting, so it only holds where that file lands. C10 clause 4 asserts
the `COPY` from the text side; this observes the behaviour in the built artifact, which is the thing
that matters.

```bash
docker run --rm open-smp-deps-probe sh -c 'grep -c failIfNoMatch /repo/pnpm-workspace.yaml'
docker run --rm open-smp-deps-probe sh -c 'cd /repo && pnpm --filter @open-smp/nope-95f3c1 build'
docker run --rm open-smp-deps-probe sh -c 'cd /repo && pnpm --filter @open-smp/api exec node --version'
```

| Check | Expected | Observed |
|---|---|---|
| the setting reached the image | 1 occurrence | **1** |
| no-match selector inside the image | non-zero | **exit 1**, `No projects matched the filters in "/repo"` |
| real selector inside the image | 0 | **exit 0**, `v22.23.2` |

The last row is the allow side, and it doubles as a Node-version data point: the image runs the
**Node 22** that `ci.yml` pins, while every stderr measurement in this cycle was taken on the local
Node 26 (VE5, still open — this probe observes status, not stderr bytes).

`packages/api-types` and `packages/queues` have **no `node_modules` directory** in the image. That is correct, not a defect: both declare zero dependencies (measured — empty `dependencies` and `devDependencies`). It is stated here because it is also the limit of this step. A future leaf member with no dependencies and no dependents would have its `COPY` line omitted with no image-observable difference, which is why C10 reads the text and this step does not replace it.

Before round 1's fix the same probe produced a **dangling** `apps/api/node_modules/@open-smp/api-types`, with `docker build` still exit 0 — the silent-`--frozen-lockfile` failure the contract exists for.

## Adversarial scenarios

These are the failure modes the change exists to remove. Each was executed.

| Scenario | Old form | New form |
|---|---|---|
| **Package renamed** — someone namespaces `@open-smp/web`, or `e2e` → `@open-smp/e2e` | `pnpm --filter <no-match> build` → **exit 0**, `No projects matched the filters`. The image builds with no `.next`; CI installs no browser. | `-C` resolves a **directory**, so a name rename is a no-op. Verified end to end: renaming the `e2e` package name leaves `pnpm test:e2e` at **exit 0, 43 passed**. |
| **A future artifact uses `--filter` again** — the form the `-C` rewrite was chosen to avoid | nothing prevents it; the scan added in code review can be evaded by quoting, a JSON exec array, a YAML folded scalar, a shell variable, or a wrapper script (all measured MISS) | `failIfNoMatch: true` in `pnpm-workspace.yaml` makes the no-match case **exit 1 at the tool**, so notation is irrelevant. Measured: `pnpm --filter @open-smp/nope build` → **exit 1**; `pnpm --filter e2e exec playwright --version` → **exit 0, Version 1.62.0**. The setting reaches the image via the pinned `COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./`, which C10 now asserts. |
| **The script is missing rather than the package** — `--filter <real-pkg> test` with no `test` script | **exit 0** (pnpm's `test` shorthand treats a missing script as a no-op) | **still exit 0** — `failIfNoMatch` does not apply because the filter matched. Covered instead by C2 clause 3 and by `-C` (`pnpm -C <pkg-without-script> test` → **exit 254**). Recorded as SC63 rather than implied closed. |
| **Directory moved or deleted** | not distinguishable from success | `pnpm -C apps/web-renamed build` → **exit 1**. `pnpm -C e2e-nope test` → **exit 1, ENOENT**. Both loud. |
| **Script removed from the target package** | `pnpm --filter <pkg> test` with no `test` script → **exit 0, no output** (a pnpm built-in shorthand bypasses the recursive-run error) | `pnpm -C <pkg> test` → **exit 254**, `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`. Additionally gated: C2 clause 3 reds if a package declaring a non-`vitest` runner has no `test` script. |
| **Workspace glob edited so the package is no longer a member** | same exit-0 masking as a rename | `-C` does not consult the workspace at all; the directory either exists or it does not. |

**Not covered, stated rather than implied.** These changes do not alter authentication, authorization, session handling, tenancy, or any credential path, so the usual Tier-2 adversarial dimensions — cross-tenant access, token replay, redirect-URI/state manipulation, scope elevation, session fixation — have no surface here. What they *do* touch is CI's ability to verify those things: the E2E suite this change protects is the repository's only end-to-end authentication and session-expiry coverage, and the pre-change `--filter` form could remove it from CI silently. That is the security-relevant property under test above, and it is the reason this plan carries a Tier-2 artifact at all.

## Rollback

Both changes are one line each and independently revertible.

```bash
git revert dba32f2            # the whole implementation, or:
git checkout main -- Dockerfile .github/workflows/ci.yml
docker compose build web && docker compose up -d web
```

Reverting restores the exit-0-on-no-match behaviour at both sites — and **`pnpm test:unit` then reds**, which is the intended coupling and not a complication to work around.

This paragraph previously read "`Dockerfile` is outside every gate's domain". That was true when it was written, at `a30b49a`, and it is the sentence that explains how the third `--filter` site survived four review rounds. It stopped being true at `7ab1cf7`: C9 scans every tracked artifact for the selector family and pins the surviving matches to the two *comments* in `ci.yml` and `Dockerfile`, and C10 reads the Dockerfile's deps stage. Restoring `pnpm --filter` at either site removes a pinned comment line and introduces an unpinned invocation, so C9 fails naming the line.

So a partial rollback is not a one-line operation. Either revert the gate with the fix —

```bash
git revert 8fde007 6021097 7ab1cf7 dba32f2   # gates and fix together, newest first
```

— or, to roll back only the deployment artifacts while keeping the gate, update C9's pinned list in the same commit.

**Measured, not assumed.** Restoring `RUN pnpm --filter @open-smp/web build` in the Dockerfile and running the gate alone: **exit 1**, `1 failed | 10 passed (11)`, failing assertion `executable lines still selecting packages by name`. Reverting `dba32f2` without the gate commits leaves `pnpm test:unit` red.

## Residual risk

- **VE5 (open by design)** — every stderr measurement in this cycle was taken on Node v26.5.0 while `ci.yml` pins Node 22 at three sites. The first CI run must record per-child stderr bytes; the sanctioned fallback if an ambient writer survives `NODE_NO_WARNINGS=1` is recorded in the plan and is never a stream filter.
- **SC56** — a gate cannot detect that it was not run. Demonstrated, not asserted: narrowing root `test:unit` to `packages/` yields 8 files / 72 tests, exit 0, with the parity gate never executing.
