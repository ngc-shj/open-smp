# Plan: sc40-derive-label-domain-and-gates

Cycle 4. Branch: `feature/sc40-derive-label-domain-and-gates`
Date: 2026-07-27
Base: `main` @ `403de2b`

Contract numbering: `C37`– (C1–C36 belong to prior cycles; C30/C34/C35/C36 were withdrawn in cycle 3
and their IDs stay retired).
Scope-out numbering: `SC42`– (SC1–SC41 taken).

---

## Why this plan is short

Cycle 3's plan review ran three rounds (13 → 19 → 12 findings) and did not converge. The findings
were overwhelmingly defects in the *previous round's fixes*, and they clustered in one place:
specifications for greps, regexes, and test placements whose correctness is only observable by
running them. Round 3's Critical was that a proposed unit test **could not exist** — the function was
unexported and `apps/web/tsconfig.json` sets `jsx: preserve`, so the vitest unit project cannot
transform the module. That is a five-minute discovery at a keyboard and a three-round discovery on
paper.

The work deferred as SC40 is exactly that category. So this plan states **what must be true** and
**which sites are members of each class**, and deliberately does not specify how the checks are
written. Regexes, test file placement, and grep shapes are decided during implementation, by
execution, and recorded in the deviation log.

**Plan review**: one round, scoped to whether the invariants and member-sets are right. Not to how
the gates are spelled.

---

## Project context

- **Type**: `web app` — pnpm monorepo (Fastify API, Next.js 15 web, BullMQ worker, Postgres 16 + RLS, Redis)
- **Test infrastructure**: unit + integration + E2E + CI/CD
  - unit: Vitest, **218 tests / 22 files** (root `vitest.config.ts`, globs `packages/**/*.test.ts`, `apps/**/*.test.ts`)
  - integration: Vitest + Testcontainers, **140 / 5**
  - E2E: Playwright against the compose stack, **43**
  - CI: `.github/workflows/ci.yml`, three jobs, all SHA-pinned as of cycle 3
- **Baseline**: `main` @ `403de2b`, clean. CI observed green on main: run `30206293886`.

### Verification environment constraints

| ID | Constraint | Status this cycle |
|----|-----------|-------------------|
| VE1 | No live Google Workspace tenant | `blocked-deferred`, untouched — no contract here crosses the provider boundary |
| VE2 | Compose images carry no source mount; E2E needs `docker compose up -d --build api web worker` | `verifiable-local`, applies to C39 |
| VE3 | Integration needs Docker (Testcontainers) | `verifiable-local` + `verifiable-CI` |
| VE4 | E2E needs the running compose stack | `verifiable-local` + `verifiable-CI` |
| VE6 | E2E login budget is 5/5 at 5/min/IP — zero headroom | **Binding on C38**: the seed gate performs a login. Moving or duplicating it must not add one. |
| **VE7** | **New.** The root vitest config resolves no `@/` alias, and both projects match `.ts` only — not `.tsx`. A module reachable from a unit test may not use the alias for a *runtime* import, and a `.tsx` module cannot be unit-tested at all. | `verifiable-local`. This is what cycle 3's round-3 Critical was; recording it so it constrains design rather than being rediscovered. |

---

## Objective

Finish the job cycle 3 started and honestly reported as unfinished: make the label-kind domain
single-sourced everywhere it is derivable, and give the three ungated properties real gates.

Cycle 3 collapsed copies 1 and 2 into `@open-smp/api-types` and pinned copy 3 (the DB enum) with a
`pg_enum` test. Three copies remain, and cycle 3's plan says so rather than claiming otherwise:

