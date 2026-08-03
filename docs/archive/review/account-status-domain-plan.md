# Plan: account-status-domain

Revision 5 — **the mutation table's spelling made runnable.** Round 4 found no defect in any
contract, invariant, control class or acceptance criterion; every finding was inside the mutation
table's own text. Three rows could not have run as written — one named an identifier its target
file does not import, two had `find` anchors that occur more than once — and one row credited
I6.9 with making SC2's matcher link executable when the golden corpus already pins it at
`70f61e4`. That claim is **deleted** rather than qualified; what I6.9 actually adds is an exact
per-member assertion where the corpus is a 0.95 ratio, plus compile-time totality. The RT9
binding cell is numbered I6.11.

Revision 4 — the mutation table's red sets completed, and the producer class surfaced as SC7.
Revision 3 — the litigation moved out of the plan and into `account-status-domain-review.md`.
Revisions 2 and 1 — see that record.

Nothing is built.

Discharges the first residue entry of `docs/archive/review/i18n-code-review.md`:

> **`accountStatus` stays English.** Wire type is a bare `string`; the producing union is in
> `packages/connectors/core`, which `apps/web` may not import (C8). Trigger: `accountStatus`
> gaining a domain in `@open-smp/api-types`.

The residue names the trigger, so this plan's first contract IS the trigger. The i18n cycle
translated `linkStatus`, `identityStatus` and `labelKind`; `accountStatus` is the fourth
vocabulary the reader sees and the only one still rendering English words under a Japanese
column heading on `/accounts` and `/identities/[identityId]`.

## Project context

- **Type**: mixed — pnpm/TypeScript monorepo. `apps/web` (Next 15 app router), `apps/api`
  (Fastify), `apps/worker` (BullMQ), shared packages under `packages/*`.
- **Test infrastructure**: unit (vitest) + integration (vitest + testcontainers) + E2E
  (Playwright over docker compose) + CI/CD (four required checks: `checks`, `integration`,
  `compose-smoke`, `audit`) + a mutation harness (`scripts/mutate.mjs`).
- **Baseline**: `main` = `70f61e4`, 977 tests green, E2E 63.

### Verification environment constraints

