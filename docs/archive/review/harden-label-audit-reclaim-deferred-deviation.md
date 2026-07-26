# Coding Deviation Log: harden-label-audit-reclaim-deferred

Phase 2. Base `main` @ `3a56620`; implementation commit `4e9d116`.

## D1 — `projectAuditPayload` exported from `events.ts` (not anticipated by the plan)

C29's acceptance criteria 2, 3 and 3a assert on `projectAuditPayload` directly, but the plan never
said how a test would reach it: the function was module-private.

**Resolution**: exported it, following the established precedent in the same file — `buildEventsWhere`
(`events.ts:47`) is exported for exactly this reason and is consumed by `events-where.test.ts`. The
alternative, reaching the projection through the HTTP route, would need a `discovery_events` row with
an out-of-domain `kind` planted in the database — which C27's append-only privilege exists to prevent
and which no API path can create. A test that cannot construct its own input is not a test.

Recorded because it widens a production module's export surface for a test's benefit, which is a
tradeoff worth a reviewer's attention even when the precedent is local.

## D2 — C28 acceptance criterion 5 satisfied by existing tests, not new ones

The criterion required an integration assertion that the single-account path still writes a correct
audit row after the refactor. The plan allowed this to be "satisfied by naming them explicitly rather
than by writing new ones, if they already assert the row contents."

**Verified they do**: `api.integration.test.ts` T-A1 (`:1366`) asserts one row with the full payload
(`actorUserId`, `saasAccountId`, `before: null`, `after: {kind, note}`) for `PUT`, and T-A3 (`:1420`)
asserts the `label_cleared` row for `DELETE`. Both pass unmodified — `git diff main...HEAD --
apps/api/test/api.integration.test.ts | grep -c '^-[^-]'` returns 0, i.e. the file has no removed
lines at all. That zero is the actual evidence for "unmodified", and it is stronger than the
criterion asked for.

## D3 — the first contract-conformance grep for C28 was spelling-bound and produced a false positive

Running the forbidden-pattern check for "label kind as a SQL literal", I first grepped
`'label_set'\|'label_cleared'` across `apps/api/src` and got 3 hits. All three were **correct code** —
TypeScript arguments typed against `LabelAuditKind`:

```
account-labels-bulk.ts:95   recordLabelAuditBatch(tx, tenantId, 'label_set', payloads)
account-labels.ts:72        recordLabelAudit(tx, tenantId, 'label_set', {...})
account-labels.ts:125       recordLabelAudit(tx, tenantId, 'label_cleared', {...})
```

The contract's wording is "as a SQL string literal **inside a query template**". The grep was bound to
the token rather than to the property, so it flagged the very form the contract wants. Re-run against
the property — extract backtick template literals, search only those — it returns **0 hits across 79
template literals scanned**.

Recorded rather than quietly corrected because it is the exact defect class this cycle exists to
close, committed by me while checking conformance to a contract about that defect class. It was caught
only because the anti-vacuity habit meant inspecting the 3 hits instead of accepting the number.

## D4 — comment in `events-projection.test.ts` overstated what one mutation proves

The comment on the "distinguishes an omitted-because-corrupt field" case claimed that emitting `null`
from the reject branch fails that assertion "while the regression pins below stay green". A Phase 2-5
reviewer executed the mutation: **6 failed / 4 passed** — the pins fail too.

The test is correct and the split between the pins and the distinguishing assertion is still right;
the *justification written in the comment* was not. Corrected to state what was actually executed:
reverting the domain check alone fails the two domain assertions while all 8 pins stay green (2/8,
executed), which is the mutation that demonstrates why the split exists. The `null`-emitting mutation
is coarser and takes the pins with it.

Recorded because an inaccurate claim about an executed proof is the same failure the plan's risk R-D
names — writing down what a check *would* show rather than what it *did*.

## Deferred parity gap: no local pre-PR aggregate script

`scripts/pre-pr.sh` does not exist in this repo, so Phase 2-4's completion check is a list of
explicitly-invoked gates rather than one command.

**Anti-Deferral entry.**
- **Worst case**: a future cycle runs a subset of the gates and a CI-only failure surfaces after push,
  costing a round.
- **Likelihood**: low this cycle — every CI gate was run locally and is recorded in the Implementation
  Checklist with its `ci.yml` line. Moderate over time, since the list lives in a plan document rather
  than in an executable script.
- **Cost to fix**: small, but creating a repo-wide developer-workflow script is not in this cycle's
  scope, and adding one in the cycle that also refactors the audit write path stacks an unreviewed
  change onto the branch.
- **Owner / trigger**: the next cycle that touches CI configuration or developer workflow. Recorded so
  the gap is explicit rather than silent.

## Not deviations (checked, conformed)

- Every member-set in the locked contracts re-derived from code before implementing, and all three
  reproduced: 2 audit-family insert sites, 7 label-kind casts, 8 `kind: string` query rows (6 retyped +
  2 named exclusions), 10 `uses:` lines.
- Red proofs for C29, C32 and C33 executed against pre-change code in a **scratchpad** git worktree
  (`/private/tmp/.../scratchpad/redproof-c29`), never by mutating this tree — cycle-2 lesson 5. The
  worktree was removed and `git worktree list` verified to show only the main checkout.
- C31's throwing routes are registered on a separate `buildApp` instance under `/test-throw/*`, so all
  five existing `apiRoutes` consumers (`:168`, `:187`, `:198`, `:688`, `:1501`, `:1526`) pass
  unmodified.
