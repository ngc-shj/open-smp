# Code Review: sc42-derive-link-status-domain

Date: 2026-07-27
Review rounds: 7 (each appended in order below)

## Changes from Previous Round

Initial review. Phase 2 had already run a focused R1-R46 (+RS*/RT*) self-check that found and fixed
two Minors, so this round ran as incremental verification on top of that baseline.

Pre-screening (`pre-review.sh code`): **No issues found.**
Ollama seeds: functionality `No findings`, security `No findings`, testing 2 Minors (both about
regex fragility in text-format gates).

**Five findings — 2 Major, 3 Minor. All applied.** The two Majors were both gate defects: one gate
blocked the operation it existed to protect, and two derivation sites had no gate at all.

---

## Functionality Findings

### FN-1 [Minor] — `LINK_STATUSES` crosses the web barrel with no runtime consumer

`apps/web/src/lib/api-types.ts:17` re-exports `LINK_STATUSES`, and the barrel documents itself as
"the one place shared types and values cross into the web app". But nothing in `apps/web/src` imports
that re-export: `link-statuses.ts:4` takes only `type LinkStatus` (type-only, per D7), and the test
imports the domain from `@open-smp/api-types` directly — bypassing the barrel.

The comment at `:15-16` says `LINK_STATUSES` "is what the chip-class map is keyed by". The map is
keyed by `LinkStatus`, the **type**, which crosses via the `export type` block. The value crosses for
nobody.

**Disposition: applied** — comment corrected to state what actually crosses and why the value is
staged. The re-export is retained deliberately: the barrel's own policy (`:7-9`) is that a shared
value belongs there rather than being imported directly, and a future `isLinkStatus` guard is exactly
the consumer it anticipates. Removing it would push the next consumer toward the bypass.

### FN-2 [Minor] — the `LinkResult.status` witness proves only one direction

`packages/matcher/test/package-edge.test.ts` asserts the field accepts every domain member, which
proves `LinkStatus ⊆ LinkResult['status']`. If the field were widened to bare `string`, the test still
compiles and passes. I42.1 claims equality.

**Disposition: applied** — a `@ts-expect-error` assignment of a non-domain literal pins the other
direction. This needs no new idiom, unlike the `expectTypeOf().toEqualTypeOf()` the plan rejected.

---

## Security Findings

**No findings.**

Independently verified, each by execution rather than by reading:

- **`z.enum` equivalence** — diffed against `main`. Member set and order identical; `.optional()`,
  `.strict()`, and the `safeParse` → 400 path byte-identical. Validation is marginally *stronger*: the
  source array is now `Object.freeze`d rather than compile-time-only `as const`.
- **`chipClassFor`** — executed against `constructor`, `toString`, `valueOf`, `hasOwnProperty`,
  `__proto__`, `'0'`, `''`, `not_a_status`, **and a live `Object.prototype` pollution**. Every input
  returned a `string`; the polluted key returned the fallback. The `!` is sound — `hasOwn` is the
  guard and `Record<LinkStatus, string>` has no optional members.
- **Prototype-pollution reachability** — no recursive merge, no `setPrototypeOf`, no nested
  query-string parsing anywhere in the app. The two `JSON.parse` sinks are defended
  (`events-cursor.ts:90-94` requires exactly `{t,id,s}`; `sync.ts:108` parses decrypted credentials).
  The only dynamic-key writes iterate a hardcoded `['before','after'] as const`.
- **Write path** — SQL unchanged, fully parameterized `$1`–`$8`, `link.status` at `$4`. The
  `Pick<LinkResult, …>` retype altered only the compile-time type.
- **The freeze** — `Object.isFrozen(LINK_STATUSES)` is `true`; `push` throws.
- **C8 boundary** — `api-types` still has zero imports and declares no dependencies. The new edge is
  *inbound*, which C8 does not restrict.
- **New disk reads** — both use `new URL('<hardcoded literal>', import.meta.url)`; no external value
  is interpolated, unit-tier only, not shipped.

Beyond the brief, the reviewer swept repo-wide for the D6 defect shape (`obj[key] ?? fallback`) and
found two siblings — `app.ts:129` (keyed by `number`, prototype keys unreachable) and
`import/page.tsx:144` (every key a hardcoded API literal, sink is a React text child). Neither is
reportable and neither file is in the diff.

---

## Testing Findings

### TEST-1 [Major] — the migration-order gate false-reds the one legitimate way to add a status

`packages/schema/test/tables.test.ts` pinned `LINK_STATUSES` against `0001_init.sql` **alone**. But
`packages/schema/src/migrate.ts:26-27` applies every `migrations/*.sql` in filename order, and Postgres
widens an enum via `ALTER TYPE link_status ADD VALUE` — which by definition lands in a *later*
migration, since `0001` is immutable once shipped. That immutability is the gate's own stated premise.

Proven by mutation: adding `0006_link_status_quarantined.sql` plus the matching domain member — a
**correctly migrated schema, database and domain in agreement** — turned the gate red. The only ways
to satisfy it were to edit shipped history or delete the test.

This is the sharpest finding of the cycle, because D4 names this test as the sole replacement for the
coverage that deriving `linkStatusEnum` removed. It was load-bearing exactly when someone adds a
status, and that is exactly when it would have blocked them.

**Disposition: applied.** The gate now reads the whole migration directory and replays the enum's
evolution (CREATE TYPE, then each ADD VALUE in filename order). Verified both directions: the
`ALTER TYPE` path is green (M10), M2's reorder is still red.

Note the reviewer explicitly refuted the *seed's* framing of this file's weakness: `[^)]*` does span
newlines, and a reformatted multi-line `CREATE TYPE` extracts identically. The real defect was
different and worse.

### TEST-2 [Major] — sites 2 and 8 had no gate anywhere

Both reverts executed:

