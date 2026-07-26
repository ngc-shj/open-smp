# Coding Deviation Log: sc40-derive-label-domain-and-gates

Base `main` @ `403de2b`; implementation `5593034`; review fixes `<this commit>`.

This plan deliberately left every gate's *shape* unspecified — see the plan's "Why this plan is
short". This log is therefore the record of what those shapes turned out to be and how each was
decided. NFR3 required every gate to be proven able to fail before acceptance; the eight mutations
and their results are below.

---

## D1 — `LABEL_FILTER_OPTIONS` / `LABEL_FILTER_VALUES` are a new module, not an edit in place

The plan named `LabelFilter.tsx:11-13` and `accounts/page.tsx:20-22` as the two sites to derive. Both
now import from a new `apps/web/src/lib/label-filters.ts`.

**Why**: I37.3 requires the *rendered order* to be asserted directly — the E2E spec selects the label
control by combobox value and never pins the bar's order, so a dropped or reordered option would ship
green. VE7 says the vitest unit project cannot transform `.tsx`, so a list living beside the component
cannot be tested at all. The list moved to a `.ts` module; the component renders it.

`LabelFilter.tsx` re-exports `LabelFilterValue` as a type so its prior importers keep working.
Verified: `accounts/page.tsx` was the only external importer, and it was rewired.

## D2 — the C38 comparison reads both files as text rather than importing either

`seed-facts.ts` is an e2e-tsconfig module and the gate is bash, so neither is importable from
`apps/api/test/`. The test parses both.

**The extractor's shape was decided by execution**, per the plan. The regex is anchored to
end-of-line with a symmetric quote back-reference — cycle 3 established by running it that an
optional trailing group's `\s+` crosses a newline under `/gm`, so a call swallows the next line and
the extractor returns a *plausible wrong count* rather than failing. Six known non-matching forms are
recorded in the test itself as executed cases, with the honest guarantee stated: the derived count
detects any reformat the extractor misses, because every unmatched form extracts fewer than expected.

Cycle 3's version of this claimed two limitations and a reviewer found five more, which is why the
guarantee is phrased over the count rather than over the extractor's coverage.

## D3 — the C39 gate is an allowlist over runtime exports, not a denylist of tokens

Two drafts of this gate in cycle 3 were denylists and were rejected both times: a bare `process` or
`globalThis` token substring-matches plausible field names and prose in a package whose entire domain
is wire shapes, and the second draft was anchored to one file path while `package.json` names
`index.ts` as `main` with no restriction on siblings.

The implemented gate asserts what *may* cross — a primitive, a frozen array of primitives, or a
function named `is*` taking one argument — and globs `src/**`. Probed against the real file first:
all four forbidden tokens return zero hits today, so the denylist would have passed while remaining
the wrong shape.

## D4 — the freeze narrowed a type and broke my own gate's cast

`Object.freeze` narrows the value to a readonly tuple, which does not overlap `unknown[]`. The gate's
cast — written as `value as unknown[]` at the time — failed `typecheck` with `TS2352`, **after**
`pnpm test:unit` had passed, because vitest does not typecheck. Per-file test runs had been green
throughout.

Recorded because it is the reason the full gate set must be run rather than the subset that seems
relevant: unit-green and typecheck-red were simultaneously true for several minutes.

**Not reproducible from the tree, and the first draft of this entry did not say so** (round-2
DOC-1). The failing cast never reached a commit, and the round-1 fix later widened the element check,
so removing today's `as unknown` from `value as unknown as readonly unknown[]` typechecks cleanly —
a reviewer tried exactly that and got 0 errors. The `TS2352` is real history, not a claim anyone can
re-run. Since D4 and D5 exist to warn against trusting an unverified green, an entry of theirs that
cannot be verified needs to say which state it describes.

## D5 — an early red proof produced a FALSE GREEN in a scratchpad worktree

M1 (unfreeze `ACCOUNT_LABEL_KINDS`) was first run in a scratchpad git worktree and **passed** — a
gate that should have failed. Cause: the worktree's `node_modules` symlink pointed at the main repo,
so `import * as apiTypes from '@open-smp/api-types'` resolved to the *unmutated* package. Confirmed
with `require.resolve`, which reported the main repo's path.