| # | Site | Today | A fourth kind added to the domain… |
|---|---|---|---|
| 4 | `packages/schema/src/tables.ts:43-47` `accountLabelKindEnum` | hand-written array | fails `tables.test.ts` — but only against a **literal copy of itself** |
| 5 | `apps/web/src/components/LabelFilter.tsx:11-13` `FILTERS` | hand-written entries | **silent** — a shorter list is still a valid array |
| 6 | `apps/web/src/app/accounts/page.tsx:17-23` `LABEL_FILTERS` | hand-written array typed `LabelFilterValue[]` | **silent** — same reason |

Copies 5 and 6 are the failure `apps/api/src/label-kinds.ts` has warned about in prose since cycle 1
("settable but not filterable, with nothing failing"), reproduced in the package that comment does
not reach.

**Non-objective**: no new user-facing feature, no new route, no schema migration. Behaviour-preserving
throughout, except that a fourth kind would newly appear in the web filter bar without an edit.

---

## Requirements

- **FR1** — Adding a label kind requires exactly one domain edit (`ACCOUNT_LABEL_KINDS`) plus the
  migration. Every other site is either derived from the domain or fails to compile. No site may
  silently accept a stale list.

  This is cycle 3's withdrawn FR6, restated once. It was withdrawn there because delivering it needs
  `packages/schema` to depend on `@open-smp/api-types`, which cycle 3's scope statement forbade.
  **This cycle lifts that restriction** — see the Technical approach.
- **FR2** — The seed acceptance gate's asserted values agree with `e2e/fixtures/seed-facts.ts`, and a
  drift in either direction fails a test in the cheapest CI job rather than at the end of the most
  expensive one.
- **FR3** — The amended C8 wording on `@open-smp/api-types` is enforced by something executable, not
  by a comment.
- **NFR1** — No behaviour change an operator can observe, except FR1's consequence above.
- **NFR2** — No existing test deleted or weakened. Test counts increase.
- **NFR3** — Every new gate is proven able to fail, by an executed mutation, before it is accepted.

---

## Technical approach

### The dependency decision that unblocks FR1

`packages/schema/package.json` depends on `drizzle-orm` and `pg` only. Deriving `accountLabelKindEnum`
from `ACCOUNT_LABEL_KINDS` requires adding `@open-smp/api-types` as a workspace dependency.

**Decision: add it.** Verified no cycle is created — `packages/api-types` imports nothing at all
(zero import statements, no dependencies block), so it is a leaf and `schema → api-types` is a new
edge into a leaf, not a loop.

Cycle 3 forbade this for a reason that no longer applies: its scope statement said "no dependency
added", written when the cycle's subject was the audit path. Here the dependency **is** the subject —
FR1 cannot be satisfied without it, which is precisely why cycle 3 withdrew FR6 rather than pretend.

**Rejected alternative**: keep `tables.ts` hand-written and strengthen its test to compare against a
value read some other way (parsing `index.ts`, or a shared JSON file). That trades a one-line
manifest edit for a parser, and leaves the *declaration* still hand-written — the test would get
better while FR1 stayed false.

### Constraint VE7 shapes where web-side code can live

The root vitest config resolves no `@/` alias and matches `.ts` only. Therefore:
- A module that a unit test reaches may use `@/` for **type-only** imports (erased before vitest sees
  them) but not for runtime imports. `apps/web/src/lib/label-kinds.ts:1-5` already carries this
  warning, added in cycle 3 after it bit.
- A `.tsx` module cannot be unit-tested. `LabelFilter.tsx` is `.tsx`, so if its derived list is to be
  tested directly, the list must live in a `.ts` module.

This is stated here so the implementation does not rediscover it — but *where* each piece lands is an
implementation decision, made by running the tests.

---

## Contracts

Each contract states the invariant and the code-derived member-set. **How each gate is written is
deliberately unspecified** — see "Why this plan is short".

### C37 — the label-kind domain is derived everywhere it can be

**Invariants**

- **I37.1 (structural)** — `packages/schema/src/tables.ts`'s `accountLabelKindEnum` derives its values
  from `ACCOUNT_LABEL_KINDS`. Order is preserved: a Postgres enum's declaration order is its sort
  order, and `api.integration.test.ts` already asserts `pg_enum` order against the domain.
