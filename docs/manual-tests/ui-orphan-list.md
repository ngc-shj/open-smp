# Manual Test: UI orphan/ghost list (C8, V4)

**Automated by `e2e/specs/accounts.spec.ts` and `e2e/specs/sync.spec.ts`**
(plan `e2e-playwright-bootstrap`): steps 1–7 below (login, tab statuses,
evidence popover, ambiguous candidates, column/freshness smoke, CSV export +
injection neutralization) are covered by `accounts.spec.ts`; step 8 (sync
failure + match gating) is covered by `sync.spec.ts`. This script remains the
reference for exploratory/manual verification; nothing here is manual-only.

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

## Run log

| Date | Operator | Result |
|------|----------|--------|
|      |          |        |