| Mutation | test:unit | typecheck | lint |
|---|---|---|---|
| site 2 → hand-written `z.enum([...])` | 258 passed | 0 errors | clean |
| site 8 → hand-written union in `upsertLink` | 258 passed | 0 errors | clean |

Nothing noticed. The central invariant of this change was ungated at two of its six derived sites, and
D5's claim that site 8 is why `apps/worker` survives M1 rested entirely on the code being read.
`apps/api/test/label-kinds.test.ts` was already the precedent for gating exactly this.

**Disposition: applied.** `accountsQuerySchema` exported and gated; `UpsertLinkInput` named and gated
by a type-level witness. Red-proven as M8 and M9.

**The first fix did not work, and that is the instructive part.** The initial site-2 gate asserted the
schema's members equal `LINK_STATUSES` — and stayed **green** under the revert, because `z.enum`
snapshots its members at construction, so a hand-written union with the same four members builds a
byte-identical validator. No behavioural assertion can distinguish them. The gate now reads the route's
source text; the behavioural assertions are kept alongside since they pin what the route accepts.

### TEST-3 [Minor] — the CSS gate was blind to an emptied rule body, not only a commented-out one

D3 recorded one blindness mode. The reviewer proved a second that comment-stripping would not fix: a
rule whose selector survives but whose body is emptied also passed. Both render a colourless chip —
the exact failure the gate exists to catch.

**Disposition: applied.** The assertion now requires a non-empty body containing `@apply`. Verified:
the emptied-body mutation goes red (M11); the commented-out mutation still passes, and D3 is amended
to state that residual limit accurately rather than framing it as narrower than it is.

---

## Adjacent Findings

None. Each expert's findings fell within scope.

## Quality Warnings

None. `merge-findings` was not invoked (three outputs merged manually via their JSON indices). Every
Major carries an executed mutation; every Minor carries a file:line.

One functionality finding (`F2`, a `.sort()` mutation concern) was **withdrawn by the reviewer during
verification** — both sides spread-copy first. Recorded because self-withdrawal on verification is the
behaviour the verification contract is meant to produce.

---

## Seed Finding Disposition

- **`link-statuses.test.ts` CSS regex / commented-out rules** — *Verified, already covered by D3,
  extended as TEST-3.* The comment case is real and recorded; M3 proves deletion fires. But D3's
  acceptance was stated too narrowly — the emptied-body mode is a second blindness comment-stripping
  would not address.
- **`tables.test.ts` enum regex assumes single-line formatting** — *Rejected as stated.* Refuted by
  execution: `[^)]*` is not newline-restricted and a reformatted multi-line `CREATE TYPE` extracts
  identically; the actual file is single-line anyway. The investigation it prompted surfaced TEST-1,
  which is a different and far more serious defect in the same test.

---

## Recurring Issue Check

### Functionality expert

- R5 (dead/unused exports) — FINDING(FN-1). `LINK_STATUSES` crosses the barrel with no runtime consumer.
- R12 (non-null assertion soundness) — PASS. `chipClassFor`'s `!` guarded by `Object.hasOwn` on a total Record; verified by execution.
- R18 (behaviour preservation in refactors) — PASS. Tab list, default status, and all four chip classes byte-identical before/after.
- R23 (type claim asserted by a witness that cannot fail) — FINDING(FN-2). The witness proves only `LinkStatus ⊆ status`.
- R29 (comment asserts something the code does not do) — FINDING(FN-1), partial. The barrel comment named the value where the type is what crosses.
- R31 (derived list silently reorders a shipped UI) — PASS. `ACCOUNT_TABS` stays hand-written, pinned by three tests including an explicit not-equal-to-domain assertion (M5).
- R44 (gate judged by its own exit status) — PASS. Re-ran typecheck/lint/unit independently on a clean tree.
- R46 (grep anti-vacuity) — PASS. All three forms returned non-empty output over a non-zero file count; no exclusion list used.

### Security expert

- Injection / parameterization — PASS. Status bound positionally at `$4` (worker) and `$n` (API).
- Prototype pollution / unsafe object index — PASS. `Object.hasOwn` verified against 5 prototype keys plus a live `Object.prototype` pollution; no merge sink exists.
- Fail-open vs fail-closed — PASS. Unrecognised `?status=` falls closed to `'orphan'`; unrecognised chip key falls to a hardcoded literal.
- Validation weakening on refactor — PASS. Member set, `.strict()`, and the 400 path unchanged; the source array gained a runtime freeze.
- Trust boundary / authz dimension — PASS. No RLS policy predicates on status.
- XSS / unescaped sink — PASS. `{status}` is a React text child; `className` receives only map values or the hardcoded fallback.
- Immutability of exported domain — PASS. `Object.isFrozen` true; `push` throws.
- Package boundary / supply chain — PASS. `api-types` remains a zero-import, zero-dependency leaf; the new edge is inbound and gated (M4).
- Path traversal / unsafe file read — PASS. Both new reads use hardcoded literals against `import.meta.url`.
- Secret handling / AuthN / session — N/A. The diff touches no credential, route, middleware, or session code.

### Testing expert

- RT7 (structurally blind / authored-but-ungated) — FINDING(TEST-2, TEST-3). TEST-2 is shape (b): the central invariant ungated at two of six sites, proven by two silent mutations. TEST-3 is shape (a).
- RT1 (gate cannot fail) — PASS for the gates as run; TEST-1 is the inverse — a gate that fails when it should not.
- RT5 (test asserts against the production module) — PASS. Both `.tsx` consumers import `@/lib/link-statuses`; the test imports the same file. No copy remains.
- RT9 (twin drift) — PASS. Same module, verified across `apps/web/src`, `apps/web/test`, `e2e`.
- R44 — PASS. CI runs lint/typecheck/test:unit as separate unpiped steps.
- R33 (CI config duplication) — N/A. No CI change in this diff.
- Test isolation / shared mutable state — PASS. No `beforeAll`/`beforeEach` in any new file; the two module-scope reads are immutable.
- Missing await — N/A. No async test in any new or modified file.