- **I37.2 (structural)** — no module under `apps/web/src` contains a hand-written list of label kinds.
  Membership comes from the domain; display strings remain hand-written and are compile-checked by
  `Record<AccountLabelKind, string>`.
- **I37.3 (behaviour preservation)** — the accounts filter bar renders the same six options in the
  same order: `[All, Unlabeled, Any label, Known shared, Service account, External collaborator]`.
  Note the leading `{ value: null, label: 'All' }` entry, which is the only control that clears the
  filter and which neither of the two arrays being derived contains.
- **I37.4 (app-enforced)** — a fourth kind added to `ACCOUNT_LABEL_KINDS` alone either compiles and
  appears everywhere, or fails loudly. Nothing accepts it silently.

**Member-set — corrected after plan review.** The first draft derived it with
`grep -rn "'known_shared'"`, which structurally cannot see a list whose members are *object keys*
rather than quoted values. It missed one site, and omitted one that the work requires but that holds
no kind list at all:

| Site | Form | Disposition |
|---|---|---|
| `packages/api-types/src/index.ts:32` | `ACCOUNT_LABEL_KINDS` | canonical, unchanged |
| `packages/schema/src/tables.ts:44` | hand-written array | **derive** (I37.1) |
| `apps/web/src/components/LabelFilter.tsx:11-13` | hand-written entries | **derive** (I37.2) |
| `apps/web/src/app/accounts/page.tsx:20-22` | hand-written array | **derive** (I37.2) |
| `apps/web/src/lib/label-kinds.ts:12-16` | `LABEL_KIND_NAMES`, a `Record<AccountLabelKind, string>` keyed by all three kinds | **retained, not derived** — see below |
| `apps/web/src/lib/api-types.ts:14` | the web-side value barrel; holds no kind list | **must change** — see below |

**`LABEL_KIND_NAMES` is retained deliberately, and that is why it must be listed.** Its keys are the
three kinds, so it *is* a copy of the membership — but it is a `Record<AccountLabelKind, string>`, so
a fourth kind added to the domain makes it a compile error rather than a silent drift. It satisfies
I37.4 already, and its values (display strings) are genuinely web-only and cannot be derived from
anything. The first draft's acceptance criterion 1 carved it out of the grep while the member-set
table did not list it, so an implementer working from the table would not know what the carve-out
was for.

**`apps/web/src/lib/api-types.ts` must change, and no contract owned it.** Deriving the two web lists
requires `ACCOUNT_LABEL_KINDS` to cross into the web bundle, and today the barrel re-exports only
`isLabelAuditKind`. Its own comment states the policy: *"A future value belongs here too, re-exported
rather than imported from `@open-smp/api-types` directly, so this stays the one place shared types
and values cross into the web app."* Cycle 3's plan assigned this decision to SC40 explicitly
(`harden-label-audit-reclaim-deferred-plan.md:778`, `:846`); the first draft of this plan dropped it.

**Decision**: add `ACCOUNT_LABEL_KINDS` to the barrel's re-export list; the two web sites import from
`@/lib/api-types`, not from `@open-smp/api-types` directly. This keeps one chokepoint for what
crosses, which is the web-side half of the boundary C39 governs on the package side.

Test-side occurrences (`e2e/specs/events.spec.ts:62`, `labeling.spec.ts:95,113,202`) are test data.
`packages/schema/test/tables.test.ts:25` is in scope as a *gate to fix* — it currently asserts the
enum against a literal copy of itself — not as a copy to derive.

**Acceptance**

1. The three sites derive from `ACCOUNT_LABEL_KINDS`; a repo-wide grep for a quoted kind literal
   outside the domain declaration and the display map returns nothing, and the grep is asserted to
   have scanned a non-zero number of files.
2. `packages/schema/test/tables.test.ts` asserts the enum against the **domain**, not against a
   literal copy of itself.
