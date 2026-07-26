# Code Review: identity-appmgmt-labeling-v2

Date: 2026-07-26
Review round: 2 (round-1 sections retained below)

---

# Round 2

## Changes from Previous Round

Round-1 fixes were committed as `f0fb389` and re-reviewed by all three experts. The
orchestrator additionally re-probed its own round-1 fix and found it incomplete.

## Orchestrator self-finding (Major) — the round-1 cursor fix was shape-only and still let a 500 through

While the round-2 experts were running, I re-tested the domain claim I had made in round 1
rather than restating it. `CURSOR_TIMESTAMP_RE` checks the *spelling* of a timestamp, not the
*validity* of its calendar fields:

```
2026-02-30T00:00:00Z   regex: true   Date.parse: true   (JS rolls it to Mar 2)
$ psql -c "SELECT '2026-02-30T00:00:00Z'::timestamptz;"
ERROR:  date/time field value out of range: "2026-02-30T00:00:00Z"
```

So a cursor carrying February 30th passed both round-1 guards and still reached the query —
re-opening exactly the 22008 the fix existed to close. The round-1 claim that the accepted
domain was "a subset of what Postgres takes" was **derived from the format rather than
measured against the domain**, which is the same defect class the plan's convergence notes
record six times.

**Fix**: `decodeCursor` now round-trips the value through `Date` and compares every UTC field
against the string it came from — a value that rolled over comes back with different fields.
This catches every out-of-range component (month, day, hour, minute, second, leap year) in one
comparison instead of enumerating month lengths.

**Verified across the domain, not a sample** — every value the validator accepts was then fed
to Postgres:

```
reject  2026-02-30  2026-13-01  2026-01-32  2026-01-01T25:00:00  0000-00-00  2026-02-29  ...T00:00:60
ACCEPT  2026-02-28  2024-02-29  2026-12-31T23:59:59.999999  2026-07-09T00:00:00.500900  0001-01-01  9999-12-31
$ psql: all six ACCEPT values cast cleanly to timestamptz
```

Leap-year handling is correct in both directions (2024-02-29 accepted, 2026-02-29 rejected).

- Modified: `apps/api/src/routes/events-cursor.ts:18-52,63`
- Tests added: four calendar-rollover rejection cases plus a leap-day round-trip case
  (`apps/api/test/events-cursor.test.ts`).
- Red-proof: against round 1's shape-only check, `2026-02-30` and `2026-02-29` both fail. The
  month-13 and hour-25 cases stay green there because `Date.parse` already rejected them —
  reported accurately rather than claimed as four catches.

## Security Findings (round 2)

### S-R2-F1 [Critical, continuing] — the calendar fix was still incomplete: astronomical year zero
The security expert independently reproduced the Feb-30 class against the **live API** (five
shape-valid strings returning HTTP 500), then tested my *uncommitted* `isRealCalendarDate`
against the real module via `tsx` — not a replica — and found two cases still passing:

```
0000-01-01T00:00:00Z  ACCEPTED -> reaches query
0000-12-31T23:59:59Z  ACCEPTED -> reaches query
2026-02-30T00:00:00Z  rejected (400)   <- my fix, working
```

Root cause: JS numbers years astronomically, so `new Date('0000-01-01T00:00:00Z').getUTCFullYear()`
is `0` and the field-by-field round-trip **agrees with itself**. Postgres has no year 0 and
raises 22008. The round-trip technique is structurally blind to exactly this case — a real
limitation of the approach I chose, found because the reviewer tested the module rather than
reading it.

Confirmed independently: `SELECT '0000-01-01T00:00:00Z'::timestamptz` → `ERROR: date/time field
value out of range`.

- Action: added an explicit `Number(year) < 1` lower bound with a comment naming why the
  round-trip cannot catch it.