The reviewer also spot-checked M1 and M4 by re-executing them, and reproduced both exactly as the
deviation log records — including M1's silent outcomes for the worker and the drizzle mirror.

---

## Environment Verification Report

| Constraint | Path | Status |
|---|---|---|
| VE1 (no live Google Workspace tenant) | — | `blocked-deferred`, untouched — no contract here crosses the provider boundary |
| VE2 (compose has no source mount) | E2E after `docker compose up -d --build api web worker` | `verified-local` — rebuild exit 0, then 43 passed |
| VE3 (integration needs Docker) | `pnpm test:integration` | `verified-local` — exit 0, 140/5 |
| VE4 (E2E needs the running stack) | `pnpm test:e2e` | `verified-local` — exit 0, 43 passed |
| VE6 (E2E login budget 5/5) | — | `verified-local` — no login added anywhere; the seed gate's existing login is unchanged |
| VE7 (vitest: no `@/` alias, `.ts` only) | both web-side relocations | `verified-local` — `link-statuses.ts` is `.ts` with relative imports; both new test files discovered by the root `unit` project and observed red under mutation |
| VE8 (matcher has no `dependencies` block) | `packages/matcher/package.json` | `verified-local` — block added, gated by M4 |

Every gate judged by its own exit status, captured to a file rather than piped (R44).

---

## Resolution Status

### TEST-1 [Major] Migration-order gate false-reds the legitimate `ALTER TYPE ADD VALUE` path
- Action: read the whole migration directory and replay enum evolution (CREATE TYPE + each ADD VALUE in filename order) instead of reading `0001_init.sql` alone.
- Modified file: `packages/schema/test/tables.test.ts:30-52`
- Proof: M10 (correct `ALTER TYPE` migration → green, was red) and M2 (reorder → still red).

### TEST-2 [Major] Sites 2 and 8 ungated
- Action: exported `accountsQuerySchema`; named and exported `UpsertLinkInput`; added a gate for each. The first site-2 gate was behavioural and stayed green under the revert — replaced with a source-text assertion after that was proven.
- Modified files: `apps/api/src/routes/accounts.ts:14`, `apps/worker/src/match.ts:63-75`
- New files: `apps/api/test/accounts-query-domain.test.ts`, `apps/worker/test/upsert-link-domain.test.ts`
- Proof: M8 (site 2 revert → red), M9 (site 8 revert → typecheck red in 2 places).
- Follow-on: adding the site-8 test required declaring `@open-smp/api-types` in `apps/worker/package.json` — the same undeclared-edge class I42.3 exists to catch, hit while writing a test for that class (D9).

### TEST-3 [Minor] CSS gate blind to an emptied rule body
- Action: assertion now requires a non-empty rule body containing `@apply`. D3 amended to state the residual comment-case limit accurately.
- Modified file: `apps/web/test/link-statuses.test.ts:89-95`
- Proof: M11 (emptied body → red). The commented-out case still passes and is recorded as an accepted limit, not claimed as closed.

### FN-1 [Minor] Barrel re-export comment inaccurate
- Action: corrected the comment to state that the **type** keys the map and the value is staged for a future guard. Re-export retained per the barrel's own single-crossing-point policy.
- Modified file: `apps/web/src/lib/api-types.ts:11-17`

### FN-2 [Minor] Type witness proves only one direction
- Action: added a `@ts-expect-error` assignment of a non-domain literal, pinning the widening direction without introducing a new type-testing idiom.
- Modified file: `packages/matcher/test/package-edge.test.ts`

---

## Final verification

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0 — **264 / 29** (baseline 241 / 25) |
| `pnpm test:integration` | exit 0 — 140 / 5, unchanged |
| `pnpm test:e2e` | exit 0 — 43, unchanged |
| `e2e/scripts/assert-seed-preserved.sh` | exit 0 |
| `pnpm build` | exit 0 |

Mutation residue: none (`git status` shows only intended changes).

**Round assessment.** Both Majors were defects in the *gates*, not in the derivation — which is the
signature of a cycle whose subject is gates. The one worth carrying forward is TEST-2's failed first
fix: a behavioural assertion could not observe a property that exists only in the source text, and it
took executing the revert to see that. The same lesson as SEC-1 in plan review, one layer down.

---

# Round 2

Date: 2026-07-27
Scope: verify the round-1 fixes are correct and complete, and check for regressions.

## Changes from Previous Round

All five round-1 findings were applied in commit `9a1a2e6`. Round 2 re-derived each fix by executing
the mutation it claims to catch, rather than reading it.

**Six findings — 3 Major, 3 Minor. All applied. Every one is a defect in a gate written or amended in
round 1; no production code was touched by this round.**

## Findings

### R2-1 [Major, continuing from TEST-2] — the site-8 gate was a false green for its own target

`apps/worker/test/upsert-link-domain.test.ts` was a runtime witness. Re-inlining `UpsertLinkInput`
with the **same four members** left typecheck at 0 errors and the suite at 264 passed.

Round 1 had *already established by execution* that only a source-text assertion can see this — that
is exactly why site 2's gate was rewritten. The site-8 gate was written in the same commit and did not
get the same treatment. D8 recorded the lesson and it was not applied one file over.

Compounding it: the narrowing case the witness *did* catch was already caught without it — a narrowed
union reds at the production call site regardless. The test contributed no detection at all.

**Applied**: reads `match.ts`'s source for `Pick<LinkResult`, plus the absence of any quoted status
literal. Red-proven (M13). The runtime witness is kept alongside, since it pins that the derived type
admits the whole domain.

### R2-2 [Major, new] — the migration replay false-redded on five valid SQL forms

`ADD VALUE IF NOT EXISTS` (the idiomatic re-runnable form), a quoted identifier, a schema-qualified
name, lowercase keywords, and extra whitespace/newlines all missed the regex — each producing a red on
a **correct** migration.

