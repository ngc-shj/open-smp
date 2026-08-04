# Coding Deviation Log: account-status-domain

## D1 — C2's post-image acceptance criterion predicted the wrong number, for the fourth time

**Contract**: C2, acceptance criteria (review aid).
**Plan said**: the derivation command over the post-image returns **3 matches** — the migration,
the new `ACCOUNT_STATUSES` declaration, and `packages/schema/test/tables.test.ts:34`.
**Measured at implementation time**: **6 matches across 5 files**.

```
rg -U --count-matches --glob '!node_modules' --glob '!*.md' \
  "active'[\s\S]{0,40}?suspended'[\s\S]{0,40}?archived'" .
```

The three unpredicted hits are code **this plan adds**: `ACCOUNT_STATUS_KEYS` in
`apps/web/src/lib/account-statuses.ts:22-24`, and the `en` and `ja` blocks in
`apps/web/src/lib/i18n/messages.ts:67-69,315-317`. Each is three message keys whose names end in
the domain's member names — `'accountStatus.active'`, `'accountStatus.suspended'`,
`'accountStatus.archived'` — which the regex matches and cannot distinguish from a declaration.

**Why it survived four review rounds**: nobody ran the command against a post-image that included
C3 and C4. Rounds 1–4 each corrected the *number* (1 → 2 → 3) and each time the correction was
computed from the files that round happened to be looking at. Round 4's Functionality expert named
the real defect — "the count is load-bearing on a formatting accident" — and recommended dropping
it; revision 5 switched from counting lines to counting matches, which was the smaller half of
that recommendation.

**Disposition**: fixed in the plan, not deferred. The criterion no longer states an expected
count. It now says to classify every hit, records the six measured, and states the distinction the
regex cannot make: a second *declaration of the domain* is a finding, a string that merely spells
the members is not.

**What this does not change**: I2.1 was already labelled `(review-enforced, no observer)` and the
forbidden patterns were already labelled tripwires. The enforcing controls — I6.1 (unit
transcription), I6.4 (engine) and I6.8 (source text) — are unaffected, and none of them counts
anything.

## D2 — Deferred CI parity gap: `scripts/assert-ci-executed.sh`

**Gate**: `bash scripts/assert-ci-executed.sh` in the `audit` job.
**Reason it cannot run locally**: it requires `GH_REPO` and `GH_RUN_ID` and asks the GitHub jobs
API what executed. A run id does not exist before the push it would gate.
**Cost of deferring**: none for this change — the gate asserts that the jobs and steps named in
`.github/ci-executed-manifest.json` actually ran, and this diff adds no CI job and no CI step.
**What would settle it**: nothing local; the gate is correct to live where it does.

## D3 — C7 prescribed a psql session that does not exist, copied from a broken precedent

**Contract**: C7. **Found by**: the Phase 2 Step 2-5 security self-check (R29 Major, R35 Major).

Revision 5 of the plan told C7 to run its destructive block through
`docker compose exec postgres psql -U postgres -d open_smp`, "the session
`docs/manual-tests/e2e-howto.md:50-51` already uses". Neither the role nor the database exists:
`docker-compose.yml:8-10` sets `POSTGRES_USER: opensmp` and `POSTGRES_DB: opensmp`, so `initdb`
creates the role `opensmp` and the database `opensmp` and nothing else. Measured against the
running stack:

```
$ docker compose exec -T postgres psql -U postgres -d open_smp -c 'select 1;'
psql: error: FATAL:  role "postgres" does not exist
```

Every one of the block's three invocations — the id lookup, the forward `UPDATE`, and **the
restore** — terminated there. The section's own evidence gate (`UPDATE 1` in both directions,
which exists to catch the RLS silent no-op) could never fire, and the section had no working
inverse.