3. The filter bar's rendered list is asserted directly, including the leading `All` entry — the E2E
   specs select by combobox value and do not pin filter-bar order, so E2E does not cover this.
4. **NFR3**: adding a fourth kind to `ACCOUNT_LABEL_KINDS` alone is executed, and what happens is
   recorded. The expected outcome is that the filter bar gains an option with no `apps/web` edit and
   `LABEL_KIND_NAMES` fails to compile — but these are two different tree states (cycle 3 proved that
   by execution), so the proof is two runs, not one.
5. Existing tests pass unmodified; `pnpm test:e2e` green after a stack rebuild (VE2).

### C38 — the seed gate agrees with the fixture

Closes cycle-2 finding F7 (RT3), deferred twice.

**Invariants**

- **I38.1 (app-enforced)** — every seeded email the shell gate asserts appears in `SEEDED_ACCOUNTS`,
  and every `SEEDED_ACCOUNTS` email is asserted by the gate. **Both directions**: a gate checking 3 of
  4 accounts is the leak `assert-seed-preserved.sh:54-57` exists to prevent.
- **I38.2 (app-enforced)** — each account's asserted `link.status` matches the key it sits under in
  `SEEDED_ACCOUNTS` (`matched`/`ghost`/`ambiguous`/`orphan`), and the app key and display name agree
  with `SAAS_APP_KEY` / `SAAS_APP_DISPLAY_NAME`.
- **I38.3 (anti-vacuity)** — the check fails loudly if it reads nothing. Cycle 3 established by
  execution that a plausible-looking extractor can return a *wrong* count while looking correct, so
  the expected count is derived from the fixture rather than written as a literal.
- **I38.4 (VE6)** — no login is added anywhere. The shell gate's existing login is unchanged.

**Member-set, from the tree**: the gate asserts 4 emails × 2 assertions (`assert_status` and
`assert_label_null`) = 8 call sites at `assert-seed-preserved.sh:49-52,70-73`, plus the app key at
`:82` and display name at `:83`. `SEEDED_ACCOUNTS` holds 4 entries; `SAAS_APP_KEY` and
`SAAS_APP_DISPLAY_NAME` are one each.

**A note the implementation must not lose**: `seed-facts.ts` mirrors `apps/api/src/seed.ts` by hand
(`seed-facts.ts:1-3` says so), and the *link statuses* the fixture keys on are **derived by the
matcher**, not stored in `seed.ts` — `seed.ts:58-63` documents the derivation. So this contract closes
the fixture↔gate copy only. The seeder↔fixture copy stays open as SC33, inherited.

**Acceptance**

1. A drift in either direction fails, proven by executing both: change an email in the fixture; change
   one in the gate.
2. **The new drift check** — the static fixture↔gate comparison — runs in the cheapest CI job
   (`checks`). The existing shell gate stays where it is.

   Corrected after plan review: the first draft said "the check runs in `checks`, not after the
   compose boot", which read as a mandate to relocate `assert-seed-preserved.sh` and contradicted
   I38.4. That script is a live-HTTP check — it logs in at `:22-27` and queries `/api/accounts` and
   `/api/saas-apps` — so it cannot run in a job that boots no stack (`checks` runs only
   lint/typecheck/`test:unit`), and moving it would add a login where I38.4 forbids one.

   What C38 closes is the *literal agreement* between the fixture and the gate, and only that static
   comparison moves early. The runtime assertion stays in `compose-smoke`. The value is still real:
   a `seed-facts.ts` edit that misses the gate now fails in the first job in seconds rather than
   after a full stack boot and the E2E suite.
3. Whatever shape the extraction takes, its limitations are recorded — cycle 3's attempt found seven
   non-matching reformats after claiming two, so the honest guarantee is "the derived-count check
   detects any reformat the extractor misses", not "the extractor handles every spelling".