This is TEST-1's own failure mode recurring inside TEST-1's fix. A gate that reds on correct work is
how the next author is pressured into deleting it.

**Applied**: the pattern now tolerates all five. Verified case by case (all five PASS).

### R2-3 [Major, new] — positional `ADD VALUE BEFORE/AFTER` made the gate assert a wrong order

Postgres supports positional enum insertion. With `ADD VALUE 'quarantined' BEFORE 'orphan'` the real
sort order is `matched, quarantined, orphan, ghost, ambiguous`; the append-only replay computed
`…ambiguous, quarantined`. The test's entire purpose is pinning sort order against the deployed
database, and it got that backwards precisely where the order is non-obvious.

**Applied**: the gate now **refuses to guess** — positional forms are detected and fail with a message
saying the ordering rule must be taught to the test first. A gate that says "I cannot evaluate this"
is honest; one that asserts a wrong order is worse than no gate. Verified FAIL.

### R2-4 [Minor, new] — a commented-out `ADD VALUE` counted as applied

`-- ALTER TYPE link_status ADD VALUE 'quarantined';` plus a domain listing `quarantined` passed — the
domain claiming a status the database lacks, which fails on insert.

**Applied**: comments stripped before scanning. `api-types-boundary.test.ts:35` already had a
`stripComments` helper as precedent. Verified FAIL.

### R2-5 [Minor, continuing from TEST-3] — the CSS gate still missed a commented-out rule

Round 1's `@apply` requirement caught the emptied body but not a commented-out rule, because the
`@apply` sits inside the comment text — so the gate's own comment named two shapes and caught one.
D3 was amended in round 1 to record that limit honestly; round 2 closed it.

**Applied**: CSS comments stripped before matching. Verified red. The comment now matches behaviour.

### R2-6 [Minor, new] — the site-2 source assertion was brittle on two correct refactors

An aliased import and a reformatted `z.enum(...).optional()` chain both keep the derivation intact yet
failed.

**Applied**: the positive pattern is whitespace-tolerant (reflow verified green), and the negative
assertion broadened from `z.enum([...])` to any quoted status literal — which also closes an
indirection the narrow form missed (`const LOCAL = [...]` fed to `z.enum`, verified red).

## Regression checks (all clear)

- **`accountsQuerySchema` export** — consumed only by the new test; `app.ts:12` still imports only
  `registerAccountsRoute`. Never mutated post-construction. No cycle, no bundling concern.
- **`UpsertLinkInput` export** — type-only, fully erased at runtime.
- **New `apps/worker` → `@open-smp/api-types` edge** — `api-types` is a dependency-free leaf, so no
  cycle is possible; `api-types-boundary.test.ts` passes.
- **`@ts-expect-error` pinning** — verified it suppresses exactly one `TS2322` on a one-line
  declaration and reds as `TS2578` when the domain widens. Not over-broad.
- **R43 (fix-induced boundary widening)** — the only delta to the validation boundary between
  `5e57200` and `HEAD` is the `export` keyword. `.strict()`, `z.enum(LINK_STATUSES)`, and all four
  fields byte-identical. **No widening.**

## Recurring Issue Check — Round 2

- **R43 (fix-induced boundary widening)** — PASS. Diffed the round-1 fix range; the sole change to
  `accounts.ts` is the `export` keyword.
- **RT7 (gate proves it can fail)** — FINDING(R2-1). The site-8 gate was verified green under its
  target mutation. R2-2/3/4/5/6 were all found by mutating and running rather than reading.
- **False-red pressure on correct code** — FINDING(R2-2, R2-3, R2-6). Same class as the resolved
  TEST-1: a gate that reds on legitimate work invites its own deletion.
- **False-green blindness** — FINDING(R2-1, R2-4, R2-5). Three gates passed states they claimed to
  reject.
- **Comment matches behaviour** — FINDING(R2-5). Comment named two shapes; the regex caught one.
- **Module boundary / cycles** — PASS. `api-types` remains a dependency-free leaf.
- **Export surface creep** — PASS. Both new exports have test-only consumers; the type erases, the
  value is server-side and immutable.
- **Mutation hygiene** — PASS. All mutations run in the main repo from backups; tree and migration
  directory confirmed clean afterwards.

## Final verification — Round 2

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0 — **264 / 29** (23 scanner-table cases removed with the scanner) (baseline 241 / 25) |
| `pnpm test:integration` | exit 0 — 140 / 5, unchanged |
| `pnpm test:e2e` | exit 0 — 43, unchanged |
| `e2e/scripts/assert-seed-preserved.sh` | exit 0 |
| `pnpm build` | exit 0 |

Migration directory verified intact (five files, no stray test artifacts). No mutation residue.

**Round assessment, and the honest version of it.** Round 2 found more Majors than round 1, and all of
them were in round 1's own fixes. The recurring shape across both rounds: a gate is easy to write so it
passes today and hard to write so it fails tomorrow, and the only way to tell those apart is to run
the mutation. Round 1 ran mutations for the gates it doubted and reasoned about the ones it did not —
R2-1 is what that costs, and it is the same mistake twice in one commit, since the lesson was written
down in D8 while the sibling gate went unproven.

---

# Round 3

Date: 2026-07-27
Scope: verify the round-2 fixes, and probe specifically for new false-reds/false-greens they
introduced — since that is exactly what round 2 found in round 1's work.

## Changes from Previous Round

Round 2's six fixes were applied in `1cf53e0` and touched only test files. Round 3 re-executed every
round-2 mutation and confirmed all six resolved, then probed the fixes themselves.

**Three findings — 2 Major, 1 Minor. All applied. Again, every one is a defect in a gate the previous
round had just repaired, and again no production code changed.**

## Findings

### R3-1 [Major, new] — the positional detector was inverted, not merely blind

