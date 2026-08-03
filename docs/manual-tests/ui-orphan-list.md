# Manual Test: UI orphan/ghost list (C8, V4)

**Automated by `e2e/specs/accounts.spec.ts` and `e2e/specs/sync.spec.ts`**
(plan `e2e-playwright-bootstrap`): steps 1–7 below (login, tab statuses,
evidence popover, ambiguous candidates, column/freshness smoke, CSV export +
injection neutralization) are covered by `accounts.spec.ts`; step 8 (sync
failure + match gating) is covered by `sync.spec.ts`. The account-status column's
`ja` rendering is covered by `e2e/specs/i18n.spec.ts` — for the `active` value
only. This script remains the reference for exploratory/manual verification.

**The "nothing here is manual-only" clause that used to close this paragraph is
retracted, not extended.** The account-status section below is manual-only, and
naming another spec does not repair that: the seed writes `accountStatus:
'active'` for all five accounts (`apps/api/src/seed.ts`) and nothing at any tier
— unit, integration or E2E — reaches `suspended` or `archived` in a render.
Seeding a fourth state was considered and rejected, and the reason is worth
naming precisely because the obvious one is wrong: it is **not** the orphan set.
`SEEDED_ORPHAN_EMAILS` (`e2e/fixtures/seed-facts.ts:91-93`) filters on the *link*
status, and `e2e/specs/accounts.spec.ts:72-80` derives both its by-name loop and
its `toHaveCount` from that same list — the fixture's own docstring says an added
account "joins this set rather than breaking a count". What binds is what
`seed-facts.ts:97-101` already records: `e2e/specs/apps.spec.ts:213` hardcodes
`Cannot delete — 4 accounts still attributed`, and a non-`active` account drops
out of `ROLLUP_SQL`'s `seat` CTE, moving the figures
`e2e/scripts/assert-seed-preserved.sh` pins.

## Pre-conditions

- `docker compose up -d --build` completed; seed service exited 0.

## Steps

1. http://localhost:3000/login → login with `demo` / `admin@demo.example` / `demo-admin-password`.
2. `/accounts` defaults to the orphan tab; verify ≥1 row.
3. Switch tabs Ghost / Ambiguous / Matched (the `?status=` values stay lowercase) — each shows ≥1 seeded row.
4. Ghost row: status chip red, evidence popover shows rule id + matched value + the identity's leave date context.
5. Ambiguous row: candidates listed; NO single identity name rendered.
6. Column check: app, email, name, account status, admin badge, last activity, link status, confidence; freshness footer shows the last sync time.
7. CSV export of the current tab; verify formula-injection neutralization (cells starting with `=`,`+`,`-`,`@` are `'`-prefixed).
8. Trigger sync (fails against fake seed credentials — expected `auth` error surfaced); confirm match can only be triggered after a sync job reports completed.

## Expected result

All steps pass; no browser console errors on the three pages.

## Account status rendering — WRITES TO THE DATABASE (manual-only)

Placed after every step above and after `## Expected result` on purpose: this
section **perturbs `saas_accounts`**, so it must not run before the
non-destructive observations, and `## Expected result` above keeps covering the
steps it was written for. This section carries its own expected-result line.

Manual-only per the retraction in the header: `suspended` and `archived` are
never seeded, so no automated tier can reach them. `e2e/specs/i18n.spec.ts`
covers the `active` value on both pages and nothing else does.

Note that step 8 does **not** propagate a change made here — the sync fails
against fake seed credentials, so match never runs and nothing reclassifies.

### 1. Rendering, read-only

| # | Locale | Page | Expect |
|---|--------|------|--------|
| A1 | `ja` | `/accounts?status=matched` | the `alice.tanaka@demo.example` row's アカウント状態 cell reads **有効**, and the word `active` appears nowhere in the row |
| A2 | `ja` | that row's identity page (click the identity link) | the account row's アカウント状態 cell reads **有効** |
| A3 | `en` | `/accounts?status=matched` | the same cell reads **Active** — *confirmatory only* |
| A4 | `en` | that row's identity page | the same cell reads **Active** — *confirmatory only* |

