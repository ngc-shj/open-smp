# Code Review: identity-appmgmt-labeling-v2

Date: 2026-07-26
Review round: 1

## Changes from Previous Round

Initial review. Three expert agents (functionality, security, testing) reviewed
`git diff main...HEAD` (73 files, ~6,900 insertions) covering Batches A–D against the locked
plan and the Phase-2 deviation log.

Ollama seed generation timed out on a diff this size: the security and testing seeds were
never produced (0-byte / absent), and the single functionality seed was **verified false**
before dispatch — it claimed `account-labels.ts` used a bare `UPDATE` where the code already
uses `INSERT ... ON CONFLICT DO UPDATE`. All three experts therefore performed full
independent reviews rather than seed confirmation. `pre-review.sh` ran clean.

## Findings summary

| Expert | Critical | Major | Minor |
|---|---|---|---|
| Functionality | 1 | 6 | 1 |
| Security | 1 | 0 | 3 |
| Testing | 0 | 6 | 4 |

Two Criticals, both independently reproduced by the orchestrator before any fix was written,
and both landing on the same contract — C20's cursor. They are unrelated defects that happen
to share a surface.

## Functionality Findings

- **F1 (Critical)** — the events cursor truncated `created_at` to milliseconds. `timestamptz`
  stores microseconds; `toISOString()` does not. The keyset predicate `(created_at, id) < ($t, $id)`
  then moved the boundary *earlier*, silently dropping every row in the gap — no error, no
  duplicate, just a missing audit record.
- **F2 (Major)** — `?source=` had no UI affordance; reachable only by hand-editing the URL,
  which is the "written but not readable" condition C20 added the filter to prevent.
- **F3 (Major)** — an invalid `?source=` rendered a Next error page, where the sibling accounts
  page allowlists its filters and falls back.
- **F4 (Major)** — `LABEL_KINDS` forked across three API modules (two copies added this cycle).
- **F5 (Major)** — `AUDIT_KINDS` defined twice; the UI copy would silently render `—` for a
  real audit event if a future kind were added only server-side.
- **F6 (Major)** — the bulk route reimplemented the audit insert instead of reusing the
  designated primitive. **Not fixed this round — see Resolution Status.**
- **F7 (Major)** — Delete acted on a single click while both sibling actions open a panel first.
- **F8 (Minor)** — `LabelControl`'s select and note input set `disabled` with no visible cue,
  while the new `BulkLabelBar` modelled on it has one.

## Security Findings

- **F1 (Critical)** — `decodeCursor`'s totality claim was false. It validated `t` with
  `Date.parse` alone, which accepts strings Postgres rejects as `timestamptz`. A cursor
  carrying `t: "0"` reached the query and returned **HTTP 500 with the raw Postgres error in
  the body** (`22008 date/time field value out of range: "0"`), against a module whose own
  docstring promises a 400. Compounded by an error handler that rethrew, letting Fastify
  serialize driver text to clients.
- **F2 (Minor)** — `\n` missing from `DANGEROUS_FIRST_CHARS` while its `\r` twin is present.
- **F3 (Minor)** — the 401/403 sweeps left `:saasAccountId` / `:identityId` unsubstituted.
- **F4 (Minor)** — the audit projection casts `snapshot.kind` without domain validation.
  **Not fixed this round — see Resolution Status.**

Verified clean by measurement, not by reading: C27's REVOKE is real and effective
(`role_table_grants` shows only `INSERT, SELECT`; live UPDATE/DELETE both denied); tenant
isolation holds on all five new routes against two real tenants; C21's projection is
fail-closed for unknown and case-variant kinds; C22 persists both `credentials_enc` and
`credentials_key_version` in one UPDATE and decrypts under a two-version key map; bulk
labeling is capped, deduplicated, all-or-nothing, and parameterized; the built WHERE clause
has no top-level OR. No auth bypass, cross-tenant leak, SQL injection, or secret disclosure
was found.

## Testing Findings

- **F1 (Major)** — `apps.spec.ts` restored the seeded app name via UI-driven teardown, the
  exact pattern I26.5 forbids, for the leak the plan itself calls permanent.
