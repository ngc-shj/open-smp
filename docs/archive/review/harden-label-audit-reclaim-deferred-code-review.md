# Code Review: harden-label-audit-reclaim-deferred
Date: 2026-07-26
Review rounds: 3 (converged)

Base `main` @ `3a56620`. Implementation `4e9d116`; fixes `e5a2b73`, `8564f40`, `e75559b`.

## Changes from Previous Round

Round 1: 7 findings (2 Major, 5 Minor) against the implementation.
Round 2: 4 findings (3 Major, 1 Minor) — **three of the four were defects introduced by the
round-1 fixes**, the pattern this branch's plan review had already recorded.
Round 3: 2 findings, both Minor, **none fix-induced**. Converged.

Phase 2's self-R-check had returned "No findings" from all three perspectives, so every finding
below is something that pass missed.

---

## Round 1

### FN-F1 [Major] — the SC30 trigger gate was specified but never implemented
C29's locked forbidden-pattern list included a gate on `saas_apps.key`. It was not built, while
the plan-review artifact recorded SEC-F-S3 and SEC-F-S5 as *resolved by it*, and SC38's
Anti-Deferral entry claimed its trigger was "now DETECTABLE via the SC30 gate rather than relying
on recall." A deferral's exit condition was recorded as executable when nothing executed it.
Production code was correct throughout (`saas-apps.ts:11` is the literal); the gate was missing.

**Resolution**: `apps/api/test/saas-app-key-pin.test.ts`. Bound to the **value**, not the form —
the plan's own sketch (`key:\s*z\.(?!literal)`) fires on `z.enum` but passes `z.literal('label')`,
the one-token edit that defeats the control. Also asserts the declaration count is exactly 1
(a file move fails rather than escapes) and that `seed.ts` seeds the same value, because the
column has two authors.
**Red proof executed**: changing the literal to `z.literal('label')` fails the test.

### SEC-1 [Major] — C29's protective omission was forged back by the events renderer
`projectAuditPayload` omits a snapshot whose kind is outside the domain, precisely so a corrupt
row is not rendered as a state that never happened. `auditTransition` then did
`labelSnapshot(payload.before ?? null)`, and `labelSnapshot` renders `null` as `'none'`. A
`label_set` whose `before.kind` was corrupted displayed as `none → Known shared` —
indistinguishable from a genuine first-time labelling, on the one surface an operator reviews the
trail from.

**The reachability was new.** Before C29 the API passed corrupt kinds through, so the field was
always present and the branch was unreachable for audit rows. C29 created it. I29.5 described this
rendering but classified it as an accepted pre-existing ambiguity, missing that the contract in
the same cycle made it reachable.

**Resolution**: `labelSide()` returns `'unavailable'` for `undefined` and delegates otherwise;
the `?? null` coalescing is gone.

