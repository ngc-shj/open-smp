# open-smp

Open-source SaaS Management Platform — account inventory, shadow IT discovery,
and license optimization. Self-hosted, multi-tenant (Postgres RLS), AGPL-3.0.

MVP scope: Google Workspace + HR CSV ingestion → identity/account matching →
orphan & ghost account detection. See `docs/archive/review/mvp-account-matching-plan.md`.

## Quick start

```bash
docker compose up   # Postgres + Redis + API + worker + web, seeded demo data
```

## Layout

- `apps/api` — Fastify API (auth, hr-import, sync/match triggers, account list)
- `apps/worker` — BullMQ collectors (sync, match) + credential-rotation CLI
- `apps/web` — Next.js admin console (orphan/ghost review)
- `packages/schema` — Drizzle schema, RLS migrations, `withTenant()`
- `packages/matcher` — pure matching engine + golden corpus
- `packages/crypto` — AES-256-GCM credential encryption (AAD, key versions)
- `packages/connectors/*` — `SaaSConnector` interface + Google Workspace