- **F2 (Major)** — the I26.6 / R42-B page↔spec membership check existed only as plan prose.
- **F3 (Major)** — the R42-A sweep obligation (generic `:param` substitution, widened method
  casts) was never implemented despite C22 adding the first `PATCH` route.
- **F4 (Major)** — route sweeps asserted only `length > 0`, so an unregistered route was
  invisible; C26 requires counts as targets, not growth.
- **F5 (Major)** — `events.spec.ts` asserted 4 of the 6 shipped column headers, leaving both
  new audit columns unguarded.
- **F6 (Major)** — I22.5's `23503` backstop discharge had no test; deleting the catch turned
  nothing red.
- **F7 (Minor)** — `assert-seed-preserved.sh` re-copies seeded values instead of deriving them
  (RT3). **Not fixed this round — see Resolution Status.**
- **F8 (Minor)** — the C20 boundary test omitted the mandated ordering assertion. The reviewer
  red-proved that the test *does* catch an inverted tie-break, but via row count rather than
  the named mechanism, and downgraded its own Major to Minor on that evidence.
- **F9 (Minor)** — the append-only guard's `{0,40}` window was red-proved evadable by ordinary
  multi-line SQL formatting.

## Adjacent Findings

- **[Adjacent] Minor (Testing → Functionality)** — D11's stale-compose-image failure mode has
  no gate. A local `docker compose up -d --build web` *recreates* `api` from its old image, so
  E2E can fail against correct code. CI is unaffected (fresh build every run).
  **Not fixed this round — see Resolution Status.**

## Quality Warnings

None. Every finding carried a file, a line, and a concrete failure scenario; the two Criticals
and three of the Minors arrived with executed reproductions.

## Resolution Status

### Functionality F1 / Security F1 [Critical] — C20 cursor: precision loss and non-total decoding
- Reproduced independently before fixing. Precision: 64 of 65 rows on the dev stack carry
  sub-millisecond timestamps; a rolled-back probe confirmed a row at `.500400` is dropped when
  the cursor carries `.500`. Totality: `Date.parse('0')` succeeds, `SELECT '0'::timestamptz`
  raises `22008`.
- Action: the query now emits `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_t` and
  the cursor is minted from that, so the comparison keeps microsecond precision; `decodeCursor`
  validates `t` against the producer's own format (`CURSOR_TIMESTAMP_RE`, 0–6 fractional
  digits) so the accepted domain is a subset of what the database takes; the error handler
  logs the full error and answers `{error:'internal_error'}` instead of rethrowing.
- Modified: `apps/api/src/routes/events.ts:63-88,186-206`, `apps/api/src/routes/events-cursor.ts:16-25,50-53`, `apps/api/src/app.ts:94-113`
- Red-proofs (throwaway worktree, real tree never mutated): the new microsecond integration
  case fails against the old encoding with `expected 50 to be 51`; the four hostile-timestamp
  unit cases fail against the old `Date.parse`-only decoder while the microsecond round-trip
  stays green.
- Tests added: `apps/api/test/api.integration.test.ts` (microsecond boundary case; `t:'0'`
  added to the malformed-cursor set, now asserting the body shape and absence of driver text),
  `apps/api/test/events-cursor.test.ts` (4 hostile-timestamp cases + microsecond round-trip).

### Functionality F2 [Major] — `?source=` unreachable from the UI
- Action: added `SourceFilter`, server-rendered links mirroring `LabelFilter`. Filter values
  verified against the producers (`label`, `matcher` present in the live table; `google-workspace`
  is `app.key`, pinned by the POST literal). No cursor is carried across a filter change,
  since a cursor is bound to the filter it was minted under.
- Modified: `apps/web/src/components/SourceFilter.tsx` (new), `apps/web/src/app/events/page.tsx:64`

### Functionality F3 [Major] — invalid `?source=` rendered an error page
- Action: the page validates `source` against the API's slug domain and drops it otherwise,
  matching `accounts/page.tsx`'s allowlist-and-fall-back idiom.
