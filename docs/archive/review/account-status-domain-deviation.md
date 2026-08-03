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

- **The freeze-liveness claim was unbounded** (`packages/api-types/src/index.ts:18-20`). The
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