- Modified: `apps/api/src/routes/events-cursor.ts:38-45`
- Tests: two year-zero cases added to the unit rejection table; `2026-02-30` and
  `0000-01-01` added to the integration malformed-cursor set (which also asserts the body
  shape and the absence of driver text).
- Severity note: the expert set `escalate: false` and justified it — the information-disclosure
  half of round-1 F1 is genuinely fixed (bodies are opaque), leaving a self-inflicted 500 on an
  authenticated endpoint. No auth bypass, cross-tenant read, injection, or secret disclosure.

### S-R2-F2 [Major, new — introduced by my round-1 fix] — the error handler mislabelled 429s
Measured by driving `/api/events` past `LIST_RATE_LIMIT` against the live API: request 240
returned `429` with correct `retry-after`/`limit` headers but a body of `{"error":"bad_request"}`.
`@fastify/rate-limit`'s error carries no string `code`, so my handler fell through to the
default. Throttling reported as a client mistake hides an abuse signal from callers and log
pipelines.

The expert also noted **no test could catch it**: every 429 assertion in the suite checked
status only — decorative coverage for the body contract.

- Action: the body now comes from a status-keyed table (`400/403/404/413/415/429`) instead of
  the error's own `code`, which fixes S-R2-F3 in the same change.
- Modified: `apps/api/src/app.ts:99-126`
- Test: the login rate-limit test now asserts `{error:'too_many_requests'}`.
- Red-proof: reverting the handler to the round-1 form fails it with
  `expected { error: 'bad_request' } to deeply equal { error: 'too_many_requests' }`.

### S-R2-F3 [Minor, new — introduced by my round-1 fix] — internal Fastify codes reflected verbatim
Measured: `POST /api/saas-apps` with malformed JSON returned
`400 {"error":"FST_ERR_CTP_INVALID_JSON_BODY"}`. Reflecting `error.code` leaked framework
identity and made internal taxonomy a de-facto part of the public contract — the same class the
round-1 fix was written to close. (Route-level SQLSTATEs never reach here; `saas-apps.ts`
handles `23505`/`23503` and sends its own bodies.)

- Action: closed by the same status-keyed table as S-R2-F2.

### Verified clean by the security expert (measured, not read)
- `to_char(... AT TIME ZONE 'UTC' ...)` round-trips exactly: 87/87 real rows satisfy
  `to_char(...)::timestamptz = created_at` under a half-hour-offset session TZ, and a
  DST-boundary value round-trips under `America/New_York`. No TZ/DST hazard.
- The handler preserves the statuses it should: 401 `unauthorized`, 403 `origin_mismatch`,
  zod 400 `invalid_query`, 415 `invalid_body`. No driver text in any body — the round-1
  disclosure is genuinely gone.
- R43 boundary-widening: none. The extracted `LABEL_KINDS`/`LABEL_FILTERS` are value-identical
  to the three previous copies and match `pg_enum` exactly; `AUDIT_KINDS` is the same two-element
  set; `projectPayload` still fails closed on unknown kinds.
- The web-side F5 change is safe: `projectSyncPayload` only ever emits `counts`/`runId` (live
  table confirms sync payload keys are exactly `["runId","counts"]`), so a sync event can never
  present audit fields to `auditTransition`.
- `SourceFilter` has no injection surface; `SOURCE_RE` blocks scripts, traversal, and CRLF.
- Round-1 F4's deferral (projection casts `snapshot.kind`) assessed and **concurred with**.

# Round 3

## Security Findings (round 3) — **No findings**

All three round-2 security findings resolved. The expert's verification is worth recording
because it settles, by exhaustion rather than by sampling, the question two earlier rounds got
wrong.

**The cursor domain is closed in both directions.** Probing the real module (not a replica) and
adjudicating each result against Postgres 16.13's own parser:

- *Under-rejection* — 73,066 candidates spanning years 0000–9999, every out-of-range
  month/day/hour/minute/second shape, leap days, and 60k random values. 1,598 were accepted by
  the validator; **all 1,598 cast cleanly to `timestamptz`, 0 errors.** The harness was
  negative-controlled: it reproduced both prior bug classes (`2026-02-30`, `0000-01-01`), so a
  silent-pass harness is ruled out.
