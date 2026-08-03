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

What actually binds was already recorded a few lines below, at `seed-facts.ts:98-106`:
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
- **Q4**: the cited `206-210` missed the sentence entirely; the landed citation is `213-220`, which covers the quoted comment (`:213-217`) and the assertion it justifies (`:218-220`). The first attempt at this reconciliation computed the range against the pre-edit file, in the commit that moved the lines — which is the mechanism `scripts/check-citations.mjs` now checks for. Mine,
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


---

# Round 2 (incremental)

Date: 2026-08-04
Review round: 2

## Changes from Previous Round

Round 1's fixes (`5d04f15`, seven files, +275/−22 — six prose, one test) reviewed by the same three
experts. **Critical 0 / Major 3 / Minor 10, and every one is against Round 1's own fixes.** Two of
the three Majors are defects *inside* a fix written to correct the same class.

## Merged Findings

### SEC-3 — Major (Security). The SEC-1 fix quotes, verbatim and with a file:line, a predicate that has not shipped since migration 0007.

Round 1 corrected a vague RLS paraphrase into a precise one — and the precise one is **superseded**.
`packages/schema/migrations/0007_tenant_context.sql:98-120` swept every `tenant_isolation` policy
off the `app.tenant_id` GUC, and `:122-135` makes the migration raise if any policy still reads
`current_setting`. Measured against the running engine, which is the authority:

```
select policyname, qual from pg_policies where tablename='saas_accounts';
 tenant_isolation | (tenant_id = current_tenant_id())
```

So `missing_ok` is not the mechanism — it is not in the code path. The mechanism is
`current_tenant_id()` (`0007:77-85`) returning NULL when the transaction claimed no tenant, and a
NULL comparison being false for every row. Measured as `opensmp_app`: `<NULL>|0`.

**The contributing defect is R50, and it is mine.** Round 1's "measured against the running stack"
block measured a **bare SQL expression** and then attributed a `count(*) = 0` to it. Both readings
were real; the attribution was not. That is proxy-signal verification — the exact failure this
review has been asking sub-agents to check for all session.

*Fixed*: all three documents now quote the shipped clause, cite `0007`, name `current_tenant_id()`
as the mechanism, label the `0001` form superseded, and give the `pg_policies` query as the way to
check — asking the engine rather than a migration file.

### N-1 / T2 — Major (Functionality + Testing). A Round-1 finding was recorded as fixed and the edit was never made.

Q3 asked for three E2E specs to be added to mutation table row 6. `code-review.md` recorded it
"*Fixed*" and asserted "All ten findings fixed in Round 1". `git show 5d04f15 --numstat` shows the
plan received **+2/−1** — entirely the VE6 row and SC9. Row 6 was untouched.

The Q3 enumeration was correct (both experts re-verified it independently). It simply never landed.
*Fixed*: row 6 now names `accounts.spec.ts:41-43`, `identity.spec.ts:32-34` and
`licenses.spec.ts:90-91` with the `seed.ts:671` mechanism, marked not harness-runnable per VE4.

### N-2 / T5 — Major (Functionality + Testing). A third copy of the refuted claim, inside the line range the correction cites as its authority.

`e2e/fixtures/seed-facts.ts:101-106` said "a new unmatched account reds the tenant-scoped orphan
count in accounts.spec.ts" — precisely what F-01 refuted. Worse, all three corrected texts cited
`seed-facts.ts:97-106`: line 97 is **blank**, the comment runs 98-102, and the range **stops one
line short — cutting off exactly the clause that contradicts it.** A reader following the citation
sees only the corroborating half.

The branch had already written the policy for this at `deviation.md`: "leaving the source is what
produces the third copy (R34)". It was applied to the `e2e/package.json` claim and not to this one.

*Fixed*: the stale clause corrected with its premise stated, ranges re-pointed to `98-102` in all
four documents, and the attribution split — the comment records the `apps.spec.ts` binder; the
seat-CTE effect is derived here and now says so.

### Minor, all fixed

- **T1** — Q2 gave `ACCOUNT_STATUSES`' barrel re-export an observer and left `LINK_STATUSES`', one
  line away in the same block, with none. Enumerating the barrel's nine runtime exports showed it
  was the last unobserved one. Fixed by routing `link-statuses.test.ts:3` through the barrel.
