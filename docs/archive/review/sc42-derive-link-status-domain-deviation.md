# Coding Deviation Log: sc42-derive-link-status-domain

The plan deliberately left gate spellings, regexes, and file placement to be settled by execution.
This log is where those decisions are recorded, along with anything that departed from the plan.

---

## D1 — Where the web-side module landed, and what it holds

**Plan**: VE7 required both `TABS` and `CHIP_CLASSES` to become reachable from the unit tier, and
explicitly left the arrangement to implementation.

**Decided by execution**: one new module, `apps/web/src/lib/link-statuses.ts`, holding both —
`ACCOUNT_TABS` (the tab order), `CHIP_CLASSES` (the domain-keyed declaration), `CHIP_CLASS_FALLBACK`,
and `chipClassFor` (the string-indexed read). It follows `label-filters.ts`'s precedent exactly:
relative imports, no `@/` alias, a `.ts` module rather than `.tsx`.

Both `.tsx` consumers now import from it — `StatusChip.tsx` takes `chipClassFor`, `accounts/page.tsx`
takes `ACCOUNT_TABS` — so the test asserts against the same module production renders from (RT5).
Neither `.tsx` file retains a copy.

`TABS` was renamed `ACCOUNT_TABS` on the move. The bare name was fine as a file-local const; as a
shared export it says nothing about which page's tabs it is.

## D2 — The I40.5 split, concretely

**Plan**: stated that a domain-keyed declaration and a string-indexed read need to be two different
types, and that `Record<LinkStatus, string>` alone is TS7053 under `strict`.

**Decided by execution**: the declaration is `Record<LinkStatus, string>`; the read is a
`chipClassFor(status: string): string` helper that casts internally. The cast is confined to one
function rather than appearing at each call site, so the permissive direction has exactly one place
to audit.

## D3 — I40.6's gate is a text read of `globals.css`

**Plan**: left the form unspecified, requiring only that map↔stylesheet agreement be gated.

**Decided by execution**: the test reads `globals.css` and asserts every status-specific class token
has a matching `.<token> {` rule. Its known limit, established by execution: the regex matches text
inside CSS comments, so a rule commented out but left in place still passes. Deleting a rule — the
realistic failure — does fire (M3). Recorded rather than fixed, because a comment-aware CSS parse is
a large step up in machinery for a case SC45 already accepts as underivable.

## D4 — C41 gained a second test the plan did not name

**Plan**: I41.2 required the domain's order to agree with the shipped Postgres enum, "asserted by
something executable rather than in a comment", without saying how.

**Decided by execution**: a second test in `tables.test.ts` reads `migrations/0001_init.sql`, extracts
the `CREATE TYPE link_status AS ENUM (...)` member list, and compares it to the domain.

This turned out to be load-bearing in a way worth recording. Under M1 (a fifth status added to the
domain alone), the *drizzle* assertion `link_status derives from the shared link-status domain`
**passes** — correctly, since `linkStatusEnum` now derives from the domain and follows it wherever it
goes. Deriving site 6 removed that test's ability to catch a domain change. The migration-order test
is what replaces it, and without it M1 would have produced no schema-side failure at all.

## D5 — Site 8 derives via the matcher, not via `api-types`

**Plan**: C42/I42.4 required `upsertLink`'s `link.status` to track `LinkResult`/`LinkStatus`, noting
`apps/worker` already declares `@open-smp/matcher` so no new package edge is needed.

**Decided by execution**: `Pick<LinkResult, 'saasAccountId' | 'identityId' | 'status' | 'confidence'
| 'ruleId'> & { evidence: unknown }`. This tracks the matcher's result shape structurally rather than
naming `LinkStatus` directly, so the parameter follows `LinkResult` on any future field change, not
only on a status widening. No manifest edit was needed for `apps/worker`.

## D6 — `chipClassFor` had a prototype-key bug, found by the self-R-check

**Not a plan deviation — a defect introduced in this cycle and fixed within it.** Recorded because the
first implementation shipped a contract its own test did not cover.

The first draft read `(CHIP_CLASSES as Record<string, string | undefined>)[status] ?? FALLBACK`. A
bare index reaches the prototype, so five inputs returned a non-`string` despite the declared return
type — verified by execution:

```text
chipClassFor('constructor')    -> function Object() { [native code] }
chipClassFor('toString')       -> function toString() { [native code] }
chipClassFor('valueOf')        -> function valueOf() { [native code] }
chipClassFor('hasOwnProperty') -> function hasOwnProperty() { [native code] }
chipClassFor('__proto__')      -> [object Object]
chipClassFor('not_a_status')   -> status-chip bg-neutral-100 text-neutral-700   (correct)
```

