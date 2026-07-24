# Manual Test: UI orphan/ghost list (C8, V4)

E2E automation is deferred (SC8); this script is the manual verification path
for the accounts UI against the seeded docker-compose stack.

## Pre-conditions

- `docker compose up -d --build` completed; seed service exited 0.

## Steps

1. http://localhost:3000/login → login with `demo` / `admin@demo.example` / `demo-admin-password`.
2. `/accounts` defaults to the orphan tab; verify ≥1 row.
3. Switch tabs ghost / ambiguous / matched — each shows ≥1 seeded row.
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
