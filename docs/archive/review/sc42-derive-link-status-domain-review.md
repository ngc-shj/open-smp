# Plan Review: sc42-derive-link-status-domain

Date: 2026-07-27
Review round: 1 (single round, by design — see the plan's "Why this plan is short")

## Changes from Previous Round

Initial review. Scoped per the cycle-4 method to whether the invariants and member-sets are right,
explicitly **not** to how gates are spelled (regexes, grep spellings, test file placement are settled
by execution during implementation and recorded in the deviation log).

Local LLM pre-screening (`pre-review.sh plan`): **No issues found.**

Nine findings, two Critical. All applied. Contracts C40/C41/C42 locked.

---

## Headline: the member-set was incomplete, and all three experts found the same site

The plan claimed **seven** declaration sites. There are **nine**. The two additions came from
opposite failure modes, and the distinction is the durable lesson:

- **Site 8** (`apps/worker/src/match.ts:63`) — **in the grep output, read past.** Found
  independently by all three experts. No better search would have caught it; the first draft scoped
  its reading by hypothesis rather than by result.
- **Site 9** (`apps/web/src/app/globals.css:12-25`) — **a genuine scope blind spot.** The grep covered
  `*.ts`/`*.tsx`/`*.sql`; the site is in `*.css`. One file extension from site 7's blind spot, in the
  same shape.

Only the second has a mechanical countermeasure (acceptance criterion 1's three-form requirement).

---

## Functionality Findings

### FN-1 [Critical] — `apps/worker/src/match.ts:63` is an eighth declaration site

The `upsertLink` parameter carries a full hand-written `'matched' | 'orphan' | 'ghost' | 'ambiguous'`
union, structurally identical to site 4. It is the function that writes `account_links.status` into
Postgres (`:70-91`) — the **last type-level checkpoint before the DB**, and the only write-side site.
Sites 2, 3, 6, 7 are all read-side.

Three consequences of the omission:

1. **FR1 was false as written.** `pnpm typecheck` runs `-r` and `apps/worker` depends on
   `@open-smp/matcher`, so deriving `LinkResult['status']` while leaving this parameter narrow means a
   fifth status still needs a second hand edit. Observed:
   `TS2322: Type 'LinkStatus' is not assignable to type '"matched" | "orphan" | "ghost" | "ambiguous"'`.
2. **C40 acceptance criterion 1 would have failed on first execution** — site 8 is a quoted status
   literal in none of the exempt categories. The dangerous repair is adding the file to the grep's
   exclusion list, converting a real finding into a permanently blessed exception.
3. **C40 criterion 4's expected-failure enumeration was incomplete**, so the NFR3 proof run would have
   produced an unlisted failure — indistinguishable from a broken gate.

**Applied**: added as site 8 with a new invariant I42.4; C42 renamed to cover the worker; criterion 5
names the worker explicitly in its expected-failure list; FR1 restated. Note `apps/worker/package.json`
already declares `@open-smp/matcher`, so no new package edge is needed.

### FN-2 [Major] — I40.5's stated fix does not compile

I40.5 required two things at once: reject a missing domain member at compile time, still accept a
non-domain string at runtime (the wire type is bare `string` — verified: `AccountLink.status` at
`packages/api-types/src/index.ts:14` and `IdentityAccountItem.linkStatus` at `:77`, both reaching
`StatusChip`). The plan's stated fix — `Record<LinkStatus, string>` — does not compile against the
retained string-indexed read under `apps/web/tsconfig.json`'s `strict: true`:

```text
error TS7053: Element implicitly has an 'any' type because expression of type 'string'
can't be used to index type 'Record<"matched"|"orphan"|"ghost"|"ambiguous", string>'.
```

The danger is the repair: the cheapest way out of TS7053 is to widen the declaration back, which
reverts the cycle's only live-weakness fix while I40.5 still reads as satisfied. Criterion 3 does not
catch it — it stays true under the reverted form.

**Applied**: I40.5 restated as two properties requiring a **declaration/read split** (domain-keyed
declaration, string-indexed read), with the spelling left to execution per the plan's method.

### FN-3 [Major] — `globals.css` holds a fourth-form copy no contract owned

`.status-chip-{orphan,ghost,matched,ambiguous}` are hand-written per status. Unownable by derivation:
Tailwind v4's `@apply` needs literal class names.

The failure mode survives everything else the cycle does — after I40.5 makes a missing chip *class
name* a compile error, a class name with no matching CSS rule is neither a compile error nor a test
failure. The chip renders with only the base `.status-chip` rule: unstyled rather than grey, arguably
harder to notice than the hole C40 closes.

**Applied**: added as site 9; new invariant **I40.6** gates map↔stylesheet agreement (a text read the
unit tier can do); the underivable remainder deferred as **SC45**, explicitly "not deferred for cost —
deferred because it is not closable".

### FN-4 [Minor] — `e2e/fixtures/seed-facts.ts` keys accounts by status

`SEEDED_ACCOUNTS` is keyed by all four statuses, and `accounts.spec.ts:20-25` / `sync.spec.ts:29-33`
iterate `Object.entries(...)` over it **as the domain**, not as fixtures. Untyped against `LinkStatus`,
so a domain change cannot make it fail to compile. Impact is low — a fifth status is simply not
iterated, so the suite stays green and silent.

Also corrects the plan's rationale for criterion 2: E2E does not cover tab order because the spec
navigates by `?status=` URL, not because it ignores statuses — it iterates all four.

**Applied**: deferred as **SC46**, alongside SC33 (same hand-sync class).

---

## Security Findings

### SEC-1 [Major] — I40.1's freeze rationale was factually wrong

The plan justified freezing `LINK_STATUSES` on the grounds that it "backs `z.enum()` in the accounts
query validator, so an unfrozen array is mutable into a widened request domain". **Refuted by
execution.** `z.enum` snapshots its member list at construction, and `accountsQuerySchema` is built at
module load (`apps/api/src/routes/accounts.ts:15-22`), so a later mutation cannot widen it:

```text
before push,             parse 'c': false
after push, SAME schema, parse 'c': false   <- the actual path; unchanged
after push, NEW schema,  parse 'c': true    <- only a schema built after the push
```

This is cycle 4's SEC-1 inverted: that one claimed a freeze existed where the array was mutable; this
one claimed a freeze protects a path that was never exposed. Both are visible only by running
something. A plan recording a false threat model teaches the next implementer the wrong rule.

The freeze is **still required**, for two reasons now stated: C39's boundary gate
(`apps/api/test/api-types-boundary.test.ts:115`) mandates `Object.isFrozen` for every exported array
regardless of consumer; and the real live-widening path is a guard that reads the array on every call
(`isAccountLabelKind`'s shape — what I39.3 was actually protecting).

*Reviewer note*: the security expert reported zod's own `options` array as unfrozen and mutable. Direct
probe on this repo's zod (v3.25) returned `Object.isFrozen(schema.options) === true` when constructed
from a frozen input. This strengthens the conclusion rather than weakening it — the `z.enum` path is
not a widening vector either way.

### SEC-2 [Critical, converged with FN-1] — the omitted member sits on the write path

Same site as FN-1, reported independently with the fail-open framing: I40.2 declares that no module
outside the domain contains a hand-written status list, and site 8 is exactly that. See FN-1 for the
applied change.

### SEC-3 [Minor] — R-C stated the widening was safe without the reasoning

Traced: the status value is bound **positionally** (`values.push(status)`, SQL fragment carries only
`$n` — `routes/accounts.ts:99-102`), so no user-controlled string reaches the query text; `link_status`
is a Postgres enum rejecting non-members independently; and status is **not an authz dimension** — no
RLS policy in any of the five migrations predicates on it. Widening the filter domain widens which
rows a user may request *within their own tenant*, which is not a privilege boundary.

**Applied**: reasoning added to R-C, plus the note that a real fifth status must decide which side of
`0001_init.sql:67`'s `CHECK ((status IN ('orphan','ambiguous')) = (identity_id IS NULL))` it falls on —
a second reason SC43 exists.

### SEC-4 [Minor] — I40.5's runtime permissiveness is not an XSS vector

Full path traced. The DB enum bounds the domain upstream; `{status}` is a React text child (escaped);
the value never reaches `className` (an out-of-domain value takes the hardcoded fallback literal).
No `dangerouslySetInnerHTML`, no `href`/`src` interpolation. Making the map domain-keyed while keeping
the fallback changes runtime risk in **neither** direction — it is purely a compile-time tightening.

**Applied**: recorded in I40.5 and R-D so the deliberate permissiveness is not mistaken for an accepted
injection risk. It is an availability choice.

### SEC-5 [Minor] — R-B cited leafness as observation rather than as a gated invariant

`api-types`'s zero-import property is enforced by `api-types-boundary.test.ts:43-61` (allowlist-shaped,
catching dynamic `import()` and `require()`). With a second consumer, a regression in that gate breaks
two packages instead of one.

**Applied**: R-B now cites the gate as what *keeps* the package a leaf.

---

## Testing Findings

### TEST-1 [Critical] — acceptance criterion 3 proposed an assertion that cannot exist

`CHIP_CLASSES` is declared at `StatusChip.tsx:1` and **is not exported** — the file's only export is
the `StatusChip` component. The file is `.tsx`. Both root vitest projects include `*.test.ts` only,
and the config resolves no transform for it. VE7 confirmed exactly as the plan states.

So criterion 3 required two relocations the plan never stated. **This is precisely the class of the
cycle-3 Critical the plan's own opening section cites** (a proposed unit test that could not exist
because the module was `.tsx` and the value unexported) — the plan recorded that lesson and applied it
to only the `TABS` half. VE7's status cell said "**Binding on C40**: `TABS` lives in `page.tsx`",
omitting the site the plan itself calls the worst of the set.

Second-order risk: the likely improvisations are skipping the assertion (leaving I40.3 and R-D's
rendered result unproven) or asserting against a copy of the class strings in the test file — which
re-introduces the RT3 self-comparison defect C41 exists to remove, at a new site.

**Applied**: VE7's row now names both sites; the web-side section states the invariant (the map must be
reachable from the unit tier, with `StatusChip` rendering from the *same* module the test asserts
against, per RT5) while leaving the arrangement to execution; criterion 3 explicitly rejects
transcription.