Not exploitable: the value originates in the `link_status` enum column, and the sink is React's
`className`. But this cycle's whole point was promoting that fallback from an inline expression into a
named, tested contract — and the test asserted only `'not_a_status'` and `''`, both of which pass
under the broken form. The gate looked like coverage and was not.

Fixed with `Object.hasOwn`, and the five keys added to the test as an `it.each`. Red-proven (M7):
reverting to the `??` form fails all five, passes the rest.

The pre-existing `StatusChip.tsx` had the same `?? fallback` shape, so this is inherited rather than
newly introduced — but it is fixed here rather than deferred, because the diff is what made it a
claimed guarantee.

## D7 — One dead re-export removed after the self-R-check flagged it

`link-statuses.ts` initially ended with `export { LINK_STATUSES }`. No consumer imported it: the two
`.tsx` files take `ACCOUNT_TABS` / `chipClassFor`, and the test imports the domain from
`@open-smp/api-types` directly. It also opened a second web-side path for a value that
`apps/web/src/lib/api-types.ts` documents itself as the single crossing point for.

Removed. That left the `LINK_STATUSES` value import unused, which failed `pnpm lint` and `pnpm build`
(`@typescript-eslint/no-unused-vars`) while `pnpm typecheck` and `pnpm test:unit` both stayed green —
the same lint-red/tests-green split cycle 4 recorded. The import is now type-only, which VE7 permits.

---

## NFR3 — mutation proofs

Seven mutations, all executed, all confirmed red, all restored. Per the plan's access-mode table,
domain mutations ran **in the main repository from a backup**, never in a worktree.

| # | Mutation | Result |
|---|---|---|
| M1 | add a fifth status `quarantined` to `LINK_STATUSES` alone | typecheck `TS2741` on the chip map + 4 unit tests red (tab coverage, chip mapping ×2, migration order) |
| M2 | reorder `linkStatusEnum` off the domain | `link_status derives from the shared link-status domain` red |
| M3 | delete `.status-chip-ghost` from `globals.css` | `defines a rule for each status-specific class` red |
| M4 | remove the `dependencies` block from `packages/matcher/package.json` | `declares @open-smp/api-types as a workspace dependency` red |
| M5 | reorder `ACCOUNT_TABS` to equal the domain order | 2 tab tests red |
| M6 | replace the fallback with a real chip class | `falls back for a value outside the domain` red |
| M7 | revert `chipClassFor` to the `??` form | 5 prototype-key tests red |

**M1's outcome, recorded as the plan required.** The expectation spanned more than one tree state:

- **Fail loudly**: the chip map (compile error), the tab-coverage assertion, the migration-order
  assertion. `apps/worker` did **not** fail — because I42.4 derived site 8, which is exactly what that
  invariant was added for. Under the plan's first draft it would have failed here.
- **Widen silently and correctly**: the API's `z.enum`, as R-C predicted.
- **Follow the domain**: `linkStatusEnum`, per D4 above.

## Verification

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0 — **258 tests / 27 files** (baseline 241 / 25) |
| `pnpm test:integration` | exit 0 — 140 / 5, unchanged |
| `pnpm test:e2e` | exit 0 — **43**, unchanged as I40.3 predicted |
| `e2e/scripts/assert-seed-preserved.sh` | exit 0 |
| `pnpm build` | exit 0 |

Every gate judged by its own exit status, captured to a file rather than piped (R44).

E2E ran after `docker compose up -d --build api web worker` (VE2 — compose carries no source mount).
No login was added anywhere (VE6).

## Acceptance criterion 1 — the three-form grep

Run in all three forms. Remaining hits are all in exempt categories, and **no site was added to an
exclusion list to make the grep pass**:

- the domain declaration itself (`api-types/src/index.ts:22-25`)
- the retained narrowing, site 5 (`matcher/src/match.ts:11,13,16`) and its single-value assignments
  (`:53`, `:78`)
- single-value predicates: `EvidencePopover.tsx:23`, `accounts/page.tsx:58`'s default, the SQL CHECK
  at `tables.ts:141`
- `ACCOUNT_TABS` — the deliberately hand-written render order, pinned by test
- deferred: `seed.ts:353-356` (SC44), `globals.css` (SC45, gated by I40.6), `e2e/fixtures` (SC46)

**New observation, out of scope**: `.github/workflows/ci.yml:101-135` hardcodes `?status=orphan` and
`?status=ghost` in the compose-smoke assertions. These are single-value smoke checks of the same shape
as `EvidencePopover.tsx:23`, not member-set declarations — a fifth status does not make them wrong.
Recorded because the grep surfaced them and silence would be indistinguishable from a miss.