R2-3 made the gate *refuse* positional `ADD VALUE ... BEFORE/AFTER` rather than replay it. Correct
choice, incomplete regex: it required a trailing whitespace character, and Postgres does not need one
because a string literal is its own token. Verified against the running Postgres 16:

```text
ALTER TYPE r3v ADD VALUE 'dormant' AFTER'matched';   -> ALTER TYPE
enumsortorder                                        -> matched, dormant, orphan
```

With that form present, the detector missed it, the append-only replay took over, and the gate
**passed the wrong order and failed the correct one** — the exact defect R2-3 was raised to prevent.

**Applied**: `(BEFORE|AFTER)\s*'`. All three spellings now fail loudly (verified).

### R3-2 [Major, new] — the `--` stripper corrupted SQL string literals

`replace(/--[^\n]*/g, '')` is not literal-aware. A `--` inside a quoted value swallowed the rest of the
line — in one executed case a real `ADD VALUE`, in another the `CREATE TYPE` itself, producing
"migrations must declare the link_status enum" against a file that declares it. A gate that fails for
a reason unrelated to its claim is worse than one that misses.

**Applied**: a tokenizing walk that treats a comment marker as one only outside a literal. Verified: a
`DEFAULT 'a--b';` sharing a line with a real `ADD VALUE` now passes, and the commented-out `ADD VALUE`
still fails.

### R3-3 [Minor, new] — the broadened negatives false-redded on ordinary comments

R2-6 widened the check to any quoted status literal in the file. That catches a `const LOCAL = [...]`
indirection, but also reds a comment mentioning `'orphan'` or a message containing `'ghost'`. Both
files already carry literals of that shape nearby, so this was when-not-if.

**Applied**: comments stripped before the check, via a local `stripTsComments` in each of the two test
directories. Verified both directions — a status-mentioning comment stays green in both files, and
both re-inline reverts still fire.

## Regression checks

The round-3 fixes *loosen* two negatives, so the round-2 detections they were widened for had to be
re-proven. Both still fire (site-2 re-inline red, site-8 re-inline red). The five valid `ALTER TYPE`
spellings from R2-2 still pass, and R2-4's commented-out case still fails.

## On the duplicated `stripTsComments`

It exists twice, in `apps/api/test/` and `apps/worker/test/`. Knowing choice, not an oversight in a
cycle about removing duplication: the two packages share no test-utility path, and the alternative
considered — `packages/api-types` — would put a test helper in the package whose entire contract (C39)
is that it holds nothing but the domain. Two copies is cheaper than eroding that boundary; a third
would be the point to build a shared test package. `packages/schema` has its own separate stripper
because it strips *SQL*, a different language with different rules.

## Recurring Issue Check — Round 3

- **RT7 (gate proves it can fail)** — FINDING(R3-1). The positional gate was verified inverted against
  a real Postgres, not reasoned about.
- **False-red pressure on correct code** — FINDING(R3-2, R3-3). Both would red a correct file.
- **False-green blindness** — FINDING(R3-1). The missed form silently degraded to a wrong-order
  assertion instead of the intended explicit refusal.
- **Comment matches behaviour** — PASS. All three gate comments now describe what the code does.
- **R2 (duplication)** — PASS with the note above; the duplication is deliberate and its cheaper
  alternative was rejected for a stated reason.
- **Mutation hygiene** — PASS. All mutations in the main repo from backups; tree clean, migrations
  directory back to five files.

## Final verification — Round 3

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0 — **264 / 29** (23 scanner-table cases removed with the scanner) (baseline 241 / 25) |
| `pnpm test:integration` | exit 0 — 140 / 5, unchanged |
| `pnpm test:e2e` | exit 0 — 43, unchanged |
| `e2e/scripts/assert-seed-preserved.sh` | exit 0 |
| `pnpm build` | exit 0 |

## Three-round assessment

Rounds 2 and 3 found nine issues between them, **all in gates, none in the derivation**. The
derivation — the actual subject of SC42 — has been correct since Phase 2 and no round has found a
defect in it.

What kept being wrong is the machinery asserting it. The recurring failure was writing a gate that
passes today rather than one that fails tomorrow for the right reason, and in every case the
difference was invisible until a mutation was executed. R3-1 is the sharpest instance: a gate that
had already been corrected once for this exact class was still inverted, and only a real Postgres
query showed it.

---

# Round 4

Date: 2026-07-27
Scope: convergence check. Rounds 2 and 3 each found that the previous round's gate repairs carried new
bugs; round 4 asks whether round 3's fixes are finally correct, or the pattern continues.

## Changes from Previous Round

Round 3's three fixes were applied in `d702e67`, touching only test files plus two new helpers.

**One Major. The pattern continued — but the review's diagnosis was more valuable than its finding,
and the fix this round is to the class rather than the instance.**

## Findings

### R4-1 [Major, new] — the same bug R3-1 diagnosed, two tokens to the left

R3-1 changed `(BEFORE|AFTER)\s` to `\s*` and wrote the general rule in a comment: *a string literal is
its own token, so no whitespace is required before it.* The same pattern contained `ADD\s+VALUE\s+`.
Postgres accepts `ADD VALUE'quarantined'` — verified against the running Postgres 16:

```text
ALTER TYPE r4v ADD VALUE'c';           -> ALTER TYPE
ALTER TYPE r4v ADD VALUE'd'AFTER'a';   -> ALTER TYPE   (order: a,d,b,c)
```

The replay missed the value entirely, so the database could gain a status the domain does not list and
the gate whose entire purpose is catching that divergence stayed green. The rule was written down and
applied to exactly one keyword.

**Applied, by class:**

1. The `ALTER TYPE ... ADD VALUE` prefix is now one shared constant used by both the positional
   detector and the replay. They were separate literals, which is how they drifted.
2. `\s*` at every keyword-to-literal boundary, in one pass.
3. The scanner got **its own test table** — 12 cases: eight spellings that must parse, two commented-out
   forms that must not, two comment-marker-in-a-literal forms that must not eat real DDL. It had only
   ever been validated indirectly through the gate consuming it, which is why each spelling cost a
   full round to surface.

