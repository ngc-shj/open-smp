# Code Review: account-status-domain
Date: 2026-08-04
Review round: 1

## Changes from Previous Round

Initial review. Three experts reviewed `feature/account-status-domain` (30 files, +3049/−38) on top
of the Phase 2 Step 2-5 self-R-check baseline, which had already fixed three findings of its own.
Local LLM pre-screening returned `No issues found`; the per-expert seeds returned `No findings` for
functionality and security and three findings for testing, all three of which the testing expert
**rejected with reasons** (see Seed Finding Disposition).

**Critical 0 / Major 1 / Minor 9.** Every finding is a rationale defect — a reason attached to a
correct conclusion that is false about the world. **Not one is a behaviour defect.** All are fixed.

## Merged Findings

### F-01 — Major (Functionality). VE6's reason names the gate that adapts and omits the ones that bind.

VE6 rejected seeding a fourth account status because it "would join the orphan set derived in
`e2e/fixtures/seed-facts.ts` and red `accounts.spec.ts`'s by-name orphan assertions". Measured:
`SEEDED_ORPHAN_EMAILS` (`seed-facts.ts:91-93`) filters on `a.status === 'orphan'` — the **link**
status, not the account status — and `accounts.spec.ts:72-80` derives *both* its by-name loop and
its `toHaveCount` from that same list. The fixture's own docstring states the intent: an added
account "joins this set rather than breaking a count."

What actually binds was already recorded 40 lines below, at `seed-facts.ts:97-101`:
`e2e/specs/apps.spec.ts:213` hardcodes `Cannot delete — 4 accounts still attributed`, and a
non-`active` account drops out of `ROLLUP_SQL`'s `seat` CTE, moving figures
`e2e/scripts/assert-seed-preserved.sh` pins.

The conclusion stands; the reason is false about the world, and the correct reason was in the repo.
A reader wanting to close the VE6 coverage gap would open `accounts.spec.ts`, find it adapts
cleanly, conclude the objection was stale, and be surprised by `apps.spec.ts`. Same class as D6.

*Fixed* in both the plan's VE6 row and `docs/manual-tests/ui-orphan-list.md`.

### SEC-1 — Minor (Security). The RLS predicate was paraphrased without `missing_ok`, and the cited form does the opposite of what the paragraph asserts.

The manual-test doc explained the silent-no-op hazard with
`tenant_id = current_setting('app.tenant_id')`. The shipped policy
(`packages/schema/migrations/0001_init.sql:114-116`) is
`NULLIF(current_setting('app.tenant_id', true), '')::uuid`, and the dropped `true` is the entire
mechanism. Measured against the running stack, as `opensmp_app`:

```
cited form   → ERROR:  unrecognized configuration parameter "app.tenant_id"
shipped form → NULL, and SELECT count(*) FROM saas_accounts → 0
```

So the cited predicate would fail **loudly**, which is the one case where the `UPDATE 1` guard would
be unnecessary. The plan stated it correctly; precision was lost between plan and doc. The next
editor "verifying" the doc gets an error, concludes the no-error warning is wrong, and deletes the
guard. *Fixed* — the shipped predicate is now quoted verbatim with its file:line, and `missing_ok`
is named as the mechanism.

### Q2 — Minor (Testing). The import-path reason rules out a shape nobody proposed, and the barrel re-export it declines had no observer.

The new test justified importing `@open-smp/api-types` directly with "this file is outside src, and
the root vitest project resolves no `@/` alias". The alias is not the question: a relative import
reaches either module, and `apps/web/test/label-filters.test.ts:2` already imports the barrel that
way. **This is D6's inference defect recurring one file from its own fix.**

It had a measurable consequence. C1 adds `ACCOUNT_STATUSES` to the barrel's value block on a stated
policy, and nothing in `apps/web` read it — deleting the line reddened nothing at any tier.

*Fixed* by routing the import through the barrel, which corrects the reason and gives the re-export
its only observer. Verified by deleting the barrel line (3 tests red) and restoring it (clean diff,
typecheck green).

### Q1 — Minor (Testing). An assertion in I6.11 that cannot fail.

`expect(display).not.toBe('')` was unreachable-red: the parse captured `([^']+)`, so an emptied
`accountStatusText: ''` produces **no match at all** rather than an empty capture. *Fixed* by
widening the capture to `([^']*)`, which makes the line reachable and turns an emptied field from a
count mismatch into a named diagnosis.

### SEC-2 — Minor (Security, Adjacent). `stripTsComments`' limitation list stopped at one gap.

The docstring named a regex literal containing a block-comment opener and framed that as the
deliberate residue. A second gap of the same false-green class was unstated: a template literal whose
`${…}` interpolation nests a backtick ends the string region early, after which the remainder is
scanned as code. `packages/schema/src/tables.ts` carries eleven `sql` templates, ten with
interpolations — the exact construct the scanner is pointed at. Unreachable today, as the first gap
also was. *Fixed.*

**The first attempt at the fix closed its own block comment** by writing the terminator literally;
`pnpm lint` caught it. A note about a comment-stripper's blind spot, defeated by one. Recorded in
the file rather than quietly repaired.

### F-02, F-03, Q3, Q4 — Minor. Two copied clauses, one truncated sentence, two citation slips.

