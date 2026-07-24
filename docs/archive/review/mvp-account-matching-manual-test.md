# Manual Test Plan: mvp-account-matching (R35 — deployment artifacts)

Deployment artifacts in this change: `Dockerfile`, `docker-compose.yml`,
`.github/workflows/ci.yml`. Tier-2 (auth, crypto, session handling ship in the
composed stack) — adversarial scenarios included.

## Pre-conditions

- Docker Desktop (or compatible daemon) running; ports 3000/3001/5432/6379 free.
- Repo checked out at the release candidate commit; no `.env` overriding compose values.

## Steps

1. `docker compose up -d --build` — expect all of postgres, redis, api, worker, web
   healthy and the `seed` service to exit 0 (check `docker compose ps`).
2. Open http://localhost:3000 → redirected to `/login`.
3. Login: tenant `demo`, `admin@demo.example`, `demo-admin-password` → lands on `/accounts?status=orphan`.
4. Verify tabs: orphan ≥1, ghost ≥1, ambiguous ≥1, matched ≥1 (seed guarantees each).
5. Ghost row shows evidence popover (rule id + matched value); ambiguous row shows
   candidates, never a single identity name.
6. CSV export downloads; open in a text editor — cells starting with `=`/`+`/`-`/`@`
   are prefixed with `'`.
7. `/events` lists `sync_completed`/`match_completed`-style rows with counts only.
8. Real-connector path (optional, requires GWS tenant): follow
   `docs/manual-tests/google-workspace-sync.md`.

## Expected results

- NFR1: single `docker compose up` yields a browsable, seeded stack.
- API `GET /healthz` returns 200 without auth; every `/api/*` route without a
  session returns 401; non-GET without `Origin: http://localhost:3000` returns 403.

## Adversarial scenarios (Tier-2)

- **Login CSRF**: `curl -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' --data '{"tenantSlug":"demo","email":"admin@demo.example","password":"demo-admin-password"}'` (no Origin header) → 403.
- **Cross-tenant probe**: authenticate, then tamper the session cookie's embedded
  tenantId to a random uuid → every request 401 (fail-closed; token hash not found
  under that tenant's RLS).
- **Rate limit**: 6 rapid failed logins from one IP → 6th returns 429.
- **Redis auth**: `redis-cli -h localhost -p 6379 ping` without password → NOAUTH error.
- **RLS floor**: `psql postgres://opensmp_app:opensmp@localhost:5432/opensmp -c "select count(*) from identities"` (no GUC) → 0 rows visible.
- **Credential exposure**: `GET /api/saas-apps`-shaped responses and `/api/events`
  payloads contain no `credentials`/raw blobs.

## Rollback

`docker compose down -v` removes containers and volumes (demo data only).

## Run log

| Date | Operator | Result |
|------|----------|--------|
|      |          |        |
