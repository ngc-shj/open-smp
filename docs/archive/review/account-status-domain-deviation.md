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