### C39 — the C8 amendment is enforced

**Invariants**

- **I39.1 (app-enforced)** — `@open-smp/api-types` exports only primitive domain constants and type
  guards over them. No I/O, no imports from `apps/*`, no server-only modules, no dependencies.
- **I39.3 (app-enforced) — added after plan review.** The exported domain arrays are **frozen at
  runtime**, not merely `as const`.

  The first draft of I39.1 said "frozen primitive domain constants", which is a claim about the tree
  that is false. `as const` is a compile-time readonly assertion and nothing more. Executed:

  ```
  isAccountLabelKind('injected_kind')          -> false
  ACCOUNT_LABEL_KINDS.push('injected_kind')    -> SUCCEEDS
  isAccountLabelKind('injected_kind')          -> true
  Object.isFrozen(ACCOUNT_LABEL_KINDS)         -> false
  ```

  That array backs `z.enum(LABEL_KINDS)` in both label-write routes and the `isAccountLabelKind`
  guard in the events audit projection — the guard whose entire job is refusing to assert an
  out-of-domain kind into the audit union. A widened domain widens both.

  This is not a live vulnerability: reaching it needs code execution inside the API process, at which
  point the attacker has more direct options. It is recorded and fixed because C39 exists to make the
  package's boundary claims *true*, and shipping a gate that asserts "frozen" against unfrozen arrays
  would be the same defect class I39.2 covers — a comment asserting something the code does not do.
  `Object.freeze` costs one call per array and makes the mutation throw in strict mode.
- **I39.2 (documentation accuracy)** — no comment in the tree asserts something about the boundary
  that is false. `apps/web/src/app/import/page.tsx:11` currently says "api-types is type-only (C8), so
  the value cannot be imported at runtime", which cycle 3 made false.

**Member-set**: `packages/api-types/src/` contains exactly one file (`index.ts`) with four runtime
exports — `ACCOUNT_LABEL_KINDS` (:31), `LABEL_AUDIT_KINDS` (:44), `isLabelAuditKind` (:48),
`isAccountLabelKind` (:52) — and zero imports. `packages/api-types/package.json` declares no
dependencies and no devDependencies.

**What cycle 3 got wrong here, twice, and what it implies**: the drafted gate forbade bare tokens
(`process`, `globalThis`) that substring-match plausible field names and prose in a file whose whole
domain is wire shapes; and it was anchored to one hardcoded path while `package.json` names
`index.ts` as `main` with no restriction on siblings. The implementation must handle both — a glob
over the package, and a check that does not fire on prose — and must **execute** the check against
realistic content before accepting it.

**Acceptance**

1. The gate fires on a real violation (an added import; a runtime export that is not a frozen
   constant or a guard) and does not fire on the package as it stands.
2. It covers the package, not one file path — proven by adding a second file under `src/` and
   confirming the gate sees it.
3. `import/page.tsx:11`'s comment is corrected. Whether `MAX_UPLOAD_BYTES` *moves* is out of scope —
   that is SC37, and the value lives in `apps/api`, which `apps/web` cannot import from regardless.

---

## Testing strategy

Every gate lands in the **unit** tier unless it needs a real database or a browser. That is where
cycle 3's gates went, it is the cheapest CI job, and VE7's constraints are known.

**NFR3 is the binding obligation**: no gate is accepted until an executed mutation has made it red.
Cycle 3 produced three gates that looked right and were not — two bound to a spelling, one to a file
count — and every one was caught by running it, not by reading it. Mutations run in a **scratchpad**
git worktree, never in the repo (a worktree inside the repo causes vitest double-collection; it cost
cycle 2 a spurious red and a cycle-3 reviewer repeated it).

**Test-count expectation**: 218 unit / 140 integration / 43 E2E at `403de2b`. Unit count rises; E2E
stays at 43 (C37 changes how the filter list is built, not what it renders — I37.3).

---

## Considerations & constraints