- *Over-rejection* — the tightened predicate could have started 400ing cursors the API itself
  mints. 20,000 Postgres-minted timestamps in the route's exact producer format plus all 119
  live rows: **0 rejected.**
- *Adversarial* — newline/CR/NUL smuggling, Arabic-Indic and fullwidth digits, lowercase
  `z`/`t`, `+00:00` offsets, 5-digit years, 7 fraction digits, type confusion, and prototype
  pollution (`__proto__` as a fourth key leaves `Object.prototype` untouched) all rejected.
  `s` accepts SQL-shaped text but reaches only a JS equality check and never enters
  `buildEventsWhere`, where only `t` and `id` go, both parameterized.

**The 400-retry is bounded and creates no oracle.** Traced over 12 status scenarios: at most two
calls in every case, including "400 always", because the retry passes `cursor: undefined`. 401
redirects before the retry check; 403/404/429/500 all throw on the first call. C20's deliberate
property — a well-formed foreign-tenant cursor returns 200-with-empty-page, never 400 — still
holds, so the retry is never entered on that path and no new distinguisher appears.

**`setNotFoundHandler` does not touch auth or Origin.** Swept the real 21-route table in-process
with a pool that throws if reached: every non-GET route 403s without a valid Origin, every GET
401s unauthenticated, and only genuinely unmatched routes reach the new handler.

**R43**: the `status` computation and the `status < 500` boundary are byte-identical to
`f0fb389`; only the body label changed. No widening.

## Functionality + Testing Findings (round 3)

### TEST-R3-1 [Major, continuing] — the membership guard lied a second time, under a new strategy
Round 2 replaced filename matching with navigation matching. The expert showed the navigation
match is satisfied by text that never runs. Reproduced:

```
MATCH  test.skip('x', async()=>{ await page.goto('/sync') })
MATCH  // await page.goto('/sync')            <- the realistic one
MATCH  /* await page.goto('/sync') */
MATCH  // TODO: add page.goto('/sync') coverage
miss   await page.goto("/sync")               <- spurious RED, double quotes
```

The commented-out case is how this bites in practice: a flaky spec gets commented out during
debugging and the guard keeps reporting its page as covered. **This is the ninth instance of the
guard-bound-to-a-spelling defect in this plan's history, and the second time this particular
guard has failed** — first by filename, then by raw text.

- Action: an `executableSource` helper strips comments and excises `test.skip`/`fixme`/`todo`
  bodies by brace matching before the route match runs; the pattern now also accepts double
  quotes and leading whitespace (TEST-R3-2, the fail-safe direction, closed in the same edit).
- Modified: `apps/web/test/page-spec-membership.test.ts:5-35,44-70`
- **The guard now guards itself**: eleven self-tests pin all five false-green forms as rejected,
  all four real navigation spellings as accepted, that `/sync-history` does not satisfy `/sync`,
  and that a live test in the same file as a skipped one still counts.
- Verified end-to-end: a page whose only coverage is a commented-out navigation is now reported
  uncovered (`pages no E2E spec navigates to: probe-route`).
- **Stated limitation, rather than an implied invariant**: navigation through a helper or a link
  click still reads as uncovered. That is the safe direction, and the comment now says so
  instead of claiming the property is fully expressed.

### F-R3-1 [Minor, new] — `setNotFoundHandler` shipped with no test
Deleting it left the whole suite green while Fastify's default body returned.

- Action: added two error-shape integration cases — an unmatched route must deep-equal
  `{error:'not_found'}`, and a malformed JSON body must not name the framework.
- Modified: `apps/api/test/api.integration.test.ts:138-165`
- Red-proof: removing `setNotFoundHandler` fails the first with
  `expected { …(3) } to deeply equal { error: 'not_found' }`. Deep-equal rather than a status
  check is what makes it red — the status was already 404 before the fix.