### TEST-2 [Critical, converged with FN-1] — member-set incomplete

Same site as FN-1, with the gate consequences enumerated. See FN-1.

### TEST-3 [Major] — C42 had no gate a mutation could redden

Taking C42's three criteria in turn: criterion 1 was a regression check on pre-existing tests
(`corpus.ts:7` types expectations via `Pick<LinkResult, …>`, so it tracks the derived type
automatically and nothing there can newly fail); criterion 2 was an observation of a file's contents;
criterion 3 was **explicitly self-cancelling** ("recorded rather than treated as a gate failure").

I42.3 is the substantive invariant and it is the one that decays silently — verified
`packages/matcher/node_modules` contains no `@open-smp` directory, so the edge is undeclared today and
workspace hoisting resolves the import regardless of the manifest. Nothing would notice a regression.

**Applied**: criterion 2 is now a gate (deleting the manifest entry must fail a check); criterion 3
corrected to state the workspace-level outcome (the widening **does** break `apps/worker` under
`typecheck -r` — true of the matcher in isolation, false of the repo).

### TEST-4 [Minor] — the mutation-site rule named the wrong mechanism

The plan said "a scratchpad worktree's `node_modules` symlink resolves to the main repository".
Verified empirically: a fresh worktree has **no `node_modules` at all** and fails loudly
(`vitest: command not found`, EXIT=1) — not a false green. pnpm's workspace links are *relative* and
would resolve worktree-locally after `pnpm install`. The false green appears only in the intermediate
state the plan implicitly described: a worktree made runnable by borrowing main's `node_modules`.

