# Manual Test Plan: package-test-script-parity

**R35 Tier-2.** The diff touches two deployment artifacts:

| File | Change |
|---|---|
| `Dockerfile:57` | `pnpm --filter @open-smp/web build` → `pnpm -C apps/web build` |
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

## Adversarial scenarios

These are the failure modes the change exists to remove. Each was executed.

| Scenario | Old form | New form |
|---|---|---|
| **Package renamed** — someone namespaces `@open-smp/web`, or `e2e` → `@open-smp/e2e` | `pnpm --filter <no-match> build` → **exit 0**, `No projects matched the filters`. The image builds with no `.next`; CI installs no browser. | `-C` resolves a **directory**, so a name rename is a no-op. Verified end to end: renaming the `e2e` package name leaves `pnpm test:e2e` at **exit 0, 43 passed**. |
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

Reverting restores the exit-0-on-no-match behaviour at both sites. Nothing else depends on the `-C` form: the parity gate asserts root script *values* (C8) and never reads `ci.yml`, and `Dockerfile` is outside every gate's domain — which is precisely how the third `--filter` site survived four review rounds and was found only by the Phase 2 self-check.

## Residual risk

- **VE5 (open by design)** — every stderr measurement in this cycle was taken on Node v26.5.0 while `ci.yml` pins Node 22 at three sites. The first CI run must record per-child stderr bytes; the sanctioned fallback if an ambient writer survives `NODE_NO_WARNINGS=1` is recorded in the plan and is never a stream filter.
- **SC56** — a gate cannot detect that it was not run. Demonstrated, not asserted: narrowing root `test:unit` to `packages/` yields 8 files / 72 tests, exit 0, with the parity gate never executing.