- **T4** — the parse comment credited `[^}]*?` with surviving a field reorder. Measured: inserting a
  field is absorbed (5 pairs), **reordering drops the entry** (4). The conclusion holds — the
  `email:` denominator makes it loud — but the mechanism was misattributed. Corrected here *and* at
  `link-statuses.test.ts:197-203`, which is where the overstatement was inherited from.
- **SEC-4** — the two-entry limitation list was itself overstated. The root cause is that the
  scanner has no regex-literal awareness at all; the three symptoms are a phantom block comment, a
  phantom line comment from `//` in a character class (`/[//]/` is valid — an unescaped `/` is legal
  there, which is why the old `/a/*b/` dismissal was the wrong example), and an odd quote count
  flipping string/code phase for the rest of the file. Rewritten to name the cause.
- **SEC-5 / N-4 / T3** — the extension landed in one of three byte-identical copies, and the two
  skipped ones sit next to the *stronger* instance (`accounts.ts` has seven interpolating
  templates). Propagated to both, each naming its own scanned file.
- **N-3** — the F-02 fix narrated the clause it removed and made a `packages/api-types` comment name
  an `apps/web` symbol, in a package whose C8 rule forbids that direction. Reduced to the
  `BILLING_CYCLES` form its own record had prescribed.
- **N-5 / T6** — two records of one fix gave two different line ranges, in the round whose subject
  is citation accuracy. Reconciled on `203-210`, and "40 lines below" was anchored to the citation
  the same finding had just refuted.
- **N-6** — the regex widening was one-sided; both captures are now `[^']*`.

## Environment Verification Report

Unchanged from Round 1 and re-run after the fixes: lint 0, typecheck 0, build 0, unit 742,
integration 254, E2E 65, `assert-seed-preserved.sh` 0. No `blocked-deferred` path.

## Quality Warnings

None. The two claims that could not be settled by reading — SEC-3's predicate and T4's reorder
behaviour — were settled by querying `pg_policies` and by running the parse against mutated fixture
copies.

## Resolution Status

All thirteen Round-2 findings fixed. Details in `account-status-domain-deviation.md` **D9**.

---

# Round 3 (incremental) — and the exit

Date: 2026-08-04
Review round: 3

## Changes from Previous Round

Round 2's fixes (`966e782`, eleven files) reviewed by the same three experts.
**Critical 0 / Major 4 / Minor 15, every one against Round 2's fixes, and every one of character
(b) — a claim false about the world — except one weak (a).**

All three experts, independently and without being asked to conclude anything, reached the same
verdict about the loop itself:

> **Functionality**: "A Round 4 that only re-reads prose will find Round 3's prose defects. A Round
> 4 pays only if the citations are checked by a script rather than a reader. Every finding above is
> mechanically detectable."
>
> **Security**: "A round that only re-verifies the six figures above, mechanically, would close this
> out; a round that re-reads the prose will find more prose."
>
> **Testing**: "That is a batch of edits, not a round of review: the findings have stopped being
> about the tests and are now entirely about the prose describing them."

## The mechanism, finally named

Three of Round 3's four Majors are one defect wearing three faces:

**A commit edits a file and, in the same commit, invalidates a `file:line` range into that file —
including ranges the same commit wrote.**

- The N-2 fix re-pointed four documents to `seed-facts.ts:98-102` *and* grew that comment from five
  lines to twelve. The new range cut mid-sentence at "…leaves ROLLUP_SQL's seat CTE **and**", and
  excluded `:103-106` — the correction the round had just landed. **N-2 recurring inside the commit
  that fixed N-2.**
- The T4 fix added three lines to `link-statuses.test.ts` and left the range reconciled in that same
  commit pointing three lines short.
- Two documents asserted the seat-CTE effect was "not recorded in the tree" while the same commit
  wrote it there.

Nine expert passes across three rounds did not catch these by reading. Every one is decidable by a
script in milliseconds.

## The exit: a gate, not a round