All eight mutations were then run in the main repo with restore-from-backup. The worktree remains the
right tool for mutating *source read by path* (cycle 3's gates read files from disk); it is the wrong
tool for mutating a module reached through package resolution.

**Corrected in round 2 (DOC-1).** The first draft said "a cycle-3 reviewer hit this same trap and
caught it the same way". A cycle-3 reviewer's *report* did mention worktree symlinks resolving back
to the main repo, but the archived cycle-3 artifacts do not record it — what they record is a
different worktree trap (a worktree created *inside* the repo, causing vitest double-collection;
plan `:693`, `:750`). So the citation pointed at something a future reader cannot verify, which is
the failure this very entry warns about.

Stated correctly: the symlink-resolution false green is new to this cycle. Recording it so the next
cycle's first instinct is to check `require.resolve` before trusting a green from a worktree.

## D6 — `packages/schema` gains a dependency on `@open-smp/api-types`

Cycle 3's scope statement forbade adding a dependency, which is why it withdrew FR6 rather than claim
to satisfy it. This cycle lifts that restriction because the dependency **is** the subject: the
drizzle enum cannot derive from the domain without it.

Verified acyclic — `packages/api-types` has zero import statements and no manifest dependencies, so
the edge runs into a leaf. A reviewer additionally reproduced the Dockerfile `deps` stage in a scratch
tree and confirmed `pnpm install --frozen-lockfile` succeeds and the workspace symlink materialises,
despite that stage not copying `packages/api-types/package.json` (a pre-existing gap already
load-bearing for `apps/api` and `apps/web` on main).

---

## RT7 — the eight mutations, executed

| # | Mutation | Result |
|---|---|---|
| M1 | Unfreeze `ACCOUNT_LABEL_KINDS` | boundary gate fails: *"must be frozen, not merely 'as const'"* |
| M2 | Add `import { readFileSync } from 'node:fs'` to `index.ts` | fails: *"must not import: index.ts: node:fs"* |
| M3 | Add a **sibling** `src/sneaky.ts` with a foreign import | fails naming `sneaky.ts` — proves the glob, which a path-anchored gate would have missed |
| M4 | Drop the leading `{ value: null, label: 'All' }` | label-filters test fails 2 assertions |
| M5 | Rename an email in `seed-facts.ts` | seed-gate test fails |
| M6 | Swap a status in the shell gate | fails: *"bob.suzuki@demo.example should be asserted as ghost"* |
| M7 | **Duplicate one email, drop another** in the shell gate — count conserved | fails: *"label_null: duplicate emails …"* |
| M8 | Add a fourth kind to `ACCOUNT_LABEL_KINDS` alone | `typecheck` fails `TS2741` on `LABEL_KIND_NAMES` **and** the filter-bar test fails — two different tree states |

**M7 is the one worth keeping.** It is the count-conserving false green a cycle-3 reviewer constructed
against an earlier design of this gate: duplicating one email and dropping another keeps the total at
8 and the union of emails equal, so a union check passes while one account silently loses its label
assertion. The per-function duplicate check is what closes it.

**M8 is two states, not one.** Cycle 3 proved by execution that "the filter bar gains an option" and
"`LABEL_KIND_NAMES` fails to compile" cannot be observed from the same tree, because the compile error
prevents the build. Recorded so the next cycle does not write a single proof for both halves.

---

## Code review round 1 — two Minor findings, both applied

### TEST-1 — the C39 gate was tighter than the invariant it cites

The gate required every non-function runtime export to be an array, while the invariant it enforces
reads "primitive domain constants". Verified by execution: a scalar `export const MAX_UPLOAD_BYTES =
10485760` failed with *"must be an array or a guard"*.

That matters because **SC37 is exactly that scalar** — moving `MAX_UPLOAD_BYTES` into this package so
`apps/web` stops hand-syncing it is the deferred item the plan already schedules. The gate would have
blocked the next thing it was written to permit.

Widened to accept a bare primitive, with the array branch unchanged. Verified both directions: a
scalar now passes; a plain object still fails with *"must be a primitive, an array, or a guard"*.

### TEST-2 — no deviation log

The plan mandates one twice (`:26`, `:338`), and every prior cycle shipped one. The commit body
narrated the mutations, but their shapes and tree states — particularly M8's two states and D5's
false green — are the artifact NFR3 exists to preserve, and they were not where the next cycle would
look. This file is the fix.

---

## Not deviations (checked, conformed)

- Every member-set re-derived from code before implementing. The plan's own member-set was corrected
  during review (a `Record` keyed by the kinds is invisible to a quoted-literal grep); the corrected
  five-site table is what was implemented against.
- `Object.freeze` verified not to break consumers: `z.enum` copies, drizzle's `pgEnum` copies,
  spreads work. Integration 140/5 green.
- The rendered filter bar is byte-identical — same order, same `key`, unchanged href logic.
- VE7 respected: `label-filters.ts` and everything it imports transitively use relative imports.
- No login added anywhere (I38.4); the shell gate stays in `compose-smoke`.
