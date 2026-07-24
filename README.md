# open-smp

Open-source SaaS Management Platform — account inventory, shadow IT discovery,
and license optimization. Self-hosted, multi-tenant (Postgres RLS), AGPL-3.0.

MVP scope: Google Workspace + HR CSV ingestion → identity/account matching →
orphan & ghost account detection. See `docs/archive/review/mvp-account-matching-plan.md`.

## Quick start

```bash
docker compose up --build
```

This boots Postgres, Redis, the API, the worker, and the web UI, then runs a
one-shot seed job that creates a demo tenant with sample accounts (including
at least one orphan and one ghost account).

1. Open <http://localhost:3000>
2. Log in with tenant slug `demo`, email `admin@demo.example`, password
   `demo-admin-password`
3. Browse `/accounts` (defaults to the orphan filter) and `/events`

The seeded Google Workspace connector uses fake credentials, so sync will
fail against the real Admin SDK. To connect a real Workspace tenant, replace
the seeded `saas_apps` credentials via `POST /api/saas-apps` with your own
service-account JSON — see `docs/manual-tests/google-workspace-sync.md` for
the full setup and verification procedure.

## Layout

- `apps/api` — Fastify API (auth, hr-import, sync/match triggers, account list)
- `apps/worker` — BullMQ collectors (sync, match) + credential-rotation CLI
- `apps/web` — Next.js admin console (orphan/ghost review)
- `packages/schema` — Drizzle schema, RLS migrations, `withTenant()`
- `packages/matcher` — pure matching engine + golden corpus
- `packages/crypto` — AES-256-GCM credential encryption (AAD, key versions)
- `packages/connectors/*` — `SaaSConnector` interface + Google Workspace
