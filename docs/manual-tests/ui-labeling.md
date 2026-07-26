# Manual Test: UI account labeling (C14)

**Automated by `e2e/specs/labeling.spec.ts`** (plan `e2e-playwright-bootstrap`):
set/edit-note/clear, CSV-injection neutralization, and survival across a
`Run matching` re-match (steps 1–8 below) are all covered. This script
remains the reference for exploratory/manual verification; nothing here is
manual-only. Cross-checks C10's survival-through-re-match guarantee
end-to-end.

## Pre-conditions

- `docker compose up -d --build` completed; seed service exited 0.
- `/accounts` has at least one row (any tab).

## Steps

1. http://localhost:3000/login → login with `demo` / `admin@demo.example` / `demo-admin-password`.
2. Open `/accounts`. Pick any row and click its "Label" button in the Label
   column. Verify the inline form opens with a kind select (Known shared /
   Service account / External collaborator) and a note input.
3. Set label: choose "Service account", enter note "Jenkins deploy bot,
   owner: infra", click Save. Verify the row now shows a "Service account"
   chip and the Label button reflects the same text.
4. Edit note: reopen the control, change the note to "Jenkins deploy bot,
   owner: platform", click Save. Verify the chip stays "Service account" and
   the note change persists (reopen the control again to confirm the note
   field shows the updated text).
5. Clear: reopen the control, click Clear. Verify the chip disappears and
   the button reverts to "Label".
6. Re-set the label (repeat step 3) so a label exists for the next step.
7. Re-run match from `/import`: open `/import`, click "Run matching", wait
   for completion, then return to `/accounts`. Verify the label chip set in
   step 6 is still present on the same account (label survives re-matching
   per C10).
8. Export CSV: click "Export CSV" on `/accounts`. Open the downloaded file
   and verify the header row contains `label` and `labelNote` columns, and
   the labeled row's cells contain the kind and note set above.

## Expected result

All steps pass; no browser console errors on `/accounts` or `/import`.

## Run log

| Date | Operator | Result |
|------|----------|--------|
|      |          |        |