- Modified: `apps/web/src/app/events/page.tsx:52-58,63`

### Functionality F4 [Major] — `LABEL_KINDS` forked across three modules
- Action: extracted `apps/api/src/label-kinds.ts` (alongside the existing `label-note.ts` /
  `page-size.ts` precedent) exporting `LABEL_KINDS` and deriving `LABEL_FILTERS` from it; all
  three routes import it. Values cross-checked against `pg_enum` (exactly the three).
- Modified: `apps/api/src/label-kinds.ts` (new), `account-labels.ts:8`, `account-labels-bulk.ts:7`, `accounts.ts:8`

### Functionality F5 [Major] — `AUDIT_KINDS` defined twice
- Action: `audit.ts` now exports `LABEL_AUDIT_KINDS` as the value with `LabelAuditKind` derived
  from it; `events.ts` builds its set from that. On the web side the second list was removed
  rather than re-synced — `auditTransition` keys off the projected payload, so a future audit
  kind renders the moment the server projects it. A runtime export through `api-types` was
  rejected because that module is deliberately type-only ("no runtime code enters the web
  bundle").
- Modified: `apps/api/src/audit.ts:11-16`, `apps/api/src/routes/events.ts:8,89`, `apps/web/src/app/events/page.tsx:36-50`

### Functionality F7 [Major] — Delete acted without confirmation (R31)
- Action: Delete now opens a `confirmDelete` panel naming the app, matching the two-step shape
  its siblings already use.
- Modified: `apps/web/src/components/SaasAppManager.tsx:43,160,172-199`, `e2e/specs/apps.spec.ts:149-154`

### Functionality F8 [Minor] — missing visible disabled cue (I25.2/R26)
- Action: added `disabled:opacity-50` to `LabelControl`'s select and note input.
- Modified: `apps/web/src/components/LabelControl.tsx:101,117`

### Security F2 [Minor] — `\n` absent from `DANGEROUS_FIRST_CHARS`
- Measured first: `"\n=cmd"` exports as `" =cmd"` — the strip turns the newline into a leading
  space, so no formula fires and the omission is **not currently exploitable**. Fixed anyway
  because it made neutralization depend on the strip running; the two defences are meant to be
  independent.
- Modified: `apps/web/src/lib/csv-export.ts:3-7`; test added at `apps/web/test/csv-export.test.ts` (the `\n` twin of the `\r`-led formula case).

### Security F3 / Testing F3 [Minor/Major] — sweep substitution and method casts
- Action: substitution generalized to `route.url.replace(/:[A-Za-z]+/g, () => randomUUID())` at
  all three sites; the `'GET' | 'POST'` cast widened to a narrow `SweepMethod` union covering
  PATCH and DELETE. (Fastify's exported `HTTPMethods` is `Autocomplete`-widened with `string`
  and does not resolve `app.inject`'s overload — measured, not assumed.)
- Modified: `apps/api/test/api.integration.test.ts:8-13,141,158,169`

### Testing F1 [Major] — UI-driven teardown for the permanent leak
- Action: `apps.spec.ts`'s `afterEach` now restores the seeded name via `PATCH /api/saas-apps/:id`
  with the mandatory `Origin` header, asserting its own 200 — the same shape `clearLabels` uses.
- Modified: `e2e/specs/apps.spec.ts:110-127`

### Testing F2 [Major] — page↔spec membership check existed only as prose
- Action: added an executed unit test that recurses `apps/web/src/app/**/page.tsx` and maps each
  page directory to a spec, with the root page and `/login` exempted by name and reason.
- Modified: `apps/web/test/page-spec-membership.test.ts` (new)
- Red-proof: renaming `identity.spec.ts` away fails the check naming `identities/[identityId]`.
  (It also caught that page for real once, before the singular/plural matcher was corrected.)

### Testing F4 [Major] — sweeps asserted a floor, not a count
- Action: T-L9 now asserts the exact sorted route list. The `HEAD` companions Fastify registers
  for every `GET` are listed explicitly — they were discovered by running the assertion, not
  assumed away.
- Modified: `apps/api/test/api.integration.test.ts:1459-1479`

### Testing F5 [Major] — events spec asserted 4 of 6 headers
- Action: extended to the full shipped set including `Label change` and `Actor`.
- Modified: `e2e/specs/events.spec.ts:12-15`

### Testing F6 [Major] — I22.5's `23503` discharge had no test
- Action: added a source assertion pinning the `23503` code, the `saas_accounts_saas_app_id_fkey`
  constraint name (the spelling the plan got wrong once — Postgres names a foreign key after the
  *referencing* table), and the `throw err` rethrow that keeps the catch narrow.
- Modified: `apps/api/test/no-rotation-route.test.ts:27-52`

### Testing F8 [Minor] — C20 boundary test lacked the mandated ordering assertion
- Action: appended the non-increasing `(createdAt, id)` check across the page seam, as C20
  (round-2 TEST-F5) specified. The `listEvents` helper's return type was widened to carry
  `createdAt`.
- Modified: `apps/api/test/api.integration.test.ts:2318,2385-2396`

### Testing F9 [Minor] — append-only guard evadable by SQL formatting
- Action: the guard now normalizes source (comments stripped, whitespace collapsed) before
  matching, so the window measures SQL distance rather than source formatting. Added three
  self-tests: it must fire on the single-line form **and** on the multi-line-with-comment form
  the reviewer red-proved silent, and must stay quiet on the INSERT/SELECT paths the audit
  trail depends on.
- Modified: `apps/api/test/audit-append-only.test.ts:11-27,45-70`

### Functionality F6 [Major] — bulk route reimplements the audit insert — DEFERRED
- **Anti-Deferral entry.** Not fixed this round.
- **Worst case**: a future change to `recordLabelAudit` (a new column, a payload-version field,
  a kind rename) lands on the single-account path and silently misses bulk, producing a
  divergent audit trail for the highest-volume operation.
- **Likelihood**: low in the near term — the two writers were verified to agree today (same
  four columns, same `AUDIT_SOURCE`, same payload shape), and both are covered by tests
  asserting one audit row per account with correct before/after contents.
- **Cost to fix**: small (a `recordLabelAuditBatch` carrying the `unnest` statement), but it
  changes the audit write path for every bulk mutation. Doing it in the same round that
  rewrote the cursor, the error handler, and the projection would stack an unreviewed change
  onto the security-load-bearing path this branch exists to build.
- **Owner / trigger**: fold into the next cycle that touches `audit.ts`, or immediately before
  any change to `recordLabelAudit`'s signature or the `discovery_events` columns.

### Security F4 [Minor] — projection casts `snapshot.kind` without domain validation — DEFERRED
- **Anti-Deferral entry.** Not fixed this round.
- **Worst case**: a `discovery_events` row whose payload carries an unrecognized `kind` string
  renders as `undefined` in the audit column, the same visible symptom as D9.
- **Likelihood**: very low. The only writers are `recordLabelAudit` and the bulk route, both of
  which construct the payload from a zod-validated `kind`; the DB privilege (C27) prevents
  rewriting an emitted row, and RLS prevents cross-tenant insertion. Reaching it requires
  direct database write access, at which point the audit trail has larger problems.
- **Cost to fix**: small, but it belongs with F6 — both are about giving the audit payload a
  validated domain on the read path, and splitting them across rounds would touch the same
  projection twice.
- **Owner / trigger**: same cycle as F6.

### Testing F7 [Minor] — shell gate re-copies seeded constants (RT3) — DEFERRED
- **Anti-Deferral entry.** Not fixed this round.
- **Worst case**: `seed-facts.ts` changes and the shell gate keeps asserting the old values,
  passing while the seed drifted — or failing spuriously after a legitimate seed change.
- **Likelihood**: low. The seeded demo values have been stable across three cycles, and a
  mismatch fails loudly at the gate rather than silently.
- **Cost to fix**: the bridge is a shell/TS boundary (the gate is bash; the fixture is a TS
  module). The reviewer's proposed `node --experimental-strip-types` eval is plausible but
  introduces a runtime dependency into a gate whose value is that it is simple and always
  runs. The cheaper alternative — asserting in a `.spec.ts` that the script's literals match
  the fixture — is the better shape and is what should be built.
- **Owner / trigger**: next cycle touching `seed-facts.ts` or the gate.

### [Adjacent] Minor — stale-compose-image failure mode has no gate — DEFERRED
- **Anti-Deferral entry.** Not fixed this round.
- **Worst case**: a local E2E run fails against correct code, costing diagnostic time (it cost
  two cycles this session, recorded as D11).
- **Likelihood**: moderate locally; zero in CI, which builds fresh every run.
- **Cost to fix**: a build-stamp assertion in `global-setup.ts` comparing a `/healthz` build id
  against HEAD requires the API to expose a build identifier it does not currently have — a
  production surface change to fix a local-workflow annoyance.
- **Owner / trigger**: revisit if it recurs; documented in `docs/manual-tests/e2e-howto.md` and
  deviation D11 in the meantime.

## Environment Verification Report

The plan declared VE1–VE5. Classification for this round:

- **VE1** (no live Google Workspace tenant) — `blocked-deferred`. C22 asserts *storage*
  properties, not provider-accepted ones, by design; the E2E credential prohibition holds
  (credential replacement is exercised only at the integration tier). Links to plan VE1 and to
  the plan's own C22 acceptance framing.
- **VE2** (E2E coverage for new pages) — `verified-local`. `pnpm test:e2e` 37 passed; the new
  identity, apps-management, and labeling specs all execute. The page↔spec membership check is
  now an executed gate rather than prose.
- **VE3** (integration needs Docker) — `verified-local`. `pnpm test:integration` 133 passed
  against Testcontainers.
- **VE4** (E2E needs the compose stack) — `verified-local`. Stack rebuilt (`api`, `web`,
  `worker`) before the run; both consecutive runs green.
- **VE5** (no git remote; CI has never executed) — `blocked-deferred`, unchanged. Every CI-gate
  claim remains parity-by-construction: the same five commands were run locally. Links to plan
  VE5.

## Gate state after fixes (all executed this round)

| Gate | Result |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test:unit` | 144 passed / 16 files |
| `pnpm test:integration` | 133 passed / 5 files |
| `pnpm test:e2e` | 37 passed |
| `bash e2e/scripts/assert-seed-preserved.sh` | exit 0 |

Deltas from the pre-review state (133 / 132 / 37): unit +11 (4 hostile-cursor cases, 1
microsecond round-trip, 3 audit-guard self-tests, 1 `\n` neutralization case, 1 page↔spec
membership, 1 `23503` discharge), integration +1 (microsecond boundary), E2E unchanged in
count with two specs strengthened.

## Orchestrator notes

**Both Criticals were reproduced before being fixed.** The precision defect was confirmed by
querying the live table (64/65 rows sub-millisecond) and by a rolled-back probe demonstrating
the dropped row; the totality defect by checking `Date.parse` against `SELECT '0'::timestamptz`.
Neither fix was written from the finding's description alone.

**One reported finding was rejected on measurement.** The Ollama functionality seed claimed the
label upsert was a bare `UPDATE`; reading the code showed `INSERT ... ON CONFLICT DO UPDATE`
already present — the seed had proposed as its fix exactly what was there.

**A typecheck failure during this round was traced to a reviewer's scratch file**, not to the
branch: `zzproj.test.ts` imported a web module by relative path into the API project, where the
`@/*` alias does not resolve. Worth recording because the first reading was "my extraction broke
the build" — the correct move was to find the importer rather than to start changing the module.

**The testing expert downgraded its own finding on evidence.** It expected the C20 boundary test
to be vacuous against an inverted tie-break, ran the mutation instead of reporting the
inference, found the test went red, built a harder 3-row-tie fixture to check whether the catch
was incidental, and reported Minor instead of the Major it had predicted. That is the discipline
the plan's convergence notes ask for.
