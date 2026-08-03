# Plan Review: account-status-domain

Date: 2026-08-03
Review round: 1

## Changes from Previous Round

Initial review. Three experts reviewed revision 1 of
`docs/archive/review/account-status-domain-plan.md` against `main` = `70f61e4`. Local LLM
pre-screening returned "No issues found" before the expert round.

**Critical 1 / Major 7 / Minor 7.** Every finding is against the plan itself — there is no
prior round for them to be against.

## Merged Findings

Deduplicated across the three experts. Where more than one expert reached a finding
independently, that is recorded: perspective convergence is a severity signal, and three of
the four Majors below were reached by two or three experts who could not see each other's
output.

### M1 — Critical (Testing). C5's two render sites have no observer in any tier, and the reason given for skipping E2E is about a different call site.

The change's only user-visible deliverable is the two `<td>` edits (`apps/web/src/app/accounts/page.tsx:135`,
`apps/web/src/app/identities/[identityId]/page.tsx:98`). Every gate that could see them was
traced and none can:

- no jsdom project exists (`apps/web/package.json` carries no jsdom/@testing-library) and both
  pages are async server components that `fetch`, so no unit test reaches the JSX —
  `apps/web/test/link-statuses.test.ts:16-19` records this constraint and it still holds;
- the untranslated-literals text scan is `/>([^<>{}]+)</g` (`apps/web/test/untranslated-literals.ts:110`);
  `{item.accountStatus}` and the proposed IIFE both begin with `{`, so the ratchet reads 0 in
  either state;
- `i18n.test.ts:437`'s orphan detector is satisfied by the key appearing in `ACCOUNT_STATUS_KEYS`
  itself, whether or not a render site reads the map;
- `i18n.test.ts:104` `SITES` is a fixed list and neither page is in it; `page-spec-membership.test.ts:100`
  matches at route level, not cell level;
- E2E: `rg -n "suspended|archived|accountStatus|account_status" e2e/` returns nothing.

So reverting either render site — or both — survives the full suite. That is SC2 Round 6's
shape exactly, and it makes the plan's own mutation obligation ("one mutation per call site")
unsatisfiable by I6.1–I6.5, none of which is downstream of either call site.

**The justification for skipping E2E inverts on checking.** The plan said the idiom is
"identical to `linkStatus`'s, already covered". `linkStatus`'s render is covered — by
`e2e/specs/accounts.spec.ts:27`, `row.getByText(account.chip, { exact: true })`, i.e. by the
tier the plan declines to use. `identityStatus`'s is covered the same way at
`e2e/specs/identity.spec.ts:39`. Every status vocabulary this repo routes through the
dictionary has an E2E pin on its render; `accountStatus` would be the first without one.
"Identical idiom to a covered site" is not coverage of *this* site. The cost argument is also
wrong: `compose-smoke` already boots and already visits both routes.

Verified independently by the orchestrator before acting: `e2e/specs/accounts.spec.ts:20-28`
and `e2e/specs/identity.spec.ts:35-40` read as described.

*Recommended action* — add a per-call-site assertion to `e2e/specs/i18n.spec.ts`, which already
sets the `ja` cookie and already visits both routes. Scope the locator to the account's row;
a bare `getByText('Active', { exact: true })` on the identity page would hit two nodes,
because `identityStatus.active` is already `'Active'` (`messages.ts:65`), and trip Playwright
strict mode — a flake introduced by the fix. Put the expected strings in
`e2e/fixtures/seed-facts.ts` and bind them the way `chip:` is bound
(`apps/web/test/link-statuses.test.ts:179-220`), or the twin drifts (RT9). Note
`scripts/mutate.mjs:82` selects unit/integration only, so the two render-site mutations must
be run by hand against a booted stack.

A jsdom / `renderToStaticMarkup` unit test was considered and rejected under RT2: both pages
are async server components with data fetches, so a unit render would be a rewritten twin of
the page rather than the page.

### M2 — Major (Functionality F2 + Security F1 + Testing F4 — all three experts). Requirement 3 has no observer, and the plan asserts one that does not exist.

C5 claimed `apps/web/test/csv-export.test.ts` "asserts `active` in the emitted CSV and must
stay green unmodified". It does not. `active` appears there exactly twice, at `:42` and `:158`,
both as **fixture input**; no assertion in the file reads the `accountStatus` column. Nor does
E2E — `e2e/specs/accounts.spec.ts:126` asserts the **link** status in the exported row, not the
account status. So translating `csv-export.ts:106` survives every tier, and C5's acceptance
criterion "green with a zero-line diff" is satisfiable by the exact defect Requirement 3
exists to prevent. The C5 forbidden-pattern grep does not cover it either: it scopes to
`apps/web/src/app/`, and `csv-export.ts` is under `apps/web/src/lib/`.

Orchestrator re-derived: `rg -n "accountStatus|'active'|\"active\"" apps/web/test/csv-export.test.ts`
returns `:42` and `:158`, nothing else.

*Recommended action* — add one cell asserting the raw value in the emitted row, and assert the
**literal** `"active"`, not `ACCOUNT_STATUSES[0]`, or the tautology is rebuilt. `'active'` and
the proposed `en` copy `'Active'` differ by case and the CSV cell is quoted exactly, so the
assertion distinguishes both states. Drop the "must stay green unmodified" framing.

### M3 — Major (Functionality F1 + Security F3 + Testing F8 — all three experts). `apps/web/src/lib/api-types.ts` is omitted from the change set, and C3 cannot compile without it.

C3 specifies relative imports — `./api-types` — which resolves to `apps/web/src/lib/api-types.ts`,
a re-export barrel with hand-maintained value (`:24-32`) and type (`:34-60`) blocks. `AccountStatus`
is in neither, and the file appears in no contract, no consumer walkthrough, and not in the
Go/No-Go gate. The barrel's own docstring states the policy as a rule (`:6-9`): "A future value
belongs here too, re-exported rather than imported from `@open-smp/api-types` directly, so this
stays the one place shared types and values cross into the web app" — and it re-exports
`LINK_STATUSES` with no runtime consumer precisely so that "leaving it out is what pushes the
next one into importing `@open-smp/api-types` directly."

So the failure is not merely a missing file: the likely repair by an implementer following C3
literally is the one the barrel exists to prevent. `rg -n "@open-smp/api-types" apps/web/src`
returns only this file today.

Secondarily, C1's consumer walkthrough lists 8 consumers while C2's table has 11 members;
members 9–11 also become importers and appear in no walkthrough row.

*Recommended action* — add `apps/web/src/lib/api-types.ts` to C1's walkthrough and to the change
set, stating the edit: `AccountStatus` into the type block, `ACCOUNT_STATUSES` into the value
block on the same grounds that put `LINK_STATUSES` there. C6's test may import the package
directly (`apps/web/test/link-statuses.test.ts:3` is the precedent; tests are outside `src`).

### M4 — Major (Functionality F4 + Security F4 — two experts). `apps/api/src/routes/licenses.ts:33` is an unrecorded member of SC2's class, and the plan's enumeration method structurally cannot see it.

SC2 recorded `packages/matcher/src/match.ts:16` as the one site where a fourth status is
silently absorbed. There is a second, in raw SQL: `WHERE sa.account_status = 'active'` in
`ROLLUP_SQL`, which defines the `seat` CTE that every downstream count filters — `assigned`,
`unassigned`, `reclaimable`, `reclaimableValue`, `needsReview`, `unlinked`.

The plan's method is why it was missed. Plan §C2 said single-value literals were "Enumerated by
`rg -w 'suspended|archived'` minus the table above; all reviewed". That command cannot see a
site whose only literal is `'active'`, and `licenses.ts:33` contains neither `suspended` nor
`archived` — so it was never in the set the plan claims to have reviewed. **The plan's own
indirect-member scan has the blindness it charges the round-3 regex scanner with.**

The consequence is larger than SC2's matcher case, by the file's own words (`licenses.ts:16-20`):
without that clause `assigned` "overcounts in the direction that HIDES waste, which is the one
direction this feature must not be wrong in." A fourth status is silently excluded from every
seat count with no compile error and no red.

Orchestrator re-derived the class:
`rg -n "accountStatus\s*===\s*'|account_status\s*=\s*'" --glob '!node_modules' --glob '!docs' .`
returns exactly `licenses.ts:33` and `match.ts:16` (plus one prose comment at `licenses.ts:18`).

*Recommended action* — record both sites, state the actual defining primitive for the
single-value subclass, and give SC2 an executable link rather than a doc-remembered trigger:
assert the matcher's outcome for **every** member of `ACCOUNT_STATUSES` rather than three
literals, so a fourth member reds with no decision recorded.

### M5 — Major (Testing F2 + Functionality F5 — two experts). I6.1 is tautological, measured, and its stated red condition is false.

Both experts read `drizzle-orm@0.45.2`'s source rather than reasoning from memory:

```
node_modules/.pnpm/drizzle-orm@0.45.2*/node_modules/drizzle-orm/pg-core/columns/enum.js
  function pgEnum(enumName, input) {
    return Array.isArray(input) ? pgEnumWithSchema(enumName, [...input], void 0) : …
  }
  function pgEnumWithSchema(enumName, values, schema) { … enumValues: values, … }
```

`enumValues` is a verbatim shallow copy. `pgEnum` **cannot** reorder, dedupe, or drop members,
so the plan's argument that I6.1 "is not tautological because `pgEnum` could reorder" is false
as measured — and the row's stated red condition "or the domain is reordered" is unreachable:
once both sides derive, reordering the domain reorders both and I6.1 stays green. Only
re-inlining a literal in `tables.ts` can red it, which C2's forbidden pattern already covers.

Orchestrator confirmed the source read.

*Recommended action* — see M6; the two resolve together.

### M6 — Major (Testing F3). RT3: `packages/schema/test/tables.test.ts:34` is an EXPECTATION, and C2 forces it to be derived from the code under test.

Judging the three test-file members C2 changes:

- member 10 `packages/matcher/test/match.property.test.ts:21` — feeds the account generator;
  every assertion in that file is structural. **Fixture input — safe to derive**, and deriving
  it is a small win (a fourth member gets fed through `match.ts:16` automatically).
- member 11 `apps/api/test/licenses-rollup.integration.test.ts:29` — a field type on a local
  fixture spec consumed as an INSERT parameter. **Fixture input type — safe to derive.**
- member 9 `packages/schema/test/tables.test.ts:34` — `expect(accountStatusEnum.enumValues).toEqual(['active','suspended','archived'])`.
  **An expectation, and the plan got it wrong.**

Once `accountStatusEnum` derives from `ACCOUNT_STATUSES`, that hand-written literal is an
*independent transcription of the authority* (`0001_init.sql:8`) — and the only unit-tier cell
that reds when the domain is reordered without the migration. Deriving it makes it
`[...[...X]] === [...X]`. A test's expectation is not a second declaration of the domain; it is
a check on it, and R42's member-set derivation misclassified it.

Net effect if shipped as written: I1.1 loses its only unit-tier observer and is left with I6.5
alone, which needs a Docker daemon (VE2) — so a developer running `pnpm test` without Docker
gets no signal at all.

*Recommended action* — move member 9 to "non-member by exclusion" alongside member 1, for the
same reason: a transcription of the AUTHORITY, not a copy of the domain. Keep the literal, name
`0001_init.sql:8` as its source in a comment. Then the triple has content:
literal-transcribed-from-migration ↔ derived drizzle enum ↔ real engine. This also disposes of
M5 without leaving `account_status` with no unit-tier cell.

### M7 — Major (Functionality F3). C2's acceptance criterion is arithmetically wrong: the post-image returns 2 hits, not 1.

The new `ACCOUNT_STATUSES` declaration, written the way C1 specifies and the way `LINK_STATUSES`
is written at `packages/api-types/src/index.ts:21-26`, matches the derivation regex itself — the
multi-line frozen-array form fits inside the 40-character window. Orchestrator reproduced it
against a simulated post-image file: it matches.

