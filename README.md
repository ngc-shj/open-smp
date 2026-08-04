# open-smp

Open-source SaaS Management Platform — account inventory, shadow IT discovery,
and license optimization. Self-hosted, multi-tenant (Postgres RLS), AGPL-3.0.

MVP scope: Google Workspace + HR CSV ingestion → identity/account matching →
orphan & ghost account detection. See `docs/archive/review/mvp-account-matching-plan.md`.

## Quick start

```bash
./scripts/setup-env.sh   # writes .env with a freshly generated encryption key
docker compose up --build
```

The repository ships no usable `ENCRYPTION_KEYS`, so the stack refuses to start
until `.env` exists — a committed key would be decryptable by anyone with a
clone. `.env` is gitignored; keep the one you generate, because the stack's
stored credentials are encrypted under it and a second key cannot read them.

Upgrading a stack that ran before the key was removed needs one extra step: a
freshly generated key cannot read the `saas_apps.credentials_enc` rows already
in the volume. Nothing announces that — the stack boots, the seed job succeeds,
and the mismatch surfaces only when something decrypts a stored credential, as
a failure indistinguishable from the connector rejecting it. Recover the old
value from `docker-compose.yml` in the git history and put it in `.env` as
version 1, append a generated key as version 2
(`ENCRYPTION_KEYS=1:<old>,2:<new>`), then re-encrypt every row onto version 2:

```bash
ROTATE_CONFIRM=yes pnpm -C apps/worker rotate-credentials
```

It prints the retirement-gate count and exits non-zero while any row is still
on an older version; once it reports zero, drop version 1 from `.env`.

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