**Why it happened, which is the part worth keeping.** The plan cited a precedent and did not
execute it. `docs/manual-tests/e2e-howto.md:50` carries the same wrong session and predates this
plan; four review rounds read the citation, and none ran it. This is R29's rationale sub-clause in
its purest form — the *reason* attached to the prescription ("this is the session the repo already
uses for exactly this") was true about the text and false about the world, and it is the reason
that licensed the copy.

**Disposition**: fixed, and the source fixed with it. All three invocations in
`docs/manual-tests/ui-orphan-list.md` now use `-U opensmp -d opensmp`; the rationale sentence names
`docker-compose.yml:8-10` and states that `opensmp` is the bootstrap superuser rather than pointing
at another document; and `docs/manual-tests/e2e-howto.md:50` — pre-existing, adjacent, and the
origin of the defect — is corrected in the same pass rather than left as the precedent that
produces the next copy (R34).

**Verified by execution against the running stack**, not by reading:

```
$ psql -U opensmp -d opensmp -tAc "select current_user, current_setting('is_superuser');"
opensmp|on
$ BEGIN; UPDATE ... SET account_status='suspended' WHERE id='<id>'; -> UPDATE 1
        UPDATE ... SET account_status='active'    WHERE id='<id>'; -> UPDATE 1
        ROLLBACK;
$ psql -U opensmp_app -d opensmp -c "UPDATE ... WHERE id='<id>';"  -> UPDATE 0
```

The last line is the hazard the section warns about, demonstrated: the application role reports
`UPDATE 0` with no error, which is why the section states `UPDATE 1` as the expected output of both
directions.

## D4 — `apps/api/test/package-test-parity.test.ts` needed the new fs-reading test listed

**Contract**: C6/I6.11. `apps/web/test/account-statuses.test.ts` reads `e2e/fixtures/seed-facts.ts`
as text, which puts it in family (a) of that file's `READS_FILES` addition-guard, and `pnpm
test:unit` red until it was added to `CONTROL_FILES` beside its twin
`apps/web/test/link-statuses.test.ts`. A plan gap rather than a plan error: the CI-parity table
enumerated the typecheck-program gate and not this one.

## D5 — `stripTsComments` placed as a per-package file, not inlined

**Contract**: C6/I6.8. The plan said to copy the body "into `packages/schema/test/`", which the
implementation read as inlining it in `tables.test.ts`. The repo's idiom is a standalone
per-package file even for a single consumer — `apps/api/test/strip-ts-comments.ts` and
`apps/worker/test/strip-ts-comments.ts` each have exactly one — so inlining would have introduced a
third *shape* on top of the existing two copies. Moved to
`packages/schema/test/strip-ts-comments.ts`.

## D6 — C3's "do not extract" reason ruled out one shape and concluded against all of them

**Contract**: C3. **Found by**: the Phase 2 Step 2-5 functionality self-check (R1 Major).

The plan and the shipped docstring both justified the third copy of the `*StatusKeyFor` read with
"the i18n review withdrew an extraction with exactly this failure mode". The withdrawal is real
(`i18n-code-review.md:123-130`) and its failure mode is real — but it is the **positional** form,
`messageKeyFor(keys, value)`, where the map and the value are independent arguments. A **closure**
form, `keyLookup(ACCOUNT_STATUS_KEYS)`, binds the map at construction and has nothing left to
mis-pair. The reason ruled out one shape; the conclusion ruled out all of them.

Four plan-review rounds and three experts accepted the inference. It survived because the cited
withdrawal was true, and a true citation under a conclusion it does not reach is exactly the R29/R49
shape this review has been finding in the other direction all along.

**Disposition**: the conclusion stands, the reason does not, and the reason is what was fixed. The
docstring now names the closure form, states that it has no mis-pairing failure, and gives the
actual argument for not taking it *here*: bound to one map it has a single consumer (indirection,
not reuse); reaching the other two means editing `link-statuses.ts`, a shipped module carrying two
vocabularies and their observers that this plan's scope does not cover; and `chipClassFor` is a
fourth near-twin with a non-null fallback, so a shared read covers three of four. Recorded as **SC8**
with its trigger.

## D7 — three comment claims corrected against measurement

All three found by the Step 2-5 self-check; all three are the R29 class, and none changes behaviour.

- **The freeze-liveness claim was unbounded** (`packages/api-types/src/index.ts:18-23`). The
  corrective edit C1 made in Batch A replaced an overstatement in one direction ("the freeze does
  NOT protect z.enum()") with an overstatement in the other. The plan's own Risks section measured
  the bound — the window closes at the first **string-valued** parse — and the sibling comment
  shipping in the same diff carried it while this one did not. Now bounded.
- **`e2e/package.json` declares two devDependencies, not one** (`@playwright/test` **and**
  `@types/node`). The claim was replicated verbatim from `apps/web/test/link-statuses.test.ts:183`,
  so it is corrected in both — leaving the source is what produces the third copy (R34).
- **I6.11's floor was justified with the wrong case**
  (`apps/web/test/account-statuses.test.ts`). The comment said the derived denominator catches
  deleting the fields from every entry; measured, that case gives 0 pairs and the `> 0` guard reds
  on its own. What the denominator actually closes is **partial** deletion — four of five entries
  gives 1 pair against 5 `email:`, which `> 0` passes and only the equality reds. That is the case
  the model's own comment records paying for. The assertions were right; the reason was not.

## D8 — Phase 3 Round 1: five reasons corrected, none of them behaviour

Every Round-1 finding was a rationale defect. The code was not wrong; what was written about it was.
Recording them together because the pattern is the point.

- **VE6 named the gate that adapts and omitted the ones that bind** (functionality F-01, Major).
  "Seeding a fourth state would join the orphan set and red `accounts.spec.ts`" — but
  `SEEDED_ORPHAN_EMAILS` (`e2e/fixtures/seed-facts.ts:91-93`) filters on the **link** status, and
  `accounts.spec.ts:72-80` derives both its by-name loop and its `toHaveCount` from that same list.
  The fixture's docstring says outright that an added account "joins this set rather than breaking a
  count". What binds is what `seed-facts.ts:98-106` already recorded: `apps.spec.ts:213` hardcodes
  `Cannot delete — 4 accounts still attributed`, and a non-`active` account leaves `ROLLUP_SQL`'s
  `seat` CTE. The correct reason was in the repo and VE6 used a plausible other one. Corrected in
  both the plan and the manual-test doc.
- **The RLS predicate was paraphrased without `missing_ok`** (security SEC-1). The doc cited
  `tenant_id = current_setting('app.tenant_id')` to explain a silent `UPDATE 0`. Measured against
  the running stack, the cited form RAISES (`ERROR: unrecognized configuration parameter`) and only
  the shipped form — `NULLIF(current_setting('app.tenant_id', true), '')::uuid` — returns NULL and
  yields 0 rows silently. The mechanism cited was the opposite of the behaviour asserted, and the
  plan had it right. A reader "verifying" the doc would have deleted the guard.
- **The import-path reason ruled out a shape nobody proposed** (testing Q2). The new test justified
  importing `@open-smp/api-types` directly with "the root vitest project resolves no `@/` alias" —
  but a relative import reaches the barrel too, and `label-filters.test.ts:2` already does exactly
  that. This is D6's inference defect recurring one file from its own fix. It had a consequence:
  `ACCOUNT_STATUSES` in the web barrel had **no observer**, and deleting it reddened nothing. Routing
  the import through the barrel fixes the reason and gives the re-export its only observer — proven
  by deleting the line (3 tests red) and restoring it.
- **An assertion that could not fail** (testing Q1). `expect(display).not.toBe('')` was unreachable:
  the capture was `[^']+`, so an emptied field produced no match rather than an empty capture. Widened
  to `[^']*`, which turns an emptied field from a count mismatch into a named diagnosis.
- **Two copied clauses and two off-by-N citations** (functionality F-02, F-03; testing Q3, Q4).
  `ACCOUNT_STATUSES`' docstring carried `LINK_STATUSES`' "not the accounts page's tab order" contrast,
  which has no referent for this domain; the I6.11 rationale D7 rewrote had lost its sentence tail;
  the quoted line range was `203-210`, not `206-210`; and mutation row 6 omitted the three E2E specs
  the `match.ts:16` cut also reds through the seed's own `matchAccounts` call.
- **`stripTsComments`' limitation list stopped at one gap** (security SEC-2), omitting nested-backtick
  interpolation in a file carrying eleven `sql` templates. Extended — and the first attempt at the
  extension **closed its own block comment** by writing the terminator literally, which lint caught.
  A note about a comment-stripper's blind spot, defeated by a comment-stripping blind spot. It is
  recorded in the file.

## D9 — Phase 3 Round 2: the fixes were the defect source, twice inside their own class

Round 2 found Critical 0 / Major 3 / Minor 10, every one against Round 1's fixes. Two of the three
Majors are the most instructive entries on this branch.

**A correction that made a superseded claim precise.** SEC-1 asked for the RLS predicate to be
quoted rather than paraphrased. The quote came from `0001_init.sql:114-116` — and
`0007_tenant_context.sql:98-120`, which predates this branch's base, swept every `tenant_isolation`
policy to `USING (tenant_id = current_tenant_id())` and then asserts its own work by raising if any
policy still reads `current_setting`. The engine says `(tenant_id = current_tenant_id())`. So the
fix took a vague-but-harmless paraphrase and turned it into a precise, authoritative, wrong one.
**Precision is not accuracy, and a file:line lends authority the claim did not earn.**

The contributing defect is R50 and it is the orchestrator's: the "measured against the running
stack" evidence measured a bare SQL expression and attributed a `count(*) = 0` to it. Both readings
were real; the attribution was not. The correct instrument was `pg_policies` — ask the engine what
policy it has, not a migration file what policy it wrote. That is now what the doc tells the reader
to do.

**A fix recorded as made and never made.** Q3's edit to mutation table row 6 was written up as
"*Fixed*" in the review artifact and repeated in the deviation log, and the plan's diff for that
commit was +2/−1 — the VE6 row and SC9, nothing else. Two experts caught it independently by
running `--numstat` rather than reading the record. **A Resolution Status entry is a claim about the
tree and has to be checked against the tree**, which is R50 again in the shape the review process
itself takes.

**A citation that excluded its own refutation.** The F-01 correction cited `seed-facts.ts:97-106` as
the record of what really binds. Line 97 is blank, the comment runs to 102, and 101 is where the
sentence breaks — so the range stopped exactly one line before the clause asserting the very thing
F-01 had refuted. Not deliberate; the effect is that a reader following the citation sees only the
half that agrees. Three documents carried it. The branch's own R34 policy — fix the source, not
just the copy — had been written down one round earlier and applied to a different claim.

The rest were the same class one size down: a limitation list that was itself overstated (the
scanner has no regex-literal awareness at all — the two entries were symptoms of one cause), that
list landing in one of three identical copies while the two skipped ones sit next to the stronger
instance, a comment crediting `[^}]*?` with surviving a field reorder it measurably does not survive
(5 pairs → 4), a fix that narrated the clause it removed and coupled `packages/api-types` to an
`apps/web` symbol name, and two records of one fix giving two different line ranges.

**What this round is evidence for.** Every finding since Phase 1 Round 2 has been a rationale
defect, and the rate has not fallen — it has moved. Round 1 corrected reasons in the code; Round 2
corrected reasons in Round 1's corrections. The i18n review recorded the same shape and named the
exit: the loop stops when the changes stop, not when the findings do.

## D10 — Phase 3 Round 3: the loop was closed by a gate, not by a round

Round 3 found Critical 0 / Major 4 / Minor 15, all against Round 2's fixes, all of character (b).
Three of the four Majors were one mechanism: **a commit that edits a file and, in the same commit,
invalidates a `file:line` range into it — including ranges it wrote itself.** N-2's own fix
committed N-2 from the other end; T4's fix left the range reconciled in that commit three lines
short; two documents denied a claim the same commit had written into the tree.

Nine expert passes over three rounds missed these by reading. All were decidable by a script.

**`scripts/check-citations.mjs`** is the round's real output. It resolves every `path:N-M` citation
in the diff and reports the ones out of bounds or stopping mid-sentence while the subject continues.
The first version also flagged legitimate sub-range citations; that was narrowed, because a gate
that over-fires is a gate that gets switched off. Over this branch it found **19** stale ranges —
including every one two experts had flagged, and several nobody had — all re-derived mechanically.
It is red-proven by its own exit status (1 broken / 0 restored, no residue), wired into
`package.json` and CI's `checks` job rather than merely authored (RT7 shape b), given
`fetch-depth: 0` because it exits 2 on an unresolvable base ref rather than passing vacuously, and
scoped to the diff because the archived review corpus carries 46 older decayed ranges that would
make it unkeepable.

What it does not do is stated in the file: it cannot tell whether the cited lines *say* what the
citing text claims. It removes the class where the reader is looking at the wrong lines, and
nothing more (R49).

**The lesson, which is the one worth carrying out of this branch.** Three code-review rounds
produced zero behaviour defects and thirty-five findings about the prose describing the behaviour.
The verification apparatus a review builds is itself reviewable surface, and past a point the
cheapest way to close a class is to stop reading for it and start checking for it. The signal that
the point has arrived: every instance of the class is mechanically decidable, and the reviewers say
so unprompted.

## D11 — the gate caught the commit that added it, in CI, on the first run

`pnpm check:citations` was green locally, then the Round-3 record and the checker's own docstring
were written, then the commit landed **without re-running the gate**. CI caught two stale ranges
over `seed-facts.ts` (both ending at line 102 where the comment now runs to 106) — one in
`code-review.md`, one inside `check-citations.mjs` itself.

So the defect the gate exists for was committed in the commit that adds the gate. That is the
strongest evidence available that the gate was the right artifact, and it is also a process failure
worth naming: **a gate run before the last edit is a gate that did not run.** Phase 2-4's own
worktree-drift note says exactly this about aggregate scripts; it applies to any gate.

**The fix taught the gate something.** Both hits were *narrative about a past citation* — the
code-review sentence describing which range the earlier fix had used, and the checker's own
illustrative example. The mechanical repair — re-pointing them at the current range — was applied first and then
reverted, because it would have made the record say the earlier fix used the correct range, which is
the opposite of what happened. **Falsifying a record to satisfy a gate is the failure a gate is meant
to prevent, not cause.** Both were rephrased out of the colon form instead, and the limitation is now
stated in `check-citations.mjs` so the next person meets it as a documented edge rather than as a
temptation.

A third instance appeared while this entry was being written: the sentence naming the two hits
carried the range in colon form and the gate flagged it on the next run. Rephrased the same way.
The limitation is real and recurs the moment you write *about* a citation, which is why the rule
("rephrase, never re-point") is in the script rather than only here.