**A3 and A4 discriminate nothing.** The `en` copy is title-case of the domain
value, so a half-applied change renders `active` where `Active` is expected — a
one-character difference a manual observer will sign off in the reverted state.
**A1 and A2 are the observations that carry this section.**

The out-of-domain rendering (a value with no dictionary entry, which must render
verbatim) is **not observed here and cannot be**: the column is a Postgres enum,
so the engine refuses the value. That is a stated gap, not something the tests
below cover — `accountStatusKeyFor`'s `null` return and the enum's rejection are
each pinned by a unit and an integration cell, and neither observes what the
render does with a `null` key.

### 2. The other two members — destructive

Get the account id first (read-only):

```sh
docker compose exec postgres psql -U opensmp -d opensmp \
  -c "SELECT id, email, account_status FROM saas_accounts WHERE email = 'alice.tanaka@demo.example';"
```

Then, substituting that id for `<accountId>` in **both** statements below:

```sh
# Forward: flip one account out of 'active'. Expected output: UPDATE 1
docker compose exec postgres psql -U opensmp -d opensmp \
  -c "UPDATE saas_accounts SET account_status = 'suspended' WHERE id = '<accountId>';"

# ... observe (see the table below), then restore. Expected output: UPDATE 1
docker compose exec postgres psql -U opensmp -d opensmp \
  -c "UPDATE saas_accounts SET account_status = 'active' WHERE id = '<accountId>';"

# Fallback if the restore was missed or the id was wrong: the seed is idempotent
# and upserts account_status, so re-running it puts every account back.
docker compose up -d --build
```

**`UPDATE 1` is the expected output of BOTH directions, and checking it is not
pedantry.** `saas_accounts` carries `FORCE ROW LEVEL SECURITY` with
`USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`
(`packages/schema/migrations/0001_init.sql:114-116`), and the application role is
never granted a bypass. The `true` is `missing_ok`, and it is the whole
mechanism: without it `current_setting` RAISES on an unset GUC (measured:
`ERROR: unrecognized configuration parameter "app.tenant_id"`), which would fail
loudly and need no guard. With it, an app-role session with `app.tenant_id`
unset gets NULL, the predicate is NULL, and the statement reports **`UPDATE 0`
with no error** — which in the forward direction reads as a broken render, and in the
inverse direction leaves the row perturbed while the operator believes it was
restored. `opensmp` is the bootstrap superuser — `docker-compose.yml:8-10` sets
`POSTGRES_USER`/`POSTGRES_DB` to `opensmp`, so `initdb` creates that role and
that database and **no `postgres` role or `open_smp` database exists** — and a
superuser bypasses RLS. `opensmp_app` (`docker-compose.yml:36`) is the
application role and is the one the paragraph above is about.

`WHERE id = '<accountId>'` is scoped to one row on purpose: `saas_accounts` is
multi-tenant and manual-test docs get copy-pasted.

Observations, with the row still flipped:

| # | Locale | Page | Expect |
|---|--------|------|--------|
| B1 | `ja` | `/accounts?status=matched` | the row's アカウント状態 cell reads **停止中** |
| B2 | `en` | same | **Suspended** — *confirmatory only, same reason as A3* |

Optionally repeat with `'archived'` (`ja`: **アーカイブ済み**, `en`: `Archived`).

**Restore before finishing.** Leaving the account `suspended` drops it from the
licences rollup's seat CTE and reds `e2e/scripts/assert-seed-preserved.sh`
(`assert_license 'google-workspace' 'assigned' '4'` and the `unassigned` figure
with it) — a gate CI runs immediately after `pnpm test:e2e`.

### Expected result for this section

A1–A4 and B1–B2 pass, the restore reports `UPDATE 1`, and
`bash e2e/scripts/assert-seed-preserved.sh` exits 0 afterwards.

## Run log

| Date | Operator | Result |
|------|----------|--------|
|      |          |        |