### TEST-R3-3 [Minor, new] — helper declared between tests
- Action: `runFilterAssertions` moved above the first `test()`.
- Modified: `e2e/specs/events.spec.ts:5-21`

### F-R3-2 [Minor] — the untabled-4xx `'client_error'` fallback is unexercised — DEFERRED
- **Anti-Deferral entry.** Not fixed this round.
- **Worst case**: reverting `'client_error'` to `'bad_request'` — the exact regression R2-F2
  fixed — keeps every test green, so the fallback's label could silently drift back to
  mislabelling an unclassified status.
- **Likelihood**: very low, and bounded. Reaching the branch needs a thrown error carrying a 4xx
  `statusCode` outside `{400,403,404,413,415,429}`; no current route produces one, and the two
  framework paths that do reach the handler (malformed JSON → 400, bad content-type → 415) are
  both tabled and now both tested.
- **Cost to fix**: the honest options are a throwaway route registered inside `buildApp` for the
  test's benefit — production code existing only to be tested, on the security-sensitive app
  factory — or exporting `CLIENT_ERRORS` purely to assert its default. Both trade a real
  structural cost for a branch nothing reaches. The reviewer costed this the same way and
  offered the deferral as the reasonable alternative.
- **Owner / trigger**: fold in the first time a route legitimately throws an untabled 4xx, or if
  the handler's mapping is edited again.

### Verified clean by the round-3 expert
- The 400-retry is depth-1 bounded (the retry passes `cursor: undefined`, so the branch cannot
  re-enter), verified over all twelve status scenarios and all six reachable source/cursor
  combinations. `redirect('/login')` still propagates — neither page wraps the recursive call in
  a try/catch. `nextCursor` stays coherent: both Load-more hrefs are built from the *fallback
  response's* cursor, never from `params.cursor`, so pagination works from page one.
- `SOURCE_RE` is character-identical to the API's zod regex plus the same 1–64 bound, so the
  retry can never itself 400 on events; on accounts, `status`/`label` are allowlisted first.
- E2E order-independence confirmed: `playwright.config.ts` sets `fullyParallel: false,
  workers: 1`, the seeder writes zero `discovery_events`, and the matcher writes exactly one
  `match_completed` row with no `before`/`after` — so the `—` assertion is load-bearing against
  the real projection rather than against an assumption.
- Removing the `login` exemption is safe: `auth.spec.ts` genuinely contains
  `page.goto('/login')`, verified by running the regex across all nine specs.
- All four Anti-Deferral entries re-assessed and still holding; neither `audit.ts` nor
  `seed-facts.ts` was touched this round.

### [Adjacent] Minor — the E2E filter spec grows the audit table on every run
The spec labels a seeded account and clears it, but the two audit rows it emits are
**permanently unremovable by design** (C27 revokes DELETE on `discovery_events`). Intended for
an append-only trail, and the label itself is cleaned up, but the accumulation is recorded here
rather than left unnoticed. It falls under SC26 (audit retention), already out of scope.

## Functionality Findings (round 2)

### R2-F1 [Major, continuing] — the `?source=` fix closed the reported case, not the property
The expert's diagnosis is the most useful thing in this round. Round 1's F3 was reported as
"invalid `?source=` renders an error page"; my fix dropped the invalid source, which closes that
reproduction. But the cursor is **filter-bound** — so dropping the source while forwarding the
cursor *creates* the mismatch the API 400s on, and a 400 throws. The error screen the fix exists
to prevent was still reachable by capitalising the source on a real "Load more" link:

```
raw="LABEL"  -> source=undefined, cursor.s=label => 400 -> page THROWS
raw="label"  -> source=label,     cursor.s=label => 200 ok
```

- Action: the cursor is dropped whenever the source is dropped — a position bound to a filter
  that did not survive validation has nothing to resume from.
