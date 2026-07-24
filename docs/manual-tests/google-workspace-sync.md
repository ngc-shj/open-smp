# Manual test: Google Workspace sync (live tenant)

C3 acceptance artifact (V1, `blocked-deferred` for automation). `users.list`
requires a real Workspace tenant with a service account + domain-wide
delegation; no free-tier substitute exists, so this procedure is run by hand
against the operator's own tenant. Fixture-based connector tests cover the
`verifiable-local` portion (`packages/connectors/google-workspace`).

Re-record / cadence (RT1, per plan V1): re-run this script at least
**quarterly**, and immediately after any `googleapis` dependency bump. Log
every run in the table at the bottom, including no-op confirmation runs.

## Pre-conditions

- A Google Workspace tenant with Admin SDK Directory API enabled.
- A GCP service account with **domain-wide delegation** configured in the
  Workspace Admin console, authorized for scope:
  `https://www.googleapis.com/auth/admin.directory.user.readonly`
  (read-only — write scope must NOT be granted; C3 forbidden pattern).
- The service account's JSON key file, and the email address of a Workspace
  admin user to impersonate (`impersonateAdminEmail`).
- open-smp running locally via `docker compose up` (or equivalent dev setup)
  with `apps/api`, `apps/worker`, Postgres, and Redis reachable.
- An admin account already provisioned for the target tenant (see repo
  README / seed script for local login credentials).

## Steps

1. Log in to the web UI (or call the API directly) as the tenant admin.
2. Register the connector:
   `POST /api/saas-apps` with
   `{ "key": "google-workspace", "displayName": "Google Workspace", "credentials": { "serviceAccountJson": "<contents of the key file>", "impersonateAdminEmail": "admin@yourdomain.example" } }`.
   Confirm the response is `201` and contains no `credentials` field.
3. Trigger a sync: `POST /api/sync/:saasAppId`. Note the returned `jobId`.
4. Poll `GET /api/jobs/:jobId` until `state = completed`. Record the
   `result.upserted` count.
5. Open the Google Workspace Admin console → Users, and note the total
   active + suspended user count for the domain (Directory → Users list, or
   `gcloud` / Admin SDK Explorer equivalent).
6. Compare the `upserted` count from step 4 against the Admin console count
   from step 5 — they should match (mismatches may be legitimate, e.g. users
   added between the sync and the console check; re-run the console check if
   they diverge).
7. Trigger a match run: `POST /api/match`. Poll `GET /api/jobs/:jobId` until
   `state = completed`.
8. Open `/accounts?status=orphan` in the web UI (or
   `GET /api/accounts?status=orphan`) and review the orphan list. Spot-check
   a few entries against the Admin console to confirm they are genuinely
   unmatched (e.g. shared mailboxes, service accounts with no HR record).

## Expected results

- Step 2: `201`, no credentials echoed back.
- Step 4: job reaches `completed` without error; `upserted` is a positive
  integer close to the domain's user count (see step 6).
- Step 4 re-run (idempotency spot-check): running the sync a second time
  without any Workspace-side changes produces the same `upserted` count and
  a `last_synced_at` that has advanced, with no duplicate rows.
- Step 8: orphan list renders without error; entries correspond to accounts
  with no matching HR identity, consistent with C4's rule pipeline.

## Rollback

- Delete the registered connector: currently no dedicated delete endpoint in
  MVP scope — remove the `saas_apps` row directly
  (`DELETE FROM saas_apps WHERE id = '<saasAppId>'`, scoped to the tenant)
  via an operator DB session. This also cascades away any dependent
  `saas_accounts` / `account_links` rows created by the test sync, if a
  cleanup of those is desired (they are otherwise idempotent and harmless to
  leave in place for a dev/staging tenant).
- Revoke or delete the temporary service account key in the GCP console if
  it was created solely for this test.

## Run log

| Date | Operator | Result |
|------|----------|--------|
|      |          |        |
