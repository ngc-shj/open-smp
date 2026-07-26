# Plan: sc42-derive-link-status-domain

Cycle 5. Branch: `feature/sc42-derive-link-status-domain`
Date: 2026-07-27
Base: `main` @ `284a446`

Contract numbering: `C40`– (C1–C39 belong to prior cycles; C30/C34/C35/C36 were withdrawn in cycle 3
and their IDs stay retired).
Scope-out numbering: `SC43`– (SC1–SC42 taken).

---

## Why this plan is short

Same reason as cycle 4, and the measurement now covers two cycles rather than one. Cycle 3 specified
greps, regexes, and test placements in prose and its plan review ran three rounds without converging;
cycle 4 specified only invariants and member-sets, and its review ran one round with four findings,
none of which was about how a gate is spelled.

This cycle is the same class of work as C37 — collapse a duplicated closed domain onto one
declaration and gate the collapse — so it inherits the same discipline: state **what must be true**
and **which sites are members**, and settle regexes, file placement, and grep shapes by execution
during implementation, recording them in the deviation log.

**Plan review**: one round, scoped to whether the invariants and member-sets are right.

---

## Project context

- **Type**: `web app` — pnpm monorepo (Fastify API, Next.js 15 web, BullMQ worker, Postgres 16 + RLS, Redis)
- **Test infrastructure**: unit + integration + E2E + CI/CD
  - unit: Vitest, **241 tests / 25 files**
  - integration: Vitest + Testcontainers, **140 / 5**
  - E2E: Playwright against the compose stack, **43**
  - CI: `.github/workflows/ci.yml`, three jobs, SHA-pinned, shape-gated by C32
- **Baseline**: `main` @ `284a446`, clean, no open PRs. CI observed green on main: run `30210090059`.

### Verification environment constraints

Inherited from cycle 4; only the changed rows are annotated.

| ID | Constraint | Status this cycle |
|----|-----------|-------------------|
| VE1 | No live Google Workspace tenant | `blocked-deferred`, untouched — no contract crosses the provider boundary |
| VE2 | Compose images carry no source mount; E2E needs `docker compose up -d --build api web worker` | `verifiable-local`, applies to C40 |
| VE3 | Integration needs Docker (Testcontainers) | `verifiable-local` + `verifiable-CI` — **binding on C41**, whose gate is a `pg_enum` read |
| VE4 | E2E needs the running compose stack | `verifiable-local` + `verifiable-CI` |
| VE6 | E2E login budget is 5/5 at 5/min/IP — zero headroom | Binding: no contract here may add a login |
| VE7 | The root vitest config resolves no `@/` alias and matches `.ts` only — a module a unit test reaches may use `@/` for type-only imports but not runtime ones, and a `.tsx` module cannot be unit-tested | `verifiable-local`. **Binding on C40 at two sites, not one** (corrected after plan review): `TABS` lives in `page.tsx`, and `CHIP_CLASSES` lives in `StatusChip.tsx` **and is not exported**. Both must become reachable from the unit tier — the relocation `label-filters.ts` took in cycle 4. Missing the second is the cycle-3 Critical's exact shape |
| **VE8** | **New.** `packages/matcher` has no dependency on `@open-smp/api-types` today, and unlike `packages/schema` it also has no `dependencies` block at all. Adding the edge means adding the block. | `verifiable-local`, applies to C42 |

---

## Objective

Close SC42: the `LinkStatus` domain is written out by hand in nine places, and the deferral note that
opened SC42 named three of them.

The note is quoted here because the gap between it and the tree is the reason this plan's member-set
is derived from code rather than from the note:

> SC42 — `LINK_STATUSES` (`apps/api/src/routes/accounts.ts:10`) duplicates the `LinkStatus` union in
> `api-types` — the same class C37 closes for label kinds, and `apps/web/src/app/accounts/page.tsx:15`
> holds a third copy as `TABS`.