The member-set was also incomplete: C41's two-direction proof **spans both access modes** (its test
reaches `tables.ts` by relative path but imports the domain by specifier), which the plan left to be
derived.

**Applied**: rule restated by **access mode** (worktree-safe iff every reddening test reaches the
mutated module by relative path), with a per-mutation classification table.

---

## Verified as sound (no finding)

Recorded because the plan named these as the things to press on:

- **Order split (I40.1/I40.3)** — correct, and independently confirmed by all three experts.
  `0001_init.sql:7` is `('matched','orphan','ghost','ambiguous')`; `page.tsx:16` `TABS` is
  `['orphan','ghost','ambiguous','matched']`. The orders genuinely differ, the migration has shipped,
  and domain-takes-migration-order with tab order local is the only arrangement that avoids reordering
  a shipped UI. Matches the `ACCOUNT_LABEL_KINDS`/`LABEL_FILTER_OPTIONS` precedent.
- **Site 5 carve-out (I42.2)** — correct. `deriveStatus` is called only at `match.ts:64`, on the
  single-hit path; `hits.length >= 2` returns `'ambiguous'` at `:53` beforehand, and the fall-through
  yields `'orphan'` at `:78`. A genuine narrowing, not a stale copy. Widening it would lose type
  information.
- **Dependency acyclicity (C42/VE8)** — correct. `packages/api-types/src/index.ts` has zero imports and
  its manifest declares neither `dependencies` nor `devDependencies`. `packages/matcher/src` imports
  only `./types.js` and `./normalize.js`. VE8's claim that matcher has no `dependencies` block is
  accurate. `matcher → api-types` is acyclic.
