# Running the E2E suite

Plan `e2e-playwright-bootstrap` (C15–C17). The Playwright suite in `e2e/`
drives the real browser against the docker-compose stack; it is a separate
tier from `pnpm test:unit`/`pnpm test:integration` and requires Docker.

## Local run

1. Start the stack and wait for the seed job to finish:

   ```sh
   docker compose up -d --build
   docker compose wait seed
   ```

2. Run the suite:

   ```sh
   pnpm test:e2e
   ```

   `global-setup.ts` polls `/healthz` (API) and `/` (web) for up to 60s and
   fails fast with a clear message if the stack is not reachable, then
   performs the suite's single UI login and saves `e2e/.auth/state.json`
   (gitignored — every spec context reuses it; only `auth.spec.ts` performs
   further real logins). A still-valid saved session skips the login
   entirely, so back-to-back runs stay inside the login rate limit.

   **Rate-limit note**: `auth.spec.ts` makes 2 real login POSTs per run and
   the API's IP limit is 5/min. Two immediate consecutive runs fit the
   budget (verified); a THIRD immediate rerun within the same minute will
   429 the invalid-password test — wait ~60 s before a third rerun. This is
   the production rate limiter working as designed, not a suite bug.

3. (Optional) verify the seed acceptance bar survived the run — the same
   check CI runs immediately after `pnpm test:e2e`:

   ```sh
   bash e2e/scripts/assert-seed-preserved.sh
   ```

## Resetting stack state

The seed is idempotent, so re-running `docker compose up -d --build` restores
the 4 seeded accounts and their link statuses. If a prior manual session or
failed spec left stray `account_labels` rows, the **preferred, targeted**
reset is a scoped delete rather than a volume wipe:

```sh
docker compose exec postgres psql -U opensmp -d opensmp \
  -c "DELETE FROM account_labels;"
```

A full volume wipe (`docker compose down -v` followed by
`docker compose up -d --build`) also works and guarantees a completely clean
slate, but it is slower and is gated by a local destructive-op hook in this
repo's Claude Code config — prefer the targeted delete above for routine use.

## CI

The same steps run in the `compose-smoke` job in `.github/workflows/ci.yml`,
after the existing curl gates and against the same stack boot (single
workflow file, R33). On failure, the `playwright-report/` artifact is
uploaded (`retention-days: 7`) for local inspection.