### FN-F2 [Minor] — the C33 insert-site gate counted files, not occurrences
`.test()` is boolean, so at most one entry per file was pushed and two INSERTs *inside* `audit.ts`
would have passed — while the comment directly above claimed the opposite ("the count alone would
be satisfied by a second insert appearing in audit.ts, so the file is asserted too") and I33.1
said "the count … is exactly 1".
**Resolution**: `matchAll(/INSERT INTO discovery_events/gi)`, one entry per occurrence.
**Red proof executed**: appending a second INSERT function inside `audit.ts` fails with
`found: audit.ts, audit.ts`.

### SEC-2 [Minor] — the pin gate's detector missed YAML flow-mapping steps
`/^[ \t]*(-[ \t]+)?uses:/` never collected `- {uses: actions/checkout@v5}`, so such a step escaped
the allowlist **entirely** rather than failing it — and the non-zero count guard stays satisfied by
the surrounding block-form lines. Valid Actions syntax, running a mutable tag, invisible to the gate.
**Resolution**: detector hoisted to a named `USES_LINE` constant and widened, with the detector
itself now tested. `PINNED` stays anchored to block form deliberately: a flow mapping cannot carry
the mandatory `# vN` comment (YAML 1.2 §6.6 requires whitespace before `#`), so the gate demands
the one shape the comment can live in.

### QA-1 [Minor] — C29 acceptance criterion 5 had no test
The `LABEL_FILTERS` value pin was specified and never written. The leak direction that matters is
the non-obvious one: `'none'`/`'any'` are filter-only pseudo-kinds, and a refactor letting either
into `ACCOUNT_LABEL_KINDS` would make them storable. The projection test iterates
`ACCOUNT_LABEL_KINDS` and would have passed unchanged.
**Resolution**: `apps/api/test/label-kinds.test.ts`, both directions.

### QA-2 [Minor] — the 401 and 403 branches had no body assertions
Three 401 and three 403 status-only assertions existed; renaming `'unauthorized'`, or dropping the
403 table entry so it fell through to `'client_error'`, would have left the suite green.
**Resolution**: two more throwing routes on the C31 probe instance, with deep-equal bodies.

### FN-F3 [Minor] — C32 acceptance criterion 4 not yet dischargeable
See Environment Verification Report.

---

## Round 2 — three of four findings were defects in the round-1 fixes

### R2-1 [Major, security] — the SC30 gate was form-bound for the second time
Round 1 replaced a gate that passed `z.literal('label')` with one using `[^,\n]*`, which cannot
cross the newline a formatter inserts into a long zod chain. **Executed**: a multi-line
declaration, `key : z.string()`, and `'key': z.string()` all evaded it 2/2.

This is the defect class the cycle exists to close, committed twice in the fix for it.

**Resolution**: normalise the source before matching (comments stripped, whitespace collapsed —
the `audit-append-only.test.ts` idiom), pattern `/['"]?key['"]?\s*:\s*z\s*\.[^,)]*\)?/g`.
**Executed**: all four spellings now match; non-zod `key: someOther.thing` and a commented-out
declaration correctly do not.

### R2-2 [Major, functionality] — the renderer still forged the *two-sided* corrupt case
`labelSide` closed the one-sided forgery; the early return above it re-opened the other half.
Both fields absent is what a sync event looks like **and** what a wholly corrupt audit payload
projects to — so a tampered label event rendered as `'—'`, i.e. "nothing to show", on the audit
surface. Reachable, and asserted by my own `events-projection.test.ts:76`.

**Resolution**: decide from the event **kind**, which comes from a column no API path can rewrite.
That required the audit-kind list where both sides can see it, so `LABEL_AUDIT_KINDS` /
`LabelAuditKind` / `isLabelAuditKind` moved to `@open-smp/api-types` — the same move C29 made for
the label-kind domain, for the same reason. A second kind list on the web side is what the existing
comment warns against.

### R2-3 [Major, functionality] — the widened detector fired on prose
`/(^|[\s{,])uses[ \t]*:/` collected any line containing `uses:` anywhere, including comments.
**Executed**: an ordinary `# uses: actions/checkout is pinned to the SHA below` turns the gate red
with three phantom unpinned references. A gate that reds on a valid workflow is one the next person
weakens — the false-positive direction is part of the contract, not an afterthought.
**Resolution**: `/^[ \t]*(-[ \t]*)?([{,][ \t]*)?uses[ \t]*:/`, with 9 executed cases covering both
directions, and a `does not collect %s` block.

### R2-4 [Minor, testing] — `labelSide` had no test
Deleting its `undefined` guard would have restored the round-1 forgery with every suite green. The
E2E path asserts `none → Known shared`, which is the *genuine* case.
**Resolution**: `auditTransition` and `labelSide` moved to `apps/web/src/lib/audit-transition.ts`
(page.tsx cannot be transformed by the vitest unit project — `jsx: preserve`), with a new test file.
**Two mutations executed**: deleting the guard → 3 failed / 6 passed; reverting to the field-absence
decision → 1 failed / 8 passed, exactly the wholly-corrupt case.

---

## Round 3 — no fix-induced defects

### R3-1 [Minor] — stale barrel comment
`apps/web/src/lib/api-types.ts` opened "This barrel is type-only" three lines above a function
re-export. Inaccurate since C29; this branch made the file itself export one.

### R3-2 [Minor] — a latent test-resolution trap
`apps/web/src/lib/label-kinds.ts` imported through the `@/` alias, which the root vitest project
cannot resolve. It worked **only because that import was type-only and erased before vitest saw
it** — and the module is now reached by the unit-tested `audit-transition.ts`. Any future runtime
import there would have broken an unrelated test file with an error naming the wrong module.

**Resolution**: relative import, matching `csv-export.ts` (the other unit-tested lib module).
**Executed both ways**: with the alias, injecting a runtime import made the suite report *0 tests
run*; with the relative form the same injection leaves all 22 files passing. The trap is removed,
not documented.

---

## Recurring Issue Check

Phase 2's self-R-check ran the full R1-R46 + RS1-RS6 + RT1-RT9 pass across three perspectives and
returned "No findings". Rounds 1-3 were incremental verification on that baseline. Rules that fired
during code review:

- **R42** (class-membership derivation) — fired at FN-F1 (a specified gate absent from the tree),
  R2-1 (member-set bound to spelling, twice).
- **R43** (fix-induced widening) — fired at R2-2 and R2-3, both fixes that re-opened or created a
  problem while closing another.
- **RT7** (a gate must be proven able to fail) — fired at FN-F2, SEC-2, R2-4. Every gate in the
  branch now carries an executed red proof.
- **RT3** (shared constant in tests) — checked clean; `workflow-pins.test.ts`'s SHA literals are
  regex fixtures, not the pinned values (the gate reads those from `ci.yml` at runtime), so a
  Dependabot bump never requires editing the test.
- **R19 / RT9** — re-derived each round; one test tree, no stale parallel copies.
- **R44** — every gate's exit status read unpiped throughout.

---

## Environment Verification Report

Phase 1 declared VE1-VE6. Classification for this branch:

| ID | Constraint | Status |
|---|---|---|
| VE1 | No live Google Workspace tenant | `blocked-deferred`, **untouched** — no contract here crosses the provider boundary |
| VE2 | Compose images carry no source mount | `verified-local` — stack rebuilt (`api`, `web`, `worker`) before each E2E run |
| VE3 | Integration needs Docker | `verified-local` + `verifiable-CI` — 140 passing against Testcontainers |
| VE4 | E2E needs the compose stack | `verified-local` — 43 passing, three separate runs |
| VE5 | ~~No git remote; CI never executed~~ | **RESOLVED in cycle 2**; see the open item below |
| VE6 | E2E login budget 5/5 at 5/min/IP | Respected — no contract added a login (I31.3) |

Per-contract:

| Contract | Path | Status |
|---|---|---|
| C28 | unit (delegation, empty batch) + integration (bulk unmodified, single-account) | `verified-local` |
| C29 | unit (projection domain, LABEL_FILTERS) + integration (`pg_enum`, ordered) | `verified-local` |
| C31 | integration (separate `buildApp`, non-`/api` routes, 4 branches) | `verified-local` |
| C32 | unit (pin shape) + **observed CI run** | shape `verified-local`, resolution `verified-CI` |
| C33 | unit (insert-site member-set) | `verified-local` |

**C32 acceptance criterion 4 (FN-F3) — DISCHARGED.**

The criterion mandated an observed-green CI run with a recorded run id, and the plan classified SHA
*resolution* as `verifiable-CI` **only**, explicitly rejecting parity-by-construction. All four
SHAs had been verified as real commits against the GitHub API during planning and again in review,
and the shape gate covers the pin form — but that is shape, not resolution.

**Observed**: PR [#2](https://github.com/ngc-shj/open-smp/pull/2), run
[`30205663497`](https://github.com/ngc-shj/open-smp/actions/runs/30205663497), all three jobs green.

```
checks          55s   lint 0, typecheck 0, unit 218 passed / 22 files
integration   1m04s   140 passed / 5 files
compose-smoke 2m58s   stack boot + curl gates, e2e 43 passed, seed acceptance bar intact
```

Counts match the local run exactly (218 / 140 / 43), so the pins resolve and the pinned versions
behave as the tags did.

Note the trigger: `ci.yml` fires on `push: branches:[main]` and `pull_request`, so a branch push
alone produces no run — the PR is what discharges this. Recorded because "pushed" and "observed" are
not the same statement, and this criterion exists because that distinction once hid a CI step that
had never executed in its life.

**New, from the observed run — deferred as SC41.** CI emitted a deprecation annotation on all three
jobs: the pinned `actions/setup-node@49933ea5` and `pnpm/action-setup@b906affc` commits target
Node.js 20, which GitHub is deprecating and currently force-runs on Node 24.

This is a direct, expected consequence of C32 — pinning freezes the action version, so a
deprecation that a floating tag would have absorbed now surfaces as a warning the repo owns. It is
the cost the plan named when it brought `dependabot.yml` into scope alongside the pin, and it is
Dependabot's job to clear: the first bump PR will move both to a Node-24 commit.

- **Worst case**: GitHub removes the Node 20 forced-migration shim and the two actions stop running,
  breaking every CI job.
- **Likelihood**: low in the near term — GitHub is force-running them on Node 24 today, so the
  behaviour is already what the upgrade would produce.
- **Cost to fix**: zero engineering; merge the Dependabot PR when it arrives. Doing it by hand now
  would mean re-resolving and re-verifying two SHAs to reach the state the bump path already
  delivers.
- **Owner / trigger**: the first Dependabot bump PR, or immediately if a job starts failing rather
  than warning.

---

## Resolution Status

All 13 findings across three rounds are resolved. Gates at `e75559b`:

```
lint         0
typecheck    0
unit         218 passed / 22 files   (baseline 164 / 16)
integration  140 passed / 5 files    (baseline 135 / 5)
e2e           43 passed              (baseline 43, unchanged by design)
seed gate    green
```

### Tightening-only skip — Round 3
Findings applied directly (no Round 4 review):
- R3-1 [Minor] stale barrel comment — `apps/web/src/lib/api-types.ts:4` — applied
- R3-2 [Minor] alias import resolving only by type-erasure — `apps/web/src/lib/label-kinds.ts:1` —
  applied, with the fix proven by executing the failure both ways

Justification: both findings are scoped within the round-2 fix range, are inline minors (a comment
and an import specifier), and neither touches a security boundary. R3-2 changes no runtime
behaviour — the import is type-only in both forms.

### Process note

Three of the four round-2 findings were defects introduced by the round-1 fixes, and both round-1
Majors were mine. The same ratio appeared in this branch's plan review (roughly 25 of 44 findings
across three rounds). The common shape is visible in R2-1: a gate bound to a *spelling* rather than
to the *property*, written while fixing a gate that had the same flaw. Every gate in this branch
now carries an executed red proof, and the two round-3 findings were caught because the reviewer
ran the failure rather than reading for it.