- **C39 gate compatibility** — a frozen `LINK_STATUSES` passes `api-types-boundary.test.ts:75-117`
  unchanged (array of primitives, frozen).
- **C41 / NFR2** — changing `tables.test.ts:17` is a **strengthening**, not a weakening: the current
  form compares the enum against a literal transcription of itself, so comparing against the domain
  strictly widens the mutation set that reddens it. Test count does not drop.
- **Corpus classification** — right. `corpus.ts:7` derives via `Pick<LinkResult, 'saasAccountId' |
  'status'>`, so retyping `LinkResult['status']` leaves all 47 expectations valid and unmodified.
- **Baseline test counts** — verified by execution: `pnpm test:unit` EXIT=0,
  `Test Files 25 passed (25) / Tests 241 passed (241)`. E2E: 43 `test(` calls across 9 specs. Both
  match the plan. The E2E-stays-43 claim is sound.
- **VE7 itself** — root `vitest.config.ts` declares no `resolve.alias`; both projects include
  `*.test.ts` only; `apps/web/tsconfig.json` sets `jsx: preserve`.
- **Unassigned ownership** — clean, unlike cycle 4. `apps/web/src/lib/api-types.ts` is explicitly
  claimed and does need the edit; `packages/matcher/package.json` is claimed; `packages/matcher/src/index.ts`
  is a pure re-export barrel needing no change. The only unclaimed manifest was `apps/worker`'s, which
  falls out of FN-1 and needs no edit anyway.
- **All line-number claims verified accurate.** One cosmetic slip, self-corrected in the plan: the
  quoted deferral note says `page.tsx:15`, the table says `:16`; `:16` is right.

---

## Adjacent Findings

None raised — each expert's findings fell within scope, with the FN-1/SEC-2/TEST-2 convergence
occurring naturally rather than via `[Adjacent]` routing.

## Quality Warnings

None. `merge-findings` was not invoked (three expert outputs merged manually via their JSON indices);
no finding was flagged VAGUE / NO-EVIDENCE / UNTESTED-CLAIM. Every Critical and Major carries either
an executed probe or a verified file:line.

---

## Perspective convergence

**FN-1 / SEC-2 / TEST-2 are the same site**, found independently by all three experts from three
different angles (member-set completeness, fail-open on an omitted member, gate-execution consequence).
Per "Perspective Convergence as a Severity Signal", the merged finding takes the Critical floor — which
matches its independent assessment: it falsifies FR1, breaks an acceptance gate on first run, and sits
on the DB write path.

---

## Recurring Issue Check

### Functionality expert

- R2 (constants hardcoded in multiple places) — **FINDING(FN-1, FN-3)**. The plan's premise is R2
  closure; two hardcoded copies survived the first draft's member-set.
- R3 (incomplete pattern propagation) — **FINDING(FN-1)**. C37's derive-the-domain pattern propagated
  to matcher/schema/web/api but stopped at the `apps/worker` boundary — the one package that persists
  the value.
- R12 (enum/action group coverage gap) — **FINDING(FN-3, FN-4)**. Two four-member groups (CSS rules,
  `SEEDED_ACCOUNTS` keys) were unclaimed by any contract.