### Risks

- **R-A — C37 changes a rendered UI surface.** The filter bar is built from a derived list rather
  than a literal one. I37.3 pins the rendered result, and the accounts E2E spec exercises the page.
  The failure mode is a reordered or missing option, which is visible.
- **R-B — the `schema → api-types` dependency is new.** Verified acyclic, but it is the first edge
  into `api-types` from a package other than `apps/*`. If `packages/schema` is ever consumed somewhere
  that cannot see `api-types`, this becomes load-bearing. Recorded because it is the kind of edge that
  is cheap now and awkward later.
- **R-C — three of the four gates here are the ones that failed to converge on paper.** The
  countermeasure is NFR3 plus the deviation log: every gate's shape is recorded as *decided by
  execution*, with what was tried and what it did.

### Scope contract

| ID | Deferred | Owner / why |
|----|---------|-------------|
| SC33 | The `seed.ts` ↔ `seed-facts.ts` hand-sync. | Inherited. C38 closes the fixture↔gate copy; closing the seeder↔fixture one means the E2E fixture importing from `apps/api`, a cross-package test dependency the suite does not have. Trigger: next cycle touching `seed.ts`'s seeded values. |
| SC37 | Moving `MAX_UPLOAD_BYTES` into `api-types`. | Inherited. C39 corrects the stale comment; moving the value is a separate decision about what belongs in the shared package. |
| SC41 | The Node 20 deprecation on the pinned setup actions. | Dependabot has already opened PRs #3–#6. Trigger: merge them. |
| SC42 | `LINK_STATUSES` (`apps/api/src/routes/accounts.ts:10`) duplicates the `LinkStatus` union in `api-types` — the same class C37 closes for label kinds, and `apps/web/src/app/accounts/page.tsx:15` holds a third copy as `TABS`. | Flagged by a cycle-3 self-check reviewer as "the obvious next member if the single-sourcing pattern is extended". Deliberately not bundled: C37's value is that it finishes one class completely, and adding a second class mid-cycle is how cycle 3's scope grew past what its review could hold. Trigger: the next cycle touching the accounts filter or `LinkStatus`. |

---

## Go/No-Go Gate

| ID  | Subject                                             | Status |
|-----|-----------------------------------------------------|--------|
| C37 | Label-kind domain derived at all three remaining sites | **locked** |
| C38 | Seed gate agrees with the fixture                   | **locked** |
| C39 | The C8 amendment is enforced                        | **locked** |

Three contracts, **one review round**, four findings, all applied:

| Finding | Change |
|---|---|
| SEC-1 [Critical] | I39.1 asserted the exports are "frozen"; `as const` is compile-time only and the arrays are runtime-mutable — **verified by execution**, and mutating `ACCOUNT_LABEL_KINDS` widens the guard protecting the audit projection. Split into I39.1 (what is true) and I39.3 (make "frozen" true with `Object.freeze`). |
| FN-1 [Major] | C37's member-set missed `LABEL_KIND_NAMES` — a `Record` keyed by the kinds, which a quoted-literal grep structurally cannot see. Added, with its retained-not-derived status stated. |
| SEC-2 [Major] | C37 dropped the `@/lib/api-types` barrel decision that cycle 3's plan assigned to SC40. Deriving the web lists requires the domain to cross that boundary; the re-export decision is now explicit. |
| TEST-1 [Minor] | C38's criterion 2 read as a mandate to relocate a live-HTTP gate into a job with no stack, contradicting I38.4. Scoped to the static drift check. |

**One round was the right call, and the findings show why.** All four are about *invariants and
member-sets* — a property claimed that the code does not have, a class member a grep could not see,
an owner nobody assigned, a criterion contradicting its own invariant. None is about how a gate is
spelled, which is the category that consumed three rounds last cycle and will be settled here by
running the checks instead.

Each contract states an invariant and a code-derived member-set; none specifies how its gate is
written.