**The extraction immediately broke something, and that is the useful part.** Sharing the prefix
silently changed what the positional detector matched — the constant stops before the new label, so
appending `\s*(BEFORE|AFTER)` no longer matched the label in between, and two positional cases flipped
FAIL → PASS. The new case table caught it on the first run. A refactor of a gate is a change to the
gate and needs the same table the gate does.

## Verified resolved (round-3 fixes)

All three confirmed by re-executed mutation: R3-1 (four positional spellings all red), R3-2 (`--`
inside a literal no longer eats real DDL), R3-3 (a comment mentioning `'orphan'` stays green in both
TS files).

## Regression re-proof

Thirteen migration cases run as real files; all matched expectation. Notably the round-2/3 catches all
still hold: commented-out `ADD VALUE` fails, the five valid spellings pass, `--` in a literal passes,
both positional forms fail. Separately re-proven: site-2 re-inline red, site-8 re-inline red,
commented-out CSS rule red, emptied CSS body red, reflowed `z.enum` green, `const LOCAL` indirection
red.

## Hazards recorded rather than fixed

Both unreachable only by accident of current content, so both are now stated in the code — the next
person to add the construct is who turns a note into a false green:

- `stripSqlComments` handles neither nested block comments nor dollar-quoting. The migrations contain
  zero block comments; `0001_init.sql`'s `DO $$` block is quote-balanced by luck.
- `stripTsComments` would treat a regex literal containing `/*` as opening a block comment. Neither
  scanned file has a regex literal, and `/a/*b/` is not valid TypeScript.

## The duplicated `stripTsComments`

Re-assessed: two byte-identical copies, each consumed by one gate. Drift would mean a missed
improvement, not a false green, since neither copy is load-bearing for the other's assertion. Cheaper
than a shared test package, and much cheaper than pushing a test helper into `packages/api-types`,
whose contract (C39) is that it holds nothing but the domain. A third call site is the trigger.

## Recurring Issue Check — Round 4

- **RT7 (gate proves it can fail)** — FINDING(R4-1), then closed by a direct scanner table rather than
  another end-to-end probe.
- **R3 (incomplete pattern propagation)** — FINDING(R4-1). This is the rule that actually names the
  defect: the fix was applied to the reported instance, not to the stated rule. The round-4 response
  (one shared constant + a case table) is the propagation fix.
- **R2 (duplication)** — PASS with the recorded exception above.
- **False-green blindness** — FINDING(R4-1).
- **Comment matches behaviour** — PASS. Both scanners now state their unhandled cases.
- **Mutation hygiene** — PASS. Main-repo mutations from backups; tree clean, five migrations.

## Final verification — Round 4

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0 — **264 / 29** (23 scanner-table cases removed with the scanner) (baseline 241 / 25) |
| `pnpm test:integration` | exit 0 — 140 / 5, unchanged |
| `pnpm test:e2e` | exit 0 — 43, unchanged |
| `e2e/scripts/assert-seed-preserved.sh` | exit 0 |
| `pnpm build` | exit 0 |

## Four-round assessment

Rounds 2–4 found ten issues, **every one in a gate, none in the derivation**. The derivation has been
correct since Phase 2.

The single recurring defect, stated plainly: hand-written text scanners assuming whitespace a
tokenizer does not require, fixed one instance at a time. Round 3 diagnosed the general rule and
applied it to one keyword; round 4 found the neighbouring one. The break was not another
one-character patch but three structural changes — one shared pattern instead of two literals, `\s*`
at every boundary in a single pass, and a direct test table for the scanner instead of validating it
only through the gate that consumes it. The extraction's own regression, caught immediately by that
new table, is the evidence the table was the missing piece.

---

# Round 5

Date: 2026-07-27
Scope: did round 4's structural change break the cycle, or does the pattern continue?

## Changes from Previous Round

Round 4 replaced a one-character patch with structure: one shared `ADD_VALUE` constant, `\s*` at every
boundary in a single pass, and a 12-case table testing the scanner directly.

**One Critical, one Major. The structural change worked for the class it targeted — whitespace is
genuinely fixed and held under every probe — but the class was drawn one notch too narrow.**

## Findings

### R5-1 [Critical, new] — the label has more spellings than a plain literal

`ADD_VALUE` was followed by a hardcoded `'([^']+)'`. Postgres accepts three other label forms and a
fully-quoted schema-qualified type name. Verified live:

```text
ALTER TYPE r5v ADD VALUE $$dq$$;    -> ALTER TYPE
ALTER TYPE r5v ADD VALUE E'esc';    -> ALTER TYPE
ALTER TYPE r5v ADD VALUE U&'uni';   -> ALTER TYPE
```

Four **confirmed false greens**, each executed as a real migration adding a status the domain does not
list — the gate stayed green in all four. Same severity class as R4-1, one axis over.

### R5-2 [Major, new] — the positional detector inherited the same assumption

A positional insert with a non-plain label went undetected, so the append-only replay asserted an order
disagreeing with the database. Confirmed against real Postgres that the reorder does happen.

## Disposition — stop failing silently, rather than enumerate harder

Every round ended the same way: a spelling nobody anticipated did not match, and the replay carried on
as if the statement were absent. Enumerating one more axis buys one more round. So:

1. **`LABEL` is now a shared constant** beside `ADD_VALUE`, covering `'x'`, `E'x'`, `U&'x'`, `$$x$$`,
   and `''` as an escaped quote — extracted for the same reason the prefix was in round 4, so the two
   consumers cannot drift on it.
2. **The gate asserts parse-completeness.** It counts statements it can *see* (`ADD_VALUE_ANY`) against
   statements whose label it can *parse*, and fails when they differ:

   ```text
   every ALTER TYPE ... link_status ... ADD VALUE must have a label this test can parse
   (saw 1, parsed 0); teach it the spelling rather than letting the statement pass unseen
   ```

   This is the only change here that closes spellings nobody has thought of yet.