A correct implementation would therefore red its own acceptance gate, and the cheapest way to
make it pass is to weaken the command — which breaks its ability to catch a real
re-declaration. The criterion also contradicts I2.1 and C2's own forbidden pattern, both of
which already carve out `packages/api-types/src/`.

*Recommended action* — restate as **exactly 2 hits**, both named. With M6 applied it becomes
**3**: the migration, the domain declaration, and the test's transcription.

### M8 — Major (Testing F5). The E2E premise was derived by a check that could not see its subject.

The plan wrote: "Verified: `rg -w 'suspended|archived' e2e/` returns only `active` inside
HR-import CSV fixtures". Two defects, and the second is the recurring class:

1. the command searches for `suspended|archived` and cannot, by construction, return `active` —
   the sentence describes a result the command cannot produce;
2. the only account status in the E2E dataset is `active` (`apps/api/src/seed.ts:202,210,218,226,249`
   write `accountStatus: 'active'` for all five seeded accounts; `suspended` and `archived` are
   never seeded). So the value whose rendering this change alters is precisely the one the grep
   did not search for. **The check was run against two strings that could not appear.**

It reached the right conclusion by luck — re-derived independently, `rg -n "active" e2e/` returns
only HR-import identity-status columns and one comment. But the plan states this command as the
re-check to run at implementation time, where a seed change between plan and implementation
would make it silently wrong.

*Recommended action* — restate as `rg -nw 'active|suspended|archived' e2e/` and record the seed
evidence as the reason the search space is what it is. With M1 applied the check stops being
load-bearing anyway.

### M9 — Minor (Functionality F6 [Adjacent] + Testing F7 — two experts). I6.5 drops two of the three cells its named model carries, and boots a redundant container.

