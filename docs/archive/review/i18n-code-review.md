# Code Review: i18n (C1, C2, C3)

Date: 2026-08-03
Review rounds: 3
Range reviewed: `b54afbf..c6c229c` — PRs #35, #36, #37

## Why this exists

These three PRs were merged **without a Phase 3 review and without the Phase 2
self-check**. This is that review, run retrospectively, and the fixes it
produced. There was no deviation log and no code-review log for the contract
before this file.

The i18n files had been touched since by an unrelated 8-round review (SC2), which
added an orphan-message-key detector to `i18n.test.ts` — and then found it was a
tautology, because it scanned the tree containing the dictionary. Each finding
below records whether it still stood on `main` at review time.

## Round 1 — Critical 0 / Major 8 / Minor 12

First-pass discovery.

### The contract's own gates were the largest finding

**C1 had no ratchet.** `actually translates` asserted `differing.length > 0`
against 187 keys of which 186 differ — a floor of 1. A key added to both locales
with the English pasted into `ja` satisfied it, and satisfied every sibling
assertion too: the key sets match, neither value is empty, identical strings
carry identical placeholders. C2 was given a ratchet; C1 was not.

**Eight of C2's eleven allowlist entries could not fire.** The scan skips text
with no letter BEFORE consulting `NOT_COPY`, so every punctuation entry was
unreachable and the test named for them passed by the letter rule.
`audit-transition.ts` justified leaving two glyphs bare "on the same ground the
detector's allowlist uses" — pointing at code that does not run.

**And the allowlist was free to widen.** Once the remainder reached zero, adding
any string moved neither assertion, and entries are keyed by text so one exempts
that string across all of `apps/web`. That is how `google-workspace` outlived its
subject and had to be removed by hand a contract later.

### Three copy gaps the ratchet could not see

- `aria-label={\`Select ${accountId}\`}` — one of twelve copy attributes, the only
  one not routed through `t()`. The attribute scan matches a quoted literal and a
  JSX expression attribute never matches, so the ratchet was structurally blind.
  Under `ja` a screen-reader user got "Select \<uuid\>" on every row of the page
  the plan measured as the largest copy surface.
- `LanguageControl` lives in `NavBar`; `NavBar` is mounted by seven pages and
  `/login` is not one of them. The login copy IS translated, so the `ja` strings
  existed and were reachable only by signing in on an English page.
- `'upload.tooLarge'` typed `10MB` into both locales, one line below
  `upload.tooManyRows`, which parameterises its own cap, and a comment explaining
  why a hand-written figure stops matching the day the cap moves.

### One vocabulary translated, one declared

`LINK_STATUS_KEYS` mirrors `LABEL_KIND_KEYS`, which the plan established as the
house pattern and then did not apply to its twin. `accountStatus` is a bare
`string` on the wire and its producing union lives in `packages/connectors/core`,
which `apps/web` may not import (C8) — declared as residue with its trigger.

### Security (Minor ×3)

The locale cookie declined `Secure` outright, reasoning the attribute "would make
the control silently stop working on any plain-HTTP deployment"; the session
cookie one file away resolves the same constraint conditionally from
`APP_ORIGIN`'s scheme. The writer adjudicated by cast where the reader uses
membership. `stripComments` had an undeclared blind spot.

Verified clean, with evidence: no raw-HTML sink exists in `apps/web`;
`translate`'s interpolation uses a FUNCTION replacement, so `$&`/`$1` in a
parameter are literal and a single pass means a value containing `{other}` is
never re-scanned; no cross-request locale state; the dictionary leaks nothing.

**Verification:** 943 tests, E2E 62, all gates green, **12/12 mutations red**.

## Round 2 — Critical 0 / Major 10 / Minor 12

**Every Major was about Round 1's fixes.** Two were reached independently by all
three reviewers.

### I closed a one-character bypass and opened a worse one

`=(["'])([^"']+)\1` generalises the quote character and shares one body class
between both forms, so it excludes BOTH quotes from the value:
`aria-label="Owner's name"` went from FOUND to missed. English UI copy carries
apostrophes routinely; the single-quoted form the fix closed has no subject in
this repository.

### The derivation reached the key and not its producer

`MAX_UPLOAD_LABEL` moved the map key and the API error with the constant and left
the two client pre-checks — which both files identify as the dominant path,
because a server 400 on an aborted upload does not reliably survive the Next
proxy — writing `10MB` by hand. They agreed only because the cap was 10MB.
Raising it broke the lookup and fell through to the generic copy: verbatim the
failure the derivation was made to prevent.

### Seven controls with no observer