- Modified: `apps/web/src/app/events/page.tsx:65-73`
- Red-proof: with the cursor forwarded, the new E2E case renders no table at all (the error
  screen); with the fix, 5/5 events specs pass.
- Test: `an invalid source alongside a cursor also falls back instead of erroring`.

### R2-F2 [Minor, new] — untabled 4xx statuses mislabelled as `bad_request`
Measured: a 418 came back as `{"error":"bad_request"}`. No route emits one today, but asserting
"the caller sent a bad request" about a status we have not classified is the same mislabelling
that made the 429 regression invisible.
- Action: unmapped 4xx now falls back to a neutral `'client_error'`.
- Modified: `apps/api/src/app.ts:124-129`

### R2-F3 [Minor, new] — unknown-route 404s bypassed the error handler
Measured: `GET /nope` returned Fastify's default
`{"message":"Route GET:/nope not found","error":"Not Found","statusCode":404}` — unchanged by
the round-1 work, because an unmatched route never reaches `setErrorHandler`. No internals leak,
but it is the one path still shaped differently from every other error.
- Action: added `setNotFoundHandler` sending the flat `{error:'not_found'}`.
- Modified: `apps/api/src/app.ts:136-141`
- Verified the sweeps are unaffected: integration stays 133/133.

### R2-F4 [Minor, continuing — pre-existing on `main`] — a malformed cursor rendered an error page
Confirmed pre-existing on `main` for **both** list pages (`git show main:...` shows the same
`throw`), so not a regression — but in scope under the pre-existing-in-changed-file rule, and
the same class as R2-F1.
- Action: both pages retry once without the cursor on a 400. A stale or hand-edited cursor is an
  unusable position, not a broken page; a genuine failure still throws.
- Modified: `apps/web/src/app/events/page.tsx:18-33`, `apps/web/src/app/accounts/page.tsx:34-45`
- Tests: one case per page (`events.spec.ts`, `accounts.spec.ts`). Verified the accounts cursor
  really 400s on garbage (`z.string().uuid()` at `accounts.ts:20`), so the test is not passing
  for the wrong reason.

### Verified clean by the functionality expert
- F1's `cursor_t` is correct, including `nextCursor` null / empty-page / filter-bound
  interactions. Combined with the calendar check, the accepted domain was measured across 13
  values and is genuinely a subset of Postgres's.
- **F5 is correct for every kind, for a stronger reason than my comment claimed**:
  `projectSyncPayload` can only ever write `counts`/`runId`, so `before`/`after` are
  *unreachable* on a non-audit kind. The expert planted a hostile row storing `before`/`after`
  under an unknown kind and confirmed it still projects to `{"counts":…}` and renders `—`.
- `SourceFilter`'s three values are complete: `sync_failed` also writes `appKey`, but from the
  same table, so it cannot introduce a fourth. `google-workspace` is pinned by
  `z.literal(...)`.
- No contract regression: C18–C27's documented bodies are all sent via explicit `reply.send`
  and never transit the error handler.
- F6's deferral premise ("the two writers agree today") verified rather than taken.

## Testing Findings (round 2)

### TEST-R2-F1 [Major, new] — the page↔spec check matched filenames, not coverage
The expert added `apps/web/src/app/sync/page.tsx` with no spec covering it and the check
**passed** — because `sync.spec.ts` exists by name, while that spec only ever navigates to
`/accounts`. The same hole applied to `auth`, `labeling`, and `session-expiry`. True positives
did work (an uncovered `reports/` page failed correctly), which is what made the gap easy to
miss: the guard I wrote in round 1 to close a prose-only obligation was itself matching a
spelling rather than the property.

I reproduced the exact case before fixing: `sync/page.tsx` present → `EXIT=0`.

