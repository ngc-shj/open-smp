# Plan: harden-label-audit-reclaim-deferred

Cycle 3. Branch: `refactor/harden-label-audit-reclaim-deferred`
Date: 2026-07-26
Revision: **final (scope split after round 3)**.

Round 1 closed 13 findings (1 Critical, 6 Major, 6 Minor); round 2 closed 19 (1 Critical, 6 Major, 12 Minor); round 3 raised 12 (1 Critical, 5 Major, 6 Minor). The review did not converge, and the reason is diagnosable rather than mysterious: **each round's findings were overwhelmingly defects introduced by the previous round's fixes.** All three Criticals were of that kind.

| Round | Findings | Of which were defects in the prior round's fixes |
|---|---|---|
| 1 | 13 | n/a (first review of the draft) |
| 2 | 19 | ~15, incl. the Critical (C35's red proof) |
| 3 | 12 | ~10, incl. the Critical (C35's unimplementable criterion 2) |

The mechanism is visible in what the findings *are*. Round 3's Critical is that `LabelFilter.tsx`'s `FILTERS` cannot be imported by a vitest unit test — it is unexported, and `apps/web/tsconfig.json:14` sets `jsx: preserve`, so the unit project cannot transform the module at all. Round 3's Majors include a `grep` whose Decision list named five of six sites, and a regex character class (`[a-z_]+`) that silently drops a hyphenated status. **Every one of these is a five-minute discovery when the code is written and run, and an expensive multi-round discovery when it is specified in prose.** The plan had grown to 1055 lines and nine contracts, most of the churn in gate specifications whose correctness is only observable by executing them.

**Decision: split the scope rather than run a fourth round.**

| Cycle 3 (this plan, proceeding to Phase 2) | Cycle 4 (deferred, recorded as SC40) |
|---|---|
| **C28** `recordLabelAuditBatch` — zero findings across all three rounds | **C30** seed-gate literal agreement |
| **C29** validated read-path domain — one round-3 correction (T11), applied below | **C34** drizzle-enum derivation gate |
| **C31** `client_error` fallback — stable since round 2 | **C35** `apps/web` domain derivation |
| **C32** CI SHA pinning — two round-3 corrections, applied below | **C36** the C8 amendment gate |
| **C33** audit-writer member-set gate — zero findings across all three rounds | |

The split is drawn where the evidence points, not for convenience: **every round-3 Critical and Major except T11 lands on the four deferred contracts**, and the five retained ones have been stable for two rounds. The retained set is also the coherent one — it is exactly the audit-hardening work plus the deferral reclamation this cycle set out to do (F6, Sec-F4, F-R3-2, plus the supply-chain pin). The deferred set is a second, separable theme: derive one domain across six copies and gate it.

Cycle 4 will build those gates **by writing and running them**, not by specifying them in prose — which is the correction this cycle's review process actually earned.

Contract numbering: `C28`– (C1–C27 belong to cycles 1–2).
Scope-out numbering: `SC32`– (SC1–SC31 belong to prior cycles). **`SC36` is deliberately unallocated**: it was proposed during round-1 review as a scope-out for the three uncovered domain copies, then withdrawn when C34/C35 adopted the fix instead. Recorded rather than silently skipped, and **not** reused, because scope-out IDs are cross-cycle citations (C28 cites SC27; C29 cites SC30) and a later reuse would make a future citation ambiguous against this review record.
Invariant numbering: `I28`– keyed to the contract that owns them.

---

## Project context

- **Type**: `web app` (pnpm monorepo — Fastify API :3001, Next.js 15 web :3000, BullMQ worker, Postgres 16 with RLS, Redis 7)
- **Test infrastructure**: `unit + integration + E2E + CI/CD`
  - unit: Vitest, 164 tests / 16 files
  - integration: Vitest + Testcontainers (real Postgres 16 + Redis 7), 135 tests / 5 files
  - E2E: Playwright against the compose stack, 43 tests
  - CI: GitHub Actions, one workflow `.github/workflows/ci.yml`, three jobs (`checks` → `integration` → `compose-smoke`)
- **Baseline**: `main` @ `3a56620`, synced with `origin/main`. Last CI run `30195790728` green on all three jobs.
  **Working tree**: clean apart from the untracked plan and review docs under `docs/archive/review/` (corrected round 3, Functionality F7). This matters because `git status` is itself evidence in this cycle — C33 criterion 2 and the C28 probe both cite a clean tree as proof that a red-proof scratch edit was reverted. Those checks MUST be phrased over tracked files (`git status --porcelain --untracked-files=no`), or an implementer sees two untracked docs during the exact step where the command is the evidence, and learns to discount its output.

### Verification environment constraints

Each constraint is classified per contract in the **Environment Verification Report obligations** section below.

| ID | Constraint | Status this cycle |
|----|-----------|-------------------|
| VE1 | No live Google Workspace tenant. Provider-accepted credential behavior cannot be exercised. | Unchanged from cycle 2. **Not touched by this cycle** — no contract here crosses the provider boundary. |
| VE2 | E2E coverage requires the compose stack to be rebuilt after any source change (`docker compose up -d --build api web worker`); images carry no source mount. | `verifiable-local`. Applies to C28/C29 acceptance via the events page. |
| VE3 | Integration tests require Docker (Testcontainers). | `verifiable-local` + `verifiable-CI`. |
| VE4 | E2E requires the running compose stack. | `verifiable-local` + `verifiable-CI`. |
| VE5 | ~~No git remote; CI has never executed.~~ **RESOLVED.** | Remote is `github.com/ngc-shj/open-smp`; CI run `30195790728` is observed-green on `main`. Every gate claim in this plan is `verifiable-CI` and MUST be stated as observed, not as parity-by-construction. See "VE5 resolution" below. |
| VE6 | E2E login rate limit is 5/min/IP and the suite's budget is 5/5 — zero headroom. | `verifiable-local` with care. **Binding constraint on C31**: see I31.3. No contract here adds a login. |

**VE5 resolution — why this matters to this plan.** For three cycles every CI claim was parity-by-construction (the same command run locally), never observed-green. When the remote landed, the first CI run failed `compose-smoke` with exit 254: `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL / Command "playwright" not found` — `pnpm exec playwright install` ran at the root while `@playwright/test` is declared only in `e2e/package.json`. **That step had never executed in its life,** and no local run could detect it, because the failure existed only on CI's code path. Fixed in `acfc356` (`pnpm --filter e2e exec`, now `ci.yml:144`).

The lesson is load-bearing for this cycle's gate claims: a gate that has never been observed to run is not evidence, and "the same command passes locally" is not the same statement as "the gate ran". Every acceptance criterion below that names CI is therefore required to cite an observed run id, not a local invocation.

---

## Objective

Reclaim four of the five findings deferred at the end of cycle 2, at the point their recorded triggers fire, and pin the CI supply chain.

The four are not an arbitrary batch. Two of them (**F6**, **Sec-F4**) are the same defect seen from the write side and the read side: the label-audit payload has no validated domain at either boundary. Cycle 2's Anti-Deferral entries recorded this explicitly — Sec-F4's trigger reads *"same cycle as F6"*, because splitting them "would touch the same projection twice". Their joint trigger is *"the next cycle that touches `audit.ts`"*, which is this one.

**Reclaimed here: three of the five.** F6 and Sec-F4 (C28 and C29 — the joint trigger "the next cycle that touches `audit.ts`" fires here), plus **F-R3-2** (C31 — the trigger is "the next edit to the error-handler mapping", and C31 is that edit).

**F7 (the shell gate's re-copied seed constants) is NOT reclaimed here** — deferred to SC40 with the domain-derivation work. Its trigger ("next cycle touching `seed-facts.ts` or the gate") does still fire, so this is a deliberate re-deferral rather than a trigger that failed to arrive: three review rounds could not settle the extractor's specification on paper, and the honest reading is that it is a gate to be written and run, not specified. Its original cycle-2 cost justification stands; the added cost of one more cycle's delay is that a `seed-facts.ts` edit continues to fail at the end of the most expensive CI job rather than in the first one.

The fifth deferral (compose image staleness) is **not** reclaimed. Its recorded trigger is "revisit if it recurs" and it has not recurred; its fix requires the API to expose a build identifier it does not have — a production surface change to fix a local-workflow annoyance. It stays deferred as **SC35** with its cycle-2 cost justification intact.

CI SHA-pinning (**C32**) is new work, not a deferral: it came from reading `../passwd-sso`, which pins every action by commit SHA. It is in scope because it is a supply-chain control on the gate that this whole cycle's evidence depends on — VE5's resolution makes CI the source of truth, so CI's own integrity is now load-bearing.

**Scope grew in round 2, then contracted after round 3.** Plan review found the first draft's member-set was three copies short: the label-kind domain exists in **six** places, not three, and two of the missed copies are in `apps/web` where a fourth kind would be silently unfilterable. Contracts to close them were added (C34–C36) — evidence-driven growth, since the draft's own FR2 already promised what they deliver.

Round 3 then found those contracts carried a Critical and three Majors of their own, all of the same kind: specifications for greps and tests whose correctness is only observable by running them. They are deferred to cycle 4 as **SC40** rather than corrected a third time. The six copies are still six; this cycle closes two of them and says so, instead of claiming all six and delivering three.

**Non-objective**: no new user-facing feature. No new page, no new route, no schema migration. This cycle is behavior-preserving from an operator's point of view, with one exception, stated precisely (corrected in round 2 — the first draft got this wrong): where a stored audit payload carries an out-of-domain `kind`, the affected snapshot side now renders as **`none`** rather than `undefined`. `none` is indistinguishable from a genuine "no label"; only a *wholly* corrupt payload renders `—`. See I29.5 for why that ambiguity is accepted and what actually constrains reachability.

---

## Requirements

### Functional

- **FR1** — Bulk and single label mutations MUST write byte-identical audit rows for the same logical event: same table, same columns, same `source`, same `kind` domain, same payload shape. A future change to the audit row (a new column, a payload-version field, a kind rename) MUST be impossible to apply to one path and miss on the other.
- **FR2** — The events read path MUST NOT serve a `before`/`after` snapshot whose `kind` is outside the label-kind domain. A stored payload carrying an unrecognized `kind` MUST degrade safely rather than being asserted into a union type it does not belong to. **Extended in round 2**: the same obligation applies to every label-kind-typed response field, not only the events projection — `accounts.ts` and `identities.ts` serve the same domain to the two highest-traffic read surfaces, and closing only the events page would fix the reported instance while leaving the property broken (cycle-2 lesson 2).
- **FR6 — withdrawn after round 3, deferred to SC40.** The requirement read: "adding a fourth label kind MUST require exactly one domain edit plus the migration, with every other site either derived from the domain or failing to compile." It survived two rounds of correction to its *edit count* (four → three → five) and never became true, because delivering it needs `packages/schema/src/tables.ts` derived from `api-types` — which requires a `schema → api-types` dependency this cycle's scope statement forbids. Rather than restate the count a fourth time, the requirement moves to the cycle that can actually satisfy it. **What this cycle delivers instead** is stated in I29.3: copies 1 and 2 collapse into one derived domain, copy 3 is pinned by a real-DB test, and copies 4–6 are recorded as unchanged rather than claimed as closed.
- **FR3** — The seed acceptance gate's asserted constants MUST be derived from, or mechanically checked against, `e2e/fixtures/seed-facts.ts`. A `seed-facts.ts` edit that is not mirrored into the gate MUST fail a test.
- **FR4** — The API error handler's unclassified-4xx fallback (`client_error`) MUST be covered by a test that fails if the fallback is removed or changed to `bad_request`.
- **FR5** — Every GitHub Action referenced by `ci.yml` MUST be pinned to an immutable commit SHA.

### Non-functional

- **NFR1** — No behavior change to the label write path's observable API contract: `PUT`/`DELETE /accounts/:id/label` and `POST /accounts/labels/bulk` keep their existing status codes, bodies, and audit-row-per-account cardinality.
- **NFR2** — The append-only property (C27, migration 0005) MUST remain schema-enforced and MUST remain source-gated by `audit-append-only.test.ts`. Consolidating the audit writers MUST NOT weaken either.
- **NFR3** — Bulk performance MUST NOT regress from set-based to per-row: the consolidated batch helper keeps the single-statement `unnest` form. 100 accounts must remain 1 audit statement, not 100.
- **NFR4** — CI wall-clock MUST NOT regress materially. No contract adds a job or a stack boot.
- **NFR5** — Total test count MUST increase; no existing test may be deleted or weakened to accommodate a contract.

---

## Technical approach

### Where the audit domain lives — the decisive design fact

**Corrected in round 2.** The first draft claimed "two hand-synced copies" plus the DB enum. All three plan reviewers independently re-derived the member-set from code and found **six**. The first draft's count was wrong because its grep was scoped to `apps/api` + `packages` and anchored on the spellings it already knew about — the exact R42 failure this plan lectures about elsewhere. The corrected, code-derived member-set:

| # | Copy | File:line | Form | Does a 4th kind fail loudly here? |
|---|---|---|---|---|
| 1 | API runtime array | `apps/api/src/label-kinds.ts:6` — `LABEL_KINDS` | value | no — it *is* the API's domain |
| 2 | Shared type alias | `packages/api-types/src/index.ts:21` — `AccountLabelKind` | type only | no — nothing compares it to copy 1 |
| 3 | DB enum | `packages/schema/migrations/0003_account_labels.sql:4` | storage | no |
| 4 | Drizzle enum | `packages/schema/src/tables.ts:44-48` — `accountLabelKindEnum` | value | **only against a literal copy of itself** — `packages/schema/test/tables.test.ts:23-29` asserts it equals a hardcoded three-element list, so the gate pins copy 4 to a copy of copy 4, not to the domain |
| 5 | Web display map | `apps/web/src/lib/label-kinds.ts:7-13` — `LABEL_KIND_NAMES` (+ `LABEL_KINDS` derived from its keys) | value | **yes** — it is `Record<AccountLabelKind, string>`, so a missing key is a compile error |
| 6 | Web filter array | `apps/web/src/app/accounts/page.tsx:17-23` — `LABEL_FILTERS` | value | **no** — typed `LabelFilterValue[]`; a *shorter* array is still assignable, so a missing kind is silent |

Copy 6 is the worst of the set and the one that makes the correction load-bearing: it is the identical failure mode `label-kinds.ts:1-5` documents in prose ("a copy missed in `accounts.ts` would make the new kind settable but not filterable, with nothing failing"), reproduced verbatim in `apps/web` where that comment does not reach. `apps/web/src/components/LabelFilter.tsx:7-14` enumerates the kinds a third time but derives each display string from `LABEL_KIND_NAMES`, so it is a presentation list rather than a fourth domain copy — it is in scope for the same edit, not for the same reason.

**FR2 forces copies 1 and 2 to be resolved rather than worked around.** Validating `snapshot.kind` on the read path needs a *runtime* member-set. The read path is `apps/api/src/routes/events.ts`, whose projected type comes from `api-types`. So the validation must check against a runtime array that is provably the same domain as `AccountLabelKind` — otherwise the fix is cosmetic: it would validate against one copy while the type claims the other.

**Decision**: move the domain array into `packages/api-types` and *derive* the type from it, inverting the current direction. Then derive copies 4, 5, and 6 from it as well, and convert copy 4's literal-list gate into a derivation gate. Copy 3 (the DB enum) cannot be derived — it is storage — and is instead pinned by I29.4.

Verified as viable: `packages/api-types/package.json` declares no dependencies, and both `apps/api` (`package.json:17`) and `apps/web` (`package.json:12`) already depend on `@open-smp/api-types` as `workspace:*`. `packages/schema` does **not** (`package.json:11-14` lists only `drizzle-orm` and `pg`) — which is why copy 4's gate is handled by C34 rather than by importing across that boundary. See C34 for why.

`apps/api/src/label-kinds.ts` keeps `LABEL_FILTERS` (the filter-only pseudo-kinds `none`/`any` are an API concern, not a shared-type concern) and re-exports `LABEL_KINDS` from `api-types`, so its three existing importers are untouched.

**Rejected alternative**: adding a runtime array to `apps/api` and leaving `api-types` as-is. Cheaper diff, but it creates a *seventh* copy and leaves the exact drift FR2 exists to close.

### The C8 "type-only" invariant — named, and what actually changes

**Added in round 2** (Security F6, Functionality F5). A prior cycle recorded an invariant this plan silently repeals, and three in-tree comments still assert it:

- `packages/api-types/src/index.ts:1-4` — *"Type-only — no runtime exports — so importing this package never pulls server code into the web bundle (C8 invariant)."*
- `apps/web/src/lib/api-types.ts:1-4` — restates it for the web-side re-export barrel.
- `apps/web/src/app/import/page.tsx:10-11` — hand-duplicates `MAX_UPLOAD_BYTES` **because** *"api-types is type-only (C8), so the value cannot be imported at runtime."* A prior cycle accepted a hand-synced copy — the defect class C29 exists to eliminate — specifically to preserve this.

**What C8 actually protects** is stated in its own words at `apps/web/src/lib/api-types.ts:2-3`: *"no runtime code enters the web bundle, so the C8 'API is the only data path' invariant is untouched."* The property is that the web app talks to the API over HTTP and does not reach into server modules — not that no byte of shared data may cross.

**The tree already settles the bundle question.** `apps/web/src/lib/label-kinds.ts:13` exports a runtime `LABEL_KINDS` array, and it is consumed by two `'use client'` components today — `BulkLabelBar.tsx:6,30,103` and `LabelControl.tsx:6,11,17,104`. A frozen array of three string literals already crosses into the client bundle. C29 changes *where that array is declared*, not whether one exists there. The reviewers' concern that C29 creates a new runtime edge into the client bundle is therefore already false of the status quo — verified, not inferred.

**Decision**: C29 **amends C8** rather than repealing it. The amended wording: `api-types` may export frozen primitive domain constants (string-literal arrays and the type guards over them) but no functions with I/O, no imports from `apps/*`, and no server-only modules. The "API is the only data path" property is preserved because a string array is data, not a path.

**In scope this cycle**: C29 updates the two comments that would otherwise be false the moment it lands — `packages/api-types/src/index.ts:1-4` and `apps/web/src/lib/api-types.ts:1-4`. A tree carrying an invariant its own code contradicts is worse than the duplication being fixed, and correcting a comment in the commit that invalidates it is not deferrable work.

**Deferred to SC40**: an *executable gate* on the amended wording, and the correction to `apps/web/src/app/import/page.tsx:10-11` (whose hand-sync of `MAX_UPLOAD_BYTES` cites C8 as its reason). The gate was drafted twice in review and found defective both times — the second version forbade bare tokens (`process`, `globalThis`) that substring-match plausible field names and prose in a file whose domain is wire shapes. It is a gate best written by writing it.

**Rejected alternative**: keep `api-types` type-only and put `ACCOUNT_LABEL_KINDS` in `apps/api`. What that silently satisfies which the chosen approach must now prove: it keeps C8's literal wording true with no amendment to justify. It is rejected because `apps/web` cannot import from `apps/api`, so copies 5 and 6 would stay ungated — FR2's whole subject — and because it leaves `import/page.tsx:10-11`'s hand-sync permanently unjustifiable.

### Read-path failure mode: fail-closed, not fail-undefined

`events.ts:123-127` currently accepts any string as `kind`. The cycle-2 review recorded the worst case as rendering `undefined` in the audit column — the same visible symptom as the D9 defect. The chosen behavior for an out-of-domain `kind` is to **omit the snapshot field entirely** (leaving `before`/`after` `undefined`), which the existing web consumer already handles: `apps/web/src/app/events/page.tsx:56` returns `'—'` when both are `undefined`. This is the fail-closed direction and requires no web change.

Rejected: substituting a placeholder kind string (would forge a label transition that never happened) and throwing (would make one corrupt row take down the whole events page).

### Concurrency / isolation

**Not applicable — no probe required.** No contract in this cycle introduces or depends on a transaction isolation level, lock, advisory lock, `SELECT … FOR UPDATE`, or any concurrency-control primitive. C28 moves an existing `INSERT` between modules while keeping it on the caller's already-open transaction (`withTenant`'s `tx`), preserving the existing commit-together-or-roll-back-together property. The transaction boundary is unchanged, so the plan-stage real-DB probe obligation does not fire.

### ORM / query-builder boundary

**No ORM.** All SQL in this repo is hand-written against `pg`'s `PoolClient.query`. The type-shape spot-check obligation is discharged by naming the exact parameter binding for each statement in the contracts below. Note the one shape that matters: `unnest($n::text[])` requires the bound parameter to be a JS array of strings — `pg` maps `string[]` to a Postgres `text[]`. C28 preserves the existing binding form rather than changing it.

---

## Contracts

### C28 — `recordLabelAuditBatch`: one audit writer for both label routes

Closes cycle-2 **Functionality F6 [Major]** (`identity-appmgmt-labeling-v2-code-review.md:631`).

**Signatures** (`apps/api/src/audit.ts`):

```ts
// unchanged, retained
export const AUDIT_SOURCE = 'label';
export const LABEL_AUDIT_KINDS = ['label_set', 'label_cleared'] as const;
export type LabelAuditKind = (typeof LABEL_AUDIT_KINDS)[number];
export type LabelAuditSnapshot = { kind: AccountLabelKind; note: string | null };
export type LabelAuditPayload = {
  actorUserId: string;
  saasAccountId: string;
  before: LabelAuditSnapshot | null;
  after: LabelAuditSnapshot | null;
};

// existing, re-expressed as a single-element delegation to the batch writer
export async function recordLabelAudit(
  tx: PoolClient,
  tenantId: string,
  kind: LabelAuditKind,
  payload: LabelAuditPayload,
): Promise<void>;

// new
export async function recordLabelAuditBatch(
  tx: PoolClient,
  tenantId: string,
  kind: LabelAuditKind,
  payloads: readonly LabelAuditPayload[],
): Promise<void>;
```

**Statement emitted by `recordLabelAuditBatch`** — the bulk route's existing form, with `kind` promoted from a SQL literal to a bound parameter:

```sql
INSERT INTO discovery_events (tenant_id, source, kind, payload)
SELECT $1, $2, $3, payload::jsonb
FROM unnest($4::text[]) AS payload
```
bound as `[tenantId, AUDIT_SOURCE, kind, payloads.map((p) => JSON.stringify(p))]`.

`recordLabelAudit(tx, t, k, p)` becomes `recordLabelAuditBatch(tx, t, k, [p])`. **This is the point of the contract**: after it, there is exactly one statement in the tree that writes an audit row, so FR1 is structural rather than maintained by discipline.

**Invariants**

- **I28.1 (app-enforced, structural)** — exactly one `INSERT INTO discovery_events` exists in `apps/api/src`, and it is inside `recordLabelAuditBatch`. Enforced by C28's forbidden-pattern grep + the member-set test in C33.
  *Why not schema-enforced*: Postgres cannot express "only one call site may insert". The nearest schema-enforced neighbour, C27's `REVOKE UPDATE, DELETE`, already exists and is retained (NFR2); it constrains mutation, not insert-site count. Recorded per the plan obligation to justify the weaker form.
- **I28.2 (app-enforced)** — `recordLabelAuditBatch` writes exactly `payloads.length` rows. An empty array writes zero rows and issues **no statement at all** (early return), so a caller that filters down to nothing cannot emit a degenerate `unnest('{}')`.
- **I28.3 (app-enforced)** — both callers pass a payload typed `LabelAuditPayload`. The bulk route's current inline anonymous object (`account-labels-bulk.ts:82-88`), whose `before.kind` is a plain `string` from `tx.query<{...kind: string...}>` at `:61`, MUST be typed, so a drift in the snapshot shape is a compile error rather than a silent JSON difference.
- **I28.4 (schema-enforced, inherited)** — `discovery_events` remains append-only for `opensmp_app` (migration 0005). Unchanged by this contract; asserted by the existing integration coverage, which C28 MUST NOT touch.
- **I28.5 (app-enforced)** — the audit write stays on the caller's transaction (`tx: PoolClient`, never `deps.pool`), so audit and mutation commit or roll back together. Preserved from the existing `audit.ts:29-33` rationale.

**Member-set derivation (R42).** I28.1 is universally quantified ("exactly one insert site"), so the member-set is code-derived, not asserted:

```
$ grep -rn "INSERT INTO discovery_events" apps packages --include='*.ts' | grep -v "/test/"
apps/api/src/audit.ts:41                          <- audit family (label)   [C28: retained, becomes the only one]
apps/api/src/routes/account-labels-bulk.ts:91     <- audit family (label)   [C28: removed, delegates to audit.ts]
apps/worker/src/match.ts:125                      <- sync family (matcher)  [out of scope, different family]
apps/worker/src/sync.ts:150                       <- sync family (app.key)  [out of scope]
apps/worker/src/sync.ts:157                       <- sync family (app.key)  [out of scope]
apps/worker/src/sync.ts:178                       <- sync family (app.key)  [out of scope]
```

Set A (all insert sites) = 6. The class C28 governs is **the audit family**, not all `discovery_events` writers — membership is defined by `source = AUDIT_SOURCE`, derived independently:

```
$ grep -rn "AUDIT_SOURCE" apps packages --include='*.ts'
apps/api/src/audit.ts:9      (definition)
apps/api/src/audit.ts:43     (bind)   -> insert site apps/api/src/audit.ts:41
apps/api/src/routes/account-labels-bulk.ts:8   (import)
apps/api/src/routes/account-labels-bulk.ts:94  (bind) -> insert site :91
```

Audit-family member-set = **{`audit.ts:41`, `account-labels-bulk.ts:91`}**, exactly 2, and the two greps agree. The four worker sites are the sync family (`source` is `'matcher'` or `app.key`) and are correctly excluded — they carry a different payload shape (`counts`/`runId`), are projected by `projectSyncPayload`, and share no columns-plus-semantics with the audit family beyond the table itself.

**Indirect members checked** (the symbol grep alone would miss these):
- Dynamically-constructed table names: none — `grep -rn "discovery_events" apps packages --include='*.ts' | grep -v "/test/"` returns only literal occurrences inside template literals. Recorded because `audit-append-only.test.ts:11-13` already names this as the gate's acknowledged blind spot, backstopped by the DB privilege.
- Aliased wrappers / re-exports of the insert: none — `recordLabelAudit` has exactly 2 call sites, both in `account-labels.ts` (`:72`, `:127`), verified by grep across `apps packages e2e`.
- ORM/query-builder writes: none — no ORM. `packages/schema/src/tables.ts:146-153` is a drizzle *mirror* used for typing, not a write path.
- Worker-side audit writes: none — `AUDIT_SOURCE` is not imported anywhere under `apps/worker`.

**Forbidden patterns**

- `pattern: INSERT INTO discovery_events` **in any file under `apps/api/src` other than `apps/api/src/audit.ts`** — reason: I28.1; a second insert site is exactly the drift F6 was deferred on.
- `pattern: 'label_set'` or `'label_cleared'` **as a SQL string literal inside a query template** — reason: I28.3; the bulk route's hardcoded `'label_set'` at `:92` is what made its `kind` untyped against `LabelAuditKind`.
- `pattern: recordLabelAudit\w*\(\s*deps\.pool` — reason: I28.5; the audit write must never take a pool.

**Acceptance criteria**

1. `apps/api/src/routes/account-labels-bulk.ts` contains no `INSERT INTO discovery_events` and imports `recordLabelAuditBatch` (not `AUDIT_SOURCE`).
2. **This criterion, not criterion 3, discharges FR1.** `POST /accounts/labels/bulk` with N unique account ids writes exactly N `discovery_events` rows with `source='label'`, `kind='label_set'`, one per account, each carrying the correct per-account `before` — asserted at the integration tier against real Postgres. **This test exists today** (cycle 2) and MUST pass unmodified: it is the regression proof that the refactor is behavior-preserving.
3. **Rewritten in round 2 (Testing F4).** The first draft proposed asserting that `recordLabelAudit` and `recordLabelAuditBatch` emit the same SQL text via a fake `PoolClient`. That assertion is tautological under C28's own design: `recordLabelAudit` *becomes* a one-line delegation to `recordLabelAuditBatch`, so the test compares a function to its own delegate and passes by construction. Worse, it stays green in the exact scenario FR1 guards — if a later change un-delegates them, two hand-written statements that happen to match today still match. A test that cannot go red is worse than no test, because it reads as coverage.

   The replacement asserts the property that has content — **structural delegation**: calling `recordLabelAudit` results in exactly one `query` call whose text is the batch statement and whose `$4` binding is a one-element array. This is falsifiable: re-introducing a second, independently written statement in `audit.ts` makes it red.
4. Empty-array call issues zero `query` calls (I28.2), asserted on the same fake. Non-vacuous — it pins an early return that does not exist today.
5. **Added in round 2 (Testing F4).** An integration-tier assertion that the **single-account** path (`PUT` and `DELETE /accounts/:id/label`) still writes a correct audit row after the refactor. The first draft named only the *bulk* integration test as the unmodified regression proof — but bulk is the path whose SQL is unchanged. The single path is the one whose shape actually changes (direct statement → delegation), and it was covered only by the fake. Existing cycle-2 assertions covering these routes must pass unmodified; this criterion is satisfied by naming them explicitly rather than by writing new ones, if they already assert the row contents.
6. `pnpm test:integration` and `pnpm test:unit` green; `audit-append-only.test.ts` green **unmodified** (NFR2).

**Consumer-flow walkthrough** (C28 changes a persisted-shape producer, so this is mandatory):

- **Consumer 1 — events read path** (`apps/api/src/routes/events.ts:109-132`, `projectAuditPayload`) reads `{ actorUserId, saasAccountId, before, after }` and, for `before`/`after`, reads `{ kind, note }`. It uses `kind` to render a transition string and `note` for display. **Satisfied**: C28 changes no payload field — the bulk route's inline object already produced exactly these four keys (`account-labels-bulk.ts:82-88`), and typing it as `LabelAuditPayload` pins that rather than altering it. C29 changes how this consumer *validates* `kind`, not what C28 writes.
- **Consumer 2 — events page** (`apps/web/src/app/events/page.tsx:37,56-57,114-116`) reads `payload.before`/`payload.after` via `labelSnapshot()` and `payload.actorUserId` (`:116`); `saasAccountId` is rendered as text, not a link (`:114-115` comments why — SC25, still deferred). **Satisfied**: no field added or removed by C28.
- **Consumer 3 — integration tests** (`apps/api/test/api.integration.test.ts`, the bulk-audit assertions) read the persisted `payload` jsonb directly and assert per-account `before`/`after`. **Satisfied**: acceptance criterion 2 requires these pass *unmodified*, which is the strongest available statement that the shape did not move.
- **Consumer 4 — `discovery_events` `kind` column** is read back by `projectPayload` (`events.ts:139`) via `AUDIT_KINDS.has(kind)`. C28 promotes `kind` from a SQL literal to a bound parameter; the *values* written stay `'label_set'` / `'label_cleared'`, both already in `LABEL_AUDIT_KINDS` (`audit.ts:14`). **Satisfied**: the set membership that drives audit-vs-sync projection dispatch is unchanged.

  **Expressiveness check on the scalar `kind` parameter** (added round 2, Functionality F4). The walkthrough obligation is to verify that the operations consumers perform are satisfiable from the locked shape — not only that today's two values are in the set. `kind` is bound as `$3` **outside** the `unnest`, so one call writes one `kind` for the whole batch. Checked against the operations the plan's own deferral list schedules against this writer:

  | Operation | Owner | Expressible with a scalar `kind`? |
  |---|---|---|
  | Bulk set (today) | C28 | yes — uniformly `label_set` |
  | Single set / single clear (today) | C28 | yes — one-element batch |
  | **Bulk clear** | **SC27**, deferred | **yes** — uniformly `label_cleared`; one call, one statement, NFR3 intact |
  | A future mixed-kind batch | none scheduled | **no** — would need `kind` moved into the payload and bound via a second `unnest` |

  **Satisfied, deliberately.** The scalar form covers every scheduled caller including SC27, which is the only future audit-emitting operation on the books. A mixed-kind batch is not scheduled by any contract or scope-out entry, and widening the signature now to serve a hypothetical caller would be building for a requirement nobody has. Recorded so that the next cycle picking up SC27 finds this checked rather than re-deriving it — and so that a genuinely mixed-kind requirement, if one ever arrives, is recognised as a signature change rather than absorbed by adding a second writer (which would reopen I28.1).

**Plan-stage probe — runtime value export from `api-types`.** Corrected in round 2 on three counts (Functionality F5, Testing F7):

1. **Consumer count was wrong.** The first draft said "all four consumers (api, web, worker, e2e)". Only **two** packages depend on `@open-smp/api-types`: `apps/api` (`package.json:17`) and `apps/web` (`package.json:12`). `apps/worker/package.json` and `e2e/package.json` do not — verified in both manifests. Two of the first draft's four probe commands targeted packages that cannot be affected.
2. **The typecheck command judged its exit status through a pipe** (`| head`) — R44. A typecheck failure with more than ten lines of output would have read as success, in the one probe that gates whether C28/C29 are implementable at all.
3. **The web check eyeballed logs.** `docker compose up -d` returns once containers *start*, not once Next.js compiles — so a build-time module-resolution failure, the exact failure this probe exists to detect, would not have shown in any exit status.

Corrected probe, with each gate's own status asserted:

```bash
R=/Users/noguchi/ghq/github.com/ngc-shj/open-smp
cd "$R"
pnpm typecheck               > /tmp/p1.log 2>&1; echo "typecheck EXIT=$?"
pnpm test:unit               > /tmp/p2.log 2>&1; echo "unit EXIT=$?"
pnpm --filter web exec next build > /tmp/p3.log 2>&1; echo "web build EXIT=$?"
docker compose up -d --build api web worker > /tmp/p4.log 2>&1; echo "compose EXIT=$?"
# Readiness, then assert the page actually renders — a failed value import 500s.
curl -sS -o /dev/null -w 'events page HTTP=%{http_code}\n' http://localhost:3000/events
```

**Executed during round-2 planning (result recorded, not predicted).** The Functionality reviewer ran the substantive half of this probe against a scratch edit — `ACCOUNT_LABEL_KINDS` + `isAccountLabelKind` added to `api-types`, `apps/web/src/lib/label-kinds.ts` rewired to import the value at runtime — and reported:

```
pnpm typecheck        -> 0 errors
apps/web: next build  -> ✓ Compiled successfully in 4.2s, 9/9 static pages generated
```
Tree restored to clean afterwards (`git status` verified clean before this revision was written).

**Consequence for R-A**: the risk the first draft called blocking does not materialize. Next.js 15 resolves the value export through the workspace symlink with no `transpilePackages` entry (`apps/web/next.config.ts` declares none). R-A is downgraded from blocking to a confirmation step, and C28/C29 no longer wait on it to lock. The probe above still runs at implementation time as the regression check, not as the go/no-go.

---

### C29 — validated domain on the audit read path

Closes cycle-2 **Security F4 [Minor]** (`identity-appmgmt-labeling-v2-code-review.md:646`). Same-cycle-as-F6 was its recorded trigger.

**Signatures**

`packages/api-types/src/index.ts` — the domain becomes a runtime value, and the type derives from it:

```ts
export const ACCOUNT_LABEL_KINDS = ['known_shared', 'service_account', 'external_collaborator'] as const;
export type AccountLabelKind = (typeof ACCOUNT_LABEL_KINDS)[number];
export function isAccountLabelKind(value: unknown): value is AccountLabelKind;
```

`apps/api/src/label-kinds.ts` — re-export, so its three existing importers do not change.

**Corrected in round 2 (Functionality F2).** The first draft wrote this as a bare `export … from` followed by a spread of the re-exported name. That does not compile: `export { X as Y } from '...'` does **not** bind `Y` in the module's local scope, so the spread references an unbound identifier. Verified against the repo's own TypeScript 5.7.3 — `error TS2304: Cannot find name 'LABEL_KINDS'`. The form that compiles needs a separate value import (and it must be a *value* import, not `import type`, because `tsconfig.base.json:14` sets `verbatimModuleSyntax: true`):

```ts
import { ACCOUNT_LABEL_KINDS } from '@open-smp/api-types';

export { ACCOUNT_LABEL_KINDS as LABEL_KINDS } from '@open-smp/api-types';
export const LABEL_FILTERS = [...ACCOUNT_LABEL_KINDS, 'none', 'any'] as const;  // unchanged semantics
```

This mattered beyond the typo: an implementer resolving `TS2304` under time pressure could reasonably re-inline the three literals, silently reintroducing the copy C29 exists to delete — and acceptance criterion 5 (which pins `LABEL_FILTERS`' *value*) would still pass.

**Copies 4, 5 and 6 are out of scope for this cycle — deferred as SC40.** `packages/schema/src/tables.ts:44-48` (the drizzle enum) and the three `apps/web` sites are not touched here. C29 collapses copies 1 and 2 into one derived domain and pins copy 3 (the DB enum) via I29.4; the remaining three keep their current hand-synced status, unchanged from `main`. See the Scope contract for why, and for what that costs.

`apps/api/src/routes/events.ts` — `projectAuditPayload` replaces the unchecked cast at `:125`:

```ts
// before (:123-127)
if (typeof snapshot.kind === 'string') {
  projected[field] = { kind: snapshot.kind as NonNullable<DiscoveryEventPayload['before']>['kind'], ... };
}
// after
if (isAccountLabelKind(snapshot.kind)) {
  projected[field] = { kind: snapshot.kind, note: ... };   // no cast — narrowed by the guard
}
```

**Invariants**

- **I29.1 (app-enforced)** — no value reaches a label-kind-typed response field without either passing `isAccountLabelKind` or arriving from a query row typed `AccountLabelKind` at the `tx.query<>` boundary. The `as` casts are deleted, not merely guarded — so the narrowing is the type system's, not the author's assertion.
- **I29.2 (app-enforced)** — an out-of-domain `kind` causes the field to be **omitted** (`undefined`), never `null` and never a forged kind. `null` already means "no label" (a real `label_cleared` transition), so mapping corruption to `null` would forge a clear-event that never happened.
- **I29.3 (structural, scoped)** — `AccountLabelKind` and the runtime array are the same domain by derivation, not by hand-sync. This closes copies 1 and 2; the DB enum (copy 3) is pinned by I29.4. Copies 4, 5 and 6 remain hand-synced, unchanged from `main` — deferred as SC40. The invariant is deliberately stated over the two copies this cycle collapses rather than over the whole domain, because claiming the latter is what FR6 did before the scope split, and it was not true.
- **I29.4 (app-enforced, new gate)** — a test asserts the runtime array matches the Postgres enum `account_label_kind`'s labels. Integration tier (needs the real DB), queried via `pg_enum`.
  **Home, decided in round 2 (Testing F6)**: `apps/api/test/api.integration.test.ts`. The schema-semantics home would be `packages/schema/test/`, but `packages/schema/package.json:11-14` depends only on `drizzle-orm` and `pg` — placing it there would add a `schema → api-types` dependency, which this cycle's scope statement forbids ("no dependency added"). `api.integration.test.ts` already boots Postgres and already reaches `api-types` transitively, so it costs no container boot and no manifest edit.
- **I29.5 (accepted behavior, not a defect)** — a single corrupt snapshot side renders as `none`, indistinguishable from a genuine "no label". See the corrected walkthrough below.

**Member-set derivation (R42) — corrected in round 2.** All three reviewers independently re-derived this and found the first draft's grep was **bound to three spellings rather than to the property**, reporting 4 members where the property has **7**. The first draft's grep (`as NonNullable<DiscoveryEventPayload|as AccountLabelKind|as LabelAuditSnapshot\['kind'\]`) matched only the spellings already known to it — the R42 anti-pattern, committed inside the contract whose stated purpose is to close an R42 gap.

The class, stated as a property rather than as a regex: **any expression that produces a label-kind-typed value by assertion from a `string`-typed query row.** Re-derived:

```
apps/api/src/routes/events.ts:125           as NonNullable<DiscoveryEventPayload['before']>['kind']    [read path]
apps/api/src/routes/account-labels.ts:76    as LabelAuditSnapshot['kind']                              [write path]
apps/api/src/routes/account-labels.ts:78    as LabelAuditSnapshot['kind']                              [write path]
apps/api/src/routes/account-labels.ts:130   as LabelAuditSnapshot['kind']                              [write path]
apps/api/src/routes/account-labels.ts:90    as AccountLabelResponse['kind']                            [MISSED in draft 1]
apps/api/src/routes/accounts.ts:77          as NonNullable<AccountListItem['label']>['kind']           [MISSED in draft 1]
apps/api/src/routes/identities.ts:55        as NonNullable<IdentityAccountItem['label']>['kind']       [MISSED in draft 1]
```

**Why the three missed members matter more than the count suggests** (Security F1). `accounts.ts` and `identities.ts` are the product's two primary label-read surfaces — the accounts list and the identity detail page. Their output feeds `LABEL_KIND_NAMES[kind]` in `apps/web`, an unchecked index that yields `undefined` in the rendered cell for an out-of-domain value. That is the **identical D9 symptom** C29 exists to eliminate on the events page. Closing it on the events page alone would have fixed the reported instance while leaving the property broken on the two higher-traffic surfaces — cycle-2 lesson 2, reproduced.

The provenance of the six non-read-path casts differs from the read path's: they read `account_labels.kind`, a **Postgres enum column** (`0003_account_labels.sql:10`), so the DB guarantees the domain. The casts are sound today; I29.4 is what keeps them sound.

**Decision**: type the query row as `AccountLabelKind` at the `tx.query<>` boundary rather than casting at each use. Same soundness argument, stated once where it is true instead of six times where it is invisible. No runtime check added where the DB already enforces one.

**The site list, corrected in round 3 (Testing T11) and derived by executing criterion 6's own grep rather than by recall:**

```
$ grep -rnE "(kind|label_kind)\??: string" apps/api/src --include='*.ts'
apps/api/src/routes/account-labels.ts:51        <- retype
apps/api/src/routes/account-labels.ts:59        <- retype
apps/api/src/routes/account-labels.ts:118       <- retype   [MISSED by the round-2 list]
apps/api/src/routes/account-labels-bulk.ts:61   <- retype   (also feeds I28.3)
apps/api/src/routes/accounts.ts:45              <- retype
apps/api/src/routes/identities.ts:35            <- retype
apps/api/src/routes/events.ts:67                <- named exclusion (event kind)
apps/api/src/routes/events.ts:134               <- named exclusion (event kind)
```

Eight matches, two excluded, **six to retype** — which now cross-checks against "six casts deleted". The round-2 list named five sites while claiming six casts, and the missing one is `account-labels.ts:118`: the `DELETE … RETURNING kind, note` row that feeds the `label_cleared` audit at `:130`. The plan's own member-set table already listed the `:130` cast as a member, so the cast was tracked while the row typing that eliminates it was not.

Left uncorrected this would have been self-defeating: an implementer following the list retypes five sites, criterion 6's grep then returns a match at `:118`, criterion 7's typecheck still passes (the `:130` cast is untouched), and the cheapest way out is adding `:118` to the exclusion list — which breaks the exactly-two count assertion T4 introduced, or silently loosens it to three.

**Forbidden patterns — corrected in round 2 (Security F1).** The first draft's third pattern was scoped by filename glob to `routes/account-labels*.ts`, which is precisely how `accounts.ts:45` and `identities.ts:35` — both declaring `label_kind: string | null` in exactly the guarded position — would have sailed past a gate written to catch them.

- `pattern: as (NonNullable<)?\w+(\[['"][\w]+['"]\])*(>)?\[['"]kind['"]\]` across `apps/api/src/**` — reason: I29.1, stated over the property (an assertion producing a `kind` field) rather than over the three spellings the draft happened to know. Covers `DiscoveryEventPayload`, `AccountListItem`, `IdentityAccountItem`, `AccountLabelResponse`, `LabelAuditSnapshot`, and any type added later.
- `pattern: as AccountLabelKind` across `apps/api/src/**` — reason: the bare-alias spelling of the same class.
- **SC30 trigger gate** — reason: I29.5's third control. C29's fail-closed argument rests on `saas_apps.key` being `z.literal('google-workspace')`, and SC38's deferral trigger reads "immediately if SC30 is lifted" — but nothing made *lifting* observable. Controls 1 and 2 of I29.5 are gated by this cycle's own tests (I33.1, C28); control 3 was a single line in one route file with no gate at all.

  **Bound to the value, not to the form (corrected round 3, Security F-S5).** The round-3 draft proposed `key:\s*z\.(?!literal)` scoped to `saas-apps.ts`. Executed, it fires correctly for a form change (`z.literal` → `z.enum`/`z.string`) and misses two lifts that reach the same end state:
  - **Changing the literal's value** — `z.literal('label')` is a one-token edit that defeats control 3 entirely and passes a form gate cleanly.
  - **Moving the schema** — extracting `saasAppBodySchema` to a shared module carries it out of a file-scoped pattern silently.

  A third surface the form gate never covered: **`saas_apps.key` has two authors, not one.** `saas-apps.ts:46` is zod-gated; `apps/api/src/seed.ts:185` inserts `SAAS_APP_KEY` directly with no schema. It is constant today, but I29.5's control-3 statement is about the *column*, and the column has a second writer.

  **The gate as corrected**: assert over `apps/api/src/**` that every zod `key:` field declaration is exactly `z.literal('google-workspace')`, that the count of such declarations is exactly 1 (so a file move or a second schema fails the count rather than escaping a glob), and that `seed.ts`'s seeded key equals the same value. That converts a form gate into a domain gate and closes the value-change hole. The count assertion is the anti-vacuity device, same as C29's exclusion count and C32's `uses:` count.
- `pattern: (kind|label_kind)\??: string` **within a `tx.query<...>` type argument anywhere under `apps/api/src/**`**, with the named exclusions below — reason: the untyped row is what makes the casts necessary; scoping this by filename is what let three members escape the first draft.

  **Named exclusions, added round 3 (Testing T4).** The round-2 pattern was bound to the *word* `kind` rather than to the property, and the plan had already warned — in C29's own Consumer 2 walkthrough — that the *event* kind and the *label* kind "are one word apart and conflating them would misdirect the fix." The pattern then conflated them. Executed against the tree, it matches two rows that are correctly typed `string` and must not change:

  | Site | Field | Verdict |
  |---|---|---|
  | `apps/api/src/routes/events.ts:67` | `EventRow.kind` | **excluded** — this is the *event* kind (`label_set`, `sync_completed`, `match_completed`, …), an open domain across two families. It drives `AUDIT_KINDS.has(kind)` dispatch at `:139`; narrowing it to the label-kind union would be actively wrong. |
  | `apps/api/src/routes/events.ts:134` | `projectPayload(kind: string, …)` | **excluded** — same event kind, same reason. |

  The exclusion list is asserted **by count** (exactly two, at those two sites), so a newly added event-kind row does not silently join the exemption — it fails the count and forces a deliberate decision. Without the count assertion the exclusion would become the hole.

  **Why this matters beyond the two lines.** Criterion 6 requires the grep to return nothing. An implementer facing two unfixable matches would either narrow the pattern back to a filename glob — re-creating the exact Security-F1 defect round 2 closed — or retype `EventRow.kind` to a label-kind union, which breaks the audit-vs-sync projection dispatch. A gate that cannot be satisfied honestly gets satisfied dishonestly.

**Acceptance criteria**

1. `events.ts` contains no `as` cast on `snapshot.kind`; `isAccountLabelKind` is the only path to the field.
2. **Unit test, RT7-provable**: `projectAuditPayload` given a payload with `kind: 'not_a_kind'` omits the field; given each of the three real kinds, preserves it. Red-proof obligation: the malformed case MUST fail against the pre-C29 code (which passes the string through) — record the executed red proof, do not assert it.
3. **Unit test, regression pins — explicitly NOT red-provable (corrected round 3, Testing T3).** `kind: null`, `kind: 42`, `kind: {}`, and a missing `kind` each omit the field. These four are **green before C29 as well as after**: the pre-C29 guard at `events.ts:123` is `typeof snapshot.kind === 'string'`, which already rejects all four. They pin behavior against future regression; they cannot falsify anything C29 changes, and the plan must not count them as coverage of I29.2. Labelled as such in the test file, per the plan's own standard that a test which cannot go red is worse than one that reads as coverage.
3a. **Unit test, red-provable — this is the criterion that carries I29.2.** `kind: null` and a valid kind must produce *different* outcomes: `null` yields `before: null` (a genuine "no label", i.e. a real `label_cleared` transition), while an out-of-domain string yields an **omitted** field. Red proof: mutate the reject branch to emit `null` instead of omitting → this assertion fails while criterion 3's four cases stay green, which is exactly why 3a exists separately. Record the executed output.
4. **Integration test (I29.4)**, in `apps/api/test/api.integration.test.ts`: `SELECT enumlabel FROM pg_enum JOIN pg_type ON … WHERE typname = 'account_label_kind' ORDER BY enumsortorder` deep-equals `ACCOUNT_LABEL_KINDS` **in order** (corrected round 3, Functionality F4).

   The round-2 draft compared as an unordered *set*. Order is genuinely load-bearing: Postgres enum declaration order *is* its sort order, so it drives `ORDER BY` on the column. A future `ALTER TYPE … ADD VALUE 'x' BEFORE 'service_account'` would leave the set equal while the DB's sort order silently diverged from the domain — the drift class this cycle exists to close, invisible to a set comparison. (The finding surfaced as an inconsistency with the withdrawn drizzle-enum contract, which asserted order and cited this criterion as its justification; the correction stands on its own merits and is retained now that the other contract is deferred.)

   Verified during planning to run under the `opensmp_app` role the integration suite connects as — `pg_enum`/`pg_type` are world-readable catalogs, so no grant is needed (R16 checked).
5. **Unit test**: `LABEL_FILTERS` still equals the three kinds plus `none`/`any` after the re-export change — the pseudo-kinds must not leak into `ACCOUNT_LABEL_KINDS`.
6. **Added in round 2**: `accounts.ts`, `identities.ts`, and `account-labels.ts` contain no label-kind `as` cast; their query rows are typed `AccountLabelKind`. The forbidden-pattern greps above return nothing across `apps/api/src/**`, and each grep is asserted to have scanned a non-zero number of files (the anti-vacuity obligation — an empty grep over zero files is evidence about the grep).
7. `pnpm typecheck` 0 across all packages; existing label/accounts/events/identities tests pass unmodified.

**Consumer-flow walkthrough** (C29 changes an API response shape's *domain*, so mandatory):

- **Consumer 1 — events page** (`apps/web/src/app/events/page.tsx:37,56-57`): `labelSnapshot(snapshot)` reads `{ kind, note }`; `auditTransition` (`:56`) returns `'—'` when **both** `before` and `after` are `undefined`. **Walkthrough of the new case**: a corrupt row yields `before === undefined` while `after` may be present. `:57` runs `labelSnapshot(payload.before ?? null)`, so the corrupt side renders via `labelSnapshot`'s falsy branch — `'none'`, the "no label" rendering. `'—'` appears only when the *whole* payload is corrupt.

  **I29.5 — the ambiguity, accepted with a corrected premise.** An omitted-because-corrupt field renders identically to a genuine "no label". The first draft justified accepting this by asserting the corrupt case is *"unreachable without direct DB write access (C27 + RLS)"*. **That premise is wrong, and the security reviewer was right to reject it.** Migration `0005_discovery_events_append_only.sql:14` is `REVOKE UPDATE, DELETE ON discovery_events FROM opensmp_app` — **INSERT is not revoked**, and cannot be, because the application must write audit rows. C27 constrains *rewriting* the trail, not *authoring* it. Conflating the two overstated a schema guarantee that does not exist.

  The honest statement of what constrains audit-row authorship, all of it app-enforced and all of it this cycle's own subject matter:
  1. **I28.1 / I33.1** — exactly one insert site exists in `apps/api/src`, inside `recordLabelAuditBatch`, and it constructs the payload server-side from a zod-validated `kind`.
  2. **`AUDIT_SOURCE`** — that one site binds `source = 'label'`, which is what `?source=label` selects and what distinguishes the audit family from the sync family.
  3. **SC30** — `saas_apps.key` is `z.literal('google-workspace')` (`saas-apps.ts:11`), so no operator can register an app whose sync events would carry `source = 'label'`.

  Point 3 is load-bearing and was previously recorded only as an inherited one-line note. It is now a **stated dependency of C29**: the worker writes attacker-influenced content into `discovery_events` payloads (`sync.ts:178` inserts a connector-supplied error string; `sync.ts:157` inserts entire provider payloads when `DISCOVERY_STORE_RAW` is set), and those rows differ from audit rows *only* by `source` and `kind`. The boundary holds today solely because `key` is pinned to a literal. Whoever lifts SC30 must re-read this paragraph.

  **With the honest premise, is omission still the right failure mode?** Yes. The alternatives are worse: a distinct "corrupt" rendering exposes storage-integrity detail to operators who cannot act on it; a placeholder kind forges a transition that never happened; throwing lets one bad row take down the whole events page. But the reasoning now rests on app-enforced controls this cycle strengthens, rather than on a schema property that does not exist.

- **Consumer 2 — `DiscoveryEventListItem.kind`** (`api-types:96`, plain `string`, set from `row.kind` at `events.ts:146`): unchanged. This is the *event* kind (`label_set`), a different field from the *label* kind inside the snapshot. Named explicitly because the two are one word apart and conflating them would misdirect the fix.
- **Consumer 3 — `apps/api/src/routes/accounts.ts:19`** reads `LABEL_FILTERS` for the accounts filter. **Satisfied** by acceptance criterion 5: the re-export preserves the value; the filter's domain is unchanged.
- **Consumer 4 — `apps/web`** imports `AccountLabelKind` as a **type only**, via the `@/lib/api-types` barrel. **Satisfied**: derivation preserves the type's identity (the same three string literals), so no `apps/web` module changes in this cycle. The runtime-value probe recorded under C28 still runs, because `api-types` now *carries* a value even though `apps/web` does not yet import one — and a value export changing how the package resolves in the Next.js build is exactly what that probe checks.

---

### C31 — the unclassified-4xx fallback is exercised

Closes cycle-2 **F-R3-2 [Minor]** (`identity-appmgmt-labeling-v2-code-review.md:237`). Trigger: "when a route legitimately throws an unclassified 4xx, or when the handler's mapping is re-edited."

**No signature change.** `apps/api/src/app.ts:94-134` is unmodified by this contract. The deferral's trigger fires because C31 *is* the re-examination of the mapping, and the honest reading is that the fallback has never been executed by any test — verified: the token `client_error` appears in exactly one place in the tree, `app.ts:129`.

**Invariants**

- **I31.1 (app-enforced)** — a thrown error carrying a 4xx `statusCode` absent from `CLIENT_ERRORS` (`app.ts:117-124`) yields `{ error: 'client_error' }` at that status, **not** `bad_request`. The distinction is the whole point of the cycle-2 comment at `:125-128`: mislabelling is what made the 429 regression invisible.
- **I31.2 (app-enforced)** — the response body carries **no** `message` field and no `FST_ERR*` token, for the fallback path as for the tabled ones. The tabled paths have this covered (`api.integration.test.ts:151-163`); the fallback does not.
- **I31.3 (test-design constraint, VE6)** — the test MUST NOT perform a login. The E2E login budget is 5/5 at 5/min/IP with zero headroom, and adding login traffic to any suite is the recorded trap. The corrected design below requires no session at all.
- **I31.4 (test-isolation constraint) — added in round 2, closes the Critical finding.** The test's throwing route MUST NOT be visible to `buildApp`'s `apiRoutes` registry, and MUST NOT perturb any existing route sweep.

  **What the first draft got wrong.** It said "a route registered only in the test harness" and left the registration site unspecified, gesturing vaguely at "outside the authenticated scope". `buildApp` (`apps/api/src/app.ts:26-36`) collects **every** route whose url starts with `/api/` into `apiRoutes` via an `onRoute` hook. Four existing tests read that registry:

  | Test | `api.integration.test.ts` | What it asserts | Affected by the corrected design? |
  |---|---|---|---|
  | route membership | `:1501` | `apiRoutes` deep-equals a **hardcoded 21-element list** — an exact count, deliberately, per its own comment at `:1495-1500` | no |
  | rate-limit coverage | `:1526` | every registered route has `hasRateLimit === true` | no |
  | 401 sweep | `:168` | every non-login route answers 401 unauthenticated | no |
  | Origin 403 sweeps | `:187`, `:198` | every non-GET route answers 403 on Origin mismatch | no |
  | rotation-route cross-check | `:688` | no route url matches `/rotat/` (C6/S13 acceptance, CT11) | no |

  **The `:688` row was added in round 3 (Testing T5).** The round-2 table listed four consumers and read as exhaustive; the code-derived set is **five**. `grep -n "app.apiRoutes" apps/api/test/api.integration.test.ts` returns `:168`, `:187`, `:198`, `:688`, `:1501`, `:1526` (plus `:778`, a comment). Under the corrected separate-instance design none of the five is affected — which is precisely why the omission is worth recording rather than shrugging off: the round-1 Critical was *found* by enumerating this exact set, and the round-2 fix then re-derived it and got 5 of 6. A member-set presented as complete and silently missing a member is the R42 failure, independent of whether the missed member happens to be harmless this time.

  A test-only route under `/api/` fails **all four** — and the first draft asserted "`app.ts` is unmodified by this contract" while never checking the *test* blast radius. That would have violated NFR5 and C28 acceptance criterion 5, and it is cycle-2 failure mode 4 (a fix introducing defects) reproduced in the plan stage. Note the draft also conflated two different registrations: the **auth** scope and the **`/api` prefix** scope are not the same thing, and only the prefix drives `apiRoutes`.

  **The corrected design** (Testing F1's recommendation, adopted): build a **separate Fastify instance local to the C31 describe block**, register the throwing routes on it under a non-`/api` path, and attach the same error handler. A separate instance cannot perturb the shared `app` at all, so the four sweeps are untouched by construction rather than by careful path selection.

- **I31.5 (tier decision) — added in round 2.** The reviewer additionally proposed moving C31 to the **unit** tier, on the correct observation that the handler (`app.ts:94-134`) touches neither Postgres nor Redis and is a pure function of the thrown error and `reply.statusCode`. Paying a Testcontainers boot for it is what created the collision in the first place.

  **Checked before adopting, and adopted only partly.** The handler is an **inline closure inside `buildApp`** (`app.ts:94`), not an exported symbol — `apps/api/src/app.ts` exports only `RegisteredRoute` and `buildApp`. Running it at the unit tier without a container therefore requires one of:

  | Option | What it costs | Verdict |
  |---|---|---|
  | Extract the closure to an exported `registerErrorHandler(app)` and import it in a unit test | A production refactor of a security-relevant path, made to serve a test | **Rejected** — C31's whole premise is that `app.ts` is *unmodified* by this contract (the finding it closes is a missing test, not a defect). Changing production code to make a test cheaper inverts that, and R-B names fix-induced defects as this cycle's top risk. |
  | Duplicate the handler's logic in the test | An RT9 twin: the test would exercise a copy and pass while production drifts | **Rejected** outright — this is the exact defect class the cycle is closing. |
  | Keep the integration tier; build a **separate app instance** in the describe block | One extra `buildApp` call inside a suite that already booted its containers; ~zero marginal cost | **Adopted** |

  The third option gets the isolation benefit the reviewer was actually after (no shared-`app` perturbation) without the production edit. The tier stays `integration` for a stated reason rather than by default: the test calls the real `buildApp`, so the call path includes the production primitive (RT5) rather than a re-implementation of it.

**Member-set derivation (R42).** I31.1/I31.2 quantify over "every branch of the error handler". Derived from `app.ts:94-134`:

| Branch | Status | Body | Covered today? |
|---|---|---|---|
| `UnauthorizedError` (`:95`) | 401 | `unauthorized` | status only (`:166-183`), **body not asserted** |
| table 400 (`:118`) | 400 | `bad_request` | `:151-163` asserts no `FST_ERR`, not the body value |
| table 403 (`:119`) | 403 | `forbidden` | status only (`:185-230`); those are the origin gate's own `403 origin_mismatch` at `app.ts:64`, a **different** path |
| table 404 (`:120`) | 404 | `not_found` | the `:148` deep-equal is `setNotFoundHandler` (`app.ts:140`), **not** this branch |
| table 413 (`:121`) | 413 | `payload_too_large` | **no** |
| table 415 (`:122`) | 415 | `unsupported_media_type` | **no** |
| table 429 (`:123`) | 429 | `too_many_requests` | **yes** (`:232-253`) |
| **fallback** (`:129`) | any other <500 | `client_error` | **no** ← the deferred finding |
| `>= 500` (`:132-133`) | 500 | `internal_error` | **no** |

**Scope decision**: C31 covers the **fallback** (the deferred finding) and the `>= 500` branch (adjacent, same handler, and currently invisible — a 500 that leaked `message` would be a data-exposure regression nothing catches). The tabled 413/415 branches are recorded as **SC32**: they require constructing requests that trip Fastify's body-limit and content-type paths, which is a different test-construction problem, and their bodies are static strings from the same table the 429 test already proves is read correctly.

**A note the contract must carry**: `app.ts:116` guards on `status < 500`, not `status >= 400 && status < 500`. A sub-400 status reaching the handler would be answered from `CLIENT_ERRORS` and fall through to `client_error`. This is currently unreachable (`declared` defaults to 500 when `statusCode` is absent, and `reply.statusCode >= 400` is required for the other branch), so it is **not** a defect today. It is recorded here because C31's test is the first thing that will ever exercise the fallback, and a test that pins `client_error` for a sub-400 status would be pinning behavior nobody intends. The test MUST use a 4xx.

**Forbidden patterns**

- `pattern: expect\(res\.statusCode\)\.toBe\(4\d\d\)` **as the sole assertion in the new tests** — reason: RT8; the status was already correct before this contract, so a status-only assertion cannot falsify anything.
- `pattern: 'bad_request'` in the fallback test's expectation — reason: I31.1; asserting the wrong label would lock in the regression the comment warns about.

**Acceptance criteria**

1. The throwing routes are registered on a **separate `buildApp` instance** local to the C31 describe block, under a **non-`/api` path** (`/test-throw/*`). Both conditions are required, and for different reasons: the separate instance keeps the shared `app` object untouched, and the non-`/api` path keeps the routes out of `apiRoutes` even on that separate instance — `buildApp`'s `onRoute` hook fires per instance, so a `/api/`-prefixed test route would still be collected there and would still have to satisfy the `hasRateLimit` assertion if that instance were ever swept.
2. A route throwing an error with `statusCode = 409` (a real, unclassified 4xx) yields exactly `{ error: 'client_error' }` at 409. **Deep equality**, so an added `message` fails it (I31.2).
3. A route throwing a plain `Error` (no `statusCode`) yields exactly `{ error: 'internal_error' }` at 500, with no `message` and no `FST_ERR` token.
4. **All five existing `apiRoutes` consumers pass unmodified** — explicitly: the deep-equal at `api.integration.test.ts:1501` still asserts its 21-element list with no additions, and `:1526`, `:168`, `:187`, `:198`, `:688` are untouched. Five, not four (corrected round 3). This is a named acceptance criterion rather than an assumption, because the round-1 version of C31 would have broken every one of them (I31.4).
5. **RT7 red proof, executed and recorded**: change `?? 'client_error'` to `?? 'bad_request'` at `app.ts:129` → criterion 2 fails. Restore → passes. Record the executed output; the fallback has never run in its life, so "it should fail" is not an acceptable substitute for showing that it does.
6. No login is performed by these tests (I31.3), verified by inspecting the test for any call to the login route.
7. `pnpm test:integration` green.

---

### C32 — CI actions pinned by commit SHA

New work (not a deferral). Sourced from `../passwd-sso`, which pins every action by SHA with the version in a trailing comment.

**Signature** — `.github/workflows/ci.yml`, ten `uses:` lines across three jobs, each rewritten as `owner/repo@<40-hex-sha> # vN`.

**Resolved SHAs**, verified against the GitHub API on 2026-07-26 (probe below):

| Action | Tag | Pinned SHA |
|---|---|---|
| `actions/checkout` | v5 | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` |
| `pnpm/action-setup` | v4 | `b906affcce14559ad1aafd4ab0e942779e9f58b1` |
| `actions/setup-node` | v4 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/upload-artifact` | v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

**Invariants**

- **I32.1 (app-enforced)** — no `uses:` line in `.github/workflows/` references a mutable ref (tag or branch). All ten are 40-hex SHAs.
- **I32.2 (correctness)** — every pinned SHA is a **commit**, not an annotated tag object. `pnpm/action-setup@v4` resolves to a *tag object* (`f40ffcd9…`), which must be dereferenced to its commit (`b906affc…`); pinning the tag-object SHA would fail at runtime. This is the trap this invariant exists to name.
- **I32.3 (behavior preservation)** — each pinned SHA is the commit the mutable tag pointed at when resolved, so CI behavior is unchanged at pin time. Verified green by an observed CI run, not by inspection.

**Member-set derivation (R42).** I32.1 quantifies over "every action reference in the repo":

```
$ find .github -type f          ->  .github/workflows/ci.yml   (exactly one file)
$ grep -n "uses:" .github/workflows/ci.yml
16:  - uses: actions/checkout@v5          31:  - uses: actions/checkout@v5
17:  - uses: pnpm/action-setup@v4         32:  - uses: pnpm/action-setup@v4
18:  - uses: actions/setup-node@v4        33:  - uses: actions/setup-node@v4
53:  - uses: actions/checkout@v5          55:  - uses: pnpm/action-setup@v4
56:  - uses: actions/setup-node@v4       154:    uses: actions/upload-artifact@v4
```
Ten references, four distinct actions, one workflow file. **Indirect members checked**: no composite actions (`action.yml` / `action.yaml`) anywhere in the repo; no reusable-workflow `uses:` (no `workflow_call`); no `docker://` references. R33 (config change applied to one file but not its duplicates) does not fire — there is exactly one workflow file, confirmed by `find`.

- **I32.4 (app-enforced, new gate) — added in round 2 (Testing F5).** The pin shape is enforced by an executed test, not by a one-time edit. Whether a pinned SHA *resolves* needs CI; whether every `uses:` line *is* SHA-pinned is a static property of a text file — exactly the shape of the source-level gates this repo already runs at the unit tier (`audit-append-only.test.ts`, `no-rotation-route.test.ts`, C33). Without it the control decays on the first `uses:` line a later cycle adds: nothing fails, and CI stays green, because a tag-pinned action works perfectly well. A supply-chain control that silently reverts is the failure mode C32 exists to prevent.

**Gate shape — allowlist, not denylist (corrected in round 2, Security F4).** The first draft declared two forbidden patterns:

```
uses:\s*[\w-]+/[\w-]+@v\d
uses:\s*[\w-]+/[\w-]+@(main|master)
```

Both match what is in `ci.yml` today, so both would have passed review. As a *forward* gate on I32.1 they miss: branches other than `main`/`master` (`@develop`, `@next`); **short SHAs** (`@fbc6f39` — mutable, resolved at run time); non-`v`-prefixed tags (`@4.0.0`, `@latest`); **sub-path actions** (`owner/repo/path@v4` — the `[\w-]+/[\w-]+` shape stops at the second segment and simply does not match a third); and `docker://` refs. A denylist enumerating the bad forms is the wrong shape for an invariant quantified over every future edit.

**Inverted to an allowlist**: every `uses:` line MUST match

```
^[ \t]*(-[ \t]+)?uses:[ \t]*[\w.-]+/[\w.-]+(/[\w.-]+)*@[0-9a-f]{40}[ \t]+#[ \t]*v[\w.-]+[ \t]*$
```

which admits exactly "owner/repo[/sub/path]@\<40-hex\> # v\<version\>" and rejects every mutable-ref form, including `docker://`, by construction rather than by enumeration.

**The version comment is mandatory, not optional (round 3, Security F-S2).** The round-2 regex ended `(\s+#.*)?$`, making the trailing `# vN` optional — so acceptance criterion 1 required it while the gate did not, and the human-readable half of the control could decay with nothing failing.

**But `# v\d+$` was too strict, and would have broken the update path C32 adopts to pay its own cost (round 3, Security F-S6).** Dependabot's `github-actions` ecosystem writes the *resolved tag* into the trailing comment when it bumps a pin. When an action ships a patch release it writes `# v5.0.1`, not `# v5` — and `# v\d+$` requires the version to be exactly `v` plus digits with nothing after. Every Dependabot PR would have landed a workflow file the unit gate immediately failed on. The plan's own rationale is that pinning without an update path is half a control; a gate that reds on every bump makes the predictable resolution the one this plan warns about elsewhere — relax the regex back to `(\s+#.*)?$` and lose the mandate entirely.

The comment group is therefore `#[ \t]*v[\w.-]+`: still mandatory, still rejects `# pinned` and the no-comment form, and now accepts the dotted and pre-release tags a real bump produces. Whitespace is `[ \t]` rather than `\s` so a tab separator is deliberate rather than incidental, and so the class cannot match a newline.

**Known and accepted: shape is not existence.** The gate accepts `actions/checkout@0000000000000000000000000000000000000000 # v5` — forty hex digits that resolve to nothing. This is deliberate and fail-loud rather than fail-open: only CI can tell whether a SHA exists, and criterion 4 delegates exactly that. Recorded so the division of labour between criteria 2 and 4 is explicit.

**Plan-stage probe — the allowlist regex, executed 2026-07-26.** Run twice: 15 cases against the first round-3 form, then **19 cases against the final form** after F-S6 showed the first was Dependabot-hostile. All 19 as expected:

```
accept                                          |  reject
  …@<sha> # v5                                  |    @v5, @main, @develop, @4.0.0
  …@<sha> # v5.0.1        (Dependabot bump)     |    @fbc6f39            (short SHA)
  …@<sha> # v5.0.1-beta.2 (pre-release tag)     |    docker://alpine:3.19
  owner/repo/sub/path@<sha> # v4                |    ./.github/actions/local
  …@<sha>\t# v5           (tab separator)       |    UPPERCASE hex, 39-hex
  …@<sha> #v5             (no space after #)    |    …@<sha>              (no comment)
  …@0000…0000 # v5        (shape-only)          |    …@<sha> # pinned     (non-version comment)
                                                |    …@<sha> # v5 (rotated)  (annotated)
```

The `# v5.0.1` and `# v5.0.1-beta.2` rows are the F-S6 correction — the first round-3 form **rejected both**, which would have failed the gate on every Dependabot PR. Recording the two probe runs rather than only the final one, because the intermediate form looked correct and was verified only against inputs that could not expose the defect.

**Anti-vacuity (Security F4).** The gate must also assert the number of `uses:` lines it found is **non-zero**. A glob that stops matching, a workflow file moved, or a regex that quietly matches nothing would otherwise produce a passing state indistinguishable from a working one.

**Corrected round 3 (Security F-S2)**: the round-2 prose said the count must "match the count actually present", which is circular when both numbers come from the same extraction — and an exact literal (`=== 10`) would be the RT3 magic-constant defect C30 was corrected for. Non-zero is the assertion that actually works, and it is what acceptance criterion 2 says.

**Acceptance criteria**

1. All ten `uses:` lines carry 40-hex SHAs with a `# vN` trailing comment naming the version, so a human reader can still see what is pinned.
2. **Executed unit test (I32.4)**: reads `.github/workflows/*.yml`, extracts every `uses:` line, asserts each matches the allowlist regex above, **and** asserts the extracted count is non-zero. Runs in `pnpm test:unit`.
3. **RT7 red proof, executed and recorded**: temporarily rewrite one `uses:` line back to `@v5` → the test fails naming that line; restore → passes. A gate whose status is never observed is a gate that cannot fail.
4. **Observed-green CI required** (VE5): the pinned workflow is proven by a real CI run on the branch, and the run id is recorded. Parity-by-construction is explicitly not acceptable here — a workflow file cannot be executed locally, and this is precisely the class of defect (a CI-path-only failure) that VE5's resolution exposed. Criterion 2 proves the *shape*; only this proves the SHAs *resolve*.

**The cost this control creates, and who owns it (Security F5).** Pinning does not remove risk; it changes which risk. What the unpinned status quo silently satisfied that pinning does not: **automatic receipt of upstream security fixes**. `actions/checkout` has shipped credential-persistence fixes historically; after C32 the repo stops receiving them until a human edits a SHA. The first draft stated only the upside (scenario 5) and left the cost unnamed and unowned — there is no `dependabot.yml` and no `renovate.json` in the tree (verified: `.github/` contains only `workflows/`).

**Resolved in scope**: C32 adds `.github/dependabot.yml` with `package-ecosystem: github-actions`. Dependabot understands SHA pins and raises PRs that bump the SHA while preserving the `# vN` comment — it is the standard pairing for this control, roughly six lines, adds no CI job, and leaves NFR4 intact. Pinning without an update path is half a control; adopting the half that is convenient and deferring the half that is work is how a security posture degrades quietly.

**Plan-stage probe — SHA resolution.** Executed 2026-07-26:

```
$ gh api repos/actions/checkout/git/ref/tags/v5 --jq '.object.sha + " " + .object.type'
fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 commit
$ gh api repos/pnpm/action-setup/git/ref/tags/v4 --jq '.object.sha + " " + .object.type'
f40ffcd9367d9f12939873eb1018b921a783ffaa tag          <- annotated tag, NOT a commit
$ gh api repos/pnpm/action-setup/git/tags/f40ffcd9... --jq '.object.sha + " " + .object.type'
b906affcce14559ad1aafd4ab0e942779e9f58b1 commit       <- dereferenced (I32.2)
$ gh api repos/actions/setup-node/git/ref/tags/v4   -> 49933ea5288caeca8642d1e84afbd3f7d6820020 commit
$ gh api repos/actions/upload-artifact/git/ref/tags/v4 -> ea165f8d65b6e75b540449e92b4886f43607fa02 commit
# each verified to exist as a commit:
$ gh api repos/<owner>/<repo>/commits/<sha> --jq '.sha'   -> echoes the same sha for all four
```

---

### C33 — the audit-writer member-set is an executed gate

Cross-cutting. C28's I28.1 ("exactly one insert site") is a class invariant, and cycle-2's most-repeated defect was a guard bound to spelling rather than to the property (nine occurrences across plan and review). This contract makes I28.1 falsifiable.

**Signature** — extend `apps/api/test/audit-append-only.test.ts` (the established idiom for source-level gates here) or add a sibling; the existing file's `collectSourceFiles` + `normalizeSource` helpers are reused rather than re-implemented (R1).

**Invariants**

- **I33.1 (app-enforced)** — the count of `INSERT INTO discovery_events` occurrences under `apps/api/src` is exactly 1, and its file is `audit.ts`. Asserting the **file** as well as the count is what makes this a property check rather than a count that a second insert in `audit.ts` would satisfy.
- **I33.2 (app-enforced)** — the gate is proven able to fail (RT7), on the realistic spelling, not only a synthetic one.
- **I33.3 (preservation)** — the existing `MUTATION_PATTERN` assertions and their three red-proof rows (`audit-append-only.test.ts:61-86`) are **not** modified. NFR5.

**A verified constraint on how C28 may be written.** The existing `MUTATION_PATTERN` (`audit-append-only.test.ts:20`) matches `(UPDATE|DELETE)` within 200 normalized chars of `discovery_events`, not crossing a `;`. Consolidating both writers into `audit.ts` must not trip it. Probed during planning rather than assumed:

```
$ node scratch/probe.mjs
candidate audit.ts trips gate: false                       <- the C28 shape is safe
adjacent DO UPDATE then discovery_events trips gate: false <- semicolons separate the statements
DO UPDATE + discovery_events with no semicolon: true       <- the gate's real blind spot, documented
```
The third line is a genuine finding about the existing gate: a single template literal containing an `ON CONFLICT … DO UPDATE` followed by `INSERT INTO discovery_events` would false-positive. It cannot arise from C28 (the two statements are separate `tx.query` calls, semicolon-separated after normalization), and it is a false-*positive* (fails loudly, does not fail open), so it is **not** a defect to fix here. Recorded as **SC34** so its absence is deliberate.

**Forbidden patterns**

- `pattern: toBeGreaterThan\(0\)` as the count assertion for insert sites — reason: I33.1; ">0 inserts exist" is satisfied by the drift being gated against.
- `pattern: \.skip\(` / `\.only\(` in this file — reason: a disabled gate reads as a passing one.

**Acceptance criteria**

1. The test asserts `sites.length === 1` **and** `sites[0]` ends with `audit.ts`, with the failure message naming the offending file.
2. **RT7 red proof, executed and recorded**: re-add the `INSERT INTO discovery_events` statement to `account-labels-bulk.ts` → the test fails naming that file; revert → passes. Record the executed output. Per cycle-2 lesson 5, **the red-proof worktree is created under the scratchpad, never inside the repository** — a worktree under the repo caused vitest double-collection and a spurious red in cycle 2.
3. Existing tests in the file pass unmodified (I33.3), verified by the file's diff containing only additions.

---

## Findings assessed and deliberately not adopted

Recorded here rather than silently dropped, per the Anti-Deferral obligation.

### Security F3 [Minor] — log line on the projection reject branch — **NOT ADOPTED**

The finding is well-reasoned: C29 converts a *visible* symptom (`undefined` rendered in a cell — which is how D9 was actually found) into an *invisible* one, with nothing distinguishing "corrupt row" from "no label" for an investigator. The recommendation was `req.log.warn({ eventId, field }, 'audit payload kind outside domain')` on the reject branch.

**Why it is not adopted as specified**: there is no `req` at that call site, and there is no cheap way to get one. The call chain is `pageRows.map(toListItem)` (`events.ts:212`) → `toListItem` (`:142`) → `projectPayload` (`:134`) → `projectAuditPayload` (`:109`) — four module-level pure functions, none of which takes a request or a logger. Implementing the recommendation means threading a logger parameter through three signatures whose current purity is why they are unit-testable at all (C29's acceptance criteria 2 and 3 depend on calling `projectAuditPayload` directly with a plain object).

**Anti-Deferral entry.**
- **Worst case**: a corrupt or planted audit row renders as "no label" and no server-side signal exists to distinguish it from a genuine one. An investigator looking at the events page sees nothing anomalous.
- **Likelihood**: very low. Reaching the branch requires a `discovery_events` row whose payload carries an out-of-domain `kind`. The only writer is `recordLabelAuditBatch` (I28.1/I33.1), which constructs the payload server-side from a zod-validated `kind`; `saas_apps.key` is pinned to a literal (SC30), so no sync row can masquerade as an audit row. It is unreachable without direct database write access.
- **Cost to fix**: threading a logger through four functions, which trades the purity that makes the projection unit-testable for a log line on an unreachable branch. The alternative shape — returning a discriminated result the caller logs — is a larger refactor of the read path than the whole of C29.
- **Owner / trigger**: fold into the next cycle that touches the events read path for another reason, or immediately if SC30 is lifted (widening `saas_apps.key` makes the branch reachable by an operator with app-registration rights, at which point the signal stops being theoretical). Recorded as **SC38**.
- **Trigger detection, added round 3 (Security F-S3)**: the round-2 entry stated the "if SC30 is lifted" trigger but nothing made lifting *observable* — it relied on a future implementer remembering to re-read I29.5. C29 now carries a forbidden pattern (`key:\s*z\.(?!literal)` in `saas-apps.ts`) so the trigger fires as a failing gate rather than as a hope. This does not adopt the finding; it makes the deferral's own exit condition executable, which is the part that was missing.

### Security F7 [Minor, Adjacent] — `seed.ts` has no `NODE_ENV` guard — **NOT ADOPTED**

`apps/api/src/seed.ts:24-25` creates a tenant with a known-plaintext admin password and no environment guard. The reviewer correctly flagged it as adjacent and out of this plan's scope.

**Anti-Deferral entry.**
- **Worst case**: the seeder runs against a production database and creates a known-credential admin account.
- **Likelihood**: low. The seeder is wired into `docker compose` as a dev-stack service and is not part of any deployment path this repo defines. There is no production deployment yet.
- **Cost to fix**: small in isolation (a `NODE_ENV !== 'production'` bail-out), but it interacts with C30, which this cycle makes assert the seeded values across three tiers — adding a guard that changes when seeding runs, in the same cycle that makes seeded facts a gated contract, stacks two changes on one surface.
- **Owner / trigger**: the cycle that introduces a real deployment path, or any change to `seed.ts`'s invocation. Recorded as **SC39**. R34's security carve-out is noted: this touches credential handling, so the impact analysis above is required rather than optional, and it is recorded rather than waved past.

---

## Testing strategy

| Tier | What it proves here | Cost |
|---|---|---|
| **unit** (`pnpm test:unit`, `ci.yml:25`) | C28's structural delegation + empty-array early return via a fake `PoolClient`; C29's projection domain (valid, invalid, null, non-string, missing) and its forbidden-pattern greps; C32's pin-shape allowlist; C33's insert-site member-set. | No stack, no DB. The cheapest job — deliberately where most of the cycle lands. |
| **integration** (`pnpm test:integration`, `ci.yml:42`) | C28's per-account row cardinality against real Postgres (existing test, unmodified) **and the single-account path**; C29's `pg_enum` ↔ `ACCOUNT_LABEL_KINDS` equality (I29.4 needs the real DB, home decided as `api.integration.test.ts`); C31's error-handler branches via a separate `buildApp` instance. | Testcontainers. |
| **E2E** (`pnpm test:e2e`, `ci.yml:147`) | **No new specs.** The existing events and labeling specs are the regression proof that C28/C29 are behavior-preserving. | Requires the compose stack rebuilt (VE2). |
| **CI** | C32's SHA *resolution*, which cannot be verified any other way (criterion 4). Its *shape* is now gated at the unit tier (criterion 2). | One observed run. |

**Red-proof obligations (RT7).** Four contracts, five red proofs, each verified during review to actually fire:

| Contract | Red proof | Tree state it runs against |
|---|---|---|
| C29 | criterion 2 (`'not_a_kind'` passes through) | **pre-C29** — no mutation; the old `typeof === 'string'` guard is what makes it red |
| C29 | criterion 3a (`null`-vs-valid distinction) | **post-C29 + a deliberate mutation** of the reject branch to emit `null` |
| C31 | criterion 5 (`?? 'client_error'` → `'bad_request'` at `app.ts:129`) | post-C31 + mutation |
| C32 | criterion 3 (one `uses:` back to `@v5`) | post-C32 + mutation |
| C33 | criterion 2 (re-add the insert to the bulk route) | post-C33 + mutation |

**The tree-state column is the round-3 correction (Testing T13).** C29's two proofs use *different procedures*: criterion 2 is executed against the pre-C29 tree with nothing mutated, while 3a needs the post-C29 tree with a deliberate mutation. An implementer working the table top to bottom without that distinction would try to run both from one state.

C28 carries no red proof by design: its obligation is behavior *preservation*, discharged by existing integration assertions passing unmodified (criteria 2 and 5). Stated so the absence is deliberate rather than an omission. Each records real command output in the deviation log. A claim that a test "would fail" is not a red proof — cycle-2 lesson 3.

**Per cycle-2 lesson 5**: every red-proof worktree is created under the scratchpad, never inside the repository. A worktree under the repo caused vitest double-collection and a spurious red last cycle; the working directory is part of the gate's input.

**Test-count expectation.** Baseline 164 unit / 135 integration / 43 E2E (CI run `30195790728`, reproduced locally by the testing reviewer). This cycle adds unit and integration tests and deletes none (NFR5); E2E stays at 43. Final counts are recorded from an observed CI run, not from a local run.

**What is deliberately not tested.** C28's I28.4 (append-only) is not re-tested; it is schema-enforced by migration 0005 and already covered. The C32 gap the first draft claimed ("a workflow file's correctness is only observable by executing it") was **half wrong** and is now closed: resolution needs CI, shape does not.

---

## Considerations & constraints

### Risks

- **R-A — the `api-types` value export. Downgraded in round 2 from blocking to confirmed.** The first draft called this the one genuinely novel move and gated C28/C29's lock on an unexecuted probe. The probe was then executed during plan review (Functionality F5): `pnpm typecheck` → 0 errors, `next build` → *"✓ Compiled successfully in 4.2s, 9/9 static pages generated"*, with `apps/web` importing the value at runtime. Next.js 15 resolves it through the workspace symlink with no `transpilePackages` entry.

  Two of the draft's premises were also wrong: only **two** packages depend on `api-types` (not four — `apps/worker` and `e2e` do not), and the bundle-boundary question was already settled by the tree, which ships a runtime `LABEL_KINDS` array into two `'use client'` components today via `apps/web/src/lib/label-kinds.ts:13`. What remains is not a resolution risk but a **documentation** obligation, now C36.
- **R-B — refactoring the audit write path is refactoring the security-load-bearing path.** Cycle 2's review found 6 of 14 round-2/3 findings were defects introduced by round-1 *fixes*. The mitigation is that C28 is required to leave the existing integration assertions unmodified (acceptance criterion 2) — behavior preservation is proven by tests written before the refactor, not by tests written alongside it.
- **R-C — three contracts touch test infrastructure (C31, C32, C33) whose failure mode is a vacuous pass.** Each carries an explicit anti-vacuity device (the RT8 forbidden pattern in C31, C32's non-zero `uses:` count, I33.1's file assertion) and an executed red proof.
- **R-D — the plan-review process itself was a risk this cycle, and the mitigation is structural.** Three rounds produced 44 findings, of which roughly 25 were defects introduced by the *previous* round's fixes, including all three Criticals. The common shape: prose specifying a grep, a regex, or a test that nobody had executed. Two mitigations are now in force. (1) Every regex and member-set in the retained contracts has an *executed* probe recorded beside it, including the two cases where execution refuted the specification I had just written (C30's extractor, C32's Dependabot-hostile comment rule). (2) The four contracts whose specifications kept failing that standard were moved to SC40 to be built by writing and running them. Phase 2 must treat "specified but never executed" as an unmet contract, not as a contract awaiting implementation.

### Scope contract

| ID | Deferred | Owner / why |
|----|---------|-------------|
| SC32 | Body assertions for the 413 / 415 / 403 / 404 / 401 tabled branches of the error handler. | C31 covers the fallback (the deferred finding) and the 500 branch. The tabled branches read static strings from a table the 429 test (`api.integration.test.ts:232-253`) already proves is consulted correctly; constructing body-limit and content-type trips is a separate test-construction problem. Trigger: next edit to `CLIENT_ERRORS`. |
| SC33 | The `apps/api/src/seed.ts` ↔ `e2e/fixtures/seed-facts.ts` hand-sync (the *fixture* mirrors the seeder by hand; `seed-facts.ts:1-3` says so). | C30 closes the fixture↔shell-gate copy, not the seeder↔fixture one. Closing it means the fixture importing from `apps/api`, a cross-package test dependency the E2E suite currently does not have. Trigger: next cycle touching `seed.ts`'s seeded values. |
| SC34 | `MUTATION_PATTERN` false-positives when `DO UPDATE` and `INSERT INTO discovery_events` share one template literal with no `;`. | Discovered by probe this cycle (C33). Fails loudly, never fails open, and is unreachable from any shape in this cycle. Trigger: if a future statement legitimately combines them. |
| SC35 | Compose image staleness has no gate. | **Inherited unchanged from cycle 2.** Recorded trigger was "revisit if it recurs"; it has not. Fixing it needs a build id on `/healthz` the API does not expose — a production surface change for a local-workflow annoyance. Zero CI impact (CI builds fresh every run). |
| SC25 | Per-account detail page (would let the audit trail link `saasAccountId`). | Inherited. C29's walkthrough re-confirms the field renders as text; `events/page.tsx:114-115` documents why. |
| **SC40** | **The domain-derivation and gate cluster, deferred from this cycle after round 3**: the seed-gate literal agreement (cycle-2 F7 / RT3), the drizzle-enum derivation gate, the three `apps/web` domain copies plus the `@/lib/api-types` barrel decision, an executable gate on the amended C8 wording, and the `import/page.tsx:10-11` comment correction. Also carries the withdrawn **FR6**. | **Owner: cycle 4, to be built by writing and running the gates rather than specifying them.** Three plan-review rounds could not settle these on paper: round 2 raised a Critical on the seed extractor's regex (which execution then showed my own replacement got wrong), round 3 raised a Critical on a unit test that cannot exist (`LabelFilter.tsx`'s `FILTERS` is unexported and `apps/web/tsconfig.json:14` sets `jsx: preserve`, so the vitest unit project cannot transform the module) plus Majors on a five-of-six grep list, a regex character class that drops hyphenated statuses, and a false-green the derived-count check does not catch. Every one is a five-minute discovery at the keyboard. **Cost of deferring**: the label-kind domain keeps three hand-synced copies, of which `apps/web/src/app/accounts/page.tsx:17-23` fails silently — a fourth kind would be settable, storable, and not filterable in the web UI. That is the same defect class this cycle closes on the API side, left open on the web side for one cycle, and it is the reason SC40 is a single entry with one owner rather than five separable ones. |
| SC37 | Moving `MAX_UPLOAD_BYTES` into `api-types` so `apps/web/src/app/import/page.tsx` need not hand-sync it. | Deferred with SC40, which also owns that file's comment correction. The value lives in `apps/api/src/routes/hr-import.ts`, and `apps/web` cannot import from `apps/api` regardless of C8, so moving it is a separate decision about what belongs in the shared package. Trigger: the next cycle touching the import path or `api-types`' contents. |
| SC38 | Server-side signal on C29's projection reject branch. | Security F3, not adopted — full Anti-Deferral entry in "Findings assessed and deliberately not adopted" above. Trigger: next cycle touching the events read path, **or immediately if SC30 is lifted** (which would make the branch operator-reachable). |
| SC39 | `NODE_ENV` guard on `seed.ts`. | Security F7 (Adjacent), not adopted — full Anti-Deferral entry above, with R34's security carve-out honoured. Trigger: the cycle introducing a real deployment path, or any change to `seed.ts`'s invocation. |
| SC24, SC26, SC27, SC28, SC30, SC31 | Inherited unchanged from cycle 2 with their original owners. **SC27 (bulk clearing) is now cross-referenced by C28's Consumer 4 expressiveness check** — the scalar `kind` parameter was verified sufficient for it. **SC30 is promoted from an inherited note to a stated dependency of C29** (see I29.5): C29's fail-closed argument now rests on `saas_apps.key` being pinned to a literal, so whoever lifts SC30 must re-read that paragraph. | See `identity-appmgmt-labeling-v2-plan.md:1026-1034`. |

### Out of scope, stated positively

No new route, no new page, no schema migration, no change to auth, RLS, rate limits, or the crypto boundary. No worker change. No dependency added or upgraded.

---

## User operation scenarios

1. **Operator bulk-labels 50 accounts.** Before and after this cycle: 50 audit rows, one per account, each with that account's own `before`. The events page shows 50 transition rows. *What C28 changes*: the rows are written by the same statement the single-account path uses. Nothing an operator can observe changes — which is the contract (NFR1).
2. **Operator opens the events page after a mixed sync + labeling day.** Sync events render `counts`/`runId`; label events render the transition. *What C29 changes*: nothing, unless a stored payload is corrupt.
   **Corrected in round 2 (Functionality F6).** The first draft claimed a corrupt payload "renders as a neutral placeholder `—`". Traced through `apps/web/src/app/events/page.tsx:37-42,55-57`, that is only true when the payload is *wholly* corrupt. A single corrupt side renders `none`, because `auditTransition` coalesces `undefined` to `null` at `:57` and `labelSnapshot` returns `'none'` for falsy — indistinguishable from a genuine "no label". C29's own I29.5 states this correctly; the Objective and this scenario did not, and now do.
3. **Developer adds a fourth label kind.** This scenario's edit count has now been wrong three times — four, then three, then five — which is itself the argument for the scope split. Stated once more, against the tree, for the cycle as it now stands:

   | Site | Before this cycle | After |
   |---|---|---|
   | `packages/api-types/src/index.ts` | one of two hand-synced copies | **the domain** — the one deliberate edit |
   | `apps/api/src/label-kinds.ts` | hand-synced copy | derived (re-export) |
   | DB enum (`0003`) + migration | hand-synced, ungated | migration still needed; **I29.4 fails loudly** if it disagrees with the domain |
   | `packages/schema/src/tables.ts` | hand-synced, gated only against a copy of itself | **unchanged — still hand-synced** (SC40) |
   | `apps/web/src/lib/label-kinds.ts` | hand-synced | **unchanged** — fails to compile if missed (SC40) |
   | `apps/web/src/app/accounts/page.tsx` | hand-synced | **unchanged — fails silently if missed** (SC40) |

   So: **one domain edit, one migration, and three sites in cycle 4's scope**, of which one still fails silently. That is a genuine improvement over the status quo (two copies collapse, one gains a real-DB gate) and it is not the "one edit" FR6 promised. Saying so is the point — FR6 was withdrawn rather than restated a fourth time.
4. **Developer changes a seeded email in `seed.ts` and mirrors it into `seed-facts.ts`, forgetting the shell gate.** Unchanged this cycle: CI's `assert-seed-preserved` step still fails at the very end of the most expensive job, after a full stack boot and the E2E suite. Closing that is SC40's, and it is the concrete cost of deferring it.
5. **A compromised or malicious action tag is force-pushed upstream.** Before C32: the next CI run silently executes the new code with repository-token access. After: the pinned SHA is unaffected.

---

## Go/No-Go Gate

| ID  | Subject                                                          | Status |
|-----|------------------------------------------------------------------|--------|
| C28 | `recordLabelAuditBatch` — one audit writer for both label routes | **locked** |
| C29 | Validated label-kind domain on the audit read path               | **locked** |
| C31 | Unclassified-4xx `client_error` fallback exercised               | **locked** |
| C32 | CI actions pinned by commit SHA, with a shape gate and a bump path | **locked** |
| C33 | Audit-writer member-set as an executed gate                      | **locked** |

~~C30, C34, C35, C36~~ — **withdrawn from this cycle**, deferred as SC40. Not renumbered: their IDs stay retired so cycle-4 references and the three review rounds' findings against them remain unambiguous.

**All five retained contracts are `locked`.** The basis is stated plainly rather than as a claim of convergence, because the review did not converge:

- **C28 and C33** drew **zero findings across all three rounds**. C28's member-set was independently re-derived by all three reviewers and reproduced exactly; C33's red proof was verified to fire.
- **C31** has been stable since its round-2 Critical was closed. Round 3 re-derived its blast-radius set and found one more consumer (`:688`), which is now listed with a verdict; the contract itself was not otherwise challenged.
- **C29** took one round-3 correction (T11: the Decision list named five of six `tx.query<>` sites), applied above and cross-checked by executing criterion 6's own grep — eight matches, two named exclusions, six to retype.
- **C32** took two round-3 corrections (F-S5's value-vs-form gate, F-S6's Dependabot-hostile comment rule), both applied, with a fresh 19-case probe executed and recorded.

No contract here rests on an unexecuted specification. Where a regex or member-set is stated, it was run against the real tree and its output is recorded beside it — including the two cases where running it refuted what I had just written.

### Review history (retained for traceability)

The two tables below record what changed in rounds 2 and 3. **They include contracts since withdrawn (C30, C34, C35, C36)** — kept because the findings against them are the evidence for the scope split, and because cycle 4 inherits both the findings and the corrections already made.

**Changed in the round-3 draft** (round-2 review: 1 Critical, 6 Major, 12 Minor):

| Contract | Change | Driven by |
|---|---|---|
| C29 | Forbidden pattern 3 gains **named exclusions** for `events.ts:67,134` — the round-2 pattern was bound to the word `kind` and matched the *event* kind, which the plan itself had warned is one word apart from the label kind; criterion 3 split into 3 (regression pins, explicitly not red-provable) and 3a (the falsifiable `null`-vs-valid distinction); criterion 4's `pg_enum` comparison made **order-sensitive**; a `saas-apps.ts` `key` literal gate added so SC38's trigger is executable; the duplicated consumer block removed | TEST-T3, TEST-T4, FN-F4, FN-F5, SEC-F-S3 |
| C30 | The "two limitations" claim corrected — **seven** known non-matching reformats, four of them behavior-preserving; the guarantee restated as a property (the derived-count check detects any miss) rather than as an enumeration of misses; the reviewer's proposed optional-quote loosening rejected with a reason | TEST-T6 |
| C31 | Blast-radius table corrected from four `apiRoutes` consumers to **five** (`:688` added); criterion 4 updated | TEST-T5 |
| C32 | The `# vN` comment made **mandatory** in the allowlist (it was optional, so the reviewable half of the pin could decay silently); the circular "matches the count actually present" prose corrected to non-zero; the 15-case regex probe executed and recorded | SEC-F-S2 |
| C34 | I34.1's order justification repaired (it cited a criterion that compared unordered); sequencing note added — its red proof shares C35's mutation and breaks `typecheck` by design; the `tables.test.ts` residue explained | FN-F4, TEST-T2, TEST-RT9 |
| C35 | **Critical**: criterion 4 was two mutually exclusive tree states, proven by execution — split into 5a (green derivation demo) and 5b (the actual red proof); a **fourth site** added (`apps/web/src/lib/api-types.ts`, the re-export barrel) with the value-crossing decision made explicitly; I35.2 corrected — it verified render order against two sites where order is unobservable, and missed the leading `null` "All" entry; forbidden-pattern carve-out narrowed to quoted literals; anti-vacuity assertion added | TEST-T1, FN-F1, FN-F2, SEC-F-S4, FN-F8 |
| C36 | I36.2 **rewritten** — the no-import gate tested neither the property I36.1 states nor a scope wider than one hardcoded path, and restated a manifest-enforced fact; now a glob over `src/**` forbidding `require`/dynamic `import`/`process`/`globalThis`/non-relative imports, plus a manifest assertion; criterion 1 corrected from three comments to four | FN-F3, SEC-F-S1 |
| Testing strategy | RT7 count corrected from eight to **eight red proofs plus one green derivation demonstration**, with a per-contract fires/does-not table | TEST-T7 |
| Header / baseline | `SC36` recorded as deliberately unallocated; "working tree clean" corrected, with the `--untracked-files=no` obligation stated because `git status` is itself red-proof evidence in C33 and the C28 probe | FN-F6, FN-F7 |

**Changed since the round-1 draft**, retained for traceability:

| Contract | Change | Driven by |
|---|---|---|
| C28 | Consumer 4 gains an expressiveness check against SC27; acceptance criterion 3 rewritten (the SQL-identity test was tautological under the delegation design); criterion 5 added for the single-account path; probe corrected (R44 pipe, consumer count 4→2, log-eyeballing → asserted status) | FN-F4, TEST-F4, TEST-F7, FN-F5 |
| C29 | Member-set re-derived by property: **7 casts, not 4**; forbidden patterns de-scoped from a filename glob to `apps/api/src/**`; signature corrected (the re-export did not compile); I29.4's home decided; I29.5's premise corrected — **C27 does not revoke INSERT** | FN-F2, FN-F3, SEC-F1, SEC-F2, TEST-F6 |
| C30 | I30.4 strengthened from "non-zero" to a **fixture-derived count**; regex rewritten after the round-2 replacement was itself found defective by execution; extractor negative self-test added; two limitations recorded | TEST-F3 |
| C31 | **Critical**: test-isolation invariant I31.4 added — the draft's test route would have broken four existing sweeps including an exact 21-element `apiRoutes` assertion; tier decision I31.5 recorded with the unit-tier option rejected for a stated reason | TEST-F1 |
| C32 | Forbidden denylist inverted to an **allowlist**; anti-vacuity count assertion added; unit-tier shape gate added (I32.4); `dependabot.yml` brought into scope | SEC-F4, SEC-F5, TEST-F5 |
| C34, C35, C36 | **New contracts** covering the three domain copies and the C8 amendment the first draft missed entirely | FN-F1, FN-F5, SEC-F6, TEST-F2 |
| SC37, SC38, SC39 | **New scope-out entries** with full Anti-Deferral justification | SEC-F3, SEC-F7, C36 |

---

## Environment Verification Report obligations

Phase 3 must classify each contract's verification path by ID:

| Contract | Path | Expected classification |
|---|---|---|
| C28 | unit (delegation, empty batch) + integration (bulk assertions unmodified, single-account path) | `verifiable-CI` |
| C29 | unit (projection domain) + integration (`pg_enum`, in `api.integration.test.ts`) | `verifiable-CI` |
| C31 | integration (separate `buildApp` instance, non-`/api` routes) | `verifiable-CI` |
| C32 | unit (pin shape) **+** observed CI run (SHA resolution) | shape `verifiable-CI`; resolution `verifiable-CI` **only** |
| C33 | unit | `verifiable-CI` |

Every contract this cycle is CI-verifiable. Unlike cycles 1–2, no contract's evidence rests on parity-by-construction. VE1 remains `blocked-deferred` but is untouched by this cycle.

**The C32 row changed in round 2** and is worth stating plainly, because the first draft's version of it was the kind of claim VE5's resolution exists to prevent. The draft asserted C32 was "not verifiable any other way" than by an observed CI run. That conflated two properties: whether the SHAs *resolve* (only CI can say) and whether every `uses:` line *is* SHA-pinned (a static property of a text file, checkable in the cheapest job). Accepting the conflation would have left a supply-chain control with no executable gate — decaying silently on the first `uses:` line a later cycle adds, with CI green throughout because tag-pinned actions work fine.

---

## Implementation Checklist (Phase 2-1)

Derived by executing the greps below against `main` @ `3a56620`, not from the contracts' prose.
Where a member-set appears in a contract, this section is the re-derivation that confirms it.

### Files to modify

| File | Contract | Change |
|---|---|---|
| `packages/api-types/src/index.ts` | C29 | add `ACCOUNT_LABEL_KINDS` (value) + `isAccountLabelKind`; derive `AccountLabelKind` from it; correct the C8 comment |
| `apps/api/src/label-kinds.ts` | C29 | import-plus-re-export form (`LABEL_FILTERS` spreads `ACCOUNT_LABEL_KINDS`) |
| `apps/api/src/audit.ts` | C28 | add `recordLabelAuditBatch`; `recordLabelAudit` delegates to it |
| `apps/api/src/routes/account-labels-bulk.ts` | C28, C29 | drop the inline INSERT + `AUDIT_SOURCE` import; call the batch writer; retype `:61` |
| `apps/api/src/routes/account-labels.ts` | C29 | retype `:51`, `:59`, `:118`; delete casts at `:76`, `:78`, `:90`, `:130` |
| `apps/api/src/routes/accounts.ts` | C29 | retype `:45`; delete cast at `:77` |
| `apps/api/src/routes/identities.ts` | C29 | retype `:35`; delete cast at `:55` |
| `apps/api/src/routes/events.ts` | C29 | `isAccountLabelKind` guard replaces the cast at `:125` |
| `apps/web/src/lib/api-types.ts` | C29 | correct the C8 comment only (no value re-export — that is SC40) |
| `.github/workflows/ci.yml` | C32 | pin 10 `uses:` lines by SHA |
| `.github/dependabot.yml` | C32 | new — `package-ecosystem: github-actions` |
| `apps/api/test/audit-append-only.test.ts` | C33 | add the insert-site member-set assertion |
| `apps/api/test/*.test.ts` (new) | C28, C29, C32 | delegation, projection domain, pin shape |
| `apps/api/test/api.integration.test.ts` | C28, C29, C31 | single-account audit row, `pg_enum` order, error-handler branches |

### Member-sets, re-derived 2026-07-26 (all reproduce the locked contracts)

```
$ grep -rn "INSERT INTO discovery_events" apps packages --include='*.ts' | grep -v /test/
  audit.ts:41, account-labels-bulk.ts:91          <- audit family (C28 collapses to 1)
  worker/match.ts:125, worker/sync.ts:150,157,178 <- sync family (out of scope)

$ grep -rnE "as (NonNullable<)?\w+(\[['\"][\w]+['\"]\])*(>)?\[['\"]kind['\"]\]|as AccountLabelKind" apps/api/src
  7 hits: account-labels.ts:76,78,90,130 / events.ts:125 / accounts.ts:77 / identities.ts:55

$ grep -rnE "(kind|label_kind)\??: string" apps/api/src
  8 hits: 6 to retype (account-labels.ts:51,59,118 / account-labels-bulk.ts:61 /
          accounts.ts:45 / identities.ts:35) + 2 named exclusions (events.ts:67,134)
```

### Shared utilities to reuse (R1 — do not reimplement)

- `collectSourceFiles` / `normalizeSource` — `apps/api/test/audit-append-only.test.ts:22-41`. C33's new assertion reuses both.
- `withTenant` — `@open-smp/schema`. Every audit write stays on the caller's `tx` (I28.5).
- `LABEL_AUDIT_KINDS` / `AUDIT_SOURCE` — `apps/api/src/audit.ts:9,14`. Already single-sourced.
- `PAGE_SIZE`, `LIST_RATE_LIMIT`, `MUTATION_RATE_LIMIT` — existing shared constants; untouched.

### R19 — all test trees referencing the changed symbols

`grep -rl` over `apps`, `packages`, `e2e` for `recordLabelAudit`, `AUDIT_SOURCE`, `LABEL_KINDS`,
`AccountLabelKind`, `projectAuditPayload` returns **no test file**. The symbols are exercised only
through HTTP in `api.integration.test.ts` and through the UI in the Playwright specs, so there is no
parallel test tree to update. Recorded because R19's failure mode is finding this out at the
full-suite run rather than at planning time.

### CI gate parity (Step 2-1 item 7)

`extract-ci-checks.sh` emits only `pnpm lint` and `pnpm typecheck`, then warns that `ci.yml` carries
multi-line `run:` blocks it cannot parse. **The extracted set is therefore a subset and must not be
treated as the gate list.** Read manually from `ci.yml`, the full set is:

| Gate | ci.yml | Runs locally? |
|---|---|---|
| `pnpm lint` | `:23` | yes |
| `pnpm typecheck` | `:24` | yes |
| `pnpm test:unit` | `:25` | yes |
| `pnpm test:integration` | `:42` | yes (Testcontainers, needs Docker) |
| compose stack boot + curl gates | `:60-137` | yes (needs `docker compose up -d --build`) |
| `pnpm --filter e2e exec playwright install` | `:144` | already installed locally |
| `pnpm test:e2e` | `:147` | yes (needs the compose stack) |
| `bash e2e/scripts/assert-seed-preserved.sh` | `:150` | yes |

**Parity gap: the repo has no local pre-PR aggregate script** (`scripts/pre-pr.sh` absent). Every
gate above is individually runnable locally, so the gap is one of convenience rather than coverage —
but it means Phase 2-4 must invoke each gate explicitly rather than relying on one script.
**Disposition**: run each explicitly this cycle; creating the aggregate script is not in scope and is
not deferred silently — it is recorded here as the reason Phase 2-4's completion check is a list
rather than a single command.

**New-file gates**: C32 adds `.github/dependabot.yml` and several `apps/api/test/*.test.ts` files.
The unit glob `apps/**/*.test.ts` picks up new test files automatically — that is the intent — and
`pnpm lint` covers the new YAML only if ESLint is configured for it (it is not; ESLint is TS-only
here, so `dependabot.yml` has no local linter and is verified by CI accepting it).

### Memory cross-check

No `~/.claude/projects/-Users-noguchi-.../memory` directory exists for this project, so there are no
recorded feedback rules to regress against. Recorded so its absence is deliberate rather than unchecked.