Phase 3's termination check prescribes exactly this for a class that keeps expanding — the
convergence artifact is a **mutation-verified guard wired into the authoritative gate**, not another
round. So Round 3's fix is `scripts/check-citations.mjs`:

- it resolves every `path:N-M` citation in the diff, including short-form ones, and reports any that
  is out of bounds or **stops mid-sentence while its subject continues** — the precise shape of the
  defect, narrowed from a first version that also flagged legitimate sub-range citations, because a
  gate that over-fires gets switched off;
- run over this branch it found **19** stale ranges, including every instance two experts had
  flagged and several nobody had. All 19 re-derived mechanically;
- **red-proven by its own exit status**: shortening one range four lines gives exit 1; restoring
  gives exit 0, with no residue;
- **wired**, not merely authored (RT7 shape b): `pnpm check:citations` in `package.json`, and a step
  in CI's `checks` job with `fetch-depth: 0`, because the script exits 2 on an unresolvable base ref
  rather than passing vacuously;
- **scoped to the diff.** Repo-wide the tree carries 46, almost all in archived reviews from
  finished cycles. Redding CI on those would make the gate unkeepable, and an unkeepable gate is a
  disabled gate. Stated in the script rather than left to be discovered.

It cannot tell whether the cited lines *say* what the citing text claims. That is declared in the
file (R49) — it removes the class where the reader is looking at the wrong lines, and nothing more.

## The other findings, all fixed

- **SEC-6** — "cannot come back" was credited to `0007:122-135`, a one-shot migration `DO` block
  that cannot constrain migration 0008. The standing property lives at
  `packages/schema/test/rls.integration.test.ts:509-526`, which derives the check from `pg_policies`
  every CI run with an anti-vacuity floor. Re-cited.
- **SEC-7** — "all in the false-GREEN direction" was false for symptom 3: an odd quote count leaves
  genuine comments *unstripped*, redding an intact file. That is false-RED, the failure the helper
  exists to prevent. Split.
- **SEC-8** — a second root cause, unnamed: the `'`/`"` scan is not newline-terminated, so a stray
  quote becomes a file-wide phase offset rather than a line-local one. Added, with its bounded fix.
- **SEC-9 / R3-3 / F-R3-01** — the propagated note told the `apps/worker` copy that its scanned file
  carries an interpolating template. Measured: `apps/worker/src/match.ts` has **zero** `${`. The
  propagation kept the `apps/api` copy's conclusion and deleted the only thing that made it
  checkable. Corrected with each copy's real profile.
- **SEC-10** — "seven interpolating templates" was six, and "the two skipped ones" was one.
- **R3-7** — the barrel still said `LINK_STATUSES` had no runtime consumer; T1 had given it one.
- **F-R3-05** — the sibling parser kept `[^']+` where its twin had been widened, so an emptied
  `chip` degraded to a count mismatch instead of naming the entry. Widened, measured either way.
- **R3-5, R3-6, R3-8** — an unanchored "40 lines below", a stale regex form in the plan, and a
  duplicated round header.

## Environment Verification Report

lint 0 · typecheck 0 · build 0 · unit 742 · integration 254 · **check:citations 0** · E2E 65 ·
`assert-seed-preserved.sh` 0. No `blocked-deferred` path.

## Termination

**Stopping here.** Not because the findings stopped — they did not, and the count rose across all
three rounds — but because their *character* settled and the mechanism behind them is now checked by
a script rather than by a reader.

| | R1 | R2 | R3 |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| Major | 1 | 3 | 4 |
| Minor | 9 | 10 | 15 |
| **(a) behaviour defects** | **0** | **0** | **0** |
| (b) claims false about the world | 6 | 11 | 18 |
| (c) wording | 4 | 2 | 1 |

Zero behaviour defects in three rounds. The code has been stable since Phase 2: every gate green at
every round, 996 tests, E2E 65, and every observer red-proven. What kept generating findings was the
prose describing the code — and three rounds of adding prose to fix prose is the loop the i18n
review already named: **the fix rate feeds the finding rate, so it converges when the changes stop,
not when the findings do.**

The one thing that changed the game was mechanizing the check. That is the artifact this round
produced, and it is what a fourth round would otherwise have spent itself discovering.