3. **That property is itself asserted** — a case feeds the scanner `ADD VALUE ??unparseable??` and
   pins seen=1, parsed=0. Plus cases for all four newly-supported label forms, `''` escaping, and
   another enum's `ADD VALUE` not being attributed to `link_status`.

## Verification

Ten new cases run as real migration files, all matching expectation: the four false greens now red
when the domain lacks the status and pass when it lists it; both positional variants red; the
unparseable label reds. Twelve rounds-2-through-4 regression cases re-run, all unchanged.

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0 — **264 / 29** (23 scanner-table cases removed with the scanner) (baseline 241 / 25) |
| `pnpm test:integration` | exit 0 — 140 / 5, unchanged |
| `pnpm test:e2e` | exit 0 — 43, unchanged |
| `e2e/scripts/assert-seed-preserved.sh` | exit 0 |
| `pnpm build` | exit 0 |

## Recurring Issue Check — Round 5

- **RT7 (gate proves it can fail)** — FINDING(R5-1, R5-2), closed by the parse-completeness assertion
  rather than by another enumeration. Round 4's table was verified non-vacuous by the reviewer
  (4/4 mutations red), so it did its job; it simply could not enumerate an unknown axis.
- **R3 (incomplete pattern propagation)** — FINDING. The pattern continued but the axis moved: round 4
  generalised across whitespace correctly, and did not generalise across lexical form. The stated rule
  was "no whitespace is required between tokens"; the unstated neighbour is "a literal has more than
  one spelling".
- **False-green blindness** — FINDING(R5-1, R5-2). Four executed false greens.
- **Comment matches behaviour** — PASS after the fix; `ADD_VALUE`'s comment previously read as more
  complete than the code was.
- **R2 (duplication)** — PASS. `ADD_VALUE` and `LABEL` are single sources.
- **Mutation hygiene** — PASS. Main-repo mutations from backups; tree clean, 5 migrations, Postgres
  scratch types dropped.

## Five-round assessment

Twelve findings across rounds 2–5, **every one in a gate, none in the derivation** — which has now been
independently traced clean five times.

The recurring defect was never really "regexes are brittle". It was that the scanners **failed
silently** on input they did not understand, and each round fixed one silence. The structural answers
arrived in order of increasing generality: one shared pattern (round 4), a direct test table (round 4),
and finally an assertion that the scanner must parse everything it can see (round 5). Only the last
one is closed against spellings nobody has thought of — which is the argument for reaching for it
first the next time a gate parses text.

---

# Round 6

Date: 2026-07-27
Scope: does the parse-completeness assertion converge the cycle, or is there a spelling that escapes
even the "seen" counter?

## Changes from Previous Round

Round 5 replaced enumeration with a parse-completeness assertion: count statements seen against
statements parsed, fail on a discrepancy.

**One Critical, one Major, one Minor. The assertion was a genuine structural improvement and closed
the entire label-spelling axis — but it was scoped to `ADD_VALUE`, so it inherited that prefix as its
own blind spot.**

## Findings

### R6-1 [Critical, new] — three-part qualification escapes both counters

`ADD_VALUE` allowed one qualifier; Postgres accepts `database.schema.type`. A statement failing the
prefix is invisible to the "seen" counter *and* the replay, so the assertion compared 0 to 0 and
passed. Executed false green: a migration adding `'sneaky'` gave 284/284.

### R6-2 [Major, new] — `RENAME VALUE` changes the label set and is invisible

The counter only knew `ADD VALUE`. `ALTER TYPE ... RENAME VALUE 'old' TO 'new'` (PG 10+) mutates the
label set without adding one — verified working on an enum in use by a table with rows, so not a
statement an author would avoid. Executed false green: 284/284.

### R6-3 [Minor, new] — the site-2 gate reds on a formatter's trailing comma

Round 4's comment claimed formatter tolerance. The chain break was handled; an argument-list break was
not, and prettier follows one with a trailing comma. This repo uses trailing commas throughout. A
false red on an intact derivation.

## Disposition

**Fixed at the statement level, where round 5's assertion should have been scoped.** The counter is now
`ALTER TYPE <any qualification of link_status> <anything but RENAME TO>` — everything aimed at the
type, refusing anything it cannot replay, rather than only the verb it already knew. `RENAME TO` is
excluded deliberately (renames the type, not a label). `TYPE_REF` takes `{0,2}` qualifiers and is
shared with the `CREATE TYPE` extraction. R6-3 fixed with `,?`.

**One new test case was itself wrong and caught itself.** After widening `TYPE_REF`, three-part
qualification became *replayable*, so leaving it in the "sees but cannot replay" table failed on the
first run. The case table catching an error in the case table is the argument for having one.

## Verification

Sixteen migration cases executed: both escapes now red when the domain lacks the status, the
three-part form passes when it lists it, `RENAME TO` correctly does not red, and all eleven
rounds-2-through-5 cases unchanged. R6-3 verified both directions (trailing-comma reflow green,
re-inline still red).

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0 — **264 / 29** (23 scanner-table cases removed with the scanner) (baseline 241 / 25) |
| `pnpm test:integration` | exit 0 — 140 / 5, unchanged |
| `pnpm test:e2e` | exit 0 — 43, unchanged |
| `e2e/scripts/assert-seed-preserved.sh` | exit 0 |
| `pnpm build` | exit 0 |

## Recurring Issue Check — Round 6

- **RT7** — PASS for the label axis (round 5's assertion verified non-vacuous by two independent
  mutations). FINDING(R6-1, R6-2) for the statement axis: an assertion cannot fire for statements it
  never sees.