- R17 (helper adoption coverage) — **PASS**. Every claimed site genuinely adopts `LINK_STATUSES`; the
  site-5 carve-out is justified and verified against `matchAccount`.
- R25 (persist/hydrate symmetry) — **PASS**. Migration order, `linkStatusEnum` order and the proposed
  domain order all agree; I41.2 pins the shipped migration as the authority.
- R40 (cross-boundary serialization shape vs strict consumer) — **FINDING(FN-2)**. Wire type is bare
  `string` while the consumer becomes domain-strict — exactly R40's mismatch, stated in a form that
  does not compile.
- R42 (class-membership derivation) — **FINDING(FN-1, FN-3, FN-4)**. The plan's own headline check.
  Independent multi-form derivation yielded more sites than the plan's seven.

### Security expert

- R3 (incomplete pattern propagation) — **FINDING(SEC-2)**. Pattern lands incompletely on the one site
  that writes to the DB.
- R42 (class-membership derivation / fail-open) — **FINDING(SEC-2)**. Omitted member; additionally
  would have broken C40 criterion 1's grep, creating pressure to whitelist it.
- R44 (gate exit status read through a pipeline) — **N/A**. The plan deliberately does not specify how
  gates are invoked; belongs to execution.
- RS3 (input validation at boundaries) — **PASS**. `?status=` is the only external entry point,
  `z.enum`-validated at `routes/accounts.ts:89` before use, with the DB enum as an independent second
  boundary; the web page's own parse fails closed to `'orphan'` (`page.tsx:59`). SEC-1 corrects the
  *rationale* for the freeze, not the validation.
- RS6 (incomplete sanitization / escape ordering) — **PASS**. `{status}` is a React text child, never
  reaches `className`, and `csv-export.ts:87` routes status through the same `csvField()`/
  `neutralizeCell()` path as attacker-influenced columns.

### Testing expert

- R44 (gate exit status read through a pipeline) — **PASS**. The unit suite was run as
  `> logfile 2>&1; echo "EXIT=$?"` and the file grepped, per R44. The plan proposes no pipeline-read
  gate; `ci.yml` already applies the lesson explicitly.
- RT3 (shared constant in tests) — **PASS, and actively improved**. C41/FR3 removes the repo's
  remaining instance (`tables.test.ts:17`). Interacts with TEST-1: a criterion-3 workaround that copies
  chip-class strings into a test file would re-introduce RT3 at a new site — the second-order reason
  TEST-1 is Critical.
- RT5 (test call-path must include the production primitive) — **PASS, with the caveat inside TEST-1**.
  The `TABS` relocation follows the `label-filters.ts` precedent. For the chip-class map, whether RT5
  holds depends on how TEST-1 is resolved; the applied text requires `StatusChip` to render from the
  same module the test asserts against.
- RT7 (new guard/gate must be proven able to fail) — **FINDING(TEST-3)**. NFR3 states the obligation
  correctly and C40/C41 propose concrete two-direction mutations; C42 did not.
- RT9 (parallel-implementation twin drift) — **FINDING(TEST-2)**. `apps/worker/src/match.ts:63` and
  `packages/matcher/src/types.ts:25` are exact twins of the same union — one produces the status, the
  other persists it — and the first draft derived only the matcher half.

---

## Outcome

| ID  | Subject | Status |
|-----|---------|--------|
| C40 | Link-status domain derived at all remaining sites (2,3,4,6,7,8) + the CSS gate | **locked** |
| C41 | The drizzle enum is asserted against the domain | **locked** |
| C42 | The matcher and the worker declare their statuses from the domain | **locked** |

New deferrals recorded: **SC45** (CSS rules, not closable), **SC46** (E2E fixture keys, with SC33).

**Method assessment.** One round held. Every finding is about invariants and member-sets — a class
member omitted, a property execution refutes, a test that cannot exist, a contract with no provable
gate. None is about how a gate is spelled, which is the category that consumed three rounds in cycle 3.

The honest counterweight: this is the second consecutive cycle whose plan shipped an incomplete
member-set to review. Cycle 4 caught one missed member; this round caught two. The lightweight-plan
method is converging on review rounds, not on first-draft accuracy — and the two misses here have
different fixes, only one of them mechanical.