`packages/schema/test/link-status-enum.integration.test.ts` has three cells: the ordered labels
(`:43`), "is this the type the column actually uses" (`:62` — whose own comment says "Without
this, the assertion above would still pass if the column were switched to some other enum that
happens to carry the same labels"), and "rejects a value outside the domain" (`:76`). I6.5
enumerated only the first. Without the `:62` analogue the observer can be looking at a type
nothing uses; without `:76`, I3.1's bounded claim has no executed counterpart and C7's `UPDATE`
step rests on a rejection nothing asserts.

Separately: a new file boots a second Postgres container. The integration project runs files in
parallel with no shared database, so it does not double wall clock — but the three cells belong
in the existing file, sharing one boot. And the mutation proof for I6.5 must be cut on
`ACCOUNT_STATUSES` (reorder, or drop a member), not on the migration, which Requirement 7 makes
immutable — a reader will otherwise look for a mutation the plan forbids.

### M10 — Minor (Testing F6). I6.2 samples nothing new, and the Risks section credits it with coverage it does not have.

`ACCOUNT_STATUS_KEYS`'s values are typed `MessageKey`, so a typo is a compile error, and every
`MessageKey` is already gated to resolve non-empty (`i18n.test.ts:25`) and to differ from `en`
(`i18n.test.ts:49-86`). So mis-wiring `active: 'linkStatus.matched'` **survives** I6.2 — a real
`ja` message that differs from `en` — while the mutation I6.2 does catch reds a pre-existing
cell too. It is blind to the one defect it is uniquely placed to catch.

The Risks section additionally claimed "I6.2's `ja !== en` assertion is the behavioural check"
for the half-applied-change risk. I6.2 never touches a render site; that is M1 restated.

*Recommended action* — fold I6.2 into I6.4's allow side and pin the **exact key per member**
(`expect(accountStatusKeyFor('active')).toBe('accountStatus.active')`, not
`toBe(ACCOUNT_STATUS_KEYS[s])`, which is circular).

For the record, the Testing expert constructed reachable mutations for I6.3 and I6.4's deny
side and both are sound: deleting a map line reds I6.3 (vitest strips types, so the runtime
check is real); replacing the `Object.hasOwn` ternary with `?? null` reds on the five prototype
keys while surviving `''` and `not_a_status` — which is why the prototype keys, not the
empty-ish ones, are load-bearing. Both cut inside `accountStatusKeyFor`, a function with no
shared helper, so the cross-vocabulary sampling hazard does not apply here.

### M11 — Minor (Security F2). The `z.enum` rationale is wrong for the pinned zod, in the direction that understates the plan's own control.

The plan's Risks section said `z.enum` "snapshots its members at construction, so freezing
`ACCOUNT_STATUSES` does not protect `rawAccountSchema`". At `zod@3.25.76`, `ZodEnum` holds a
live reference to `_def.values` and builds its `Set` cache lazily on first parse. Reproduced by
the Security expert:

```
node -e "const {z}=require('zod');const a=['active','suspended','archived'];const s=z.enum(a);a.push('pwned');console.log(s.safeParse('pwned').success)"  # => true
```

with a parse before the push printing `false`, and `Object.freeze(a)` making the push throw.
So the freeze **is** load-bearing on the connector-ingest validator, and an unfrozen array would
widen that validator rather than merely fail the C39 gate. The pre-existing comment at
`packages/api-types/src/index.ts:18-20` carries the same error.

### M12 — Minor (Security F5). C2/C3/C5's forbidden patterns are order-sensitive tripwires presented as an acceptance criterion (R47).

`['suspended','active','archived']`, or `'active'|'suspended'|'archived'` without spaces, or a
union split across lines, is a complete second declaration and is invisible to every one of
them — including "returns exactly 1 hit". Likewise `/ACCOUNT_STATUS_KEYS\[/` misses `?.[x]`,
`Reflect.get`, and a destructure; `/\{item\.accountStatus\}/` misses
`const { accountStatus } = item`. The plan classifies its *observers* honestly (C2 and C3 both
say "not an enforceable boundary") but never classifies the greps, and it is a grep that backs
I2.1. A reordered array is an ordinary refactor, not an adversarial input.

### M13 — Minor (Functionality F7). Three rationale/citation slips.

(a) C5 said the render sites "become the idiom already used three lines below each". It is 8
lines below on `/accounts` and 7 on the identity page, and — the part that matters — it is not
the same shape: the existing sites pass `key ? t(key) : undefined` into `StatusChip`, which does
its own raw-value fallback at `StatusChip.tsx:17` (`{label ?? status}`). The plan's snippet is a
new IIFE in a bare `<td>` doing the fallback inline. An implementer told to follow the precedent
three lines down would produce a different fallback semantic than Requirement 2 asks for.
(b) C3's control-class paragraph says an unresolved value "returns `null`, which **C4** renders
as the raw value" — C4 is the dictionary; C5 is the render.
(c) SC3 names a trigger but no cost of deferring, which the Anti-Deferral format requires and
SC1/SC2 both supply. The cost is measurable: `rg -n "pg_enum" --glob '!node_modules' .` returns
only `link-status-enum.integration.test.ts:52` and `api.integration.test.ts:1613` (for
`account_label_kind`), so a migration adding an identity-status label produces neither a compile
error nor a red.

### M14 — Minor (Testing F9). C7 defers a question that is already answered.

`docs/manual-tests/ui-orphan-list.md:21` covers `/accounts` and lists "account status" in its
column check. C7 deferred "which existing UI doc covers `/accounts`" to implementation time;
naming it now avoids a seventh `docs/manual-tests/ui-*.md` for one column. C5's doc walkthrough
named only `google-workspace-sync.md` and missed this file.

### M15 — Minor (Security, drafting note under R31/RS4). C7's `UPDATE saas_accounts` has no `WHERE`.

Not a hazard in kind — `docs/manual-tests/e2e-howto.md:50-51` already documents a raw
`DELETE FROM account_labels;` against the dev container. But `docs/manual-tests/google-workspace-sync.md:66`
explicitly qualifies its destructive statement as "scoped to the tenant", and `saas_accounts` is
a multi-tenant table whose manual-test docs get copy-pasted. Give it
`WHERE id = '<accountId>'`.

## Adjacent Findings

- Functionality F6 → Testing: I6.5's missing cells (merged into M9).
- Security F1 → Testing: the CSV observer (merged into M2).
- Testing F8 → Functionality: the `api-types.ts` barrel (merged into M3).

All three were independently reported by the expert who owns the scope, which is the
convergence recorded on M2, M3 and M9.

## Verified Clean, With Evidence

Recorded because "no findings" must be earned. Each was checked by the named expert and, where
it drives a decision below, re-derived by the orchestrator.

- **The R42 member set reproduces exactly.** Set A (11 sites) = set B (the plan's table); no
  member in A \ B. Command re-run verbatim by the Functionality expert.
- **The C39 boundary fits without widening.** A frozen array of string primitives satisfies
  `apps/api/test/api-types-boundary.test.ts:101-115`; C1 proposes no `is*` guard, so the
  function branch is not engaged; no import and no dependency are added.
- **The ORM/type-shape spot-check passes at the pinned versions.** drizzle
  `pgEnum<U extends string, T extends Readonly<[U, ...U[]]>>` and zod
  `createZodEnum<U extends string, T extends Readonly<[U,...U[]]>>` both accept
  `Object.freeze([...] as const)`; the two cited precedents (`tables.ts:37`, `accounts.ts:21`)
  really do prove it.
- **The security-relevant citation is accurate.** `tables.ts:33` is a hand-written second
  declaration; `identities.ts:136` is a bare `as` over an unvalidated row;
  `i18n-code-review.md:132-136` says what the plan says it says. The decision to keep the wire
  type `string` rests on a true reason.
- **SC1's deferral is safe, with the trace.** Ingest is `z.enum`-validated then bound as a
  parameter; storage is `account_status NOT NULL` (`0001_init.sql:48`); the read path reaches a
  JSX text node with zero `dangerouslySetInnerHTML` in `apps/web`, and the CSV path goes through
  `neutralizeCell → stripNewlines → quoteCsvCell` unchanged. Keeping `string` plus a guarded
  read is strictly safer than the bare `as` one file away.
- **`Object.hasOwn` is the correct adjudicator, measured.** A bare index returns non-nullish for
  nine prototype members including `__proto__`; `in` returns true for all of them and would have
  been wrong; `Object.defineProperty(Object.prototype, …)` does not defeat `hasOwn`; a Symbol
  key cannot arrive from `JSON.parse` output typed `string`.
- **Requirement 6 holds.** All five packages in C2's table already declare
  `@open-smp/api-types: workspace:*`; no new dependency edge.
- **RT8/RT10 on I6.4 as designed.** Both directions present; the five prototype keys are what
  distinguish `Object.hasOwn` from `?? null`, and `''`/`not_a_status` are correctly present only
  as breadth.
- **RT11.** The integration model boots and stops its own container; nothing outlives the run.
- **Both touched routes already carry `LIST_RATE_LIMIT`** and run under `withTenant`, so there
  is no new rate-limit or cross-tenant surface.

## Quality Warnings

None. The merge quality gate flagged no finding as VAGUE, NO-EVIDENCE, or UNTESTED-CLAIM: every
finding carries a file:line or a reproducing command, and the two that rest on third-party
library behaviour (M5, M11) were resolved by reading `node_modules` source and by executing a
script, not from memory.

## Recurring Issue Check

Preserved verbatim per expert. Not deduplicated — these are the evidence that each check ran.

### Functionality expert

- R1 (Shared utility reimplementation): Checked — no issue (the third copy of *StatusKeyFor is a declared, reasoned R1 acceptance at plan:310-320; the withdrawn-extraction precedent at docs/archive/review/i18n-code-review.md:126 is real)
- R2 (Constants hardcoded): Finding F4
- R3 (Pattern propagation): Checked — no issue
- R4 (Event dispatch gaps): N/A — no events touched
- R5 (Missing transactions): N/A — no writes
- R6 (Cascade delete orphans): N/A
- R7 (E2E selector breakage): Checked — no issue (rg -nw 'suspended|archived' e2e/ = 0; no Active/Suspended/Archived under e2e/; seed-facts.ts keeps status and chip apart)
- R8 (UI pattern inconsistency): Finding F7
- R9 (Transaction boundary for fire-and-forget): N/A
- R10 (Circular module dependency): Checked — no issue (api-types gains no import; C39 gate at api-types-boundary.test.ts:43-61 enforces it)
- R11 (Display group != subscription group): N/A
- R12 (Enum/action group coverage gap): Finding F4
- R13 (Re-entrant dispatch loop): N/A
- R14 (DB role grant completeness): N/A — pg_enum/pg_type are world-readable, already established at docs/archive/review/harden-label-audit-reclaim-deferred-plan.md:452
- R15 (Hardcoded env values in migrations): N/A
- R16 (Dev/CI environment parity): Checked — no issue (VE1/VE2 correct; integration tier gated on Docker in both)
- R17 (Helper adoption coverage): Checked — no issue (C5's forbidden patterns cover apps/web/src/app/; the lib/ gap is F2)
- R18 (Allowlist/safelist sync): Checked — no issue (the untranslated-literals ratchet scans .tsx only, apps/web/test/untranslated-literals.test.ts:42-50, and the new module is .ts; the render-site edits are expressions the text scan cannot cross)
- R19 (Test mock alignment): N/A
- R20 (Multi-statement preservation in mechanical edits): Checked — no issue
- R21 (Subagent completion vs verification): N/A
- R22 (Perspective inversion for helpers): Checked — no issue
- R23 (Mid-stroke input mutation): N/A
- R24 (Migration additive+strict split): N/A — Requirement 7 forbids editing the shipped migration and no new one is proposed
- R25 (Persist/hydrate symmetry): N/A
- R26 (Disabled-state visible cue): N/A
- R27 (Numeric range in user-facing strings): N/A
- R28 (Toggle label grammatical consistency): Checked — no issue
- R29 (Citation/derived-claim/rationale accuracy): Findings F2, F3, F5, F7
- R30 (Markdown autolink footguns): Checked — no issue
- R31 (Destructive ops without confirmation): N/A
- R32 (Runtime-shape boot test): Checked — no issue (api-types/src/index.ts:264 module-init guard is untouched and ACCOUNT_STATUSES adds no key to CONNECTOR_APP_KEYS)
- R33 (CI config cross-config propagation): Checked — no issue (new integration file matches **/*.integration.test.ts in vitest.config.ts:16)
- R34 (Adjacent pre-existing bug deferred): Finding F4
- R35 (Manual test plan for deployed components): Checked — no issue (C7 exists; docs/manual-tests/ui-orphan-list.md:6 is the nearest existing doc and pins the column NAME, not the value, so no edit is forced)
- R36 (Suppression or markerless weakening): Checked — no issue
- R37 (Internal jargon in user-facing strings): Checked — no issue
- R38 (Async/persisted state machine): N/A
- R39 (Lifecycle secret zeroization): N/A
- R40 (Cross-boundary serialization vs strict consumer): Checked — no issue (wire type stays string; the rationale at plan:93-111 verified against apps/api/src/routes/accounts.ts:48-50 and apps/api/src/routes/identities.ts:136)
- R41 (Declared capability without backing path): Finding F1
- R42 (Class-membership derivation): Finding F4 (the direct 11-member set reproduces exactly; the single-value subclass does not)
- R43 (Fix-induced security-boundary widening): N/A — Security expert's scope
- R44 (Gate exit status through a lossy channel): Checked — no issue (plan:536-537 explicitly requires exit status, never a pipe)
- R45 (Repo-wide gate scaling): Checked — no issue
- R46 (Scope-blind binding resolution): Finding F1
- R47 (Surface-form adjudication): Finding F4 (the single-value enumeration is a surface-form scan that cannot see its own subject); C3's Object.hasOwn adjudication is correctly declared
- R48 (Parallel adjudicators): Checked — no issue
- R49 (Undeclared control class / overstated claim): Finding F2 (C5 claims a closure csv-export.test.ts does not have); F5. C1/C2/C4/C5 correctly declare "not applicable" and C3 correctly declares fail-closed-gate-not-boundary with its adjudication authority.
- R50 (Verification preconditions unverified): Finding F3
- R51 (Decision bound to a name): Checked — no issue
- R52 (Control reach extended without re-audit): Checked — no issue (C39 is fitted, not widened; a frozen string array passes api-types-boundary.test.ts:101-115 unchanged)
- R53 (Threshold without headroom measurement): N/A
- R54 (Control suspension via ambient state): N/A
- R55 (In-band sentinel collision): Checked — no issue (accountStatusKeyFor returns null, distinct from every MessageKey)
- R56 (Progress-marker heal direction): N/A
- R57 (Ordering/cursor key without total order): N/A

### Security expert

- R1 (Shared utility reimplementation): Checked — no issue. C3's third copy of the three-line key-lookup is an explicit, reasoned R1 acceptance (plan 310-320); the withdrawn-extraction precedent it cites is real.
- R2 (Constants hardcoded): Checked — no issue. C2 removes 10 of 11 hardcoded spellings; the 11th is the shipped migration, correctly excluded.
- R3 (Pattern propagation): Finding F2 — the incorrect z.enum claim would be copied from packages/api-types/src/index.ts:18-20 into a second site.
- R4 (Event dispatch gaps): N/A — no event path touched.
- R5 (Missing transactions): N/A — no write path added.
- R6 (Cascade delete orphans): N/A.
- R7 (E2E selector breakage): Checked — no issue. rg -w 'suspended|archived' e2e/ confirms no spec pins a rendered account status; C5's walkthrough is accurate.
- R8 (UI pattern inconsistency): Checked — no issue. The C5 idiom is identical to the adjacent linkStatus render at accounts/page.tsx:143-147.
- R9 (Transaction boundary for fire-and-forget): N/A.
- R10 (Circular module dependency): Checked — no issue. Arrow points api-types -> everything; api-types has zero dependencies (gate :63-70).
- R11 (Display group != subscription group): N/A.
- R12 (Enum/action group coverage gap): Finding F4.
- R13 (Re-entrant dispatch loop): N/A.
- R14 (DB role grant completeness): N/A — no new object.
- R15 (Hardcoded env values in migrations): N/A — Requirement 7 forbids editing the migration.
- R16 (Dev/CI environment parity): Checked — no issue. VE1-VE3 classify every contract verifiable-local and verifiable-CI.
- R17 (Helper adoption coverage): Checked — no issue. Both render sites converted; rg -n accountStatus over apps/web/src/app returns exactly the two lines C5 names (:135, :98).
- R18 (Allowlist/safelist sync): Finding F3 — apps/web/src/lib/api-types.ts's re-export list is the crossing-point allowlist and is not synced.
- R19 (Test mock alignment): N/A.
- R20 (Multi-statement preservation): N/A.
- R21 (Subagent completion vs verification): N/A.
- R22 (Perspective inversion for helpers): Checked — no issue. accountStatusKeyFor(status: string) takes the value, not the map; the inverted signature is what C3 explicitly withdraws.
- R23 (Mid-stroke input mutation): N/A.
- R24 (Migration additive+strict split): N/A.
- R25 (Persist/hydrate symmetry): N/A.
- R26 (Disabled-state visible cue): N/A.
- R27 (Numeric range in user-facing strings): N/A.
- R28 (Toggle label grammatical consistency): N/A.
- R29 (Citation/derived-claim/rationale accuracy): Findings F1, F2. The security-critical citation (identityStatusEnum / bare as) verified ACCURATE against tables.ts:33, identities.ts:136, and i18n-code-review.md:132-136.
- R30 (Markdown autolink footguns): Checked — no issue.
- R31 (Destructive ops without confirmation): Checked — see RS4 note: C7's UPDATE saas_accounts should carry a WHERE id = ... the way google-workspace-sync.md:66 does.
- R32 (Runtime-shape boot test): Checked — no issue. api-types-boundary.test.ts:75-117 sweeps Object.entries(apiTypes) at runtime and will see ACCOUNT_STATUSES automatically.
- R33 (CI config cross-config propagation): Checked — no issue. I6.5 lands in the integration project alongside link-status-enum.integration.test.ts; no CI config change needed.
- R34 (Adjacent pre-existing bug deferred): Checked — SC1/SC2/SC3 each carry a trigger and a cost; F4 notes SC2 is short one site and its trigger is not executable.
- R35 (Manual test plan for deployed components): Checked — no issue. C7 exists and states its own unreachable case honestly.
- R36 (Suppression or markerless weakening): Checked — no issue. No eslint-disable, no @ts-expect-error, no `as any` proposed.
- R37 (Internal jargon in user-facing strings): Checked — no issue. 有効 / 停止中 / アーカイブ済み are ordinary Japanese.
- R38 (Async/persisted state machine): N/A.
- R39 (Lifecycle secret zeroization): N/A — no credential path (VE3).
- R40 (Cross-boundary serialization vs strict consumer): Checked — no issue. The wire type stays string; no consumer narrows with .strict() on this field.
- R41 (Declared capability without backing path): Finding F1.
- R42 (Class-membership derivation): Finding F4 (indirect-member list short by one). The 11-member Set A itself re-run and confirmed exact.
- R43 (Fix-induced security-boundary widening): Checked — no issue. C1 fits the C39 allowlist unchanged; no gate relaxation proposed.
- R44 (Gate exit status through a lossy channel): Checked — no issue. Plan line 536-537 requires each gate read by its own exit status, never through a pipe.
- R45 (Repo-wide gate scaling): Checked — no issue. The C39 gate globs packages/api-types/src/**, unaffected by one added constant.
- R46 (Scope-blind binding resolution): Checked — no issue.
- R47 (Surface-form adjudication): Finding F5.
- R48 (Parallel adjudicators): Checked — no issue. I6.1 (drizzle vs domain) and I6.5 (engine vs domain) are deliberately paired and the plan states the resolution if I6.1 proves tautological (plan 495-497).
- R49 (Undeclared control class / overstated claim): Finding F1; F2 is the rarer inverse (an understated control).
- R50 (Verification preconditions unverified): Checked — no issue. Requirement 6's "every package already declares `@open-smp/api-types`" verified independently for schema, connectors-core, matcher, worker, api, web.
- R51 (Decision bound to a name): Checked — no issue.
- R52 (Control reach extended without re-audit): Checked — no issue.
- R53 (Threshold without headroom): N/A.
- R54 (Control suspension via ambient state): N/A.
- R55 (In-band sentinel collision): Checked — no issue. accountStatusKeyFor returns null, not an in-band string; the raw-value fallback cannot collide with a MessageKey.
- R56 (Progress-marker heal direction): N/A.
- R57 (Ordering/cursor key without total order): N/A — the ORDER BY sa.id cursor is untouched.
- RS1 (Timing-safe comparison): N/A — no secret compared.
- RS2 (Rate limiter on new routes): N/A — no new route; both touched routes already carry LIST_RATE_LIMIT (accounts.ts:91, identities.ts:67).
- RS3 (Input validation at boundaries): Checked — no issue. Two independent validators (z.enum at ingest, the account_status column type at 0001_init.sql:48) plus a guarded read; SC1's deferral assessed as safe with evidence.
- RS4 (Personal-identifying data in committed artifacts): Checked — no issue. One drafting note on C7's unscoped UPDATE.
- RS5 (Untrusted externally-supplied security parameter): Checked — no issue. Connector-supplied accountStatus is z.enum-validated before it reaches storage.
- RS6 (Incomplete sanitization / escape ordering): Checked — no issue. csvField's neutralize->strip->quote order (csv-export.ts:40-47) is preserved; the render path is a React text node with zero dangerouslySetInnerHTML in apps/web.

### Testing expert

- R1 (Shared utility reimplementation): Checked — no issue (the third copy of *StatusKeyFor is argued from a withdrawn extraction, plan:310-320)
- R2 (Constants hardcoded): Checked — no issue
- R3 (Pattern propagation): Finding F1
- R4 (Event dispatch gaps): N/A — no events touched
- R5 (Missing transactions): N/A — no writes
- R6 (Cascade delete orphans): N/A
- R7 (E2E selector breakage): Finding F5 (and the 'Active' strict-mode hazard noted in F1's recommendation)
- R8 (UI pattern inconsistency): Checked — no issue (follows the linkStatus idiom at both sites)
- R9 (Transaction boundary for fire-and-forget): N/A
- R10 (Circular module dependency): N/A — api-types is a leaf, gated by apps/api/test/api-types-boundary.test.ts:43
- R11 (Display group != subscription group): N/A
- R12 (Enum/action group coverage gap): Checked — no issue (packages/matcher/src/match.ts:16 recorded as SC2 with a trigger)
- R13 (Re-entrant dispatch loop): N/A
- R14 (DB role grant completeness): N/A
- R15 (Hardcoded env values in migrations): N/A — no migration
- R16 (Dev/CI environment parity): Finding F3 (I1.1's only surviving observer needs a local Docker daemon)
- R17 (Helper adoption coverage): Finding F1
- R18 (Allowlist/safelist sync): Checked — no issue (NOT_COPY untouched; pinned by exact equality at apps/web/test/untranslated-literals.test.ts:93-97)
- R19 (Test mock alignment): N/A — no mocks in scope
- R20 (Multi-statement preservation): N/A
- R21 (Subagent completion vs verification): N/A
- R22 (Perspective inversion for helpers): Checked — no issue
- R23 (Mid-stroke input mutation): N/A
- R24 (Migration additive+strict split): N/A
- R25 (Persist/hydrate symmetry): N/A
- R26 (Disabled-state visible cue): N/A
- R27 (Numeric range in user-facing strings): N/A
- R28 (Toggle label grammatical consistency): N/A
- R29 (Citation/derived-claim/rationale accuracy): Findings F2, F4, F5
- R30 (Markdown autolink footguns): N/A
- R31 (Destructive ops without confirmation): N/A
- R32 (Runtime-shape boot test): Checked — no issue (I6.5 is that test, modelled correctly)
- R33 (CI config cross-config propagation): Checked — no issue (a new *.integration.test.ts in packages/schema/test/ is auto-collected and already inside that package's typecheck program, per the CI gate at .github/workflows/ci.yml:40-66)
- R34 (Adjacent pre-existing bug deferred): Checked — no issue (SC1-SC4 each carry a trigger and a cost)
- R35 (Manual test plan for deployed components): Finding F9
- R36 (Suppression or markerless weakening): Finding F3
- R37 (Internal jargon in user-facing strings): N/A
- R38 (Async/persisted state machine): N/A
- R39 (Lifecycle secret zeroization): N/A
- R40 (Cross-boundary serialization vs strict consumer): N/A
- R41 (Declared capability without backing path): Findings F2, F4
- R42 (Class-membership derivation): Findings F3, F5
- R43 (Fix-induced security-boundary widening): N/A
- R44 (Gate exit status through a lossy channel): Checked — no issue (plan:536-537 reads each gate by exit status)
- R45 (Repo-wide gate scaling): Checked — no issue
- R46 (Scope-blind binding resolution): N/A
- R47 (Surface-form adjudication): Checked — no issue (Object.hasOwn named as the adjudication authority, plan:342-344)
- R48 (Parallel adjudicators): N/A
- R49 (Undeclared control class / overstated claim): Findings F2, F6
- R50 (Verification preconditions unverified): Finding F5
- R51 (Decision bound to a name): N/A
- R52 (Control reach extended without re-audit): N/A
- R53 (Threshold without headroom): N/A
- R54 (Control suspension via ambient state): N/A
- R55 (In-band sentinel collision): Checked — no issue (null sentinel, raw-value fallback, no collision with a MessageKey)
- R56 (Progress-marker heal direction): N/A
- R57 (Ordering/cursor key without total order): N/A
- RT1 (Mock-reality divergence): N/A — no mocks
- RT2 (Testability verification): Checked — no issue (a jsdom unit render of the two pages was considered and rejected as untestable; F1 routes to E2E instead)
- RT3 (Shared constant in tests): Finding F3
- RT4 (Race-test vacuous-pass guard): N/A
- RT5 (Test call-path includes the production primitive): Finding F1
- RT6 (New production exports without test diff): Checked — no issue for the four lib exports; the render sites are F1
- RT7 (New guard must be proven able to fail): Findings F1, F2, F6
- RT8 (Vacuous denial-path test): Checked — no issue (the five prototype keys distinguish Object.hasOwn from ?? null; '' and not_a_status do not, and are correctly present only as breadth)
- RT9 (Parallel-implementation twin drift): Checked — no twin exists today (e2e/fixtures/seed-facts.ts carries no account-status field); F1's recommended E2E fixture would create one and must be bound the way chip: is
- RT10 (Guard tested only on its deny side): Finding F6 (I6.4 pairs both directions, but the allow side must pin the exact key per member)
- RT11 (Test fixture outlives its own run): Checked — no issue; see F7 for the avoidable second container boot


---

# Round 2 (incremental)

Date: 2026-08-03
Review round: 2

## Changes from Previous Round

Revision 2 of the plan: the observer set rebuilt from five to seven with a mutation table, two
E2E cells added, the CSV claim withdrawn and replaced, the web barrel added to the change set,
`licenses.ts:33` recorded, `tables.test.ts:34` reclassified as a non-member, the `z.enum`
rationale corrected, the forbidden-pattern greps reclassified as tripwires, and one observer
deleted (the per-member `ja !== en` cell, covered by `i18n.test.ts:49`).

**Critical 0 / Major 6 / Minor 15.** Every Round 1 finding is RESOLVED or PARTIAL — none was
ignored and none regressed into a worse state than it started. **Every new finding is against
revision 2's own fixes.** That is the pattern the i18n and SC2 reviews both recorded: the fix
rate feeds the finding rate, so the loop converges when the changes stop, not on its own.

Round 1 dispositions, as the experts filed them: M1 RESOLVED · M2 RESOLVED (×3 experts) ·
M3 RESOLVED/PARTIAL · M4 member RESOLVED, method PARTIAL · M5+M6 RESOLVED, with a successor
defect · M7 RESOLVED · M8 RESOLVED · M9 RESOLVED · M10 RESOLVED · M11 RESOLVED in substance ·
M12 PARTIAL · M13 (a)(b) RESOLVED, (c) resolved with a new slip · M14 RESOLVED · M15 RESOLVED.

## Merged Findings

### N1 — Major (Testing F1 + Functionality F1 — two experts). I6.1's first red condition is false, and the first mutation row is unsatisfiable.

I6.1 compares `accountStatusEnum.enumValues` against a hand-written literal. Re-inlining **that
same literal** in `tables.ts` produces identical `enumValues`, so the assertion stays green — and
the Functionality expert proved it without running the mutation: **the post-mutation state IS
`main`**, where `tables.ts:38-42` already holds the inline literal and `tables.test.ts:34`
already asserts it.

```
pnpm exec vitest run --project unit packages/schema/test/tables.test.ts
→ Test Files 1 passed (1) | Tests 5 passed (5)
```

So I2.2 ("`accountStatusEnum` is built from `ACCOUNT_STATUSES` rather than a literal (I6.1)")
names an observer structurally blind to it — R41, the same shape as Round 1's M5. And the only
things that would catch a re-inlined `tables.ts` are the C2 forbidden pattern and the post-image
hit count, **both of which the same revision demoted** to "tripwire, not enforcement" and "review
aid, not a gate". Revision 2's fix moved the enforcement gap rather than closing it.

*Resolution in revision 3*: I6.8 added — a source-text read modelled on the in-repo precedent
`apps/api/test/accounts-query-domain.test.ts:21-34`, whose own comment states the reason
value-equality cannot see re-inlining. I6.1's red condition narrowed to the reorder/drop case;
mutation row 1 repointed at I6.8 and a second row added for the reordered-literal case.

### N2 — Major (Security F1). SC2's "executable link" does not red. Measured, not read.

Revision 2 replaced Round 1's doc-remembered trigger with "member 10 derives the matcher property
test's generator from `ACCOUNT_STATUSES`, so a fourth member is fed through `match.ts:16`
automatically and the test reds". The Security expert replayed the three assertions against the
real `matchAccounts` with a fourth member `'pending'`:

```
size=10:  'pending' accounts=2  outcomes= [ 'matched' ]
size=50:  'pending' accounts=12 outcomes= [ 'matched', 'orphan' ]
size=200: 'pending' accounts=50 outcomes= [ 'matched', 'orphan' ]
RESULT: all three property assertions stay GREEN with a 4th status
```

The reason is structural, and the orchestrator confirmed it by reading
`packages/matcher/src/match.ts:8-17`: `deriveStatus` runs only after a rule has already produced
a hit, so a fourth status yields `status: 'matched'` with a **non-null** `identityId` — which
satisfies "identityId is null iff status is orphan or ambiguous"
(`match.property.test.ts:81-86`). The other two cells are a length check and a determinism check.

**An unbacked trigger is worse than the doc-remembered one it replaced, because it retires the
reviewer's attention.** This is the round's most useful finding: it is the only one that could
not have been reached by reading.

*Resolution in revision 3*: I6.9 — `deriveStatus` asserted against a **total**
`Record<AccountStatus, 'ghost' | 'matched'>` exercised with a `left` identity, so a fourth member
is a missing key and a compile error. That is the idiom C3 already uses for
`Record<AccountStatus, MessageKey>`, and unlike a generator it cannot pass by defaulting.

### N3 — Major (Security F2). The executable link covers one of SC2's two sites.

`apps/api/src/routes/licenses.ts:33` gets nothing. C2 member 11 makes
`licenses-rollup.integration.test.ts:29` `status: AccountStatus` — a **type widening on a fixture
field**, and widening a union forces no test to add a case (the file's only non-`active` seat
case is `so-suspended` at `:194`, hand-written).

Verified end to end against `ROLLUP_SQL` (`licenses.ts:26-73`): the `seat` CTE at `:27-37` is the
sole source for `assigned` (`:49`), `ghost`/`orphan` (`:50-51`), `needs_review` (`:52`),
`unlinked` (`:53`), `unassigned` (`:60`) and `reclaimable_value` (`:64-66`). A fourth status
drops out of **every** figure `/licenses` produces.

*Resolution in revision 3*: **not closed, and stated as not closed.** SC2 now says plainly that
the two sites are not equally covered, gives the licences half its full cost, and names why the
executable form is out of scope (one seeded account per member in an integration test is a
rollup-semantics change, not a domain derivation). One link is not allowed to stand for two
sites.

### N4 — Major (Testing F3 + Functionality F3 — two experts). The prescribed RT9 fixture binding cannot keep "the same shape".

C6 said to bind the ja strings "with a text-parsing cell of the same shape" as
`apps/web/test/link-statuses.test.ts:179-220`. Four legs; two do not transfer:

- `expect(new Set(parsed statuses)).toEqual(new Set(LINK_STATUSES))` — under VE6 the fixture can
  only ever carry `active`, so a literal copy reds on arrival. **And this leg is what makes the
  derived count non-vacuous**: if the field is deleted from every entry, `pairs.length` is 0 and
  the derived count is 0, so `0 === 0` passes and the cell asserts nothing — the exact "floored"
  failure the model's comment at `:205-207` records as already paid for once.
- `expect(chip).toBe(translate('en', key))` — every existing `chip:` holds `en`; the new field
  holds `ja` (有効). A reader assuming symmetry writes `'Active'`, which under the `ja` cookie
  asserts nothing.

So the instruction is unsatisfiable as written, with a silent-weakening repair path.

*Resolution in revision 3*: the substitute guard is spelled out — a floor derived from the
fixture's own `email:` count so deleting the field everywhere reds, a subset check against
`ACCOUNT_STATUSES` plus non-empty, and `translate('ja', …)` — with one line saying the
set-coverage leg is deliberately not carried over and why.

### N5 — Major (Functionality F2). The replacement enumeration primitive was declared "the correct" one with no statement of what it cannot see.

C2 charged revision 1's scan with a structural blindness and replaced it with a second ordered
surface-form scan, introduced as "**The correct** defining primitive" — while the same revision
labels every other grep in the plan a tripwire. Its own blind spots: `!==`/`!=`/`<>`,
`IN (…)`/`NOT IN`/`= ANY(…)`, a bound parameter, a `switch`/`case`, loose `==`, a double-quoted
literal, a comparison through an intermediate variable, and — most plausibly, given the file it
was written to catch — an aliased CTE column, which `licenses.ts:30` already does for
`al.status::text AS link`.

Both experts then did the work the plan should have: the Functionality expert swept all 32 files
containing the identifier, and the Security expert all 59 occurrences plus targeted sweeps for
every alternate form, RLS policies, views and partial indexes. **The result is correct today** —
no site is missing. The finding is the claim, not the answer.

*Resolution in revision 3*: the blind spots are enumerated in C2, the hand-sweep that closed them
is recorded, and SC2's completeness is classified as **measured at plan time**, not enforced.
The third hit (the prose comment at `licenses.ts:18`) is now named.

### N6 — Major (Testing F2). I6.2 was ordered equality where its named model sorts, so mutation rows 2 and 3 both red the same three observers.

`toEqual` on arrays is order-sensitive and `Object.keys` returns the map's insertion order. So
reordering the domain reds I6.1, I6.4 **and I6.2**; dropping a member reds I6.2, I6.4 **and
I6.1**. Neither row discriminates, and the table's attribution is wrong in both directions.

Worse, order-sensitive I6.2 is a **third adjudicator of declaration order** (R48) whose authority
is a hand-written map's key order — which has no relationship to `0001_init.sql:8`. Reordering
three lines of `ACCOUNT_STATUS_KEYS`, a cosmetic edit, would red it with no defect present. The
named model, `link-statuses.test.ts:118`, sorts **both** sides for exactly this reason.

*Resolution in revision 3*: both sides sorted; order left to I6.1 and I6.4; the mutation table
now names, for each mutation, **every** observer it reds rather than only the intended one.

### N7 — Minor (Functionality F8 + Security F6 — two experts). The tripwire reclassification stopped one contract short, and I2.1 was left with nothing enforcing it.

C5 labels its patterns tripwires and then, two lines later, makes them an acceptance criterion —
the same sentence C2 retracted. And I2.1 stayed `(app-enforced)` after the grep that backed it
was demoted; neither I6.1 (values) nor I6.4 (engine) can see a surviving second declaration
elsewhere, and one at `packages/connectors/core/src/index.ts:19` would sit at the ingest boundary
where the type would refuse a fourth member `z.enum(ACCOUNT_STATUSES)` accepts.

*Resolution in revision 3*: C5's criterion demoted; I2.1 re-labelled review-enforced, with the
weaker-but-real compiler-backed property named in its place.

### N8 — Minor (Testing F4 + Functionality F9 — two experts). I6.5's locator premise.

`apps/web/src/app/accounts/page.tsx:59` resolves an unrecognised `?status=` to `'orphan'`, so a
bare `goto('/accounts')` renders only the two orphan-linked accounts — while the only email
`i18n.spec.ts` carries is `SEEDED_ACCOUNTS.matched.email` (`:72`), which is not on that tab. An
implementer following the nearest precedent gets a locator that times out. I6.6's placement was
also unstated: the identity page renders under `ja` today only inside "the control switches the
language" (`i18n.spec.ts:79-84`).

*Resolution in revision 3*: `?status=matched` and `SEEDED_ACCOUNTS.matched` named; I6.6 given its
own test and its own `ja` navigation. Row addressability confirmed by an existing spec —
`identities/[identityId]/page.tsx:97` renders the email and `identity.spec.ts:28` already scopes
by it.

### N9 — Minor (Security F5). The freeze protects `z.enum` only by reference identity, and the repo already contains the shape that defeats it.

`z.enum([...ACCOUNT_STATUSES])` typechecks identically, satisfies C39 (which sweeps the package's
exports, not call sites), passes every proposed observer, and silently discards the control
revision 2 had just promoted to load-bearing. C1's forbidden pattern is scoped to the
declaration and does not see it. **`apps/api/src/label-kinds.ts:15` is exactly that shape
already** — `export const LABEL_FILTERS = [...ACCOUNT_LABEL_KINDS, 'none', 'any'] as const`
feeding `z.enum(LABEL_FILTERS)` — so the spread is a local idiom and the likely mistake, not the
adversarial one. And the exposure is **new**: `raw-account.schema.ts:7` today passes an
unreachable inline literal; C2 replaces it with a reachable exported reference.

*Resolution in revision 3*: C1's walkthrough and C2 member 4 both say "by reference"; I6.10 added
— `expect(rawAccountSchema.shape.accountStatus._def.values).toBe(ACCOUNT_STATUSES)`, `toBe` not
`toEqual`, since a copy passes the latter and fails the former. `label-kinds.ts:15` recorded as
SC6.

### N10 — Minor (Security F3). SC2's quotation was about a different clause, in the wrong direction.

The quote from `licenses.ts:16-20` is verbatim-accurate; its subject is not. That comment opens
"Why the watermark exists at all" and the clause whose absence makes `assigned` overcount is the
sync watermark at `:34-36`, not `account_status = 'active'` at `:33`. The imported direction is
also inverted: removing the watermark **over**counts `assigned` (hides waste); a fourth status
**under**counts it, which is the safe direction. The genuinely unsafe movement is in
`reclaimable`/`reclaimableValue`/`needsReview`.

*Resolution in revision 3*: the watermark cited at `:34-36`; the fourth-status consequence stated
through `ROLLUP_SQL:49-66`.

### N11 — Minor (Security F4). The corrective comment edit fixes half of what is wrong, and the plan's blanket phrasing invites a symmetric "fix" of a comment that is already right.

`packages/api-types/src/index.ts:16-20` carries two errors. Revision 2 named the `z.enum` one.
The other: the comment sits on `LINK_STATUSES`, presents the freeze as speculative ("if one is
added here later"), and cites `isAccountLabelKind` — a guard over a **different** array — as its
model, while `LINK_STATUSES` has a live consumer today at `apps/api/src/routes/accounts.ts:21`.
Meanwhile the `ACCOUNT_LABEL_KINDS` comment at `:84-89` is **correct on both counts** and needs
no edit.

*Resolution in revision 3*: both errors named, the rewrite scoped, and `:84-89` explicitly marked
as correct and untouched.

### N12–N21 — Minor, applied

- **N12** (Functionality F5) — SC3's `pg_enum` command returns 20+ hits, not two. It was imported
  unchecked from Round 1's own recommendation, which is the M8 class the same revision spent a
  paragraph correcting. Fixed: `--glob '!docs'` added, result restated as four hits of which two
  are comments.
- **N13** (Functionality F6, + a Security note) — the zod probe fails from the repo root with
  `MODULE_NOT_FOUND`; pnpm's isolated layout hoists no `zod`. Fixed: `cd packages/connectors/core`
  stated. Both experts reproduced all three variants there.
- **N14** (Functionality F4) — the barrel's **value**-block half has no observer, and C1
  attributed C3's dependency to it rather than to the type export. Fixed: the two halves split,
  the type half marked compile-enforced and the value half review-enforced-with-no-observer.
- **N15** (Functionality F7) — the tripwire's carve-out was directory-wide while I2.1's was one
  line. Member 9's reason ("an expectation is a check on the domain, not a copy") is sound for an
  `expect(…)` argument and not for a module-scope `const` in a sibling test file. Fixed: narrowed
  to `tables.test.ts` and bound to the expression position.
- **N16** (Functionality F10) — the corrective comment edit lived only in the Risks section: no
  contract, no changed-file statement, nothing reds if skipped. Fixed: moved into C1's file list.
- **N17** (Testing F5) — I6.7's substring match is **not** vacuous (both experts enumerated every
  cell the fixtures produce; nothing else emits `"active"`), but it does not pin which column
  carries the value, and `CSV_HEADER` (`csv-export.ts:73-88`) and the `fields` array (`:102-117`)
  are unchecked parallel lists. Fixed: located through the header, the way `cellFor` does at
  `:311-316`.
- **N18** (Testing F6) — `e2e/fixtures/seed-facts.ts` has a **second** parser,
  `apps/api/test/seed-gate-agreement.test.ts:55-59`, whose greedy `[^}]*` before a case-sensitive
  `status:` would capture a field named `account_status:` as the *link* status for every entry
  and red an unrelated gate in `apps/api`. Fixed: added to C5's walkthrough with the camelCase
  constraint stated.
- **N19** (Testing F7 + Security F7 — two experts) — C7's two `en` observations cannot fail (the
  title-case trap the plan's own Risks section describes), `ui-orphan-list.md:3-8` declares
  "nothing here is manual-only", and the write had scoping but no restore. The repo's two
  existing destructive manual steps both announce destruction in their heading and are
  *reversals*. Flipping a seeded account to `suspended` reds
  `e2e/scripts/assert-seed-preserved.sh`'s `assert_license 'google-workspace' 'assigned' '4'`.
  Fixed: heading that announces the write, placement after step 8, mutation + inverse + re-seed
  in one block, header corrected, `en` pair marked confirmatory.
- **N20** (Testing F8) — VE6's "the other two are covered on the unit tier only" claimed render
  coverage the unit tier cannot provide (VE5 says so two rows above). The honest argument is
  stronger: the render site is one member-agnostic expression, so pinning one member exercises it
  for all three. Fixed as worded.
- **N21** (Testing F9) — I6.4's "renamed or given a second `describe`" left three citations at
  risk (`tables.test.ts:26-28`, SC3, SC5), and the I6.1 row said "(unchanged)" while requiring a
  comment. Fixed: filename kept, second `describe`, row corrected to "comment added".

## Adjacent Findings

Functionality F1 → Testing (observer construction); Functionality F3 → Testing (fixture design);
Functionality F6 → Security (the zod claim itself); Functionality F9 → Testing (spec placement);
Testing F8 → Functionality (the barrel). Each was independently reported by the expert who owns
the scope, which is the convergence recorded on N1, N4, N7, N8 and N13.

## Verified Clean, With Evidence

- **R42 set A = set B for both commands**, re-derived independently by two experts. The primary
  command returns exactly the 11 table members; the single-value command's two decision sites are
  complete after a hand sweep of all 59 occurrences plus `!=`/`<>`/`IN`/`ANY`/`CASE`/`FILTER`,
  every RLS policy (all eight key on `tenant_id` alone), every view (none exist) and every partial
  index (the only one is unrelated).
- **The deleted observer was safely deleted.** `apps/web/test/i18n.test.ts:49-86` is exact-set
  equality over every key of the default locale against a one-element allowlist, with a `>100` key
  floor — not a sample. The per-member `ja !== en` cell it replaced could only red where this
  already reds.
- **No Playwright cookie leak.** `use.storageState` gives each test a fresh context from the file;
  `context.addCookies` never writes back, so the existing `try/finally` is belt-and-braces.
- **有効 is unique on both target pages.** The only other occurrence in the dictionary is
  `saasapp.invalidJson` (`messages.ts:489`), which renders on `/apps`.
- **Row addressability is proven by an existing spec** — `identity.spec.ts:28` already uses
  `getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.matched.email) })` against the same table.
- **VE4, VE5, VE6 all re-derived** by both the Testing and Functionality experts, independently.
- **`pgEnum` is a verbatim order-preserving copy** at the pinned `drizzle-orm@0.45.2`; **`zod`
  3.25.76 stores `_def.values` by reference and caches lazily**, both read from `node_modules`
  source and both executed.
- **The new browser-bundle surface is nil.** `@open-smp/api-types` already ships to the client
  (`SourceFilter.tsx:3`, `label-filters.ts:4`), including its module-init throw; the added payload
  is three lowercase ASCII strings already present in the rendered DOM and every CSV export.
- **SC5's cost claim holds under execution**: of the seven order-sensitive `LINK_STATUSES`
  comparisons in the tree, `link-status-enum.integration.test.ts:59` really is the only one
  comparing the domain's order to an independent authority.
- **I6.3's deny side is sound**: the five prototype keys distinguish `Object.hasOwn` from
  `?? null`; `''` and `not_a_status` do not, and are correctly present only as breadth.
- **`LIST_RATE_LIMIT` is 240/min** and both new E2E cells reuse `storageState`, so neither the
  page-load nor the login budget is a flake source.

## Quality Warnings

None. Every finding carries a file:line or a reproducing command, and the two that could not be
settled by reading — N1 and N2 — were settled by **executing** the existing suite and by
replaying the property assertions against a fourth member.

## Recurring Issue Check

Preserved verbatim per expert.

### Functionality expert

- R1 (Shared utility reimplementation): Checked — no issue (C3's third-copy argument and the withdrawn-extraction precedent are unchanged and still true)
- R2 (Constants hardcoded): Checked — no issue (C2 removes 9 of 11 spellings; the two exclusions are the migration and the test transcription)
- R3 (Pattern propagation): Finding F10
- R4 (Event dispatch gaps): N/A — no events touched
- R5 (Missing transactions): N/A — no writes
- R6 (Cascade delete orphans): N/A
- R7 (E2E selector breakage): Findings F3, F9
- R8 (UI pattern inconsistency): Checked — no issue (C5 now states the shape difference; StatusChip.tsx:17 verified verbatim)
- R9 (Transaction boundary for fire-and-forget): N/A
- R10 (Circular module dependency): Checked — no issue (api-types gains no import; gate at api-types-boundary.test.ts:43-70)
- R11 (Display group != subscription group): N/A
- R12 (Enum/action group coverage gap): Checked — no issue (SC2 now records both sites with an executable link)
- R13 (Re-entrant dispatch loop): N/A
- R14 (DB role grant completeness): N/A — catalogs world-readable, already established
- R15 (Hardcoded env values in migrations): N/A
- R16 (Dev/CI environment parity): Checked — no issue (VE1 corrected; VE2/VE4/VE5/VE6 re-verified against source)
- R17 (Helper adoption coverage): Checked — no issue (the lib/ gap M2 found is now covered by I6.7)
- R18 (Allowlist/safelist sync): Finding F4 (the barrel re-export list is the crossing-point allowlist; its value half syncs by review only)
- R19 (Test mock alignment): N/A
- R20 (Multi-statement preservation in mechanical edits): Checked — no issue
- R21 (Subagent completion vs verification): N/A
- R22 (Perspective inversion for helpers): Checked — no issue
- R23 (Mid-stroke input mutation): N/A
- R24 (Migration additive+strict split): N/A — Requirement 7 forbids editing the shipped migration
- R25 (Persist/hydrate symmetry): N/A
- R26 (Disabled-state visible cue): N/A
- R27 (Numeric range in user-facing strings): N/A
- R28 (Toggle label grammatical consistency): Checked — no issue
- R29 (Citation/derived-claim/rationale accuracy): Findings F1, F2, F5, F6 (M13a/b resolved; all other cited lines re-verified exact)
- R30 (Markdown autolink footguns): Checked — no issue
- R31 (Destructive ops without confirmation): Checked — no issue (M15 resolved; google-workspace-sync.md:66 precedent verified)
- R32 (Runtime-shape boot test): Checked — no issue (api-types-boundary.test.ts:75-117 sweeps Object.entries and sees ACCOUNT_STATUSES automatically)
- R33 (CI config cross-config propagation): Checked — no issue (I6.4 lands in an existing *.integration.test.ts; no new file, no CI change)
- R34 (Adjacent pre-existing bug deferred): Checked — no issue (SC1-SC5 each carry a trigger and a cost; SC5's cost verified by derivation over all seven LINK_STATUSES order comparisons)
- R35 (Manual test plan for deployed components): Checked — no issue (C7 names ui-orphan-list.md:21, verified)
- R36 (Suppression or markerless weakening): Checked — no issue (no `as any`, no disable proposed)
- R37 (Internal jargon in user-facing strings): Checked — no issue
- R38 (Async/persisted state machine): N/A
- R39 (Lifecycle secret zeroization): N/A
- R40 (Cross-boundary serialization vs strict consumer): Checked — no issue (wire type stays string; accounts.ts:35 / identities.ts:31 unchanged)
- R41 (Declared capability without backing path): Findings F1, F4
- R42 (Class-membership derivation): Finding F2 (both set A = set B; the method claim is the issue, not the result)
- R43 (Fix-induced security-boundary widening): N/A — Security expert's scope
- R44 (Gate exit status through a lossy channel): Checked — no issue (plan requires exit status, never a pipe)
- R45 (Repo-wide gate scaling): Checked — no issue
- R46 (Scope-blind binding resolution): Checked — no issue (relative imports justified; root vitest resolves no alias)
- R47 (Surface-form adjudication): Findings F2, F7, F8
- R48 (Parallel adjudicators): Checked — no issue (I6.1 unit / I6.4 engine deliberately paired, and the pairing's rationale is now measured rather than assumed)
- R49 (Undeclared control class / overstated claim): Findings F1, F4, F8
- R50 (Verification preconditions unverified): Findings F5, F6, F9
- R51 (Decision bound to a name): Checked — no issue
- R52 (Control reach extended without re-audit): Checked — no issue (C39 fitted, not widened)
- R53 (Threshold without headroom measurement): N/A
- R54 (Control suspension via ambient state): N/A
- R55 (In-band sentinel collision): Checked — no issue (null sentinel, raw-value fallback)
- R56 (Progress-marker heal direction): N/A
- R57 (Ordering/cursor key without total order): N/A

### Security expert

- R1 (Shared utility reimplementation): Checked — no issue. C3's third *StatusKeyFor remains a declared R1 acceptance on the withdrawn-extraction precedent, which round 1 verified.
- R2 (Constants hardcoded): Checked — no issue. Member 9's move to non-member is correctly reasoned as a transcription of the authority.
- R3 (Pattern propagation): Finding F4 — the wrong half of the :16-20 comment survives the plan's stated correction and is the sentence a next-array author would copy.
- R4 (Event dispatch gaps): N/A — no event path touched.
- R5 (Missing transactions): N/A — no write path added by the plan; F7's manual UPDATE is a doc step, not code.
- R6 (Cascade delete orphans): N/A.
- R7 (E2E selector breakage): Checked — no issue. rg -n "有効" messages.ts returns only :489 (/apps), so the I6.5/I6.6 string is unique on both target pages; the existing ⟨ body assertions do not conflict with the raw-value fallback.
- R8 (UI pattern inconsistency): Checked — no issue. plan:386-390 now states correctly that the StatusChip idiom 7-8 lines below is a different fallback semantic.
- R9 (Transaction boundary for fire-and-forget): N/A.
- R10 (Circular module dependency): Checked — no issue. api-types gains no import; the C39 gate is unchanged.
- R11 (Display group != subscription group): N/A.
- R12 (Enum/action group coverage gap): Findings F1, F2 — a fourth member reaches two decision sites and reds nothing at either.
- R13 (Re-entrant dispatch loop): N/A.
- R14 (DB role grant completeness): N/A — no new object; pg_enum/pg_type world-readable, established previously.
- R15 (Hardcoded env values in migrations): N/A — Requirement 7 forbids editing the migration.
- R16 (Dev/CI environment parity): Checked — no issue. VE1-VE6 classify every contract; VE4's Playwright limitation and VE6's seed limitation are both stated and correct.
- R17 (Helper adoption coverage): Checked — no issue. Both render sites converted; csv-export.ts correctly on the unchanged list with its own observer.
- R18 (Allowlist/safelist sync): Checked — no issue. The barrel's re-export list is the crossing-point allowlist and M3's fix syncs it.
- R19 (Test mock alignment): N/A.
- R20 (Multi-statement preservation in mechanical edits): N/A.
- R21 (Subagent completion vs verification): N/A.
- R22 (Perspective inversion for helpers): Checked — no issue. accountStatusKeyFor(status: string) takes the value, not the map.
- R23 (Mid-stroke input mutation): N/A.
- R24 (Migration additive+strict split): N/A.
- R25 (Persist/hydrate symmetry): N/A.
- R26 (Disabled-state visible cue): N/A.
- R27 (Numeric range in user-facing strings): N/A.
- R28 (Toggle label grammatical consistency): N/A.
- R29 (Citation/derived-claim/rationale accuracy): Findings F1, F3, F4. Verified accurate this round: the barrel line refs, google-workspace-sync.md:66, e2e-howto.md:50-51, seed.ts:202,210,218,226,249, the zod measurement, and the pgEnum pass-through argument behind I6.1.
- R30 (Markdown autolink footguns): Checked — no issue.
- R31 (Destructive ops without confirmation): Finding F7 — the WHERE is present (M15 resolved) but there is no restore step and the section lands in a doc with no destructive-section convention.
- R32 (Runtime-shape boot test): Checked — no issue. api-types-boundary.test.ts sweeps Object.entries(apiTypes) and will see ACCOUNT_STATUSES; the module-init guard at index.ts:262-266 is untouched.
- R33 (CI config cross-config propagation): Checked — no issue. I6.4 lands in the existing link-status-enum.integration.test.ts, so no glob or workflow change.
- R34 (Adjacent pre-existing bug deferred): Checked — SC1-SC5 each carry a trigger and a cost; SC5 is a new, correctly-recorded one. F5 notes one further candidate (label-kinds.ts:15) that is pre-existing and unrecorded, raised as evidence only.
- R35 (Manual test plan for deployed components): Checked — C7 now names its host doc (M14 resolved); the residual is placement, F7.
- R36 (Suppression or markerless weakening): Checked — no issue. No eslint-disable, no @ts-expect-error, no `as any` proposed.
- R37 (Internal jargon in user-facing strings): Checked — no issue.
- R38 (Async/persisted state machine): N/A.
- R39 (Lifecycle secret zeroization): N/A — no credential path (VE3).
- R40 (Cross-boundary serialization vs strict consumer): Checked — no issue. Wire type stays string; accountsQuerySchema is .strict() but carries no account-status field.
- R41 (Declared capability without backing path): Findings F1, F2, F5 — three claimed observers/controls with nothing behind them.
- R42 (Class-membership derivation): Checked — no issue. The corrected single-value primitive returns the complete set; independently re-derived over all 59 mentions plus !=/<>/IN/ANY/CASE/FILTER/view/partial-index/RLS forms, all empty. The gap is F2 (coverage), not enumeration.
- R43 (Fix-induced security-boundary widening): Checked — no issue. C1 fits the C39 allowlist unchanged. F5 is the inverse — a boundary the fix depends on and does not pin.
- R44 (Gate exit status through a lossy channel): Checked — no issue.
- R45 (Repo-wide gate scaling): Checked — no issue.
- R46 (Scope-blind binding resolution): Checked — no issue. C3's relative-import rule is stated with its reason.
- R47 (Surface-form adjudication): Finding F6 — C5's acceptance criterion still adjudicates by grep two lines after the same patterns are labelled evadable tripwires.
- R48 (Parallel adjudicators): Checked — no issue. I6.1 / I6.4 are deliberately paired and revision 2 states which is authority for what.
- R49 (Undeclared control class / overstated claim): Findings F4, F5, F6. C1-C5's control-class declarations are otherwise honest, and the C2 reclassification paragraph is a genuine improvement.
- R50 (Verification preconditions unverified): Checked — one note, not a finding: the quoted zod command needs a cwd where zod resolves. Requirement 6's per-package dependency claim re-verified.
- R51 (Decision bound to a name): Checked — no issue.
- R52 (Control reach extended without re-audit): Checked — no issue. C39 is fitted, not widened.
- R53 (Threshold without headroom measurement): N/A.
- R54 (Control suspension via ambient state): N/A.
- R55 (In-band sentinel collision): Checked — no issue.
- R56 (Progress-marker heal direction): N/A.
- R57 (Ordering/cursor key without total order): N/A.
- RS1 (Timing-safe comparison): N/A — no secret compared.
- RS2 (Rate limiter on new routes): N/A — no new route; both touched routes carry LIST_RATE_LIMIT and run under withTenant.
- RS3 (Input validation at boundaries): Finding F5 — two independent validators remain, but the first one's freeze protection rests on an unstated calling convention with no observer.
- RS4 (Personal-identifying data in committed artifacts): Finding F7 — no PII, but the destructive statement's placement and missing restore are the RS4/R31 pair round 1 opened.
- RS5 (Untrusted externally-supplied security parameter): Checked — no issue. Connector-supplied accountStatus stays z.enum-validated before storage; C2 changes the literal to a reference, not the validation.
- RS6 (Incomplete sanitization / escape ordering): Checked — no issue. csvField's neutralize->strip->quote order is untouched, accountStatus still goes through it, and I6.7 asserts the quoted cell without weakening the path.

### Testing expert

- R1 (Shared utility reimplementation): Checked — no issue (C3's third *StatusKeyFor is unchanged from revision 1 and still a reasoned acceptance)
- R2 (Constants hardcoded): Checked — no issue for the observers; I6.1's literal is deliberate and now correctly classified
- R3 (Pattern propagation): Finding F3 (the chip: binding cell is proposed for copy without its non-transferable leg)
- R4 (Event dispatch gaps): N/A
- R5 (Missing transactions): N/A
- R6 (Cascade delete orphans): N/A
- R7 (E2E selector breakage): Checked — no issue; rg -nw 'active|suspended|archived' e2e/ re-run, returns only HR-import CSV columns and one comment (licenses.spec.ts:73); no spec pins a rendered account status
- R8 (UI pattern inconsistency): Checked — no issue (C5 now states the StatusChip fallback difference correctly)
- R9 (Transaction boundary for fire-and-forget): N/A
- R10 (Circular module dependency): N/A
- R11 (Display group != subscription group): N/A
- R12 (Enum/action group coverage gap): Checked — no issue (SC2 carries its executable link)
- R13 (Re-entrant dispatch loop): N/A
- R14 (DB role grant completeness): N/A
- R15 (Hardcoded env values in migrations): N/A
- R16 (Dev/CI environment parity): Checked — no issue (VE2 correctly keeps I6.1 on the unit tier; vitest.config.ts projects verified)
- R17 (Helper adoption coverage): Checked — no issue
- R18 (Allowlist/safelist sync): Finding F6 (seed-facts.ts has a second parser not in the walkthrough)
- R19 (Test mock alignment): N/A — no mocks
- R20 (Multi-statement preservation): N/A
- R21 (Subagent completion vs verification): N/A
- R22 (Perspective inversion for helpers): Checked — no issue
- R23 (Mid-stroke input mutation): N/A
- R24 (Migration additive+strict split): N/A
- R25 (Persist/hydrate symmetry): N/A
- R26 (Disabled-state visible cue): N/A
- R27 (Numeric range in user-facing strings): N/A
- R28 (Toggle label grammatical consistency): N/A
- R29 (Citation/derived-claim/rationale accuracy): Findings F1, F9. All other new citations spot-checked and accurate: 0001_init.sql:8,41,48; csv-export.ts:77,106; mutate.mjs:82; seed.ts:202,210,218,226,249; messages.ts:65,310; ui-orphan-list.md:21; accounts.spec.ts:126; tables.ts:33,38-42
- R30 (Markdown autolink footguns): N/A
- R31 (Destructive ops without confirmation): N/A — C7 no longer prescribes an UPDATE
- R32 (Runtime-shape boot test): Checked — no issue (api-types-boundary.test.ts:115 freeze sweep verified to accept a frozen string array)
- R33 (CI config cross-config propagation): Checked — no issue; I6.4 stays in an existing *.integration.test.ts, I6.5/I6.6 in an existing spec, I6.7 in an existing unit file — no new file, no config change
- R34 (Adjacent pre-existing bug deferred): Checked — no issue (SC5 newly records the link_status tautology instead of citing it as precedent)
- R35 (Manual test plan for deployed components): Finding F7
- R36 (Suppression or markerless weakening): Checked — no issue
- R37 (Internal jargon in user-facing strings): N/A
- R38 (Async/persisted state machine): N/A
- R39 (Lifecycle secret zeroization): N/A
- R40 (Cross-boundary serialization vs strict consumer): N/A
- R41 (Declared capability without backing path): Finding F1 (I2.2 declares a test gate its named observer cannot provide)
- R42 (Class-membership derivation): Checked — no issue; the reclassification of tables.test.ts:34 as an expectation is correct and the single-value subclass now has a defining primitive that can see licenses.ts:33
- R43 (Fix-induced security-boundary widening): N/A — Security expert's scope
- R44 (Gate exit status through a lossy channel): Checked — no issue
- R45 (Repo-wide gate scaling): Checked — no issue
- R46 (Scope-blind binding resolution): Finding F4 (/accounts with no ?status= resolves to a tab that does not contain the row the sibling precedents use)
- R47 (Surface-form adjudication): Checked — no issue; revision 2 demotes the greps to tripwires explicitly. But see F1: with the tripwire demoted, I2.2 has nothing left
- R48 (Parallel adjudicators): Finding F2 (order-sensitive I6.2 becomes a third order adjudicator whose authority is a hand-written map)
- R49 (Undeclared control class / overstated claim): Findings F1, F8
- R50 (Verification preconditions unverified): Checked — no issue; VE4/VE5/VE6 all re-derived and all three hold
- R51 (Decision bound to a name): Finding F9 (I6.4's placement decided by a filename that three other sites cite)
- R52 (Control reach extended without re-audit): Checked — no issue
- R53 (Threshold without headroom): Checked — no issue (LIST_RATE_LIMIT 240/min against ~8 page loads; login budget untouched because both cells reuse storageState)
- R54 (Control suspension via ambient state): Checked — no issue; each Playwright test gets a fresh context from storageState, so the ja cookie cannot leak into a sibling
- R55 (In-band sentinel collision): Checked — no issue
- R56 (Progress-marker heal direction): N/A
- R57 (Ordering/cursor key without total order): N/A
- RT1 (Mock-reality divergence): N/A — no mocks; I6.4 asks the engine
- RT2 (Testability verification): Checked — stated explicitly: the suspended/archived E2E pin is rejected as untestable and NOT filed; F1's proposed derivation observer IS filed because a text-read precedent exists in-repo
- RT3 (Shared constant in tests): Checked — no issue; I6.1 keeps its literal, I6.3's allow side pins literal keys, I6.7 pins the literal "active". All three correctly refuse to derive the expectation
- RT4 (Race-test vacuous-pass guard): N/A
- RT5 (Test call-path includes the production primitive): Checked — no issue; I6.5/I6.6 exercise the real pages, I6.7 the real buildAccountsCsv
- RT6 (New production exports without test diff): Checked — no issue; every new export has a named observer
- RT7 (New guard must be proven able to fail): Findings F1 (row 1 survives; I2.2 unprovable), F3 (the copied twin-drift cell is vacuous when the field disappears)
- RT8 (Vacuous denial-path test): Checked — no issue; the five prototype keys distinguish Object.hasOwn from ?? null, ''/not_a_status do not, and revision 2 says so correctly
- RT9 (Parallel-implementation twin drift): Finding F3
- RT10 (Guard tested only on its deny side): Checked — no issue; I6.3 now pins the exact key per member on the allow side (M10 applied)
- RT11 (Test fixture outlives its own run): Checked — no issue; I6.4 reuses the existing container and its afterAll; I6.5/I6.6 add no persistent state


---

# Round 3 (incremental)

Date: 2026-08-03
Review round: 3

## Changes from Previous Round

Revision 3 of the plan: the six Round-2 Majors repaired, and the "what the previous revision said
and why it was wrong" litigation moved out of the plan into this artifact — the plan became
shorter as a result.

**Critical 0 / Major 3 / Minor 13.** Every Round 2 finding RESOLVED or PARTIAL; none regressed.
Every new finding against revision 3's own fixes.

## Merged Findings

### P1 — Major (Testing F1 + Functionality F1 — two experts). Mutation row 1 was unsatisfiable, and I2.2's named observer was blind to it.

Re-inlining the **identical** literal in `tables.ts` produces identical `enumValues`, so I6.1
stays green. The Functionality expert proved it without running the mutation: **the post-mutation
state IS `main`**, and `pnpm exec vitest run --project unit packages/schema/test/tables.test.ts`
passes there (5 tests). So I2.2 named an observer structurally blind to its subject — and the only
things that would have caught it, the C2 forbidden pattern and the post-image hit count, were
demoted by the same revision.

*Resolution*: I6.8 added — a source-text read modelled on `apps/api/test/accounts-query-domain.test.ts:21-34`,
whose own comment states why value-equality cannot see re-inlining.

### P2 — Major (Testing F2 + Functionality F2 — two experts). Mutation row 10 named the wrong package, understated its reds, and left I6.9's only executable half with no row.

`scripts/mutate.mjs:81-88` runs `pnpm exec vitest run` only — never `tsc`. Vitest strips types, so
a compile-error mutation produces a green run and a `SURVIVED` verdict. I6.9's sole row was
labelled "(compile error)", and no row cut `packages/matcher/src/match.ts:16` — the production
decision site SC2 says I6.9 covers. **N2's shape one level down**: a trigger executable in
principle and unexecuted in the stated procedure.

*Resolution*: the row split into an `ACCOUNT_STATUSES` probe and a `match.ts:16` cut, plus a
standing note that the Reds column lists observers, not gates.

### P3 — Major (Testing F3 + Functionality F3 — two experts). RT9's substitute guard could not be written from the single fixture field it prescribed.

Two of the three guards need a domain value, and the only existing field that could supply one is
`status:` — which holds the **link** status. So `ACCOUNT_STATUSES.includes(status)` is false for
every entry and the guard reds on arrival, with the cheapest repair being to hardcode the member,
which under VE6 is green forever. **N4's failure mode reproduced inside N4's own fix.**

*Resolution*: two fields specified (`accountStatus`, `accountStatusText`), the parse regex given
explicitly, and the camelCase constraint stated against `seed-gate-agreement.test.ts:57`.

### P4 — Minor, twelve of them, applied

- **I6.10 through `_def`** (Testing F5 + Security F4) — `.options` is the same reference, is zod's
  public surface, and is what `accounts-query-domain.test.ts:38` already uses. Changed, with the
  `.unwrap()` caveat for optional fields.
- **I6.8's stripper** (Testing F4) — the naive two-regex form strips `/*…*/` first, so a `/*`
  inside a string deletes to the next `*/`: the false-**green** direction for a negative literal
  check. Changed to copy the body of `apps/api/test/strip-ts-comments.ts`.
- **The blind-spot enumeration** (Functionality F10 + Security F2) — presented as closed, omitting
  drizzle predicates, JS membership tests and SQL `DEFAULT`. All three swept and empty; the
  enumeration relabelled best-effort.
- **The producer direction** (Security F2) — `google-workspace/src/index.ts:139-141` hand-writes
  all three members in **reverse** order, invisible to both primitives, and its
  `RawAccount['accountStatus']` return type accepts a subset of a widened union. So a fourth
  member is never *produced*. Recorded as **SC7**.
- **SC6's remedy** (Security F5) — prescribed de-spreading a site that must spread;
  `LABEL_FILTERS` is deliberately wider than the domain. The fix is `Object.freeze`. The
  no-attacker-path claim was traced independently and holds.
- **C7's header** (Functionality F8 + Security F1) — naming another spec does not retract "nothing
  here is manual-only". Retracted instead.
- **C7's placement reason** (Testing F7) — `ui-orphan-list.md:23` says the sync **fails**, so match
  never runs and nothing propagates. The real reason is ordering: a destructive write comes after
  every non-destructive observation.
- **SC3's `pg_enum` command** (Functionality F5), **the zod probe's cwd** (Functionality F6 +
  Security), **`3 hits` vs output lines** (Functionality F7), **the barrel's value half**
  (Functionality F4), **the tripwire carve-out scope** (Functionality F7), **`cellFor`'s scope**
  (Testing F8), **`seed-facts.ts`'s second parser** (Testing F6), **VE6's coverage sentence**
  (Testing F8), **I6.4's filename** (Testing F9) — each a one-clause repair, all applied.

---

# Round 4 (incremental)

Date: 2026-08-03
Review round: 4

## Changes from Previous Round

Revision 4: the mutation table's red sets completed, SC7 added, C2's blind-spot paragraph
rewritten, RT9 given two fields, C7 rewritten, SC6 split, Requirement 8 given an exception.

**Critical 0 / Major 4 / Minor 12.** **Not one finding is against a contract, an invariant, a
control class, or the adequacy of an acceptance criterion.** Every one is inside the mutation
table's own text or is a citation.

All three experts volunteered a saturation assessment without being asked to conclude one:

> **Security**: "Saturation: yes. … All five findings below are one-cell or one-clause edits, and
> F1's fix **deletes** a sentence rather than adding one."
>
> **Testing**: "Revision 5 is the last round that removes at least as much as it adds. Nothing
> below touches a contract, an invariant, a control class, or an acceptance criterion's adequacy;
> after revision 5 the plan should be locked regardless of what a sixth round would find."
>
> **Functionality**: "Six of the eight findings below are surgical deletions or one-clause
> narrowings. … If revision 5 is written, it should be net-negative in lines; if it is not, that
> is the signal to stop."

## Merged Findings

### Q1 — Major (Security F1 + Testing F2 + Functionality FR1 — all three experts). The `match.ts:16` row claimed "I6.9 only", and the sentence it carried was the round's real finding.

`packages/matcher/test/precision.test.ts` runs the golden corpus through the real `matchAccounts`
and gates `precision >= 0.95` over 47 expectations. Under that mutation five flip —
`corpus.ts:186,228,243,327` ghost→matched and `:214` matched→ghost — giving 42/47 = **0.894**.
The Functionality expert added a second: `apps/worker/test/match.integration.test.ts:129` asserts
`ghost` for a `left` identity with an `active` account, and `packages/matcher/package.json` names
`src/index.ts` as `main`, so the worker resolves the mutated source.

The isolation claim was therefore wrong by two observers. **The larger finding is the sentence
beside it**: "This is the row that makes SC2's link executable rather than compile-time" is false
— `match.ts:16` is already pinned executably at `70f61e4`. An *over*-credited trigger retires the
reviewer's attention exactly as an unbacked one does, which is N2 in the opposite direction.

*Resolution*: the Reds cell names all three observers; the claim is **deleted**. SC2 now says what
I6.9 actually adds — an **exact per-member** assertion where the corpus is a ratio a single
flipped case survives (46/47 = 0.979), plus compile-time totality.

### Q2 — Major (Testing F1 + Security F2). The CSV mutation row reds by `ReferenceError`, not by the defect it claims to prove.

`accountStatusKeyFor(item.accountStatus) ?? item.accountStatus` names an identifier
`csv-export.ts` does not import — and C5 keeps that file unchanged, so it never will.
`applyOnce` is a single find/replace and cannot add the import. The mutation throws at runtime and
reds the whole file, **so deleting the I6.7 cell entirely produces the same verdict**. A vacuous
proof of the one observer Requirement 3 depends on.

*Resolution*: respelled with no free identifier —
`item.accountStatus === 'active' ? '有効' : item.accountStatus`.

### Q3 — Major (Testing F3). Two rows had `find` anchors that occur more than once, so `applyOnce` errors and the row yields no verdict.

`=== 'active'` occurs twice in `packages/matcher/src/match.ts` (`:12` is the *identity's* status);
`accountStatusText: '有効'` occurs five times once RT9 lands.

*Resolution*: the matcher anchor carries `account.accountStatus`; the fixture row names the entry.
**The Testing expert's suggested entry (`slackOrphan`) was itself not unique** — it and `orphan`
share `status: 'orphan'` / `chip: 'Orphan'` — so the orchestrator verified and switched to `ghost`,
anchored on `chip: 'Ghost',`.

### Q4 — Major (Functionality FR2). Requirement 2's out-of-domain render branch has no observer, and C7 named two that do not cover it.

VE5 blocks the unit tier; VE6 means every seeded account is in the domain, so the falsy branch of
`key ? t(key) : item.accountStatus` never executes at any tier, and no mutation row cuts it.
`return key ? t(key) : ''` survives everything. C7 claimed it was "covered by I6.3 and I6.4's
third cell" — I6.3 pins the guard's `null` return, I6.4's third cell pins the engine's rejection;
neither observes what the render does *with* a `null` key. R41.

*Resolution*: recorded as Requirement 8's **first stated exception** (an observer is genuinely
impossible), and C7's coverage claim rewritten to say so. An extraction into a pure
`accountStatusCell()` was considered and rejected — it would only weakly satisfy RT5, since the
`<td>` still has to call it.

### Q5 — Minor, applied

- **The RT9 binding cell was an unnumbered eleventh observer** (Testing F4 + Functionality FR4) —
  a mutation row, no ID, no host file, and a Go/No-Go that said "ten". Now **I6.11**, hosted in
  `apps/web/test/account-statuses.test.ts`, in the Testing strategy, and the gate says eleven.
- **SC7's direction** (Security F3) — the plan named only the *surfacing* direction. For an
  account linked to an **active** identity the same misclassification inflates `assigned` and
  shrinks `unassigned` — the hides-waste direction `licenses.ts:16-20` forbids. Added, with the
  reassuring half stated too: nothing in this class can hide live access, because the mapping only
  ever collapses *into* `'active'`.
- **C7's destructive block named no DB session** (Security F5) — `saas_accounts` carries
  `FORCE ROW LEVEL SECURITY` and the app role has no bypass (`0001_init.sql:112-116,141-145`), so
  from an app-role session both the mutation and its inverse report `UPDATE 0` **with no error**.
  The block now uses `docker compose exec postgres psql` per `e2e-howto.md:50-51` and states that
  `UPDATE 1` is the expected output of both directions.
- **Two false universals** (Functionality FR5) — "the only index in the tree" (constraint-backed
  indexes exist) and "the only unfrozen array backing any `z.enum`" (contradicted by the plan's
  own Risks paragraph 26 lines later). Both narrowed. These are the over-tight universals that
  revision 4's own repair set out to stop writing.
- **The `cellFor` comma rationale was fabricated** (Testing F5c + Functionality FR6) — no cell of
  `maliciousItem` contains a comma; the candidate list joins on `'; '`. The scoping half of the
  reason was correct and sufficient on its own.
- **Row 4's typecheck enumeration was short by three sites** (Testing F5b + Functionality FR1).
  Replaced with the property rather than a list: enumerating them is what kept going wrong.
- **Rows 1–2 omit their `pnpm lint` red** (Testing F5a); **citation slips** (Functionality FR7:
  `applyOnce` is `:46-52`, the Go/No-Go C7 row said "header corrected" where C7 says "retracted");
  **the "5 output lines" figure** (Functionality FR8) is conditional on a spelling nothing forces —
  `BILLING_CYCLES` at `packages/api-types/src/index.ts:32` is the one-line frozen idiom in the same
  file and there is no prettier config. The criterion now counts **matches**, which removes text.

## Verified Clean, With Evidence

- **I6.9 and I6.10 both go green and both go red for the stated reasons — by execution.** The
  Security expert replayed `matchAccounts` with a fourth member (4 results, 0 ambiguous,
  `active→ghost`, everything else `→matched`) and measured `.options === ACCOUNT_STATUSES` true
  for the by-reference form, false for the spread while `toEqual` still passes. No previous round
  could say this of its own observers.
- **The "first string-valued parse" precondition is exactly right**: four non-string parses leave
  the widening window open; both a successful and a failing string parse close it.
- **SC6's no-attacker-path statement traced independently** — `label` reaches SQL as a bound
  parameter or a hard-coded `IS NULL`/`IS NOT NULL` branch under `withTenant`, so a widened domain
  yields a 500, not injection and not a tenancy crossing.
- **RT9 against the real fixture**: exactly five `email:` occurrences, all in `SEEDED_ACCOUNTS`,
  none in a comment, one per seeded account — so the floor is arithmetically correct and
  non-vacuous. Neither existing parser breaks on camelCase additions (verified by both experts
  independently).
- **I6.8's stripper is copyable**: `strip-ts-comments.ts:20-44` is a pure, import-free 25-line
  function with its residue list in the docstring; `packages/schema/tsconfig.json` includes `test`
  and the unit glob collects it. The collision reasoning holds — `'suspended'`/`'archived'` occur
  in `tables.ts` only at `:40-41`, and `'active'` legitimately at `:33`.
- **Nine RLS policies at the cited lines**, all keying on `tenant_id` alone; no view; the only
  `CREATE INDEX` is unrelated and not partial; no drizzle predicate, no JS membership test, no SQL
  `DEFAULT` on the column.

## Saturation Call

**Round 4 is the exit.** Against the four criteria:

1. **At least two rounds completed** — four.
2. **No Critical or Major open** — the four Round-4 Majors are repaired in revision 5, and each
   repair is a deletion or a one-clause narrowing rather than an addition.
3. **No finding is against the design itself** — met from Round 2 onward. C1–C5's contracts,
   control classes and invariants have not been challenged since revision 1. Every finding in
   Rounds 2, 3 and 4 was against the verification apparatus this review kept adding, and all
   three experts classified their Round-4 findings accordingly.
4. **Every remaining Minor is prose-only or reachable only by building** — the residue is
   citation precision and table wording.

The counts never converged, and that is the point the i18n review already recorded: the fix rate
feeds the finding rate, so the loop stops when the changes stop, not on its own.

| | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| Critical | 1 | 0 | 0 | 0 |
| Major | 7 | 6 | 3 | 4 |
| Minor | 7 | 15 | 13 | 12 |
| **originating in the contracts (C1–C5)** | **7** | **0** | **0** | **0** |
| originating in this review's own fixes | — | 21 | 16 | 16 |

What settles it is the **character**: every product-level defect — the untranslated render sites
with no observer, the CSV requirement with no observer, the omitted web barrel, the unrecorded
`licenses.ts:33` decision site — was found in Round 1 and is fixed and observed. Rounds 2–4 found
things wrong with the fixes, and by Round 4 with the fixes to the fixes. What remains is R49
(a claim stronger than its implementation) and R29 (citation precision) in a mutation table, which
is a better filter for a PR review than a fifth self-review round.

Two findings could not have been reached by reading, and both are the round's justification:
Round 2's N2 (the SC2 link that did not red, replayed) and Round 4's Q1 (the precision gate that
already redded, computed from the corpus).

## Recurring Issue Check

Round 4, preserved verbatim per expert. Rounds 1–3's are in the sections above and in the
per-round findings files under the session's temp directory.