- **False-green blindness** — FINDING(R6-1, R6-2). Two executed false greens.
- **R3 (incomplete pattern propagation)** — FINDING. `ADD_VALUE` was widened for quoted qualification
  in round 5 without asking how many qualifiers Postgres permits; the neighbouring generalisation was
  one quantifier away.
- **Comment matches behaviour** — FINDING(R6-3), fixed. The counter's comment said "whatever follows",
  accurate about what follows and silently untrue about what precedes.
- **R2 (duplication)** — PASS. `TYPE_REF`, `ADD_VALUE`, `LABEL`, `ALTERS_TYPE` are single sources.
- **Derivation** — PASS, sixth consecutive round.

## Six-round assessment

Fourteen findings across rounds 2–6, **every one in a gate, none in the derivation**, which has now
been independently traced clean six times.

The axis moved every round: whitespace (2–4), lexical form of the label (5), the statement prefix and
verb (6). Each fix was correct for the axis it targeted and inherited the next one's blind spot. What
generalises is not a wider pattern but the *shape* of the assertion — count what you can see, refuse
what you cannot replay — applied to the whole statement rather than to the fragment already
understood. That is the transferable lesson from six rounds of chasing one class of defect.

---

# Round 7

Date: 2026-07-28
Scope: does the statement-level counter converge, or is there yet another escape?

## Changes from Previous Round

Round 6 scoped the completeness counter to the whole statement.

**Two High, one Medium. It does not converge — and round 7 stops trying.**

## Findings

### R7-1 [High, new] — a stripped comment defeats both counters through their shared prefix

`stripSqlComments` replaced a comment with nothing, but Postgres treats one as a token separator. So
`ALTER/*c*/TYPE link_status ADD VALUE 'escaped'` — valid DDL, verified adding the label on live
Postgres 16 — became `ALTERTYPE` after stripping. Both `ALTERS_TYPE` and `ADD_VALUE` share that
prefix, so seen and parsed both hit zero and the completeness assertion passed 0-to-0. **The
anti-blindness counter, blinded by exactly what it was built to catch.**

### R7-2 [High, new] — a recreate is not an `ALTER TYPE` at all

`DROP TYPE link_status; CREATE TYPE link_status AS ENUM ('totally','different','labels');` replaced
the label set wholesale and passed 287/287. `created` used a non-global match, binding 0001's
declaration and ignoring the later one. Scoping to `ALTER TYPE` cannot reach this by construction.

### R7-3 [Medium, new] — the widening now costs false reds

`OWNER TO` and `SET SCHEMA` are label-neutral and both redded. `RENAME TO` was special-cased in round
6; its siblings were not. The scanner was being asked to know the full grammar in both directions,
one exemption per round.

## Disposition — the instrument was wrong

Seven rounds is enough evidence: the escapes are not running out, and each widening admits new false
reds. So the text scanner is **deleted** — `stripSqlComments`, `TYPE_REF`, `ADD_VALUE`, `LABEL`,
`ALTERS_TYPE`, the 23-case table and the replay test, ~170 lines approximating a SQL parser.

Replaced by `packages/schema/test/link-status-enum.integration.test.ts`: run the migrations against a
real Postgres via Testcontainers, read the enum back from `pg_enum` by `enumsortorder`. No spelling
can escape, because the parser is the one that will run the migrations in production. It also pins
that `account_links.status` uses that type (otherwise a swap to a same-labelled enum would pass) and
that an out-of-domain value is rejected on cast.

**Proven on nine cases as real migration files** — the database gate is correct on all nine; the text
scanner was wrong on four after seven rounds of repair:

| Case | Text scanner | Database gate | Want |
|---|---|---|---|
| `ALTER/*c*/TYPE ... ADD VALUE` | **green — escaped** | red | red |
| `DROP TYPE` + `CREATE TYPE` | **green — escaped** | red | red |
| plain / `$$…$$` / positional / `RENAME VALUE` | red | red | red |
| commented-out (no-op) | green | green | green |
| `OWNER TO` / `SET SCHEMA` | **red — false** | green | green |

`tables.test.ts` keeps the drizzle-mirror assertion — a different claim, correctly unit-tier — with a
pointer to where the deployed-enum question is now answered.

## Verification

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0 — **264 / 29** (23 scanner cases removed with the scanner) |
| `pnpm test:integration` | exit 0 — **143 / 6** (was 140 / 5) |
| `pnpm test:e2e` | exit 0 — 43, unchanged |
| `e2e/scripts/assert-seed-preserved.sh` | exit 0 |
| `pnpm build` | exit 0 |

## Also noted

The reviewer found that `pnpm -C packages/schema test` reports 43 passed while never running
`tables.test.ts` — the package script only picks up the integration file. Not introduced here and out
of scope for this cycle, but worth knowing: a reviewer or job invoking the package script gets a
confident green that never touches the gate under review.

## Recurring Issue Check — Round 7

- **RT7** — FINDING(R7-1, R7-2), closed by removing the instrument rather than patching it.
- **False-green blindness** — FINDING(R7-1, R7-2). Two executed false greens, one of which defeated
  the anti-blindness counter itself.
- **False-red pressure on correct code** — FINDING(R7-3). The exemption list was growing per round.
- **R2 (duplication)** — PASS, and improved: ~170 lines of parser approximation deleted.
- **Derivation** — PASS, seventh consecutive round.

## Seven-round assessment

Seventeen findings across rounds 2–7. **Every one in a gate. Zero in the derivation**, which has been
independently traced clean seven times and has not changed since Phase 2.

Every finding was the same shape: a text scanner failing silently on input it did not understand. The
structural answers got steadily more general — one shared pattern (r4), a direct case table (r4), a
parse-completeness assertion (r5), statement-level scoping (r6) — and each was correct for the axis it
targeted while inheriting the next one's blind spot. What converges is not a better parser but *not
parsing*: where a real executor for the language is available, asking it is the only approach with no
blind spot left to find. The cost is a database and a slower tier, and refusing that cost is what the
previous six rounds were really doing.