`/login`'s `LanguageControl`, the `chip` fixture field, `ContractImportForm`'s
`max` branch, the ratchet's locale derivation, the identity-status ternary's
allow side, and two more. Each was revertible with every gate green.

**Verification:** 968 tests, E2E 63, all gates green, **14/14 mutations red**.

## Round 3 — Critical 0 / Major 9 / Minor 7

Again, every Major was about Rounds 1-2. **Two fixes were WITHDRAWN rather than
layered on**, which is the round's most useful outcome.

### Withdrawn: the `.ts` widening of the copy detector

Justified by naming three `.ts` modules this contract moved copy out of — and the
copy there was object-literal values and bare `return` strings, which neither the
text scan nor the attribute scan can match. The widened branch was inert for
exactly the regression it was widened to catch, and its only observer asserted
JSX inside a `.ts` file, which TypeScript will not compile. The widening also
forced the text scan off for `.ts`, adding a branch a one-line deletion left
green. The shape is real; a scan that reaches it is a different scan.

### Withdrawn: the cap as a positional argument

Collapsing the duplicated map was right. Taking the row cap as a `number` was
not: `uploadFailure(raw, HR_ROW_CAP)` in the contract form typechecked, passed
every test, and fell through to the generic copy on every row-cap refusal — the
asymmetry the extraction existed to remove, relocated from the map to the
argument. Before it, each form named its own constant in its own file. Two entry
points now, each closing over its own cap.

### The claim that named a compile error that cannot happen

`IDENTITY_STATUS_KEYS` was read by a bare index under a docstring claiming a
third member would be a compile error. It would not: `identityStatusEnum` in
`packages/schema` is a hand-written second declaration — unlike `linkStatusEnum`,
which derives from the shared domain — and the API narrows the row's `string`
with a bare `as`. So the migration the claim named produces no error, and the
bare index rendered `⟨undefined⟩` where the ternary it replaced rendered the raw
value.

### Three observers that could not see their subject

The round-trip gate scanned two files while the key it guards had moved to a
third, and its loop asserted nothing when it matched nothing. The seed-fixture
parse was floored at one pair over five. And the comment-stripper fixture —
rewritten once already under a commit titled for exactly this — put the URL
inside a block comment the first pass deletes.

**Verification:** 977 tests, E2E 63, all gates green, **9/9 mutations red**.

## Termination

Stopped after Round 3, at 35/35 mutations red across the three rounds.

The reason is not that Major counts fell — they did not (8 → 10 → 9), and neither
did first-pass mutation survivors (2 → 2 → 3). It is that **the subject changed**:

| | R1 | R2 | R3 |
|---|---|---|---|
| Major findings | 8 | 10 | 9 |
| originating in #35-#37 | 8 | **0** | **0** |
| originating in this review's own fixes | — | 10 | 9 |

Rounds 2 and 3 found nothing wrong with the code under review. They found things
wrong with the fixes, and by Round 3 with the fixes to the fixes. The fix rate
feeds the finding rate, so the loop does not converge on its own — it converges
when the changes stop.

The findings' CHARACTER settles it. Every product-level defect — the untranslated
`aria-label`, `/login` without a language control, the hardcoded cap, the English
status vocabularies — was found in Round 1 and is fixed and observed. Rounds 2
and 3's Majors are R49 (a claim stronger than its implementation) and RT7 (a
guard that cannot fail): real methodological defects, and the kind a PR review is
a better filter for than a fourth self-review round.

## Residue

- **`accountStatus` stays English.** Wire type is a bare `string`; the producing
  union is in `packages/connectors/core`, which `apps/web` may not import (C8).
  Trigger: `accountStatus` gaining a domain in `@open-smp/api-types`.
- **Copy in a `.ts` module is undetected.** Real, has happened, and the file-set
  widening tried and withdrawn above does not reach it.
- **The comment stripper mis-handles three shapes** — a `//` after `}` in a
  template, one abutting a closing quote, one inside JSX text. None has a subject
  today; all three are in the detector's own residue list.
- **JSX text adjacent to an interpolation is invisible.** Closing it surfaces
  nine legitimate runs, and the budget entries that would take are the ratchet
  slipping.
- **`identityStatusEnum` is a hand-written second declaration** while
  `linkStatusEnum` derives from `LINK_STATUSES`, and the API narrows with `as`.
  The guarded read handles the consequence; the divergence itself is a schema
  contract, not this one.
- **Three sites assert the rendered cap** (`e2e/specs/import.spec.ts`,
  `apps/api/test/api.integration.test.ts`, `docs/manual-tests/ui-import.md`).
  Deliberately not derived: an assertion that computes its own expectation
  asserts nothing. They red when the cap moves, which is the point.