| ID | Constraint | Consequence |
|----|-----------|------------|
| VE1 | `compose-smoke` takes ~11 min in CI, but already boots and already visits both target routes | An assertion added to an existing spec costs seconds. E2E is `verifiable-CI` and `verifiable-local`. |
| VE2 | Integration tests need a local Docker daemon (testcontainers) | I6.4 runs here. A developer without Docker gets no signal from this tier, which is why I1.1 must also have a unit-tier observer. |
| VE3 | No real Google Workspace or Slack tenant is reachable | Not exercised: this change alters no provider call and no credential path. |
| VE4 | `scripts/mutate.mjs:82` is `const project = target.includes('.integration.') ? 'integration' : 'unit';` — **it cannot drive Playwright** | The two render-site mutations must be run by hand against a booted stack and recorded with their observed output. |
| VE5 | `apps/web` has no jsdom project and both target pages are async server components that `fetch` | No unit test can reach their JSX. A `renderToStaticMarkup` twin is rejected under RT2: it would be a rewritten copy of the page, not the page. E2E is the only tier that can observe the render. |
| VE6 | `apps/api/src/seed.ts:202,210,218,226,249` seed `accountStatus: 'active'` for all five accounts; `suspended` and `archived` are never seeded | The E2E observers pin **one** domain member. That is sufficient for the render path, because the render site is a single member-agnostic expression — exercising one member exercises it for all three. What stays member-specific is the key→copy mapping, which I6.2/I6.3 and `apps/web/test/i18n.test.ts:49` cover on the unit tier. Seeding a fourth state is rejected under RT2, and the reason is NOT the orphan set: `SEEDED_ORPHAN_EMAILS` (`e2e/fixtures/seed-facts.ts:91-93`) filters on the **link** status, and `e2e/specs/accounts.spec.ts:72-80` derives both its by-name loop and its `toHaveCount` from that same list — the fixture's docstring says so explicitly, so an added account is absorbed rather than breaking a count. What actually binds is two things, and only the first is recorded in the tree: `seed-facts.ts:98-102` already notes that `e2e/specs/apps.spec.ts:213` hardcodes `Cannot delete — 4 accounts still attributed`. The second is derived here — a non-`active` account drops out of `ROLLUP_SQL`'s `seat` CTE, moving the figures `e2e/scripts/assert-seed-preserved.sh:116-117` pins. (That same comment's closing clause asserted the orphan-count claim this row refutes; it was corrected in the same round, and the premises differ: it assumed a seed-only edit, this row assumes `SEEDED_ACCOUNTS` is updated in step.) That is a seed-design change, not an observer. |

Every contract is `verifiable-local` and `verifiable-CI`. No `blocked-deferred` path, so no
Anti-Deferral cost-justification is owed against a constraint entry.

## Objective

Give `accountStatus` one declaration that every other spelling derives from, and route the two
render sites through the dictionary — the shape `LINK_STATUS_KEYS` and `LABEL_KIND_KEYS` have.

## Requirements

1. `active` / `suspended` / `archived` render as Japanese under `ja` and English under `en`, on
   `/accounts` and `/identities/[identityId]`.
2. A value outside the domain renders **verbatim** — not `⟨accountStatus.x⟩`, not `undefined`.
   The wire type is a bare `string` and stays one (SC1).
3. The CSV export keeps the **raw domain value**. It is consumed by spreadsheets and scripts;
   translating it would make the same file parse differently depending on who exported it.
4. A fourth status added to `@open-smp/api-types` with no copy is a **compile error**.
5. The addition fits the C39 boundary gate (`apps/api/test/api-types-boundary.test.ts`) without
   widening it: a frozen array of strings and a derived type.
6. No new dependency edge. Every package that must derive already declares
   `@open-smp/api-types` as a workspace dependency.
7. `packages/schema/migrations/0001_init.sql` is **not edited**. A shipped migration is
   immutable; the domain's order is made to match it.
8. **Every requirement above has an observer that can go red for it**, and every observer has a
   named mutation that reds it *and* the set of other observers that mutation also reds. **Two
   stated exceptions.** (a) Requirement 2's out-of-domain fallback branch has no observer at any
   tier and cannot have one: VE5 blocks the unit tier, and the column is a DB enum so E2E cannot
   produce the value (I6.4's third cell is the proof of that unreachability, not a substitute
   observer). I6.3 is the nearest reachable proxy — it pins `accountStatusKeyFor`'s `null` return,
   not the render's use of it. (b) Requirement 7 is enforced by review and by a forbidden-pattern tripwire
   only. No test can see it — I6.4 compares the deployed enum to the domain, so an edit that moves
   both (the repair path Requirement 7 forbids) reds nothing. The exception is accepted rather
   than papered over, because a shipped migration is edited by a human decision, not by drift.

## Technical approach

`LINK_STATUSES` is the precedent: the frozen array lives in `@open-smp/api-types`, the type
derives from it, `packages/schema` builds the drizzle `pgEnum` from the array, and `apps/web`
keeps a `Record<Domain, MessageKey>` read through an `Object.hasOwn` guard because the wire type
is `string`.

No concurrency primitive is involved, so the plan-stage real-DB probe does not apply. The one
storage-facing claim — that the drizzle enum and the shipped Postgres enum agree in members and
order — is not taken on reading: I6.4 asks the engine.

### Why the wire type stays `string`

`AccountListItem.accountStatus` and `IdentityAccountItem.accountStatus` are declared `string` and
stay `string`. Narrowing would be a bare `as` over a value the API does not validate — the shape
the i18n review found a false claim attached to (`identityStatusEnum` at
`packages/schema/src/tables.ts:33` is a hand-written second declaration, and
`apps/api/src/routes/identities.ts:136` narrows with a bare `as`). Reading through a guard makes
no claim that can drift. The narrowing is SC1.

## Contracts

### C1 — `ACCOUNT_STATUSES` as the shared domain

**Files**: `packages/api-types/src/index.ts` (the declaration, and the corrective comment edit
below), `apps/web/src/lib/api-types.ts` (the web barrel).

```ts
export const ACCOUNT_STATUSES: Readonly<readonly ['active', 'suspended', 'archived']>;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
```

Constructed as `Object.freeze([...] as const)`, matching `LINK_STATUSES` and
`ACCOUNT_LABEL_KINDS` in the same file.

**Corrective edit, in scope and stated here rather than only in prose.** The `LINK_STATUSES`
docstring at `packages/api-types/src/index.ts:16-20` is wrong on two counts and this plan makes
the second of them load-bearing, so both are fixed:

- it says the freeze "does NOT protect `z.enum()` — that snapshots its members at construction".
  Measured false at the pinned version (see Risks);
- it presents the freeze as speculative ("if one is added here later") and cites
  `isAccountLabelKind` — a guard over a **different** array — as its model, while `LINK_STATUSES`
  has a live consumer today: `z.enum(LINK_STATUSES)` at `apps/api/src/routes/accounts.ts:21`.

The rewrite names that consumer and drops the cross-reference. **The `ACCOUNT_LABEL_KINDS`
comment at `:84-89` is already correct on both counts and is NOT touched** — it names its guard
and says "the same array backs `z.enum()` in both label-write routes. Widening it widens both."
Stated so the next reader does not "fix" it symmetrically.

**Invariants**

- **I1.1 (app-enforced, test-gated)** — declaration order equals
  `packages/schema/migrations/0001_init.sql:8`. A Postgres enum's declaration order is its sort
  order and that migration has shipped. No schema-enforced form exists — the storage engine
  cannot constrain a TypeScript array. Observers: I6.1 (unit, against an independent
  transcription of the migration) and I6.4 (integration, against the engine).
- **I1.2 (app-enforced, test-gated)** — frozen, not merely `as const`, and **passed by
  reference** wherever a validator closes over it. The C39 gate
  (`api-types-boundary.test.ts:115`) observes the freeze; I6.10 observes the reference. Both are
  needed and the second is not decorative — see Risks.

**Control class**: not applicable — a data declaration. The control in the vicinity is the
pre-existing C39 gate, which C1 must *fit*: a frozen array of string primitives satisfies the
allowlist at `:101-115`, and C1 proposes no `is*` guard, so the function branch is not engaged.

**Forbidden patterns** (tripwires — see the classification note under C2)

- `/export const ACCOUNT_STATUSES\s*=\s*\[/` — an unfrozen array fails C39/I39.3 and would widen
  `rawAccountSchema` at runtime.
- `/from ['"]@open-smp\// in `packages/api-types/src/` — C39 forbids any non-relative import.

**Acceptance criteria**: `pnpm -F @open-smp/api test api-types-boundary` green with
`ACCOUNT_STATUSES` present in its `Object.entries(apiTypes)` sweep; I6.1, I6.4, I6.10 green.

**Consumer-flow walkthrough**

- `apps/web/src/lib/api-types.ts` — the barrel. **Two halves with different enforcement, and
  saying so is the point.** `AccountStatus` into the type block (`:34-60`) is
  **compile-enforced**: C3 imports it from `./api-types` and `pnpm typecheck` fails without it.
  `ACCOUNT_STATUSES` into the value block (`:23-32`) is **review-enforced with no observer** —
  nothing under `apps/web/src` imports it, and C6's test reads the package directly
  (`apps/web/test/link-statuses.test.ts:3` is the precedent; tests are outside `src`). It is
  added anyway for the reason the file's own docstring gives at `:17-22` about `LINK_STATUSES`:
  "leaving it out is what pushes the next one into importing `@open-smp/api-types` directly."
  That is a policy, not a guarantee, and this plan does not claim otherwise.
- `packages/schema/src/tables.ts` — `{ ACCOUNT_STATUSES }` passed whole to
  `pgEnum('account_status', …)`, which requires `readonly [string, ...string[]]`. Satisfiable:
  `LINK_STATUSES` is passed the same way at `:37`, and the drizzle signature
  `pgEnum<U extends string, T extends Readonly<[U, ...U[]]>>` accepts `Object.freeze([...] as const)`.
- `packages/connectors/core/src/index.ts` — `{ AccountStatus }` as the type of
  `RawAccount.accountStatus`.
- `packages/connectors/core/src/raw-account.schema.ts` — `{ ACCOUNT_STATUSES }` passed **by
  reference** to `z.enum(…)`, whose signature
  `createZodEnum<U extends string, T extends Readonly<[U, ...U[]]>>` accepts the same shape;
  `apps/api/src/routes/accounts.ts:21` already calls `z.enum(LINK_STATUSES)`. **Not
  `z.enum([...ACCOUNT_STATUSES])`** — see I6.10.
- `packages/matcher/src/types.ts`, `apps/worker/src/sync.ts`, `apps/worker/src/match.ts`,
  `apps/api/src/seed.ts` — `{ AccountStatus }` as a field type on a local type.
- `apps/web/src/lib/account-statuses.ts` — `{ AccountStatus }` via the barrel, as the KEY type of
  `Record<AccountStatus, MessageKey>`. This is what makes a fourth member a compile error.
- `packages/matcher/test/match.property.test.ts` — `{ ACCOUNT_STATUSES }` to drive its account
  generator (fixture input) **and** `{ AccountStatus }` for I6.9's total expectation map.
- `apps/api/test/licenses-rollup.integration.test.ts` — `{ AccountStatus }` as a field type on its
  local `AccountSpec` (fixture input type). Note this is a *widening* and forces no new case;
  SC2 records what that does and does not buy.
- `apps/web/test/account-statuses.test.ts` — `{ ACCOUNT_STATUSES }` directly from
  `@open-smp/api-types`.

`packages/schema/test/tables.test.ts` is deliberately **not** a consumer — see I6.1.

No consumer needs a field absent from the locked shape. The producing union in
`packages/connectors/core` becomes a *consumer* rather than the source, which dissolves the C8
objection: `apps/web` imports from `@open-smp/api-types`, never from `packages/connectors/core`.

### C2 — every hand-written spelling of the triple derives from C1

**Member-set derivation (R42).** The class is "source that re-declares the account-status
domain". Its defining primitive is the literal triple in any spacing, including the union form:

```bash
rg -nU --glob '!node_modules' --glob '!*.md' "active'[\s\S]{0,40}?suspended'[\s\S]{0,40}?archived'" .
```

Set A at `70f61e4` — **11 members**:

| # | Site | Disposition |
|---|------|-------------|
| 1 | `packages/schema/migrations/0001_init.sql:8` | **Non-member by exclusion.** A shipped migration is immutable; it is the AUTHORITY I1.1 derives from. |
| 2 | `packages/schema/src/tables.ts:38-42` | → `pgEnum('account_status', ACCOUNT_STATUSES)` |
| 3 | `packages/connectors/core/src/index.ts:19` | → `accountStatus: AccountStatus` |
| 4 | `packages/connectors/core/src/raw-account.schema.ts:7` | → `z.enum(ACCOUNT_STATUSES)`, **by reference** (I6.10) |
| 5 | `packages/matcher/src/types.ts:16` | → `accountStatus: AccountStatus` |
| 6 | `apps/worker/src/sync.ts:69` | → `accountStatus: AccountStatus` |
| 7 | `apps/worker/src/match.ts:31` | → `account_status: AccountStatus` |
| 8 | `apps/api/src/seed.ts:67` | → `accountStatus: AccountStatus` |
| 9 | `packages/schema/test/tables.test.ts:34` | **Non-member by exclusion.** An EXPECTATION, not a declaration — see I6.1. The exclusion is bound to the **expression position** (an argument to `expect(…).toEqual(…)`), not to the file: a module-scope `const STATUSES = [...]` in a test would be a second declaration and is not excluded. |
| 10 | `packages/matcher/test/match.property.test.ts:21` | → derive the generator from `ACCOUNT_STATUSES` (fixture input) |
| 11 | `apps/api/test/licenses-rollup.integration.test.ts:29` | → `status: AccountStatus` (fixture input type) |

**The single-value subclass.** A site can decide on the status without re-declaring the set, and
the primitive above cannot see it. That subclass is enumerated by:

```bash
rg -n "accountStatus\s*===\s*'|account_status\s*=\s*'" --glob '!node_modules' --glob '!docs' .
```

which returns three hits: a prose comment at `apps/api/src/routes/licenses.ts:18`, and two
decision sites — `packages/matcher/src/match.ts:16`
(`account.accountStatus === 'active' ? 'ghost' : 'matched'`) and
`apps/api/src/routes/licenses.ts:33` (`WHERE sa.account_status = 'active'`).

**This primitive is comparison-shaped, and so is everything below.** The forms swept by hand at
`70f61e4`, each returning empty: `!==`/`!=`/`<>`; `IN (…)`/`NOT IN`/`= ANY(…)`; a bound parameter
(`account_status = $1`); a `switch`/`case`; loose `==`; a double-quoted TypeScript literal; a
comparison through an intermediate variable; an aliased CTE column; a view predicate (none exists
in `packages/schema/migrations/`); a partial index (the only `CREATE INDEX` in
`packages/schema/migrations/` is `0004_discovery_events_created_at_idx.sql:8-9` and it is not
partial; the constraint-backed indexes cannot be); an RLS policy (all **nine**
— `0001_init.sql:102,108,114,120,126,132,138`, `0003:20`, `0006:62` — key on `tenant_id` alone,
as does the `ALTER POLICY` template at `0007:107`); a drizzle predicate (`eq`/`ne`/`inArray` over
`accountStatus`); a JavaScript membership test (`[…].includes(a.accountStatus)`, `Set.has`); and a
SQL column `DEFAULT` (`0001_init.sql:48` is `account_status account_status NOT NULL`, no default).
The enumeration is itself best-effort — it is a list of forms someone thought of — but it is what
was run, and the two sites are the complete set of **comparison** sites as measured at plan time.
That is a measurement, not an enforced property.

Neither decision site re-declares the set, so neither is a C2 member. Both are SC2.

**The producer direction is a different class, and neither primitive can see it.** A site can
*decide which member to emit* without comparing one:

- `packages/connectors/google-workspace/src/index.ts:139-141` —
  `if (user.archived) return 'archived'; if (user.suspended) return 'suspended'; return 'active';`
  This hand-writes all three members in **reverse domain order**, so the primary regex misses it
  (it is order-sensitive) and the comparison regex misses it (no `===`).
- `packages/connectors/slack/src/index.ts:126` — `member.deleted ? 'archived' : 'active'`.
- `apps/api/src/seed.ts:202,210,218,226,249`.

C2 cites the two connector mappers above as evidence that member 3's **type** propagates. That is
true and it is also the limit: their return type is `RawAccount['accountStatus']`, and a mapper
returning a *subset* of a widened union still typechecks. **So a fourth `ACCOUNT_STATUSES` member
is never produced** — a new provider state maps to `'active'`, enters `ROLLUP_SQL`'s `seat` CTE as
a paid seat and `match.ts:16` as `ghost` for a departed identity, with no compile error and no
red. Recorded as SC7 rather than closed here: which provider state maps to a new member is a
connector decision, not a domain derivation.

**No edit required**, listed as the evidence that member 3 propagates:
`packages/connectors/slack/src/index.ts:125` and
`packages/connectors/google-workspace/src/index.ts:138` return `RawAccount['accountStatus']`;
`packages/schema/src/tables.ts:106` uses the `accountStatusEnum` column.

Every package in the table already declares `@open-smp/api-types` as `workspace:*`, verified per
`package.json` — no new dependency edge (Requirement 6).

**Invariants**

- **I2.1 (review-enforced, no observer)** — after C2 there is exactly one runtime *declaration*
  of the member set outside the shipped migration and `tables.test.ts:34`'s transcription. The
  grep that appeared to enforce this cannot: a reordered array, an unspaced union, or a union
  split across lines is a complete second declaration and is invisible to it. What IS
  compiler-backed is weaker and worth naming instead: every consumer imports the type, so a
  re-declaration at a seam is a different type and typecheck reds at the assignment.
- **I2.2 (app-enforced, test-gated)** — `accountStatusEnum` is built from `ACCOUNT_STATUSES`
  rather than a literal. Observer: **I6.8**, a source-text read. I6.1 cannot serve here — it
  compares values, and a re-inlined identical literal produces identical `enumValues`.
- **I2.3 (observed against the real engine)** — the `account_status` type in a freshly migrated
  Postgres has exactly these labels in this order, on the column that uses it, and rejects
  anything else (I6.4).

**Control class**: C2 is a derivation, not a guard. The controls it leans on — I6.1, I6.4, I6.8
— are **fail-closed verification gates**: they cannot pass without deciding and they run in CI.
None is an enforceable boundary.

**Forbidden patterns — what they are.** Best-effort **tripwires against accidental
reintroduction, not enforcement**. Each is an ordered, spacing-sensitive regex with the blind
spots listed under I2.1.

- `/'active',\s*\n?\s*'suspended'/` outside `packages/api-types/src/`,
  `packages/schema/migrations/` and `packages/schema/test/tables.test.ts`.
- `/'active' \| 'suspended' \| 'archived'/` in the post-image.
- `/migrations\/0001_init\.sql/` in the changed-file list (Requirement 7).

**Acceptance criteria**

- `pnpm typecheck` **and** `pnpm build` green (separate tsconfigs).
- `pnpm test` green with no test edited except members 10–11 and the C6 additions.
- *Review aid, not a gate, and it carries no expected count.* Run the derivation command over the
  post-image and **classify every hit**; the number is not the signal. Measured at
  implementation time: **6 matches across 5 files** — the migration (the authority), the new
  `ACCOUNT_STATUSES` declaration, `tables.test.ts:34` (the transcription), **and three the regex
  cannot distinguish from a declaration but which are not one**: `ACCOUNT_STATUS_KEYS` in
  `account-statuses.ts` and the two dictionary blocks in `messages.ts`, whose message keys end in
  the member names (`'accountStatus.active'`, …). Revisions 1–5 predicted 1, then 2, then 3; the
  count was wrong every time, because it depends on the spelling of code the same plan adds. A
  hit that is a *second declaration of the domain* is the finding; a hit that merely spells the
  members is not. A grep cannot make that distinction, which is why this does not gate the
  contract.

### C3 — the web vocabulary and its guarded read

**File**: `apps/web/src/lib/account-statuses.ts` (new).

```ts
export const ACCOUNT_STATUS_KEYS: Record<AccountStatus, MessageKey>;
export function accountStatusKeyFor(status: string): MessageKey | null;
```

Imports are **relative** (`./api-types`, `./i18n/messages`), not the `@/` alias: the root vitest
project resolves no alias, as `label-kinds.ts` and `link-statuses.ts` both record.

**Why a new module** rather than a third vocabulary in `link-statuses.ts`: that file's name
already covers two vocabularies and its docstrings are about the link chip. `label-kinds.ts` is
the precedent for a vocabulary owning its own module.

**Why a third copy of the three-line read rather than an extraction**: the obvious extraction is
`messageKeyFor(keys: Record<K, MessageKey>, value: string)`, and that signature typechecks
`messageKeyFor(LINK_STATUS_KEYS, account.accountStatus)` — map and value become independent
arguments, so a call site can pair the wrong two. The i18n review withdrew an extraction with
exactly this failure mode. A deliberate R1 acceptance.

**Invariants**

- **I3.1 (compile-time)** — keyed by `AccountStatus`, so a fourth member with no copy fails to
  compile. **Bounded**: it holds for a member added to `ACCOUNT_STATUSES`, not for one added to
  the DATABASE only. That case is I6.4's third cell.
- **I3.2 (app-enforced)** — `accountStatusKeyFor` returns `null` for any value outside the map,
  including `Object.prototype` members. `Object.hasOwn`, not `?? null`: a bare index returns a
  non-nullish value for nine prototype members including `__proto__`, so `??` never fires; `in`
  returns `true` for all of them and would be the wrong adjudicator.

**Control class**: a **fail-closed verification gate** over the render path — it cannot return
without deciding, and every unresolved case returns `null`, which **C5** renders as the raw
value. NOT an enforceable boundary: nothing structurally prevents a future render site from
indexing the map directly. Adjudication authority: `Object.hasOwn`.

**Forbidden patterns** (tripwires; `?.[x]`, `Reflect.get` and a destructure evade the first)

- `/ACCOUNT_STATUS_KEYS\[/` outside `account-statuses.ts` and its test.
- `/\?\?\s*null/` in `account-statuses.ts`.

**Acceptance criteria**: I6.2 and I6.3 green.

### C4 — the dictionary entries

**File**: `apps/web/src/lib/i18n/messages.ts`. Three keys per locale, adjacent to
`identityStatus.*` (`:65-66` / `:310-311`):

| Key | `en` | `ja` |
|---|---|---|
| `accountStatus.active` | Active | 有効 |
| `accountStatus.suspended` | Suspended | 停止中 |
| `accountStatus.archived` | Archived | アーカイブ済み |

**Invariants**

- **I4.1** — same key set in both locales, and `ja` differs from `en`. Both already gated over
  every key by `apps/web/test/i18n.test.ts:36` and `:49` — the latter is exact-set equality over
  every key of the default locale against a one-element allowlist, not a sample. C4 inherits both
  observers and adds none.
- **I4.2** — every key has a reader. `i18n.test.ts:437`'s orphan detector requires the quoted key
  literal outside the dictionary; the three appear as values in `ACCOUNT_STATUS_KEYS`. This is
  satisfied by the map alone and says nothing about the render sites, which is I6.5/I6.6's job.

**Control class**: not applicable — data.

**Acceptance criteria**: `pnpm -F @open-smp/web test i18n` green.

### C5 — the two render sites, and the one that must NOT change

**Changed**: `apps/web/src/app/accounts/page.tsx:135` and
`apps/web/src/app/identities/[identityId]/page.tsx:98`, both currently a bare
`<td …>{…accountStatus}</td>`:

```tsx
{(() => {
  const key = accountStatusKeyFor(item.accountStatus);
  return key ? t(key) : item.accountStatus;
})()}
```

**This is not the idiom used further down each file.** The `linkStatus` cells 8 lines below on
`/accounts` and 7 below on the identity page pass `key ? t(key) : undefined` into `StatusChip`,
which does its own raw-value fallback at `apps/web/src/components/StatusChip.tsx:17`
(`{label ?? status}`). Account status has no chip, so the fallback is inline. Following the
nearby precedent literally would produce a different fallback semantic than Requirement 2 asks
for.

**Deliberately unchanged**: `apps/web/src/lib/csv-export.ts` keeps `item.accountStatus` verbatim at
`:106` — its only read of the field; `:77` is the header string `'accountStatus'` in `CSV_HEADER`
(Requirement 3), observed by I6.7.

**Consumer-flow walkthrough** — consumers of the rendered text:

- `e2e/specs/*.spec.ts` — reads nothing today; this change adds two consumers (I6.5, I6.6).
  Derivation: `rg -nw 'active|suspended|archived' e2e/` returns only HR-import CSV
  identity-status columns and one comment at `licenses.spec.ts:73`. The search space is what it
  is because of VE6. i18n Round 1 broke three E2E specs by translating a rendered status value a
  spec pinned; this walkthrough is the direct consequence.
- `e2e/fixtures/seed-facts.ts` has **two** parsers, not one:
  `apps/web/test/link-statuses.test.ts:179-220` (the `chip:` binding) and
  `apps/api/test/seed-gate-agreement.test.ts:55-59`, whose `parseFixture` is
  `/\w+:\s*\{\s*email:\s*'([^']+)'[^}]*status:\s*'([^']+)'/g` — a **greedy** `[^}]*` before a
  case-sensitive `status:`. **Constraint on the new fields: camelCase only.** A field spelled
  `account_status:` would be captured as the *link* status for every entry and red that gate for
  all five accounts, in `apps/api`, with a message about the shell seed gate. `accountStatus:` is
  safe because the substring is `Status:`.
- `docs/manual-tests/ui-orphan-list.md:21` covers `/accounts` and lists "account status" as a
  column check (a heading, already translated). `google-workspace-sync.md:38` is an instruction
  about the Google admin console. Both re-checked at implementation time.
- `apps/web/src/lib/csv-export.ts` needs the DOMAIN value, which is why it is on the unchanged
  list and why I6.7 observes it.

**Control class**: not applicable — render.

**Forbidden patterns** (tripwires; `const { accountStatus } = item` evades both)

- `/\{item\.accountStatus\}/` and `/\{account\.accountStatus\}/` in `apps/web/src/app/`.
- `/t\('accountStatus\./` — a hardcoded key at a call site bypasses `ACCOUNT_STATUS_KEYS`, so a
  fourth member stops being a compile error.

**Acceptance criteria**: I6.5, I6.6, I6.7 green. The forbidden-pattern sweep is a **review aid,
not a gate**, for the same reason C2's is.

### C6 — the observers

| ID | Observer | File | Reddens when |
|---|---|---|---|
| I6.1 | `accountStatusEnum.enumValues` equals the hand-written literal `['active','suspended','archived']`, comment added naming `0001_init.sql:8` as its source | `packages/schema/test/tables.test.ts:34` (comment added) | the domain is reordered or loses a member without the migration |
| I6.2 | `Object.keys(ACCOUNT_STATUS_KEYS).sort()` equals `[...ACCOUNT_STATUSES].sort()` | `apps/web/test/account-statuses.test.ts` (new) | the map gains an extra key or loses one. **Sorted deliberately**, matching `link-statuses.test.ts:118`: unsorted, a cosmetic reorder of three map lines would red with no defect, and the map's insertion order has no relationship to `0001_init.sql:8`. Order is I6.1's and I6.4's to own. |
| I6.3 | `accountStatusKeyFor` returns `null` for `constructor`/`toString`/`valueOf`/`hasOwnProperty`/`__proto__`/`''`/`not_a_status`, **and the exact key per member as a literal** | same | the guard degrades to `?? null` (deny side, on the five prototype keys); the map is mis-wired to another vocabulary's key (allow side) |
| I6.4 | three cells against a real engine: `pg_enum` labels ordered by `enumsortorder` equal `[...ACCOUNT_STATUSES]`; `saas_accounts.account_status` is the type that carries them; `'not_a_status'::account_status` is rejected | `packages/schema/test/link-status-enum.integration.test.ts`, **filename kept**, second `describe` added | the migration and the domain disagree; the column is repointed at a same-labelled type; the enum stops rejecting |
| I6.5 | `/accounts?status=matched` under the `ja` cookie: `SEEDED_ACCOUNTS.matched`'s row shows the seeded ja string and not `active` | `e2e/specs/i18n.spec.ts` | the `/accounts` render site is reverted |
| I6.6 | `/identities/<matched identity>` under the `ja` cookie: the account row shows the seeded ja string | same, as its own test with its own `ja` navigation | the identity-page render site is reverted |
| I6.7 | the emitted CSV cell **located through the header** is exactly `"active"` | `apps/web/test/csv-export.test.ts` | the export is translated, or the header/field lists drift apart |
| I6.8 | `packages/schema/src/tables.ts` source text matches `/pgEnum\(\s*'account_status'\s*,\s*ACCOUNT_STATUSES\s*,?\s*\)/`, and the comment-stripped source contains no `'suspended'` or `'archived'` literal | `packages/schema/test/tables.test.ts` (new cell) | `tables.ts` stops deriving — including the re-inlining of an identical literal, which I6.1 cannot see |
| I6.9 | `matchAccounts`' outcome for a `left` identity, one account per status, against a **total** `Record<AccountStatus, 'ghost' \| 'matched'>` | `packages/matcher/test/match.property.test.ts` | **at compile time**, a fourth member is added with no decision recorded (a missing key); **at runtime**, `match.ts:16`'s comparison changes. The runtime leg is the one the mutation harness can run, and it is what makes SC2's link executable |
| I6.10 | `rawAccountSchema.shape.accountStatus.options` **is** `ACCOUNT_STATUSES` (`toBe`, not `toEqual`) | `packages/connectors/core/test/raw-account.test.ts` | the array is spread at the call site, which silently discards the freeze |
| I6.11 | the RT9 fixture binding: `e2e/fixtures/seed-facts.ts` parsed as `accountStatus`/`accountStatusText` pairs, floored at the fixture's own `email:` count, every domain value a member, and every display string equal to `translate('ja', ACCOUNT_STATUS_KEYS[status])` | `apps/web/test/account-statuses.test.ts` | the E2E fixture's copy drifts from the dictionary it mirrors, or the field disappears from the fixture |

**Why I6.1 keeps its literal.** Deriving it would make it `[...[...X]] === [...X]`: `pgEnum` at
`drizzle-orm@0.45.2` is `pgEnumWithSchema(enumName, [...input])` with `enumValues: values`, a
verbatim order-preserving copy, so a derived-vs-derived comparison has no content. And I6.4 needs
Docker (VE2), so deriving I6.1 would leave `pnpm test` without Docker with no signal on I1.1.
Keeping the literal makes it an **independent transcription of the authority** — a check on the
domain, not a copy of it. It is genuinely independent because it pre-dates `ACCOUNT_STATUSES`
(the cell is unchanged from `main`).

**Why I6.8 exists separately, and its two scoping constraints.**
`apps/api/test/accounts-query-domain.test.ts:21-34` is the in-repo precedent and its comment
states the reason: a re-inlined union with the same members produces a byte-identical validator,
so the derivation is observable only in the source text. I6.8 is that shape for `pgEnum`, with
two differences the precedent does not have to handle:

- **It strips comments inline**, copying the **body of `apps/api/test/strip-ts-comments.ts`** —
  not importing it (`packages/schema` does not depend on `apps/api`, so a cross-package test
  import would either fail to resolve or drag a foreign path into the package's typecheck
  program), and **not** the two-regex form at `api-types-boundary.test.ts:35-37`. That file exists
  precisely because the naive form is wrong: its own docstring records that a `//` inside a string
  is not a comment, and the naive form strips `/*…*/` first, so a `/*` inside a string deletes
  everything to the next `*/` — the false-**green** direction for a negative literal check.
  `tables.ts` is dense with `sql\`…\`` templates and I6.8 is I2.2's only observer, so the robust
  form is the one to carry. (Verified: no such shape is reachable in `tables.ts` today, which is
  why this is a latent hazard rather than a present bug — and why copying the corrected body costs
  nothing.) Keep its "not handled: a regex literal containing `/*`" note.
- **The forbidden literal set is `'suspended'` and `'archived'`, NOT `'active'`.**
  `packages/schema/src/tables.ts:33` is `pgEnum('identity_status', ['active', 'left'])` — a
  different domain that legitimately contains `'active'` in code, not in a comment. Forbidding it
  would red on an intact file. `'suspended'` and `'archived'` appear nowhere else in `tables.ts`,
  so together with the positive `pgEnum(…, ACCOUNT_STATUSES)` match they pin the derivation
  without a false red. The precedent got to forbid its whole domain only because
  `matched|orphan|ghost|ambiguous` collides with nothing in its file.

**Why I6.9 goes through `matchAccounts` and not `deriveStatus`.** Deriving
`match.property.test.ts`'s generator from `ACCOUNT_STATUSES` does **not** red on a fourth member:
`deriveStatus` runs only after a rule hit, so a fourth status yields `status: 'matched'` with a
non-null `identityId`, which satisfies the file's "identityId is null iff orphan or ambiguous"
cell; the other two cells are a length check and a determinism check. A total expectation map
fixes that — but it must be exercised through `matchAccounts`, because `deriveStatus` is
module-private (`packages/matcher/src/index.ts` exports `matchAccounts` and the rules, not it).
That is the better call path anyway (RT5): the observer runs the production primitive rather than
a helper reached around it. The cell seeds a `left` identity and one account per member of
`ACCOUNT_STATUSES`, each matching by primary email so every account takes the rule-hit path, and
asserts the resulting `status` against `Record<AccountStatus, 'ghost' | 'matched'>` — the same
idiom C3 uses for `Record<AccountStatus, MessageKey>`, where a missing key is a compile error.
The call path was traced: `matchAccount` accumulates hits over **identities**, not accounts, so
one identity plus three accounts on its primary email gives `hits.length === 1` each time and the
`ambiguous` branch (which needs two matching identities) never fires. The expectation is
`{active: 'ghost', suspended: 'matched', archived: 'matched'}` — two outcomes over three inputs,
so the runtime assertion is not carried by the compile error.

**Why I6.10 reads `.options` and not `_def.values`.** `get options() { return this._def.values }`
returns the same object, so the two are equivalent — but `.options` is zod's public surface, it is
what `apps/api/test/accounts-query-domain.test.ts:38` already uses for exactly this question, and
a patch bump that memoised `_def` would false-red the freeze observer. One caveat for whoever
copies the spelling next: it works here only because `accountStatus` is not `.optional()`. On an
optional field `shape.X` is a `ZodOptional` and `.unwrap()` is required first.

**I6.5/I6.6 hazards**, both concrete:

- **The default tab.** `apps/web/src/app/accounts/page.tsx:59` resolves an unrecognised
  `?status=` to `'orphan'`, so a bare `goto('/accounts')` renders only the two orphan-linked
  accounts. I6.5 navigates to `?status=matched` and scopes to `SEEDED_ACCOUNTS.matched.email`,
  which is the account `i18n.spec.ts:72` and `identity.spec.ts:23,28` already use — and
  `identities/[identityId]/page.tsx:97` renders the email in the row, so
  `getByRole('row', { name: new RegExp(email) })` is proven by an existing spec.
- **Strict mode.** Asserting under `ja` avoids the collision `en` would have: `identityStatus.active`
  is already `'Active'` (`messages.ts:65`), while under `ja` it is 在籍 and account status is 有効.
  The only other 有効 in the dictionary is `saasapp.invalidJson` (`:489`), which renders on
  `/apps`. Row-scoping is belt-and-braces on top of that.

**RT9 — the fixture binding, stated rather than delegated.** `e2e/fixtures/seed-facts.ts` gains
**two** new camelCase fields per entry, because the guards below need both a domain value and a
display string and the existing `status:` field cannot supply the first — it holds the **link**
status (`'matched'`, `'ghost'`, …, `:22,28,34,40,46`), so `ACCOUNT_STATUSES.includes(status)` is
false for every entry:

- `accountStatus: 'active'` — the domain value, a second hand-synced copy of `seed.ts`'s, which
  is the duplication class the fixture header at `:1-3` already declares ("cross-checked, not
  re-derived");
- `accountStatusText: '有効'` — the **`ja`** copy. Its neighbours' `chip:` holds `en`; the
  asymmetry is deliberate, must be named in the fixture comment, and exists because I6.5/I6.6
  assert under the `ja` cookie. A reader assuming symmetry writes `'Active'` and the cell asserts
  nothing.

Both names are camelCase and therefore safe against `seed-gate-agreement.test.ts:57`'s greedy
`[^}]*status:` (the substring is `Status:`, capital S) and against `link-statuses.test.ts:201`'s
`chip:` pairing.

The binding cell is modelled on `apps/web/test/link-statuses.test.ts:179-220`, parsing
`/accountStatus:\s*'([^']+)'[^}]*?accountStatusText:\s*'([^']+)'/g`, with one leg **deliberately
not carried over**: that model asserts `new Set(parsed statuses) === new Set(LINK_STATUSES)`,
which under VE6 is `{'active'}` against a three-member domain and would red on arrival. Its job
there is to stop the derived count going vacuous when the field disappears from every entry
(`0 === 0` passes). The substitutes:

- `expect(pairs.length).toBe([...source.matchAll(/email:/g)].length)` — the denominator is the
  fixture's own entry count, so deleting the field everywhere gives `0 !== 5` rather than passing
  vacuously. Verified: `seed-facts.ts` has exactly five `email:` occurrences, all inside
  `SEEDED_ACCOUNTS`, none in a comment, and every one corresponds to a seeded account;
- `expect(pairs.every(([, s]) => ACCOUNT_STATUSES.includes(s))).toBe(true)` and non-empty;
- `expect(display).toBe(translate('ja', ACCOUNT_STATUS_KEYS[status]))` — **`ja`**, not `en`.

This cell is **I6.11**. It lives in `apps/web/test/account-statuses.test.ts`, which already reaches
`ACCOUNT_STATUSES`, `ACCOUNT_STATUS_KEYS` and `translate`, and it has its own mutation row — an
observer with no row, or no ID, is what the last two rounds kept finding.

**Mutation obligation.** Each observer is verified by a mutation cut at the site it claims to
cover — not at a shared helper, one per call site. The table names, for each mutation, every
observer it reds: a mutation that reds three says less than one that reds one, and revision 2's
table claimed isolation it did not have.

**The "Reds" column lists OBSERVERS, not gates.** `scripts/mutate.mjs:81-88` runs only
`pnpm exec vitest run --project <unit|integration> <target>` — never `tsc`, never `eslint`, never
Playwright. Vitest strips types without checking them, so a mutation that reds `pnpm typecheck`
produces a *green* harness run and a `SURVIVED` verdict. Where a mutation also reds a gate the
harness does not run, the row says so, and that leg is verified by running the gate directly.

| Mutation | Reds |
|---|---|
| `tables.ts` — re-inline the identical literal | **I6.8 only** (also reds `pnpm lint`: the `ACCOUNT_STATUSES` import goes unused) (I6.1 compares values and cannot see it; the post-mutation state is `main`, which is green) |
| `tables.ts` — re-inline a **reordered** literal | I6.1 and I6.8 (same lint note). Both legs of I6.8 fire: the positive match fails, and any reordering still contains `'suspended'` and `'archived'` |
| `packages/api-types` — reorder the domain | I6.1 and I6.4 (**not** I6.2, which sorts; **not** a migration edit — Requirement 7) |
| `packages/api-types` — drop `'archived'` | I6.1, I6.2, I6.4 — **plus `pnpm typecheck` at every site that assigns the dropped literal** — C3's `Record<AccountStatus, MessageKey>`, I6.9's map, `packages/matcher/test/corpus.ts:213,430`, and both connector mappers, where a *narrowed* union makes `return 'archived'` unassignable. Enumerating them is what keeps going wrong; the property is what matters |
| `packages/api-types` — add `'pending'` with no copy and no decision | I6.1, I6.2, I6.4, **I6.9 at runtime** (the expectation map has no `pending` key, so the assertion compares against `undefined`) — **plus `pnpm typecheck`** twice. A probe, not a shippable state |
| `packages/matcher/src/match.ts:16` — `account.accountStatus === 'active'` → `=== 'archived'` (the anchor must carry `account.accountStatus`: `=== 'active'` alone occurs twice, at `:12` for the identity's status) | I6.9 (twice over: `active` yields `matched` where `ghost` is expected, `archived` the reverse) **and `packages/matcher/test/precision.test.ts`** — the golden-corpus gate, where 5 of 47 expectations invert (`corpus.ts:186,228,243,327` ghost→matched; `:214` matched→ghost) giving 42/47 = 0.894 against a 0.95 floor — **and `apps/worker/test/match.integration.test.ts:129`**, which asserts `ghost` for a `left` identity with an `active` account and resolves the mutated source directly (`packages/matcher/package.json` names `src/index.ts` as `main`). Not an isolating row, and both extra observers are pre-existing. **It also reds three E2E specs**, because `apps/api/src/seed.ts:671` computes the demo's links with `matchAccounts`: `bob.suzuki` moves from `ghost` to `matched` in the seeded database, emptying `/accounts?status=ghost` and redding `accounts.spec.ts:41-43`, `identity.spec.ts:32-34` and `licenses.spec.ts:90-91` (`reclaimable` `2` / `(1 left, 1 unknown)` — the "1 left" IS this ghost). Per the preamble the Reds column lists observers, not gates: the harness `run` list names the three vitest files (the worker one is an `*.integration.test.ts`, so it selects the other project) and the E2E leg is recorded by hand, as VE4 requires |
| `account-statuses.ts` — mis-wire `active` to `'linkStatus.matched'` | I6.3 allow side, `i18n.test.ts:437`'s orphan detector, **I6.5, I6.6 and the RT9 binding cell** — the render sites read the same map, so under `ja` the cell shows 一致 instead of 有効. The one mutation whose blast radius crosses all three tiers, which is what makes I6.3's allow side the *cheap* observer rather than the only one |
| `account-statuses.ts` — `Object.hasOwn` ternary → `?? null` | I6.3 deny side **only**, on the five prototype keys; `''` and `not_a_status` survive it, which is why the prototype keys are the load-bearing inputs |
| `accounts/page.tsx` — revert to `{item.accountStatus}` | **I6.5 only** (also reds `pnpm lint` on the now-unused import) |
| `identities/[identityId]/page.tsx` — revert | **I6.6 only** (same lint note) |
| `csv-export.ts:106` — `item.accountStatus` → `item.accountStatus === 'active' ? '有効' : item.accountStatus` | **I6.7 only**. Spelled with **no free identifier**: `csv-export.ts` imports only types and C5 keeps it unchanged, so `accountStatusKeyFor` would not resolve and the mutation would red the whole file by `ReferenceError` — proving nothing about I6.7, which is the RT7 failure this row exists to avoid. Anchor `item.accountStatus` is unique (`:77` is the header *string* `'accountStatus'`, not a field read) |
| `seed-facts.ts` — in the **`ghost`** entry, `accountStatusText: '有効'` → `'Active'` | **I6.11 only**. A non-`matched` entry deliberately: `e2e/specs/i18n.spec.ts:72` binds `SEEDED_ACCOUNTS.matched`, so mutating that entry would red I6.5 and I6.6 too. The anchor needs entry context — `accountStatusText: '有効'` occurs five times once RT9 lands — so it carries the preceding `chip: 'Ghost',`. **Not `slackOrphan`**: it and `orphan` share `status: 'orphan'` / `chip: 'Orphan'`, so that pair is not unique and `applyOnce` (`mutate.mjs:46-52`) would error. `chip: 'Ghost',` is |
| `raw-account.schema.ts` — `z.enum([...ACCOUNT_STATUSES])` | **I6.10 only** |

Per VE4 the **two render-site rows** cannot go through `scripts/mutate.mjs` and are run by hand
against a booted stack, recorded with their observed output. The CSV row is a unit target and runs
in the harness normally. Two rows are split across tiers: the `account-statuses.ts` mis-wire and
the `seed-facts.ts` edit each have harness-runnable legs *and* E2E legs, so the harness verdict
covers the former only and the E2E legs are recorded by hand alongside the render-site rows.

### C7 — the manual test record

**File**: a new section in `docs/manual-tests/ui-orphan-list.md`, placed **after step 8 and after
`## Expected result`**, under a heading that announces it writes. The ordering reason is that a
destructive write must come after every non-destructive observation so it cannot perturb steps
1–8 — *not* that step 8 propagates the change, which it does not: `:23` says the sync **fails**
against fake seed credentials, so match never runs and nothing reclassifies through `match.ts:16`.
Placing it after `## Expected result` (`:25-27`, "All steps pass") keeps that line covering the
steps it was written for; the new section carries its own expected-result line.

The doc's header (`:3-8`) ends "nothing here is manual-only". Adding this section makes that false
and **naming another spec does not repair it** — I6.5/I6.6 pin the `ja` render of the seeded
`active` account, and per VE6 nothing at any tier reaches `suspended`/`archived`. So the clause is
**retracted**, not extended: steps 1–8 stay attributed as they are, `e2e/specs/i18n.spec.ts`
(I6.5/I6.6) is named for the `active` account-status render, and the new section is marked
manual-only with VE6 as the reason.

Four rendering observations, two per page. **The `en` pair is confirmatory only and the doc says
so**: `en` copy is title-case of the domain value (SC4), so a half-applied change renders
`active` where `Active` is expected — a difference a manual observer will sign off in the
reverted state. The `ja` pair is the discriminating one.

The out-of-domain rendering cannot be produced through the UI — the column is a DB enum — so it
is **not observed at all**, and Requirement 8 records that as its first stated exception. I6.3
pins `accountStatusKeyFor`'s `null` return and I6.4's third cell pins the engine's rejection;
neither observes what the render does *with* a `null` key. Naming them as coverage would be the
R41 shape.

Where the section perturbs the database it does so in one fenced block containing the mutation,
its inverse, and the re-seed as fallback, scoped `WHERE id = '<accountId>'`, **run as the bootstrap
superuser** — `docker compose exec postgres psql -U opensmp -d opensmp`, per
`docker-compose.yml:8-10`, which is the only role that exists and the only one that bypasses RLS. Naming the session is not pedantry: `saas_accounts` carries
`FORCE ROW LEVEL SECURITY` with `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`
(`0001_init.sql:112-116`) and the app role is never granted a bypass (`:141-145`), so from an
app-role session with `app.tenant_id` unset the predicate is NULL and the statement reports
`UPDATE 0` **with no error** — in the forward direction that reads as a broken render, and in the
inverse direction it leaves the row perturbed while the operator believes it restored. So the
block states that the expected output of both directions is `UPDATE 1`. The scoping matters
because `saas_accounts` is multi-tenant and manual-test docs get copy-pasted; the **restore**
matters because flipping a seeded google-workspace account to `suspended` drops it from
`ROLLUP_SQL`'s `seat` CTE and reds `e2e/scripts/assert-seed-preserved.sh`'s
`assert_license 'google-workspace' 'assigned' '4'`, a gate that runs in CI immediately after
`pnpm test:e2e`, and `'unassigned' '-1'` at `:117` with it. It is recoverable —
`apps/api/src/seed.ts:607-613` upserts `account_status = EXCLUDED.account_status` — but the
operator must be told.

## Testing strategy

- **Unit** — I6.1, I6.8 (schema), I6.2/I6.3 (new `apps/web/test/account-statuses.test.ts`,
  modelled on `link-statuses.test.ts`), I6.7 (existing csv-export file, cell located through the
  header, since `CSV_HEADER` (`csv-export.ts:73-88`) and the `fields` array (`:102-117`) are two
  hand-maintained parallel lists with no gate that they stay aligned). `cellFor`
  (`csv-export.test.ts:311-316`) is the shape but **not reachable**: it is declared inside
  `describe('buildLicensesCsv')`, so either hoist it to module scope or write the three-line
  equivalent in `describe('buildAccountsCsv wiring')`. It also does `record.split(',')`, which is unsafe
  against any cell containing a comma, so I6.7 uses a minimal comma-free fixture rather than
  reaching for `maliciousItem`. Column name `accountStatus`, asserted cell the
  literal `"active"`), I6.9 (matcher), I6.10 (`packages/connectors/core/test/raw-account.test.ts`),
  I6.11 (the RT9 fixture binding, alongside I6.2/I6.3).
- **Integration** — I6.4, in the existing `link-status-enum.integration.test.ts` under a second
  `describe`. The filename is kept: `tables.test.ts:26-28`, SC3 and SC5 all cite it by name, and
  a rename stales three citations to save nothing. The file now covers two enums on one container
  boot, which is the reason it is not a new file.
- **E2E** — I6.5 and I6.6, in `e2e/specs/i18n.spec.ts`, which already sets the `ja` cookie and
  already visits both routes. Every status vocabulary this repo routes through the dictionary has
  an E2E pin on its render (`accounts.spec.ts:27`, `identity.spec.ts:39`); skipping it would make
  `accountStatus` the first without one.
- **Mutation** — the table in C6, against a green suite and a clean tree (`scripts/mutate.mjs`
  exits 2 on a dirty tree and restores with `git checkout -- .`).
- **Gates** — `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, each read by its own exit
  status, never through a pipe.

## Considerations & constraints

### Scope contract

| ID | Deliberately out of scope | Owner / trigger / cost |
|---|---|---|
| SC1 | Narrowing the wire type from `string` to `AccountStatus` at the API row boundary | Trigger: the API validating the row rather than casting it. Cost of deferring: `apps/web` keeps a guarded read it would not need — assessed as *safer* than the alternative, since the alternative is a bare `as` over an unvalidated value. |
| SC2 | Two decision sites absorb a fourth status. **They are not equally covered and the difference is stated rather than averaged.** `packages/matcher/src/match.ts:16` is **already** pinned executably at `70f61e4` by the golden-corpus gate (`packages/matcher/test/precision.test.ts`, 0.95 over 47 expectations). What I6.9 adds is different and still worth having: an **exact per-member** assertion where the corpus is a ratio a single flipped case survives (46/47 = 0.979), plus **compile-time totality** — a fourth member cannot be added without recording a `ghost`/`matched` decision. It does not make the link executable; it makes it exact and total. `apps/api/src/routes/licenses.ts:33` gets **none** — C2 member 11 widens a fixture field's type, and widening a union forces no test to add a case. | Trigger: a fourth member added to `ACCOUNT_STATUSES`. Cost of deferring the licences half: the `seat` CTE (`ROLLUP_SQL:27-37`) is the sole source for `assigned`, `ghost`/`orphan`, `needs_review`, `unlinked`, `unassigned` and `reclaimable_value` (`:49-66`), so a fourth status drops out of every figure `/licenses` produces — `reclaimable` and `reclaimableValue` move in the direction that hides waste, and an `ambiguous` account in that status leaves the review queue with no signal. Not closed here because the executable form needs one seeded account per member in an integration test, which is a rollup-semantics change rather than a domain derivation. (The comment at `licenses.ts:16-20` is about the sync **watermark** at `:34-36`, not this filter — cited here so the next reader does not go to `:33` looking for it.) |
| SC3 | `identityStatusEnum` (`packages/schema/src/tables.ts:33`) remains a hand-written second declaration while `linkStatusEnum` and (after C2) `accountStatusEnum` derive. | Trigger: `IdentityDetailResponse['status']` gaining a domain in `@open-smp/api-types` — the trigger this plan discharges for `accountStatus`. Cost, measured: `rg -n "pg_enum" --glob '!node_modules' --glob '!docs' .` returns four hits, of which two are comments (`api-types/src/index.ts:83`, `schema/src/tables.ts:46`) and two are the only executed queries (`link-status-enum.integration.test.ts:52`, `api.integration.test.ts:1613`, the latter for `account_label_kind`). So a migration adding an identity-status label produces neither a compile error nor a red; it reaches `identityStatusKeyFor` as an unmapped value and renders raw. |
| SC4 | The `en` copy is title-case of the domain value, so the `en` direction is nearly a visual no-op. | Trigger: product copy review. Not a defect. This is also why C7's `en` observations are confirmatory only. |
| SC5 | `packages/schema/test/tables.test.ts:30` derives **both** sides of the `link_status` comparison from `LINK_STATUSES`, making it tautological given `pgEnum`'s pass-through. | Trigger: the next change to that file. Cost: `link_status`'s order is pinned only by `link-status-enum.integration.test.ts:59`, i.e. only where Docker is available. Verified: of the seven order-sensitive `LINK_STATUSES` comparisons in the tree, `:59` is the only one comparing the domain's order to an independent authority. |
| SC6 | **Two different defects, not one.** (a) `apps/api/test/accounts-query-domain.test.ts:12-14` carries the same "`z.enum` snapshots its members at construction" phrasing C1 corrects — a wrong mechanism under a *right* conclusion (a re-inlined union with the same members is byte-identical either way). (b) `apps/api/src/label-kinds.ts:15` exports an **unfrozen** `[...ACCOUNT_LABEL_KINDS, 'none', 'any'] as const` that `apps/api/src/routes/accounts.ts:23` holds by reference in `z.enum(LABEL_FILTERS)`. | Trigger: the next edit to either file. Cost of (a): a false reason is what licenses the next edit (R29). Cost of (b): measured over the whole tree, `LABEL_FILTERS` is the only **reachable** unfrozen array backing a `z.enum` — every other named-export site closes over an `Object.freeze`d export, and the one remaining inline literal (`raw-account.schema.ts:7`) is unreachable, which is exactly what C2 changes, and the C39 gate cannot reach this one because it lives in `apps/api/src`. The fix is `Object.freeze(…)` around the existing expression — **not** a de-spread, which is impossible: `LABEL_FILTERS` is deliberately wider than the domain. Deferred only because the file is not in this diff. Not a live vulnerability: `label` reaches SQL as a bound parameter or a hard-coded `IS NULL`/`IS NOT NULL` branch (`accounts.ts:114-121`) under `withTenant`, so a widened domain yields a 500 rather than an injection or a tenancy crossing — and widening it at all needs code execution in the API process. The residual is propagation (R3): it is the in-tree idiom an implementer would copy, which is why I6.10 exists. |
| SC7 | The **producer** direction: `packages/connectors/google-workspace/src/index.ts:139-141` and `packages/connectors/slack/src/index.ts:126` decide which member to emit, in a form neither C2 primitive can see, and their `RawAccount['accountStatus']` return type accepts a subset of a widened union. | Trigger: a fourth member added to `ACCOUNT_STATUSES`. Cost of deferring: the member is never *produced* — a new provider state falls through to `'active'`. For an account linked to a **departed** identity that inflates `reclaimable`/`reclaimableValue`, the *surfacing* direction (an operator is told to reclaim a seat the provider already revoked — a false positive, wasteful but loud). For one linked to an **active** identity it inflates `assigned` and shrinks `unassigned`, which is the **hides-waste** direction `licenses.ts:16-20` names as "the one direction this feature must not be wrong in". Nothing in this class can hide live access, because the mapping only ever collapses states *into* `'active'`, never out of it. No compile error and no red in either direction. Not closed here because which provider state maps to a new member is a connector decision requiring provider knowledge, not a domain derivation. Surfaced by this plan rather than created by it: the gap exists at `70f61e4`. |
| SC8 | The `*StatusKeyFor` read now exists in three copies (`link`, `identity`, `account`) plus a fourth near-twin, `chipClassFor`, which returns a non-null fallback rather than `null`. C3 declines the extraction; the Phase 2 self-check found the *reason* it gave was too narrow — it ruled out the POSITIONAL form `messageKeyFor(keys, value)`, which the i18n review withdrew, while a CLOSURE form `keyLookup(MAP)` binds the map at construction and has no mis-pairing failure mode at all. | Trigger: a fourth vocabulary, or any change that already has `apps/web/src/lib/link-statuses.ts` open. Cost of deferring: three copies of a three-line read drift independently, and the fourth (`chipClassFor`) would sit outside whatever is extracted. Not taken here because bound to one map the closure has a single consumer — indirection, not reuse — and reaching the other two means editing a shipped module carrying two vocabularies and their observers, which this plan's scope does not cover. The corrected reasoning is recorded in `apps/web/src/lib/account-statuses.ts`'s docstring so the next reader inherits the real argument rather than the narrow one. |
| SC9 | `apps/web/src/app/events/page.tsx:85-86` renders `{event.source}` and `{event.kind}` raw under translated headings (`events.source` → ソース, `events.kind` → 種別). That is the fifth and last member of the class this change closes on `/accounts` and `/identities/[identityId]`, and it is recorded in neither `i18n-code-review.md`'s residue list nor SC1–SC8. | Trigger: the next i18n pass, or a product decision about event vocabulary. Cost of deferring: a Japanese reader sees ソース / 種別 over `google-workspace` and `sync.completed`. **There is a defensible answer** — event kinds are dotted machine identifiers, so verbatim may be right for the same reason the CSV export stays raw (Requirement 3) — but nobody has written it down, and the class is now closed everywhere except here with no record of why. Not decided here because it is a product-copy question about a file this change does not touch. |

### Risks

- **The `en`-looks-unchanged trap.** Because `en` copy ≈ the raw value, a half-applied change
  (map added, render site not switched) looks correct under `en` and is visible only under `ja`.
  I6.5/I6.6 are the behavioural check; the forbidden-pattern greps are a review aid.
- **The freeze is load-bearing on the ingest validator, and only by reference.** At
  `zod@3.25.76`, `ZodEnum` stores `_def.values` by reference and builds its `Set` cache lazily on
  first parse. Measured **from `packages/connectors/core`** (the repo root has no hoisted `zod`
  and the command fails there with `MODULE_NOT_FOUND`):

  ```bash
  cd packages/connectors/core
  node -e "const {z}=require('zod');const a=['active','suspended','archived'];const s=z.enum(a);a.push('pwned');console.log(s.safeParse('pwned').success)"   # true
  ```

  With a parse before the push it prints `false`; with `Object.freeze(a)` the push throws. So the
  widening window is real but closes at the first **string-valued** parse of that field —
  `ZodEnum._parse` returns `INVALID` for a non-string *before* it builds the cache, so any number
  of non-string parses leave the window open. "Could widen", not "would". Two
  consequences the plan acts on: C1's corrective comment edit, and I6.10, because
  `z.enum([...ACCOUNT_STATUSES])` typechecks identically, satisfies C39 (which sweeps the
  package's exports, not call sites), passes every other observer, and silently discards the
  control. The spread form is an existing idiom here (`apps/api/src/label-kinds.ts:15`), so it is
  the likely mistake rather than the adversarial one. The exposure is new: `raw-account.schema.ts`
  today passes an unreachable inline literal, and C2 replaces it with a reachable exported
  reference.
- **`pnpm typecheck` passing does not imply `pnpm build` passes** (separate tsconfig).

## User operation scenarios

1. **Japanese operator triages `/accounts`.** 「アカウント状態」 over 有効 / 停止中 /
   アーカイブ済み, beside a tab strip that has read Japanese since the i18n cycle.
2. **The same operator opens an identity detail page.** The attributed-accounts table translates
   from the same map; the `table.accountStatus` heading is already shared between the two pages,
   which is what made the untranslated values read as an inconsistency.
3. **The same operator exports CSV.** The file still contains `active`. A spreadsheet filter
   written against `active` keeps working, and two operators on different languages produce
   byte-identical exports.
4. **A future migration adds `pending` to the `account_status` type but not to
   `ACCOUNT_STATUSES`.** I6.4 reds. If it reached production first, the page renders `pending`
   verbatim rather than `⟨accountStatus.pending⟩` or an empty cell.
5. **A developer adds `pending` to `ACCOUNT_STATUSES` and forgets the copy.** `pnpm typecheck`
   reds at `Record<AccountStatus, MessageKey>` and again at I6.9's expectation map — so the
   `ghost`/`matched` decision must be made deliberately rather than defaulted. They also red at
   I6.4 until the migration exists, which is the correct order of complaint: storage first.
   Two places stay silent, both recorded: `/licenses`'s seat counts (SC2) and the connector
   mappers, which keep emitting the old three (SC7). The second is why "add a member" is a probe
   rather than a shippable state — until a connector decides when to emit it, the member exists in
   the domain and never in the data.

## Go/No-Go Gate

| ID | Subject | Status |
|----|---------|--------|
| C1 | `ACCOUNT_STATUSES` / `AccountStatus`, the web barrel re-export, and the corrective comment edit | pending |
| C2 | Every hand-written spelling of the triple derives from C1 | pending |
| C3 | `ACCOUNT_STATUS_KEYS` + `accountStatusKeyFor` in `apps/web` | pending |
| C4 | Dictionary entries in `en` and `ja` | pending |
| C5 | The two render sites translate; CSV export does not | pending |
| C6 | The eleven observers, each with a mutation table row naming every observer it reds | pending |
| C7 | Manual test section in `ui-orphan-list.md`, with its manual-only clause retracted | pending |

No contract locks until plan review closes.

## Implementation Checklist

Authored in Phase 2 Step 2-1 from its own impact analysis. Not a findings list — Phase 3 reads
this as the set of files that must appear in the diff.

### Files that must be modified

**C1 — the domain**
- `packages/api-types/src/index.ts` — add `ACCOUNT_STATUSES` (frozen, migration order) + `AccountStatus`; rewrite the `LINK_STATUSES` docstring at `:16-20` (both errors); leave `:84-89` untouched.
- `apps/web/src/lib/api-types.ts` — `AccountStatus` into the type block (`:34-60`, compile-enforced); `ACCOUNT_STATUSES` into the value block (`:23-32`, review-enforced).

**C2 — the derivations** (9 edits; members 1 and 9 are non-members by exclusion)
- `packages/schema/src/tables.ts:38-42` → `pgEnum('account_status', ACCOUNT_STATUSES)`
- `packages/connectors/core/src/index.ts:19` → `accountStatus: AccountStatus`
- `packages/connectors/core/src/raw-account.schema.ts:7` → `z.enum(ACCOUNT_STATUSES)` **by reference**
- `packages/matcher/src/types.ts:16` → `accountStatus: AccountStatus`
- `apps/worker/src/sync.ts:69`, `apps/worker/src/match.ts:31`, `apps/api/src/seed.ts:67` → `AccountStatus`
- `packages/matcher/test/match.property.test.ts:21` → generator from `ACCOUNT_STATUSES` (fixture input)
- `apps/api/test/licenses-rollup.integration.test.ts:29` → `status: AccountStatus` (fixture input type)

**C3/C4/C5 — the web side**
- `apps/web/src/lib/account-statuses.ts` (new) — `ACCOUNT_STATUS_KEYS`, `accountStatusKeyFor`
- `apps/web/src/lib/i18n/messages.ts` — three keys in each locale, adjacent to `identityStatus.*`
- `apps/web/src/app/accounts/page.tsx:135`, `apps/web/src/app/identities/[identityId]/page.tsx:98`
- `apps/web/src/lib/csv-export.ts` — **unchanged**, verified by I6.7

**C6 — the observers**
- `packages/schema/test/tables.test.ts` — I6.1 comment; I6.8 new cell (inline `stripTsComments` body)
- `apps/web/test/account-statuses.test.ts` (new) — I6.2, I6.3, I6.11
- `packages/schema/test/link-status-enum.integration.test.ts` — I6.4, second `describe`, filename kept
- `e2e/specs/i18n.spec.ts` — I6.5, I6.6
- `e2e/fixtures/seed-facts.ts` — `accountStatus` + `accountStatusText` on all five entries
- `apps/web/test/csv-export.test.ts` — I6.7
- `packages/matcher/test/match.property.test.ts` — I6.9
- `packages/connectors/core/test/raw-account.test.ts` — I6.10 (file exists)

**C7** — `docs/manual-tests/ui-orphan-list.md`

### All-test-tree enumeration (R19)

`accountStatus` / `account_status` appears in three test roots, all enumerated above:
centralized `test/` (`packages/*/test`, `apps/*/test`), and `e2e/`. There is **no** co-located
`*.test.ts` beside source anywhere in this repo — verified: every test file lives under a `test/`
or `e2e/specs/` directory. No parallel tree is left stale.

### Shared utilities that MUST be reused (R1/R2)

The two mechanical scanners were run and produced nothing usable here —
`build-codebase-fingerprint.sh` fails on this platform (`declare -A` needs bash 4; macOS ships
3.2) and `scan-shared-utils.sh` found no shared-module directories because this repo's shared code
lives in `packages/*` and `apps/web/src/lib`, which its pattern does not match. Supplied by manual
search instead, which is what the step's fallback prescribes:

- `apps/web/src/lib/i18n/messages.ts` — `MessageKey`, and `translate` from `./i18n/translate`. Do not add a second key type or a second translate.
- `apps/web/src/lib/link-statuses.ts:83-87` — `linkStatusKeyFor`'s `Object.hasOwn` shape. `accountStatusKeyFor` is a deliberate third copy (C3); do NOT extract a shared `messageKeyFor`.
- `packages/api-types/src/index.ts:21-26` — the `Object.freeze([...] as const)` idiom. Not `BILLING_CYCLES`'s one-line form; multi-line, matching `LINK_STATUSES`.
- `apps/api/test/strip-ts-comments.ts:20-44` — copy the **body** into `packages/schema/test/`; do not import across packages.
- `apps/web/test/csv-export.test.ts:311-316` — `cellFor`'s shape. It is block-scoped inside `describe('buildLicensesCsv')`, so hoist it or write the local equivalent.
- `apps/web/test/link-statuses.test.ts:179-220` — the fixture-binding cell's shape for I6.11, minus the set-coverage leg (see RT9).
- `packages/schema/test/link-status-enum.integration.test.ts:43,62,76` — I6.4's three cells.

### CI gate parity (Step 2-1 item 7)

`extract-ci-checks.sh` emits `pnpm lint` / `pnpm typecheck` and then defers on multi-line `run:`
blocks. Enumerated by hand from `.github/workflows/ci.yml`:

| CI gate | Local equivalent | Disposition |
|---|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` (`checks`) | same commands | covered |
| "Every assigned test file is inside a typecheck program" (`checks`) | none | **Relevant**: new test files must sit inside a member's tsconfig program. Verified in advance — `packages/connectors/core/tsconfig.json` includes `test`, and every other new cell lands in a file or directory already covered. Re-run the gate's own commands locally before pushing. |
| `pnpm test:integration` (`integration`) | same | covered (needs Docker, VE2) |
| `pnpm test:e2e` + "the suite executed its whole discovered set" (`compose-smoke`) | `pnpm test:e2e` | The discovered-vs-executed check is self-consistent, not a pinned count, so two added specs pass it. Needs a booted stack. |
| `bash e2e/scripts/assert-seed-preserved.sh` (`compose-smoke`) | none | **Relevant to C7 only** — the manual perturbation must be restored or this reds. Not affected by the code change. |
| `bash scripts/assert-ci-executed.sh` (`audit`) | none | Requires `GH_REPO`/`GH_RUN_ID`; cannot run locally. **Deferred parity gap — reason: needs a GitHub run id, which does not exist before push.** Not affected by this change (adds no CI job or step). |
| `pnpm audit --prod` (`audit`) | same | covered; adds no dependency |

**There is no local pre-PR aggregate script in this repo**, so no script to extend. Recorded
rather than invented: adding one is a repo-wide decision outside this plan's scope, and the four
gates above that have no local equivalent are each either verified in advance or inapplicable to
this diff.
