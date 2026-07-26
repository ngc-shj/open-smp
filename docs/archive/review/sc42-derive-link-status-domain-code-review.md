# Code Review: sc42-derive-link-status-domain

Date: 2026-07-27
Review round: 1

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