Three copies named; **nine** declarations in the tree. The six the note missed are the two in
`packages/matcher` (`types.ts:25`, and `match.ts:11`'s narrowed return type), the drizzle enum in
`packages/schema/src/tables.ts:33-38`, `CHIP_CLASSES` in
`apps/web/src/components/StatusChip.tsx:1-6`, the `upsertLink` parameter in
`apps/worker/src/match.ts:63`, and the per-status chip rules in
`apps/web/src/app/globals.css:12-25`.

| # | Site | Today | A fifth status added to the domain… |
|---|---|---|---|
| 1 | `packages/api-types/src/index.ts:11` | `type LinkStatus` union | the declaration — but a **type**, so it has no runtime member-set |
| 2 | `apps/api/src/routes/accounts.ts:10` `LINK_STATUSES` | hand-written array | **silent** — a shorter `z.enum` just rejects the new value as an invalid query |
| 3 | `apps/web/src/app/accounts/page.tsx:16` `TABS` | hand-written array typed `LinkStatus[]` | **silent** — a shorter list is still a valid array; the tab simply never renders |
| 4 | `packages/matcher/src/types.ts:25` `LinkResult.status` | hand-written union | **silent** — the matcher cannot emit a status it does not declare |
| 5 | `packages/matcher/src/match.ts:11` `deriveStatus` | narrowed union `'matched' \| 'ghost'` | correctly narrower; **not a copy of the domain** — see below |
| 6 | `packages/schema/src/tables.ts:33-38` `linkStatusEnum` | hand-written array | fails `tables.test.ts:17` — but only against a **literal copy of itself** |
| 7 | `apps/web/src/components/StatusChip.tsx:1-6` `CHIP_CLASSES` | `Record<string, string>` keyed by all four | **silent, with a rendered fallback** — see below |
| 8 | `apps/worker/src/match.ts:63` `upsertLink`'s `link.status` | hand-written union, inline | **fails loudly, in a package no contract looked at** — see below |
| 9 | `apps/web/src/app/globals.css:12-25` chip rules | hand-written CSS class per status | **silent, and underivable** — see below |

**Sites 8 and 9 were both added after plan review, and the reason each was missed is different.**

**Site 8 — the write path — was not a blind spot; it was seen and misclassified.** All three reviewers
found it independently. The quoted-literal grep *did* surface `apps/worker/src/match.ts:63`, and the
first draft of this plan read past it because the search was scoped by hypothesis (`packages/` plus
the two `apps/` files already known to be copies) rather than by result. That makes it a worse miss
than site 7, which was structurally invisible.

It is also the most consequential site in the set, because of where it sits: `upsertLink` is the
function that writes `account_links.status` into Postgres (`apps/worker/src/match.ts:70-91`), so this
union is the last type-level checkpoint before a status value reaches the `link_status` enum column.
Sites 2, 3, 6, 7 are all read-side. This one is the write path, and it was in no member-set.

Two concrete consequences the first draft would have hit mid-implementation:

- **FR1 was false as written.** After the cycle as originally planned, adding a fifth status would
  still need a second hand edit, in `apps/worker`. `pnpm typecheck` runs `-r`, and `apps/worker`
  depends on `@open-smp/matcher`, so deriving `LinkResult['status']` while leaving `upsertLink`'s
  parameter narrow makes `upsertLink(…, { status: result.status, … })` stop assigning
  (`TS2322: Type 'LinkStatus' is not assignable to type '"matched" | "orphan" | "ghost" | "ambiguous"'`,
  observed).
- **C40's acceptance grep would have failed on first execution**, because site 8 is a quoted status
  literal in none of the exempt categories. The dangerous repair is to add the file to the grep's
  exclusion list, which converts a real finding into a permanently blessed exception.

**Site 9 — the CSS — is the one member of this class that cannot be derived at all.** `CHIP_CLASSES`
names a class per status; those classes must exist as rules, and Tailwind v4's `@apply` needs literal
class names, so no TS array can generate them. It was missed because the first draft's grep scope was
`*.ts`/`*.tsx`/`*.sql` — one file extension away from the site-7 blind spot, in the same shape.

Its failure mode survives everything else this cycle does: after I40.5 makes a missing chip *class
name* a compile error, a class name that exists in TS with no matching CSS rule is neither a compile
error nor a test failure. The chip renders with only the base `.status-chip` rule — an unstyled chip
rather than a grey one. That is arguably *harder* to notice than the hole C40 closes. Site 9 is
therefore listed, given a gate rather than a derivation (C40/I40.6), and its underivable remainder is
deferred as SC45.

**Site 7 was found by looking for what the grep could not see, and it is the only site with a live
weakness.** The member-set above was first derived by grepping quoted status literals; that form
structurally cannot see a list whose members are *object keys*. Cycle 4's plan review raised exactly
this (FN-1, Major) about `LABEL_KIND_NAMES`, so the grep was re-run for key-shaped members — which is
what surfaced `CHIP_CLASSES`.

It is worse than `LABEL_KIND_NAMES` was. That map is a `Record<AccountLabelKind, string>`, so a new
kind makes it a **compile error**. `CHIP_CLASSES` is typed `Record<string, string>` and read through
`CHIP_CLASSES[status] ?? 'status-chip bg-neutral-100 text-neutral-700'` — a fifth status compiles,
renders, and silently takes the grey fallback chip. Nothing fails; the chip is just the wrong colour
on every page that shows a link status.

**The obvious fix does not compile, and plan review proved it by execution.** The first draft said
"widening its type to `Record<LinkStatus, string>` is the fix". Under `apps/web/tsconfig.json`'s
`strict: true`, that declaration plus the retained string-indexed read is:

```
error TS7053: Element implicitly has an 'any' type because expression of type 'string'
can't be used to index type 'Record<"matched"|"orphan"|"ghost"|"ambiguous", string>'.
```

The read must stay string-indexed because the wire type is `string` (I40.5). So the fix is a **split**
— a domain-keyed *declaration* and a string-indexed *read*, two different types at two sites — not one
retype. This matters because the cheapest way out of TS7053 is to widen the declaration back, which
silently reverts the only live-weakness fix in the cycle while leaving I40.5 reading as satisfied.
I40.5 therefore states the two properties and leaves the spelling to execution; acceptance criterion 3
does not catch the reverted form, so the split is stated here rather than left to be rediscovered.

Site 6's test is the exact defect C37's acceptance criterion 2 fixed one function below it: at
`packages/schema/test/tables.test.ts:29-31` the label-kind enum is asserted against the domain, while
at `:17` the link-status enum is still asserted against a transcription of itself. The two sit in the
same `describe` block.

**Site 5 is listed and deliberately not derived.** `deriveStatus` returns `'matched' | 'ghost'`
because those are the only two statuses reachable when a rule has hit exactly one identity — orphan
and ambiguous are returned by other paths in `matchAccount`. It is a genuine narrowing, not a stale
copy, and widening it to the full domain would *lose* type information. It appears in the member-set
so that an implementer reading the table knows the carve-out exists and what it is for; cycle 4's
plan review raised precisely this omission (FN-1) about `LABEL_KIND_NAMES`.

**Non-objective**: no new user-facing feature, no new route, no schema migration. Behaviour-preserving
throughout, except that a fifth status would newly appear as an accounts tab without a web edit.

---

## Requirements

- **FR1** — Adding a link status requires exactly one domain edit (`LINK_STATUSES` in `api-types`)
  plus the migration, **plus one CSS rule** (site 9). Every other site is either derived from the
  domain or fails loudly. No site may silently accept a stale list.

  **The CSS exception is stated rather than glossed**, corrected after plan review. The first draft
  read "exactly one domain edit plus the migration… every other site is either derived from it or
  fails to compile", which is false twice over: site 8 was unlisted and would have needed a second
  hand edit, and site 9 *cannot* be derived at all — `@apply` needs literal class names. Site 8 is now
  derived (I42.4). Site 9 cannot be, so FR1 admits it and I40.6 makes forgetting it loud. A
  requirement that overstates what the cycle delivers is the same defect as a comment asserting
  something the code does not do.
- **FR2** — `LinkStatus` becomes a runtime member-set that the type derives from, matching how
  `ACCOUNT_LABEL_KINDS`/`AccountLabelKind` already relate. Today `LinkStatus` is a bare type union, so
  there is nothing for the consumer sites to derive *from* — this is why the current duplication
  is not merely untidy but unavoidable.
- **FR3** — `packages/schema/test/tables.test.ts:17` asserts the drizzle enum against the domain, not
  against a literal copy of itself.
- **NFR1** — No behaviour change an operator can observe, except FR1's consequence above.
- **NFR2** — No existing test deleted or weakened. Test counts increase.
- **NFR3** — Every new gate is proven able to fail, by an executed mutation, before it is accepted.

---

## Technical approach

### FR2 is the enabling change, and it comes first

`ACCOUNT_LABEL_KINDS` is a frozen array with `AccountLabelKind` derived from it via
`(typeof ACCOUNT_LABEL_KINDS)[number]`. `LinkStatus` has no such array. Every contract below depends
on creating one, and the shape is already established in the same file — including I39.3's
`Object.freeze`, which this new array must carry for the same reason: it will back a `z.enum()` in a
request-validation path.

**Order matters**: the domain's declaration order becomes the accounts tab order and the Postgres
enum's sort order, and those two are *not* the same today.

- `linkStatusEnum` / migration `0001_init.sql:7`: `matched, orphan, ghost, ambiguous`
- `TABS` (render order): `orphan, ghost, ambiguous, matched`

The migration's order is **immutable** — a Postgres enum's declaration order is its sort order, and
`0001_init.sql` has shipped. So the domain array must take the migration's order, and the web tab
order becomes a separate, deliberately hand-written list. This is the same split C37 made between
`ACCOUNT_LABEL_KINDS` (membership, domain order) and `LABEL_FILTER_OPTIONS` (render order, local).

I40.3 below pins the tab order precisely because the derivation must not silently reorder it.

### The dependency decision for `packages/matcher` (VE8)

Deriving `LinkResult.status` from the domain requires `matcher → api-types`.

**Decision: add it.** Verified acyclic by the same argument C37 used for `schema → api-types`:
`packages/api-types/src/index.ts` contains **zero import statements** and its `package.json` declares
no dependencies, so it is a leaf; `packages/matcher/src` imports only from within itself. A new edge
into a leaf cannot create a loop. `packages/schema` already carries this exact edge as of cycle 4,
so this is the second instance of an established pattern, not a new one.

**Rejected alternative**: leave the matcher's union hand-written and gate it with a type-level
equality assertion (`expectTypeOf<LinkResult['status']>().toEqualTypeOf<LinkStatus>()`). That keeps
the declaration duplicated while making the *test* better — FR1 would stay false — and it adds a
type-testing idiom the repo does not currently use anywhere.

### Where the web-side lists land (VE7)

**Two web-side sites are governed by VE7, not one.** The first draft named only `TABS`, and plan
review raised the omission as Critical — because the missing one is site 7, the site this plan calls
the worst of the set.

`TABS` is in `page.tsx`, which the unit project cannot transform. If the tab list is to be tested
directly it must move to a `.ts` module under `apps/web/src/lib/`, importing from `@/lib/api-types`
via a **relative** path, exactly as `label-filters.ts` does and for the same recorded reason.

`CHIP_CLASSES` is in the same position **and worse**: `StatusChip.tsx` is a `.tsx` file *and*
`CHIP_CLASSES` is not exported — the file's only export is the `StatusChip` component itself. So
acceptance criterion 3 ("each domain status maps to a distinct chip class, asserted directly") cannot
be written against the tree as it stands, in either respect.

**This is the exact class of the cycle-3 Critical this plan's opening section cites** — a proposed
unit test that could not exist because the module was `.tsx` and the value unexported. The first draft
recorded that lesson and then applied it to only one of the two sites it governs.

The invariant is therefore: the chip-class map must be **reachable from the unit tier**. Whether that
means moving it to a `.ts` module beside `label-filters.ts`, exporting it in place and relocating the
component's import, or another arrangement is an implementation decision made by execution — the
constraint is that `StatusChip` must keep rendering from the *same* module the test asserts against,
so the production primitive stays on the call path (RT5). Asserting against a transcription of the
class strings in a test file satisfies criterion 3 on paper while reintroducing exactly the
self-comparison defect C41 exists to remove; that is not an acceptable resolution.

`apps/web/src/lib/api-types.ts` must re-export the new runtime value, per its own stated policy that
it is "the one place shared types and values cross into the web app". That barrel edit is the web-side
half of the boundary C39 gates on the package side — and C39's gate must keep passing, since the new
array is a frozen primitive constant and nothing else.

---

## Contracts

Each contract states the invariant and the code-derived member-set. **How each gate is written is
deliberately unspecified.**

### C40 — the link-status domain is derived everywhere it can be

**Invariants**

- **I40.1 (structural)** — `@open-smp/api-types` exports a frozen `LINK_STATUSES` array in the
  migration's order (`matched, orphan, ghost, ambiguous`), and `LinkStatus` derives from it.

  **The freeze is required, but the first draft's reason for it was wrong** — corrected after plan
  review, by execution. The draft said the array "backs `z.enum()` in the accounts query validator, so
  an unfrozen array is mutable into a widened request domain". `z.enum` does not work that way: it
  snapshots its member list at construction, and `accountsQuerySchema` is built at module load
  (`apps/api/src/routes/accounts.ts:15-22`), so a later mutation cannot widen it. Observed on the
  repo's zod (v3.25):

  ```text
  before push,          parse 'c': false
  after push, SAME schema,  parse 'c': false   <- the actual path; unchanged
  after push, NEW schema,   parse 'c': true    <- only a schema built after the push
  ```

  Asserting a security property the code does not have is the same defect class as cycle 4's SEC-1,
  inverted — that one claimed `as const` froze an array that was mutable; this one claimed a freeze
  protected a path that was never exposed. Both are only visible by running something.

  The two real reasons, either of which is sufficient:

  1. **C39's boundary gate requires it.** `apps/api/test/api-types-boundary.test.ts:115` asserts
     `Object.isFrozen` for *every* array exported from the package, regardless of consumer. An
     unfrozen `LINK_STATUSES` fails that gate on arrival.
  2. **It keeps a future guard honest.** The live-widening path is a guard that reads the array on
     every call — `isAccountLabelKind` is exactly that shape, and it is what I39.3 was actually
     protecting. No `isLinkStatus` exists today; the freeze is what makes adding one safe later.
- **I40.2 (structural)** — no module outside the domain declaration contains a hand-written list of
  link statuses. Membership comes from the domain; the accounts **tab order** remains hand-written
  because it differs from the domain order, and is compile-checked as `LinkStatus[]`.
- **I40.3 (behaviour preservation)** — the accounts page renders the same four tabs in the same
  order: `[orphan, ghost, ambiguous, matched]`, and the default status when `?status=` is absent or
  unrecognised remains `orphan`. Every status renders the same chip class it renders today.
- **I40.4 (app-enforced)** — a fifth status added to `LINK_STATUSES` alone either compiles and appears
  everywhere, or fails loudly. Nothing accepts it silently.
- **I40.5 (app-enforced)** — two properties hold of the chip-class map **simultaneously**, and stating
  them as two is the point:

  1. A **domain member with no chip class is a compile error** — not a grey fallback chip.
  2. A **non-domain string is still renderable at runtime** — `StatusChip` takes `status: string`
     because `AccountListItem['link'].status` and `IdentityAccountItem.linkStatus` are bare `string`
     on the wire, so an unexpected value must render a neutral chip rather than crash the page.

  These need a **domain-keyed declaration and a string-indexed read** — two different types at two
  sites. A single `Record<LinkStatus, string>` with a string-indexed read does not compile (TS7053,
  shown above), and the cheapest repair reverts property 1 while leaving the invariant looking
  satisfied. The spelling is settled by execution; what this plan fixes is that a split is required.

  **The runtime permissiveness is not a security relaxation.** Plan review traced the full path: the
  DB column is the `link_status` Postgres enum, so the value is domain-bounded upstream; `{status}`
  is a React text child and therefore escaped; the value never reaches `className` (an out-of-domain
  value takes the hardcoded fallback literal). Keeping property 2 costs a grey chip, nothing more.
- **I40.6 (app-enforced) — added after plan review.** Every class name in the chip-class map has a
  matching rule in `apps/web/src/app/globals.css`. This is site 9, and it is the one member of the
  class that **cannot be derived**: Tailwind v4's `@apply` needs literal class names, so no TS array
  can generate the rules. A gate is the strongest available form — a text read of a file the unit
  tier can do — and it converts an otherwise invisible gap (a class name with no rule renders an
  unstyled chip: no compile error, no test failure) into a loud one.

**Member-set**: sites 1–4 and 6–9 from the Objective table are in scope. Site 5 (`deriveStatus`) is
retained un-derived, for the reason stated there. Test-side occurrences are test data, not copies to
derive: `packages/matcher/test/corpus.ts` (47 expectations, typed
`Pick<LinkResult, 'saasAccountId' | 'status'>` so they track the derived type automatically),
`apps/api/test/api.integration.test.ts`, `apps/web/test/csv-export.test.ts`,
`packages/schema/test/rls.integration.test.ts`, `packages/matcher/test/match.*.test.ts`.
`apps/api/src/seed.ts:353-356` counts links by status for a summary payload and
`apps/web/src/components/EvidencePopover.tsx:23` branches on `'ambiguous'`; both are single-value
predicates, not member-set declarations, and neither is in scope — the seed summary is deferred as
SC44. `e2e/fixtures/seed-facts.ts:5-10` keys four accounts by status and two specs iterate its keys as
the domain; it is deferred as SC46 rather than derived, because it is the same hand-sync as SC33.

**Acceptance**

1. Sites 2, 3, 4, 6, 7 and 8 derive from `LINK_STATUSES`; a repo-wide grep for a quoted status literal
   outside the domain declaration, the migration, the retained narrowing, and test data returns
   nothing — and the grep is asserted to have scanned a non-zero number of files (the anti-vacuity
   rule cycle 3 learned by execution: an empty grep is evidence about the grep). **The grep must be
   run in at least three forms**: quoted literals, object keys, and non-`.ts` file types. The key form
   found site 7; the file-type form found site 9; the quoted form found site 8 and the first draft
   read past it. **No site may be added to the grep's exclusion list to make it green** — an
   exclusion is how a real finding becomes a permanently blessed exception.
2. The rendered tab order is asserted directly, including that it differs from the domain order. The
   E2E accounts spec navigates by `?status=` URL and never enumerates or orders the tab bar, so E2E
   does not cover this and the unit assertion is load-bearing.
3. Each domain status maps to a distinct chip class, asserted directly against the production map —
   the pre-existing four classes unchanged. This is the I40.3 half of site 7. Requires the VE7
   relocation above; asserting against a transcription of the classes in a test file does not satisfy
   this criterion.
4. Every class name in that map resolves to a rule in `globals.css` (I40.6), proven able to fail by
   removing one rule.
5. **NFR3**: adding a fifth status to `LINK_STATUSES` alone is executed and the outcome recorded. The
   expectation spans more than one tree state, so the proof is more than one run. Expected: the tab
   list, `linkStatusEnum`, `CHIP_CLASSES` and **`apps/worker`'s `upsertLink`** fail loudly; the API's
   `z.enum` widens silently and correctly; `globals.css` fails only via I40.6's gate. The worker is
   named explicitly because the first draft's member-set omitted it, and an unlisted failure during
   the proof run is indistinguishable from a broken gate.
6. Existing tests pass unmodified; `pnpm test:e2e` green after a stack rebuild (VE2).

### C41 — the drizzle enum is asserted against the domain

**Invariants**

- **I41.1 (app-enforced)** — `linkStatusEnum.enumValues` is compared to `LINK_STATUSES`, not to a
  literal in the test file. The current form at `tables.test.ts:17` fires only when someone edits
  `tables.ts` and forgets the test — never when the domain moves.
- **I41.2 (app-enforced)** — the domain's order agrees with the shipped Postgres enum's order. The
  drizzle mirror is not the authority here; `0001_init.sql:7` is, and it has shipped.

**Member-set**: `packages/schema/test/tables.test.ts:16-18` (the assertion to fix),
`packages/schema/src/tables.ts:33-38` (the declaration to derive), `migrations/0001_init.sql:7` (the
immutable authority on order). `apps/api/test/api.integration.test.ts` already reads `pg_enum` for
`account_label_kind`; whether the link-status equivalent joins it there is an implementation decision
(VE3 — it needs a live database).

**Acceptance**

1. The test compares against the domain, and is proven able to fail by an executed mutation in both
   directions: reorder the domain; reorder the drizzle enum.
2. The relationship between the domain order and the shipped migration's order is asserted by
   something executable rather than asserted in a comment.

### C42 — the matcher and the worker declare their statuses from the domain

**Invariants**

- **I42.1 (structural)** — `LinkResult['status']` is `LinkStatus`, imported from `@open-smp/api-types`,
  not a re-spelled union.
- **I42.2 (structural)** — `deriveStatus`'s `'matched' | 'ghost'` narrowing is retained and its
  reason is recorded in the code, so a later reader does not "fix" it into the full domain and lose
  the narrowing.
- **I42.3 (app-enforced)** — the `matcher → api-types` edge is declared in
  `packages/matcher/package.json`, not merely resolved by workspace hoisting. A type-only import that
  happens to resolve today is not a declared dependency, and the repo's other cross-package edge
  (`schema → api-types`) is declared. Verified undeclared today: `packages/matcher/node_modules`
  contains no `@open-smp` directory, so the import resolves purely by hoisting.
- **I42.4 (structural) — added after plan review.** `upsertLink`'s `link.status` parameter
  (`apps/worker/src/match.ts:63`) tracks `LinkResult`/`LinkStatus` rather than re-spelling the union.
  This is site 8: the value it types is the one written into `account_links.status`, so it is the last
  type-level checkpoint before Postgres.

**Member-set**: `packages/matcher/src/types.ts:25`, `packages/matcher/src/match.ts:11`,
`packages/matcher/package.json` (VE8 — no `dependencies` block exists yet), and
`apps/worker/src/match.ts:63`. `packages/matcher/src` imports nothing outside itself today, verified
by grep over all four source files. `apps/worker/package.json` **already** declares
`@open-smp/matcher` and `@open-smp/schema`, so site 8 can derive through the matcher with no new
package edge — unlike VE8, this needs no manifest change unless it derives from `api-types` directly.

**Acceptance**

1. `packages/matcher` typechecks and its tests pass with the derived type; the 47-case corpus is
   unmodified (it is typed via `Pick<LinkResult, …>`, so it tracks the change without edits).
2. **I42.3 is asserted by something a mutation can redden**: deleting the `dependencies` entry from
   `packages/matcher/package.json` must fail a check. Added after plan review — the first draft's
   criterion was "the declared dependency is present in the manifest", which is an observation of a
   file, not a gate. This is the invariant most likely to decay silently, because workspace hoisting
   keeps resolving the import whether or not the manifest declares it, so nothing else would notice.
3. A fifth status added to the domain does **not** break `packages/matcher`'s compile — it is a
   widening of a produced type, and the matcher simply never emits it. **But it does break
   `apps/worker`**, because `pnpm typecheck` runs `-r` and `upsertLink` receives the widened
   `result.status`. Corrected after plan review: the first draft asserted the workspace-level outcome
   was a non-failure, which is true of the matcher in isolation and false of the repo. Observed:
   `TS2322: Type 'LinkStatus' is not assignable to type '"matched" | "orphan" | "ghost" | "ambiguous"'`.
   Under I42.4 that error disappears — site 8 derives — and the loud failures for I40.4 come from
   sites 3, 6 and 7.

---

## Testing strategy

Every gate lands in the **unit** tier unless it needs a real database (C41's `pg_enum` check, if it
goes there) or a browser. That is the cheapest CI job and where cycle 4's gates went.

**NFR3 is the binding obligation**: no gate is accepted until an executed mutation has made it red.
Cycle 4 ran eight mutations and one of them (M7) exposed a false green a cycle-3 reviewer had
constructed on paper.

**Mutation-site rule, learned by execution in cycle 4 and restated after plan review because the
first draft named the wrong mechanism.**

The rule that matters is about **access mode, not location**: a mutation is worktree-safe if and only
if *every test that must redden* reaches the mutated module by **relative path**. A test that reaches
it through a **package specifier** (`@open-smp/api-types`) may resolve to a different copy than the
one mutated, and then passes green while proving nothing.

The first draft said "a scratchpad worktree's `node_modules` symlink resolves to the main repository".
Plan review checked this and the mechanism is not that. A fresh worktree has **no `node_modules` at
all** — `pnpm test:unit` there fails outright with `vitest: command not found`, which is loud, not a
false green. pnpm's workspace links are *relative*, so they would resolve worktree-locally if
`pnpm install` ran there. The false green appears in the **intermediate state**: a worktree made
runnable by borrowing the main repo's `node_modules`, where the specifier resolves back to main:

```text
require.resolve('@open-smp/api-types/src/index.ts', {paths:['<worktree>/packages/schema']})
  -> <MAIN repo>/packages/api-types/src/index.ts     # not the worktree's mutated copy
```

Stating the trigger matters, because an implementer who checks that their worktree resolves relatively
and concludes the warning does not apply would be right — under the first draft's wording they could
not tell.

**Per-mutation classification for this cycle** (the first draft left this to be derived, and C41's is
non-obvious because one test file mixes both modes):

| Mutation | Read by the reddening test as | Where to run it |
|---|---|---|
| `LINK_STATUSES` (any C40 domain mutation) | specifier, from four packages | **main repo, from a backup, restored** |
| C41 "reorder the drizzle enum" | relative (`../src/tables.js`) | worktree-safe |
| C41 "reorder the domain" | specifier | **main repo** |
| C42/I42.3 manifest edge removal | specifier-side by nature | **main repo** |
| C40/I40.6 remove a `globals.css` rule | relative file read | worktree-safe |

**Test-count expectation**: 241 unit / 140 integration / 43 E2E at `284a446`. Unit count rises; E2E
stays at 43 (C40 changes how the tab list is built, not what it renders — I40.3).

---

## Considerations & constraints

### Risks

- **R-A — C40 changes a rendered UI surface.** The accounts tab bar is built from a list that must
  not silently take the domain's order. This is the single most likely defect in the cycle, because
  the two orders differ and the derivation makes the wrong one convenient. I40.3 pins it and
  acceptance criterion 2 asserts it directly.
- **R-B — the `matcher → api-types` edge is new.** Acyclic and precedented, but it is the second
  package edge into `api-types` and makes that package load-bearing for the matcher's public type.
  Note that `api-types`'s leafness is not merely an observed fact — it is a **gated invariant**
  (`apps/api/test/api-types-boundary.test.ts:43-61`, allowlist-shaped, catching dynamic `import()` and
  `require()`). With a second consumer, a regression in that gate would break two packages instead of
  one. Recorded because it is cheap now and awkward later.
- **R-C — the API's `z.enum` widens silently under I40.4.** This is correct behaviour, not a defect —
  a new status should become a valid filter — but it means the API site is *not* where a stale-list
  failure surfaces. Stating it so the NFR3 run is not misread as a gate that failed to fire.

  **Why the widening is not security-relevant**, added after plan review so a future reader deciding
  about some *other* `z.enum` has the reasoning rather than the conclusion: the status value is bound
  **positionally** (`values.push(status)` with the SQL fragment carrying only `$n` —
  `apps/api/src/routes/accounts.ts:99-102`), so no user-controlled string ever reaches the query text;
  `link_status` is a Postgres enum that independently rejects non-members; and status is not an
  authorization dimension — no RLS policy in any of the five migrations predicates on it. The
  query-filter domain is therefore not a trust boundary. A real fifth status must also decide which
  side of `0001_init.sql:67`'s `CHECK ((status IN ('orphan','ambiguous')) = (identity_id IS NULL))` it
  falls on, which is a second reason SC43 exists.
- **R-D — site 7 is the only site with a live weakness, and retyping it is the only change here that
  can alter a rendered pixel.** `CHIP_CLASSES` currently absorbs any string; after I40.5 it must
  still absorb non-domain strings (the wire type is `string`) while rejecting a missing domain
  member at compile time — which needs the declaration/read split stated there, since the single-type
  form does not compile. Getting it backwards either crashes the accounts page on unexpected data or
  leaves the silent-fallback hole open. Acceptance criterion 3 pins the rendered result. Note that
  keeping the runtime permissiveness is an **availability** choice, not an accepted injection risk —
  see I40.5.
- **R-E — the first draft's member-set was wrong in two directions, and only one was a blind spot.**
  Site 9 (CSS) was invisible to the grep's file-type scope; site 8 (the worker) was **in the grep
  output and read past**. The countermeasure for the first is acceptance criterion 1's three-form
  requirement. There is no mechanical countermeasure for the second — it is a discipline point, and it
  is recorded here because "the grep found it and I classified it as noise" is a failure mode that
  looks nothing like an empty grep.

### Scope contract

| ID | Deferred | Owner / why |
|----|---------|-------------|
| SC33 | The `seed.ts` ↔ `seed-facts.ts` hand-sync. | Inherited, untouched. Trigger: next cycle touching `seed.ts`'s seeded values. This cycle reads `seed.ts:353-356` but changes nothing there. |
| SC37 | Moving `MAX_UPLOAD_BYTES` into `api-types`. | Inherited. C39's gate was widened in cycle 4 to admit scalars, so it is actionable — but it is a different domain from link statuses, and cycle 3's lesson is that a second class added mid-cycle is how scope outgrows its review. |
| SC34, SC35, SC38, SC39 | Inherited, untriggered. | No contract here touches `MUTATION_PATTERN`, compose image staleness, the events projection, or `seed.ts`'s environment guard. |
| **SC43** | A fifth link status has no migration path in this cycle. C40/I40.4's proof adds one to the domain and observes the failures, but adding a status for real needs `ALTER TYPE link_status ADD VALUE` plus a decision about where it sorts. | Out of scope because no status is being added. Trigger: the first real new link status. |
| **SC44** | `apps/api/src/seed.ts:353-356` counts links per status with four hand-written `.filter()` calls, one per status. A fifth status would be silently absent from the summary. | It is a summary payload, not a domain declaration, and deriving it means reshaping a response body — a behaviour change NFR1 forbids here. Trigger: the next cycle touching the sync summary shape. |
| **SC45** | Site 9's underivable remainder. `globals.css:12-25` needs one hand-written rule per status, and Tailwind v4's `@apply` requires literal class names, so the rules cannot be generated from `LINK_STATUSES`. I40.6 gates the *agreement* between the map and the stylesheet; it cannot remove the hand-written rule itself. | Not deferred for cost — deferred because it is **not closable**. Recorded so the cycle does not close claiming the chip path is fully single-sourced. A real fifth status still needs a CSS edit, and I40.6 is what makes that edit impossible to forget. Trigger: n/a — this is the permanent residue, revisited only if the styling approach changes. |
| **SC46** | `e2e/fixtures/seed-facts.ts:5-10` keys four seeded accounts by status, and `accounts.spec.ts:20-25` / `sync.spec.ts:29-33` iterate `Object.entries(...)` over it as the domain. Untyped against `LinkStatus`, so a domain change cannot make it fail to compile. | Found in plan review. Deferred rather than derived because it is the same hand-sync as SC33 and belongs with it: closing it means the E2E fixture importing from a package, a cross-package test dependency the suite does not have. Impact is low — a fifth status is simply not iterated, so the suite stays green and silent rather than going wrong. Trigger: SC33's trigger, or the next cycle touching the E2E fixtures. |

---

## Go/No-Go Gate

| ID  | Subject                                                     | Status |
|-----|-------------------------------------------------------------|--------|
| C40 | Link-status domain derived at all remaining sites (2,3,4,6,7,8) + the CSS gate | **locked** |
| C41 | The drizzle enum is asserted against the domain               | **locked** |
| C42 | The matcher and the worker declare their statuses from the domain | **locked** |

**One review round, nine findings, all applied.** Two Criticals, both of which would have surfaced
mid-implementation as either a scope amendment or a silently weakened gate.

| Finding | Change |
|---|---|
| FN-1 / SEC-2 / TEST-2 [Critical] | **All three experts independently found site 8** — `apps/worker/src/match.ts:63`, a full hand-written union on the DB **write path**, in a package no contract looked at. FR1 was false as written; C40's acceptance grep would have failed on first execution; C42's criterion 3 asserted a workspace-level non-failure that is false under `pnpm typecheck -r`. Added as site 8 with I42.4, and named explicitly in criterion 5's expected-failure list. |
| TEST-1 [Critical] | Acceptance criterion 3 asserted on `CHIP_CLASSES`, which is **unexported and in a `.tsx` file** the unit tier cannot reach. This is the exact class of the cycle-3 Critical this plan's opening cites — recorded as a lesson, then applied to only one of the two sites VE7 governs. VE7's row and the web-side section now cover both. |
| SEC-1 [Major] | **I40.1's freeze rationale was factually wrong**, proven by execution: `z.enum` snapshots its members at construction, and `accountsQuerySchema` is built at module load, so mutating the source array afterwards cannot widen it. Same defect class as cycle 4's SEC-1, inverted — that claimed a freeze existed where it did not; this claimed a freeze protected a path it does not. The freeze is still required, for two other reasons now stated. |
| FN-2 [Major] | **I40.5's stated fix does not compile.** `Record<LinkStatus, string>` with the retained string-indexed read is TS7053 under `strict`. The cheapest repair reverts the fix while the invariant still reads as satisfied. Restated as two properties needing a declaration/read split. |
| FN-3 [Major] | **Site 9** — `globals.css:12-25`, one hand-written rule per status. Missed because the grep scope was `*.ts`/`*.tsx`/`*.sql`: one file extension from site 7's blind spot, same shape. Underivable (Tailwind `@apply` needs literals), so it gets a gate (I40.6) and a deferral (SC45) rather than a derivation. |
| TEST-3 [Major] | **C42 had no gate a mutation could redden** — a regression check, a file observation, and an explicitly self-cancelling non-failure. I42.3 is the invariant that decays silently, since hoisting resolves the import whether or not the manifest declares it. Criterion 2 is now a gate. |
| TEST-4 [Minor] | The mutation-site rule named the wrong **mechanism** (a fresh worktree has no `node_modules` at all and fails loudly; the false green needs the borrowed-`node_modules` intermediate state) and left the per-mutation classification to be derived — non-obvious for C41, whose single test file mixes both access modes. Restated by access mode, with a table. |
| SEC-3 [Minor] | R-C stated the `z.enum` widening was safe without the reasoning. Added: positional binding, the DB enum as an independent boundary, and status not being an authz dimension. |
| SEC-4 / SEC-5 [Minor] | I40.5's runtime permissiveness recorded as an availability choice, not an accepted injection risk (DB enum bounds it upstream; React escapes the text child; the value never reaches `className`). R-B now cites the boundary test as what *keeps* `api-types` a leaf. |
| FN-4 [Minor] | `e2e/fixtures/seed-facts.ts` keys accounts by status and two specs iterate its keys as the domain — deferred as SC46 alongside SC33. |

**The single round held, and the findings show the method working rather than failing.** Every one is
about invariants and member-sets: a class member omitted, a property asserted that execution refutes,
a test that cannot exist, a contract with no provable gate. None is about how a gate is spelled.

**What this round cost, stated plainly**: the first draft claimed seven sites and there are nine. The
member-set grew 29% under review — which is the review doing its job, but it is also the second
consecutive cycle where the plan's member-set was incomplete at first draft. The durable lesson is
narrower than "grep harder": site 9 was a scope blind spot with a mechanical fix (criterion 1's
three-form rule), while **site 8 was in the grep output and read past**. Only the first is fixable by
a better search.

---

## Implementation Checklist

Derived at Phase 2 Step 2-1 by executing the three grep forms acceptance criterion 1 mandates.
**Result: the plan's nine sites are confirmed exactly — no tenth site.** The forms and their hits:

| Form | What it found |
|---|---|
| quoted literals, src only | sites 2, 3, 4, 5, 6, 8 + the two single-value predicates (out of scope) |
| object keys | site 7, `seed.ts:353-356` (SC44), `e2e/fixtures/seed-facts.ts` (SC46) |
| non-`.ts` filetypes | site 9, `0001_init.sql:7` + `:67`, and `ci.yml:101-135` |

**New observation — `ci.yml:101-135`** hardcodes `?status=orphan` and `?status=ghost` in the
compose-smoke assertions. Classified **out of scope**: these are single-value smoke assertions of the
same shape as `EvidencePopover.tsx:23`, not member-set declarations. A fifth status does not make them
wrong. Recorded here because the grep found them and silence would be indistinguishable from a miss.

### Files to modify

| File | Change | Contract |
|---|---|---|
| `packages/api-types/src/index.ts` | add frozen `LINK_STATUSES`; derive `LinkStatus` from it | C40/I40.1 |
| `apps/api/src/routes/accounts.ts:10` | delete local `LINK_STATUSES`, import from domain | C40, site 2 |
| `apps/web/src/lib/api-types.ts` | re-export `LINK_STATUSES` as a value | C40, barrel |
| `apps/web/src/app/accounts/page.tsx:16` | `TABS` moves out; import it | C40, site 3 |
| `apps/web/src/lib/link-statuses.ts` *(new)* | `ACCOUNT_TABS` + chip-class map, unit-reachable | C40/VE7, sites 3+7 |
| `apps/web/src/components/StatusChip.tsx` | read the map from the `.ts` module | C40/I40.5, site 7 |
| `packages/schema/src/tables.ts:33-38` | derive `linkStatusEnum` from the domain | C40, site 6 |
| `packages/schema/test/tables.test.ts:17` | assert against the domain, not a self-copy | C41/I41.1 |
| `packages/matcher/src/types.ts:25` | `status: LinkStatus` | C42/I42.1, site 4 |
| `packages/matcher/package.json` | declare the `api-types` edge | C42/I42.3, VE8 |
| `apps/worker/src/match.ts:63` | derive `upsertLink`'s `status` | C42/I42.4, site 8 |
| `apps/web/src/app/globals.css` | unchanged — gated, not derived | C40/I40.6, site 9 |

### Reuse obligations (no new helpers)

- `apps/web/src/lib/label-filters.ts` is the **precedent** for the new `.ts` module: relative imports
  (no `@/` alias — VE7), a `readonly` typed export, and the comment explaining why it is not `.tsx`.
- `apps/api/src/label-kinds.ts` is the precedent for the API-side re-export (`export { X as Y } from`
  plus a separate value import when the local scope needs it).
- `packages/schema/test/tables.test.ts:29-31` is the precedent for C41's assertion shape.
- `apps/api/test/api-types-boundary.test.ts` already gates the freeze — no new freeze gate needed.

### CI gate parity

`extract-ci-checks.sh` extracts `pnpm lint` and `pnpm typecheck`; it reports the multi-line `run:`
blocks in `ci.yml` need manual review. Manually derived, CI runs three jobs:

- `checks`: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`
- `integration`: `pnpm test:integration` (Testcontainers)
- `compose-smoke`: stack boot, `assert-seed-preserved.sh`, `pnpm test:e2e`

The repo has **no `scripts/pre-pr.sh`**, so there is no local aggregate to diff against — the parity
obligation is discharged by running all three job sets locally before Phase 3. No CI-only gate exists
that a local run cannot reproduce (VE2/VE3/VE4 govern the stack-dependent ones).
