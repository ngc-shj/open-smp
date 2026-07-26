# Deviation Log: identity-appmgmt-labeling-v2 (Phase 2)

Date: 2026-07-26
Branch: `feature/identity-appmgmt-labeling-v2` (base `feature/e2e-playwright-bootstrap` @ `ad30a0c`)

Deviations from the locked plan (`identity-appmgmt-labeling-v2-plan.md`), recorded where
implementation departed from what a contract stated, or where implementation surfaced a fact
the plan asserted incorrectly.

## D9 — Production bug found by E2E: a `'use client'` module's non-component export is `undefined` on the server (essence-shift, fix-now)

C25's audit column rendered `none → undefined` for every label transition. Diagnosed to ground
truth rather than inferred: a server-side `console.log` of `{snapshot, map}` showed `snapshot`
correct (`{kind: 'known_shared', note: null}`) while `LABEL_KIND_NAMES` was **absent from the
serialised output entirely** — the value resolves to `undefined` when a server component imports
a non-component export from a module carrying `'use client'`.

The plan's Shared-utilities table names `LabelControl.tsx:9` as the single source for label
display strings (R2), and three server components were importing it from there. **Two of them —
`accounts/page.tsx` and `identities/[identityId]/page.tsx` — carried the same latent bug and were
shipped in Batches B and C**, because no spec renders a labelled row server-side (the labeling
teardown clears labels before any page assertion sees them). The events page is simply where a
transition string made the `undefined` visible in rendered text.

Fix: extracted the map to `apps/web/src/lib/label-kinds.ts`, a module with no `'use client'`
directive, exporting `LABEL_KIND_NAMES` and `LABEL_KINDS`; all five consumers (both client
components and all three server pages) now import from there. R2 is preserved — the single source
moved, it did not fork.

Recorded as a deviation because the plan's shared-utility pointer was itself the defect: following
it literally is what produced three broken call sites. **The E2E tier caught a bug two prior
batches' gates were structurally unable to see** — the same class of value the e2e-bootstrap cycle
recorded in D3.

Orchestrator process note: while diagnosing this I twice reasoned "the accounts page does the same
thing and works, so the import is fine." That was never measured — those specs pass because they
never render a labelled row. The claim was retracted only after the server-side probe. This is the
plan's own recurring lesson (Convergence note 3) reappearing in Phase 2: a claim stated as
established fact without a measurement behind it.

## D10 — Bulk labeling is not E2E-testable for N > 1 against the demo seed (scope, constructibility)

C26's component→spec mapping asks `labeling.spec.ts` to "select rows, apply a label, assert the
confirmation count". Measured against the seeded data: `account_links` holds exactly one account
per status (`orphan`/`ghost`/`ambiguous`/`matched` = 1 each), and selection state is client-side,
so it does not survive the full page load that switching tabs performs. **No tab can hold two
selectable rows**, and a multi-row selection is therefore not constructible at the E2E tier.

This is the same structural limit SC23 already records for pagination, arrived at independently.
The spec asserts what the tier can prove — the bar is disabled with nothing selected, a checkbox
enables it, and the applied label reaches the row — and the `{updated: N}` count for N > 1 is
proven at the integration tier (`labels every supplied account and emits one audit row per
account`, 3 ids → 3 labels → 3 audit rows). Recorded rather than silently scoped down, per the
plan's "no silent caps" discipline.

## D11 — Both compose images were stale; three E2E failures were deployment, not implementation

The first `labeling.spec.ts` run failed three tests. The cause was not the specs: the `web` and
`api` services build images with no source mount, so the running stack predated Batch D entirely.
`docker compose up -d --build web` rebuilt only `web` — `api` was *recreated* from its old image,
which is why the audit projection still served the pre-C21 kind-blind shape after the first
rebuild.

No plan deviation, but recorded because it cost two diagnostic cycles and the failure mode is
indistinguishable from a real defect at first read: an assertion failing against code that is
correct on disk. Both services (`api`, `web`, plus `worker`) must be rebuilt, not recreated,
before any E2E run that exercises new API or page code.

## D12 — Unit-test baseline restated: 133, not the 149 carried in the working notes

The plan pins the cycle-1 baseline at 99 unit tests and requires Phase 2 to state final counts as
targets rather than "grows" (C26 acceptance, round-2 TEST-F9). The working count carried into this
session was 149; the measured figure is **133 across 15 files**. Verified that the discrepancy is
not a dropped file: `vitest list --reporter=verbose` confirms all four Batch-D unit files execute
(`events-cursor.test.ts`, `events-where.test.ts`, `audit-append-only.test.ts`,
`csv-export.test.ts`). The 149 appears to have been a different measurement basis, not a
regression. Final counts are recorded in the gate table below.

## Verification gates (all executed, this session)

| Gate | Result |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test:unit` | 133 passed / 15 files |
| `pnpm test:integration` | 132 passed / 5 files |
| `pnpm test:e2e` (run 1) | 37 passed |
| `pnpm test:e2e` (run 2, D4 consecutive) | 37 passed |
| `bash e2e/scripts/assert-seed-preserved.sh` | exit 0, after both runs |

Batch-D test deltas: integration +14 cases in 2 describes (C20 cursor/ordering/filter-binding,
C23 filtering/bulk/audit-count); unit +11 (`events-cursor` 5, `events-where` 6) plus 8 added
`csv-export` cases; E2E +3 (`labeling.spec.ts`).

## Red-proofs executed (RT7, throwaway `git worktree`, real tree never mutated)

| Guard | Mutation | Result |
|---|---|---|
| C24 export strip | remove `stripNewlines` from `csvField` | **8 failed** / 16 passed — the three provider/HR columns (`displayName`, `matchedValue`, `candidates`) and all four note-pin cases |
| C24 ordering (I24.3 violation C) | move strip *before* `neutralizeCell` | **2 failed** — `"\rlead"` and `"\r=cmd"`, i.e. formula neutralisation lost, exactly as the plan predicted |
| I26.5 gate, label axis | label `alice.tanaka` by hand | gate fails naming that account |
| I26.5 gate, displayName axis | rename the seeded app by hand | gate fails with `got 'Leaked Rename'` |

Both gate red-proofs were run against the live dev database and restored immediately; the gate was
re-confirmed green (exit 0) after each restore.