- Action: the check now reads every spec's source and requires an actual
  `page.goto('/<route>')`, with a boundary so `/accounts` does not satisfy `/account`. The
  `login` exemption was **removed** as no longer needed — `auth.spec.ts` genuinely navigates
  there, and matching on navigation makes the special case unnecessary. Only the root redirect
  stays exempt.
- Modified: `apps/web/test/page-spec-membership.test.ts:1,17-21,42-64`
- Verified: baseline green; the reviewer's `sync/page.tsx` reproduction now fails with
  `pages no E2E spec navigates to: sync`.

### TEST-R2-F2 [Minor, new] — the audit-guard self-tests did not exercise `normalizeSource`
Measured by the expert: replacing `normalizeSource`'s body with an identity function left **all
four tests green**. The multi-line snippet's DELETE→table gap is 79 characters, well inside the
widened 200-char window, so it matched with or without normalization — the self-tests proved
the pattern fires, not that stripping does anything.

- Action: added a third case where the gap only fits after normalization (comment prose pushes
  the raw distance past the window).
- Modified: `apps/api/test/audit-append-only.test.ts:69-83`
- Red-proof: with `normalizeSource` neutered, that case now fails while the others stay green —
  so normalization is load-bearing for at least one assertion.

### TEST-R2-F3 [Minor, new] — `SourceFilter` shipped with no test at any tier
The component exists precisely because the filter was URL-only, yet `labeling.spec.ts` reaches
`/events?source=label` by direct navigation and would pass with no control on the page at all.

- Action: added three cases to `events.spec.ts` — clicking the control (not navigating to the
  URL), the `SOURCE_RE` fallback rendering normally for `?source=<script>`, and the non-audit
  row case below.
- Modified: `e2e/specs/events.spec.ts:1-2,28-74,95-102`
- Note on fixture independence: the seeder writes **no** `discovery_events`, so a spec asserting
  on label or matcher rows would pass or fail by spec order. The filter test now creates its own
  audit event via the API and clears it in `finally`; the matcher test runs matching first.
  A first draft of the filter assertion tolerated an empty page, which would have passed
  vacuously — corrected to require a non-empty result.

### TEST-R2-F4 [Minor, new] — `auditTransition`'s changed discriminator was unpinned
The round-1 F5 fix switched it from a kind allowlist to `before/after === undefined`. The
positive case was covered (`labeling.spec.ts` asserts `none → Known shared`); the negative half
was not.

- Action: `a non-audit row renders no label transition` asserts a matcher row renders `—`.
- Modified: `e2e/specs/events.spec.ts:76-93`

### Verified by the testing expert through executed mutation
- **T-L9 exact route list**: dumped `apiRoutes` from the live `onRoute` hook — 21 entries,
  byte-identical to the assertion; commenting out the bulk route registration drops it to 20 and
  fails. It cannot pass another way.
- **Microsecond fixture**: boundary independently re-derived at positions 50/51.
- **Four hostile-timestamp cases**: reverting the decoder fails exactly those four and no others.
- **C20 ordering proxy**: `toISOString` is fixed-width for years 1–9999 so lexicographic equals
  chronological, and `|` (0x7C) exceeds every UUID character, so the composite key cannot be
  confused across the separator.
- **`exact: true` in `apps.spec.ts`**: a correct disambiguation, not a symptom mask — once the
  confirm panel opens, "Google Workspace" genuinely appears in two cells.
- Round-1 F7's deferral assessed and **concurred with**.

### [Adjacent] Major — stray `wt/` worktree broke the integration gate
My round-1 red-proofing worktree was created inside the repo root instead of the scratchpad.
Vitest collected it, so `pnpm test:integration` exited 1 with five `Cannot find package`
failures while all 133 real tests passed — a gate reporting red for a reason unrelated to the
branch, and the same class as the round-1 `zzproj.test.ts` incident. Removed; the gate is back
to 5 files / 133 passed. Red-proofing worktrees belong under the scratchpad, which is where the
other three this session were created.

---

# Round 1

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