- **F-02**: `ACCOUNT_STATUSES`' docstring carried `LINK_STATUSES`' "not the accounts page's tab
  order" contrast verbatim. There it is load-bearing (`ACCOUNT_TABS` really does reorder the same
  members); for account status no second ordering exists anywhere in `apps/web`. The sibling
  `BILLING_CYCLES` comment shows the correct reduced form. *Fixed.*
- **F-03**: the I6.11 rationale D7 rewrote had lost its sentence tail — a clause ending in a comma
  with nothing after it. The rewrite that fixed a wrong reason truncated the sentence doing it.
  *Fixed.*
- **Q3**: mutation table row 6 omitted three E2E specs. `apps/api/src/seed.ts:671` computes the
  demo's links with `matchAccounts`, so cutting `match.ts:16` reclassifies `bob.suzuki` from `ghost`
  to `matched` in the seeded database and reds `accounts.spec.ts:41-43`, `identity.spec.ts:32-34`
  and `licenses.spec.ts:90-91`. Conservative (it understates the case for I6.9) but the table's
  stated contract is completeness. *Fixed.*
- **Q4**: the quoted sentence is at `link-statuses.test.ts:203-205`, not the cited `206-210`. Mine,
  from the D7 fix. *Fixed.*

### F-04 — Minor (Functionality). A fifth member of the render class, recorded nowhere.

`apps/web/src/app/events/page.tsx:85-86` renders `{event.source}` and `{event.kind}` raw under
translated headings — the last instance of the class this change closes on the two account pages,
and absent from both `i18n-code-review.md`'s residue list and SC1–SC8. There is a defensible product
answer (dotted machine identifiers may belong verbatim, for the same reason the CSV export stays
raw) but nobody wrote it down. Pre-existing, file outside the diff. *Recorded as **SC9** with its
trigger and cost; no code change.*

## Seed Finding Disposition

**Functionality** — seed reported `No findings`; the expert did not defer to it and re-derived the
member set, the checklist cross-check and every citation independently.

**Security** — seed reported `No findings`; the expert did not defer to it and instead *executed*
zod's semantics, the DB role/GUC claims against the running stack, and drizzle's source.

**Testing** — three seed findings, **all three rejected**, each with evidence:
- *CSV line-ending mismatch* — Rejected. `csv-export.ts:121,190` both `join('\r\n')`; `\r\n` is the
  only terminator the producer emits. The suggested tolerant split would be a **regression**:
  `csv-export.ts:37` neutralises bare newlines precisely so one cannot survive into a cell, and a
  tolerant split would absorb a future break of that neutraliser instead of redding.
- *Unsafe cast* — Rejected. The parsed value is constrained by `expect(ACCOUNT_STATUSES).toContain(status)`
  one statement earlier. The suggested guard would convert a red into a silent skip — the vacuous-pass
  shape RT7 exists to prevent.
- *Mutable record* — Rejected. A module-scope constant in one test file, never written; vitest
  isolates per file. The freeze idiom is a *production boundary* rule, and `as const` would fight the
  `Record<AccountStatus, …>` annotation that is the declaration's entire point.

## Environment Verification Report

Phase 1 declared VE1–VE6. Every path classified:

| Path | Classification | Evidence |
|---|---|---|
| VE1 — E2E under a booted stack | `verified-local` | `pnpm test:e2e` → 65 passed, against a rebuilt compose stack |
| VE2 — integration under Docker | `verified-local` | `pnpm test:integration` → 254 passed |
| VE3 — no real GWS/Slack tenant | N/A | no provider call or credential path touched |
| VE4 — `mutate.mjs` cannot drive Playwright | `verified-local` | the two render-site rows are recorded hand-run; the harness path is unchanged |
| VE5 — no jsdom, async server components | N/A | asserted as the reason E2E is the only render observer; unchanged |
| VE6 — seed writes only `active` | `verified-local` | `seed.ts:202,210,218,226,249`; the E2E observers pin one member, and F-01 corrected the reason a fourth is not seeded |

No `blocked-deferred` path. The one deferred CI gate (`assert-ci-executed.sh`, needs a run id) is
recorded as **D2** with its cost.

## Quality Warnings

None. Every finding carries a file:line and a reproducing command or an opened citation. The two
that could not be settled by reading — SEC-1's predicate behaviour and Q2's missing observer — were
settled by **executing** against the running stack and by deleting the line to watch it red.

## Recurring Issue Check

Preserved per expert. All three ran R1–R57 (plus RS1–RS6 / RT1–RT11) as an incremental pass on the
Phase 2 baseline. Verdicts: Functionality — F-01 (R29), F-04 (R3), all others clean or N/A.
Security — SEC-1 (R29), SEC-2 (R1-adjacent); every other rule clean with evidence, including RS3
traced end to end and R43 verified member-identical rather than assumed. Testing — Q1 (RT7), Q2
(R29/RT6), Q3 (R49), Q4 (R29); RT7 verified for all eleven observers, anchor uniqueness for all
thirteen mutation rows, red-set width for all thirteen, and the precision arithmetic recomputed from
`corpus.ts` (42/47 = 0.894 against the 0.95 floor).

## Resolution Status

All ten findings fixed in Round 1. Details in `account-status-domain-deviation.md` **D8**.
Gates after fixes: lint 0, typecheck 0, build 0, unit 742, integration 254, E2E 65,
`assert-seed-preserved.sh` 0.
