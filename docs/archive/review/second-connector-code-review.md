# Code Review: second-connector (SC2 / C1, C2, C3)

> Rounds 1-5 below were recorded across six commits; rounds 2-5 had been left in
> commit bodies only and are restored here in round 6, which is itself a finding
> about this loop's own record-keeping (step 3-4 requires each round's findings
> and resolutions in this file).

Date: 2026-08-02
Review rounds: 6 (of a 10-round limit)
Range reviewed: `02a6106..2ffa769` — PRs #39, #40, #41

## Changes from Previous Round

Initial review. **These three PRs were merged without the Phase 2 Step 2-5
self-R-check**, so this round is first-pass discovery rather than incremental
verification. The sibling PR (#42) received both a 2-5 pass and a Phase 3 pass;
this is the retrospective equivalent for the three before it.

Pre-screening: Ollama returned `No findings` for functionality and security, and
four findings for testing — one of which (the untested `catalog_full` ceiling)
the Testing expert verified and escalated to Critical.

## Convergence

Three findings were reached independently by more than one expert. Per
"Perspective Convergence as a Severity Signal", each takes the higher floor.

| Issue | Experts | Floor |
|---|---|---|
| Slack `WebClient` constructed with SDK defaults | Functionality F1, Security SEC-1, Testing F5/A1 | **Major**, and the only finding with an unbounded blast radius |
| `rejectCredentials` falls through for any non-Google key | Functionality F2, Security SEC-3 + SEC-5 (adjacent) | **Major** |
| The 429 test asserts a shape the real client cannot produce | Functionality F8 (adjacent), Testing F5 | **Major** |

## Functionality Findings

- **F1 [Major]** `packages/connectors/slack/src/index.ts:258` — `new WebClient(token)`
  with no options. Verified against the installed SDK: `retryConfig =
  tenRetriesInAboutThirtyMinutes`, `rejectRateLimitedCalls = false`,
  `timeout = 0`. The connector's stated `MAX_ATTEMPTS = 5` therefore sits ON TOP
  of 10 SDK retries (~55 HTTP attempts, hours of wall clock per page), and
  `kind: 'rate_limit'` is unreachable — a 429 is absorbed by the SDK and
  re-thrown as a bare `Error` with no `statusCode`, no `data.error` and no
  `retryAfter`, so all three arms of `isRateLimited` miss it and it reports as
  `transient`. The intent is legible: `'retryAfter' in error` matches
  `WebAPIRateLimitedError`, the shape produced ONLY under
  `rejectRateLimitedCalls: true`.
- **F2 [Major]** `apps/web/src/lib/connector-credentials.ts:93-97` —
  `rejectCredentials` is an `if/else`, not a dispatch, so every non-Google key
  is validated as a Slack bot token. Reachable today: `seed.ts` seeds
  `'notion'`, rendered through `SaasAppManager`; its Replace-credentials panel
  renders ZERO inputs and Save reports *"That does not look like a bot token."*
  A dead panel with an error naming an unrelated connector. The file's own
  header argues for `Record<ConnectorAppKey, …>` "and not a lookup with a
  fallback" — `CREDENTIAL_FIELDS` honours it; this function does not.
- **F3 [Major]** `apps/web/src/components/SaasAppManager.tsx:247-269` —
  `CredentialField.required` is applied in `SaasAppForm` and not here, and the
  replace flow deliberately sends every declared field including blanks. An
  operator who pastes a service account and leaves the admin email empty stores
  a blank required credential; the failure surfaces only as a
  `discovery_events` row.
- **F4 [Major]** `apps/web/src/components/SaasAppForm.tsx:47` — `catalogFull`
  maps to *"Registration failed. Please try again."*, the same string as
  `unknown`. Retrying can never succeed at the ceiling, and the actual recovery
  (delete an unused application) is never stated. C3's stated reason for reading
  the discriminant was actionable copy; the code reads it and discards it.
- **F5 [Minor]** `apps/web/src/lib/i18n/messages.ts:243,465` —
  `saasapp.connector` added to both dictionaries, referenced nowhere.
- **F6 [Minor]** `apps/web/test/untranslated-literals.ts:42` — the
  `'google-workspace'` allowlist entry survives the literal it was written for.
- **F7 [Major, adjacent]** `e2e/specs/apps.spec.ts:38-47` — `getByLabel`'s string
  form is a case-insensitive SUBSTRING match, and the manager's replace labels
  are "New service account JSON" / "New bot token". The `toHaveCount(0)`
  assertions are green only because every manager panel is idle on load.
- **F8 [Major, adjacent]** the 429 test cell — see Testing F5.

## Security Findings

- **SEC-1 [Major]** — the same `WebClient` defaults as F1, read for blast
  radius: `timeout: 0` means a single request can hang indefinitely, and all of
  it runs INSIDE the `withTenant` transaction (`sync.ts:91` opens it, `:125`
  iterates the connector inside). `sync.ts:119` passes
  `new AbortController().signal` — a signal nothing ever aborts — so the
  connector's own `ctx.signal.aborted` check is inert. No `statement_timeout` or
  `idle_in_transaction_session_timeout` anywhere in the repo. One tenant's
  blackholed workspace holds a pooled connection and an idle-in-transaction
  session for hours, and the sync worker's `concurrency: 1` stalls the queue for
  every other tenant.
- **SEC-2 [Major, R49]** `packages/connectors/slack/src/index.ts:181-184` — the
  comment says the fixed-string property "here it is asserted". The test asserts
  the message is clean AND **pins the token into `error.cause`**
  (`list-users.test.ts:230`). A replayable bearer credential now crosses a
  package boundary inside every auth/transient error, and the only thing
  preventing disclosure is that every downstream consumer happens to use
  `String(error)`. `console.error(msg, { error })` — the spelling the `Logger`
  interface's `meta?: Record<string, unknown>` invites — inspects the cause chain
  verbatim.
- **SEC-3 [Minor]** — `rejectCredentials` fallthrough, see F2.
- **SEC-4 [Minor, R49]** `apps/api/test/saas-app-key-pin.test.ts:27` — a
  CONTROL_FILES member whose header still says *"POST /saas-apps still pins its
  zod field to the one literal"* after the enum widening. Its prose IS the
  control's specification.

**Verified clean**: the reserved-source property holds (write-path set derived
independently: exactly three, `PATCH` is `.strict()` with no `key`); the
module-init guard is reachable on every API boot; tenant isolation and the
advisory-lock key; `narrowRaw` genuinely drops the unmapped PII; RS2, RS3, RS4,
R42, R43, R47, RT7, RT10. No Critical, no escalations.

## Testing Findings

Every finding below was **proved by mutation**, tree restored.

- **F1 [Critical]** `apps/api/src/routes/saas-apps.ts:102` — the 409
  `catalog_full` ceiling, PR #39's headline control, has **zero executable
  coverage on any tier**. `grep -rn catalog_full` returns the `reply.code(409)`
  and the web mapping, nothing else. The asymmetry is the evidence: the sibling
  ceiling on the import route has both a limit test and a two-transaction
  advisory-lock acceptance test; the sibling 409 on this same route has its own
  describe block. RT8 also requires asserting no row was inserted.
- **F2 [Major]** `list-users.test.ts:59` — `toEqual` treats an
  `undefined`-valued key as absent, so **M11** (deleting `is_app_user`,
  `is_restricted`, `is_ultra_restricted` from `narrowRaw`) passes 13/13 — the
  exact three fields whose retention the source comment justifies.
  `toStrictEqual` reds it.
- **F3 [Major]** `connector-credentials.test.ts:54` — the declared-name set is
  flattened across connectors, so the per-key association is unpinned. **M6**
  (move `botToken` into the Google array, leaving `slack: []`) passes all 14
  while the Slack form renders no inputs and posts `credentials: {}` — the exact
  failure the file's header says it exists to prevent.
- **F4 [Major]** `connector-credentials.test.ts:52` — the anti-vacuity guard is a
  GLOBAL floor. **M7** (`const { botToken } = credentials` — a routine
  refactor) passes all 14 with the Slack side of the detector matching nothing,
  in exactly the state the guard's own message describes.
- **F5 [Major]** `slack/src/index.ts:195,209` — **M1** (force `kind` to
  `'transient'`) and **M2** (`sleep(0)`) both pass 13/13. `sleep` is asserted by
  call count only, never by argument, so the backoff schedule is untested.
- **F6 [Major]** `connector-registry.test.ts:39` — "builds a connector for every
  key it claims" never builds one. **M5** (make `buildSlackConnector` throw)
  leaves all three tests green.
- **F7 [Minor]** — **M3** (`PAGE_SIZE` 200→1) and **M4** (delete the
  `ctx.signal.aborted` guard) both pass 13/13.
- **F8 [Minor]** `list-users.test.ts:32` — `as unknown as` on the JSON fixtures
  disables the only available drift check against the SDK.
- **F9 [Minor]** — `saasapp.connector` orphan key, see Functionality F5.

**Rejected seeds**: the `saas-app-key-pin.test.ts` regex-brittleness concern —
that file compensates deliberately and provably (**M8**: `z.enum` → `z.string()`
reds 6 tests including the degradation cell). The uncompensated regex is
`connector-credentials.test.ts:50`, adopted as F4.

**CI integration clean**: canonical test script byte-identical, `vitest`
declared, `tsconfig` includes `test`, Dockerfile COPY present, both new
CONTROL_FILES listed by hand (correctly — both are family (b)).

## Recurring Issue Check

The dominant pattern is **RT7, four times**, and it is the same shape each time:
a test whose COMMENT states the property correctly and whose ASSERTION is one
abstraction level too coarse to see it — a flattened set, an
undefined-tolerant equality, a global floor, existence rather than invocation.

## Resolution Status

All Critical and Major findings fixed. Round 1 closed.

### Testing F1 [Critical] — the `catalog_full` ceiling had no coverage on any tier
- Action: three acceptance tests in `apps/api/test/api.integration.test.ts` —
  refusal at the ceiling asserting BOTH the 409 body and that no row was
  inserted (RT8), the allow case landing exactly ON the ceiling (RT10), and the
  duplicate-at-the-ceiling case.
- **Writing the third one found a defect.** The ceiling was read before the
  duplicate, so re-registering a key the tenant already held reported
  `catalog_full` and sent the operator to delete an application when what they
  had was a key in use. The duplicate is decided first now, under the same
  advisory lock — not a TOCTOU, because the lock serialises catalog growth for
  the tenant.
- Modified: `apps/api/src/routes/saas-apps.ts:60-90`, `apps/api/test/api.integration.test.ts:1702`

### F1 / SEC-1 [Major, 3-way convergence] — Slack client on SDK defaults
- Action: `retryConfig: { retries: 0 }`, `rejectRateLimitedCalls: true`,
  `timeout: REQUEST_TIMEOUT_MS`. `sync.ts` now supplies
  `AbortSignal.timeout(SYNC_DEADLINE_MS)` instead of a signal nothing aborts.
  `Retry-After` is obeyed, not merely read to classify.
- Modified: `packages/connectors/slack/src/index.ts`, `apps/worker/src/sync.ts`

### SEC-2 [Major] — the bot token was pinned into `error.cause` by a test
- Action: `cause` is a `diagnose()` projection — classification fields plus a
  message with the secret removed. The test now asserts the token is absent from
  the serialized cause AND that the diagnosis survived, so the fix cannot be
  satisfied by discarding it.
- Modified: `packages/connectors/slack/src/index.ts`, `packages/connectors/slack/test/list-users.test.ts:226`

### F2 / SEC-3 / SEC-5 [Major] — `rejectCredentials` fell through
- Action: `Record<ConnectorAppKey, …>`, matching `CREDENTIAL_FIELDS`. A key with
  no rejector returns `null` rather than Slack's check, and `SaasAppManager`
  HIDES the Replace-credentials control when the connector declares no fields —
  the seeded `notion` app had a dead panel reporting "That does not look like a
  bot token".
- Modified: `apps/web/src/lib/connector-credentials.ts`, `apps/web/src/components/SaasAppManager.tsx`

### F3 [Major] — `required` honoured on one of two surfaces
- Action: the manager checks every declared required field before sending, and
  passes `required` to the rendered inputs.
- Modified: `apps/web/src/components/SaasAppManager.tsx`

### F4 [Major] — `catalog_full` told the operator to retry
- Action: `saasapp.catalogFull` in both locales, naming the recovery that works.
- Modified: `apps/web/src/lib/i18n/messages.ts`, `apps/web/src/components/SaasAppForm.tsx:47`

### Testing F2, F3, F4, F6, F7 [Major/Minor] — five tests that could not fail
- Action: `toStrictEqual`; per-connector credential-name assertion located
  through the registry entry with a per-connector anti-vacuity floor; the
  registry test CALLS each factory and checks the built connector, with a paired
  deny case; `limit` asserted; an abort case added; a rate-limit classification
  case and a backoff-duration assertion added.

### F7 [Major] — `getByLabel` substring collision
- Action: `{ exact: true }` on every label query in the new specs. The manager's
  "New bot token" / "New service account JSON" labels contain the searched text.
- Modified: `e2e/specs/apps.spec.ts`

### F5 / F9, F6, SEC-4 [Minor] — records that had stopped being true
- Action: orphan `saasapp.connector` removed from both locales; the
  `'google-workspace'` allowlist entry removed with the literal it covered gone;
  the CONTROL_FILE header rewritten from "the one literal" to what the control
  now asserts.

### F8 [Minor] — fixture casts disabled the drift check
- Action: `as unknown as` replaced with annotations, restoring the compile error
  an upstream `@slack/web-api` rename would produce.

## Round mutations

Fourteen run, thirteen red, one declared survivor.

| mutation | result |
|---|---|
| the SDK retry layer comes back | SURVIVED (declared — the injected `usersList` bypasses `WebClient` entirely, so no unit test can observe its construction options. The only observer would be a test that constructs the real client and inspects it, which asserts about the SDK rather than about this connector. Recorded rather than papered over.) |
| rate limits stop being classified as rate limits | reds |
| the provider-mandated wait is ignored again | reds |
| a stray `retryAfter` property classifies as a rate limit | reds |
| the token is carried into the cause again | reds |
| `narrowRaw` drops the classification flags | reds |
| the page size moves | reds |
| the abort guard is removed | reds |
| a connector key loses its rejector | reds |
| the worker reads a credential under a different name | reds |
| a factory stops rejecting credentials it cannot use | reds |
| the ceiling is read before the duplicate again | reds |
| the ceiling refuses the registration that lands on it | reds |
| the ceiling stops refusing at all | reds |

## Termination

Round 1 closed: every Critical and Major finding fixed, each fix mutation-proved
except the one declared survivor above. Suite state: unit 562 (42 files),
integration 232, E2E 60, lint / typecheck / build clean, CI-only
typecheck-program gate clean, `assert-seed-preserved.sh` green against the live
stack.

---

# Round 2 — Major 12 / Minor 10

Recorded from commit `bea0c54`, which was this round's only record until round 6.

Three findings were caused by Round 1's own fixes, which is why the round existed.

**Regressions from Round 1.** Setting `retries: 0` on the Slack client moved a
whole error class to a classifier that did not recognise it: `WebAPIRequestError`
— every socket failure, and every one of the 30-second timeouts the same fix
added — carries no `statusCode`, no `data.error` and no `retryAfter`, so it was
retried by NOTHING. Not the SDK, not `withRetry`, not BullMQ, whose sync job runs
`attempts: 1`. One slow response became a terminal sync failure. Honouring
`Retry-After` made an unbounded provider-supplied number authoritative INSIDE the
open sync transaction: `retry-after: 2000000` would have held a pooled
connection, an idle-in-transaction session and a live credential buffer for
weeks — the blast radius Round 1 closed, re-opened through an input Round 1 made
authoritative.

**R3 twice.** `token-audit.ts` still had the never-firing `AbortController`
signal that `sync.ts` was fixed for, and it never zeroized its decrypted
credentials. The google-workspace connector still put the raw provider error in
`cause`, and the Slack fix had DELETED the comment recording that gap.

**Eight more mutation-proved tests that could not fail**, including the mutation
this repository had DECLARED a survivor — refutable in fifteen lines.

## Resolution
Transport error class added with a red-proving test; `Retry-After` clamped and
made abort-aware; `diagnose` hoisted into `connectors-core`; the orphan-message-key
class detected rather than fixed by hand.

---

# Round 3 — ~10 findings

Recorded from commit `fe32732`.

**The orphan-key detector written in Round 2 was a tautology.** It scanned
`apps/web/src`, which CONTAINS the dictionary, so `code.includes("'key'")` was
true by construction and `orphans` was always empty. It was written to close the
class it then failed to detect, and had been registered in `CONTROL_FILES` on
that premise.

**`sync.ts` zeroed a copy.** `Buffer.from(decryptCredentials(...))` allocated a
second buffer, so the `finally` cleared only that one and the plaintext
service-account document lived for the life of the process. Round 2 had cited
this function as the correct sibling while closing the credential-buffer class.

**`diagnose` was hoisted without being widened.** It read `statusCode` and
`data.error` — Slack's spellings — so every Google diagnosis came out
`{statusCode: undefined, platformError: undefined}`. The secret passed was the
whole service-account JSON, a needle no error message contains, making the scrub
a guaranteed no-op on that path.

**`waitUnlessAborted` did not bound the wait.** Checking the signal either side
of a bare `setTimeout` ends the run one full wait later; it does not shorten it.
It is a `Promise.race` now, in `connectors-core`.

---

# Round 4 — ~10 findings

Recorded from commit `9a53d84`. The round's character changed: mostly "the fix
has no observer" rather than "the fix is wrong".

**The third member of a class declared closed twice.** `rotate-credentials.ts`
did `Buffer.from(plaintext).fill(0)` — the exact construct removed from
`sync.ts` one round earlier, in the same app, against the same helper. It is the
worst of the three: rotation never stringifies the credential, so that buffer is
the ONLY plaintext holder on the path, and the sweep decrypts every tenant's
every stale credential in one process.

`diagnose` still dropped googleapis' canonical shape: a NUMERIC `code`. The
`privateKey()` correction overstated too — the PEM is not what a googleapis error
carries. Dead code was presented as guards: the required-blank guard in
`SaasAppManager` was unreachable for every connector, as was the post-sleep abort
re-check in `waitUnlessAborted`.

---

# Round 5 — ~7 findings

Recorded from commit `0af8d4e`.

**The three call-site fixes were all defeated in one place.** `decryptCredentials`
ended with `Buffer.concat([decipher.update(x), decipher.final()])`. For
AES-256-GCM `update` returns the entire plaintext and `final` returns nothing, so
the concat allocated a third buffer and left the first holding a complete copy.
Zeroing the returned buffer — which `sync.ts`, `token-audit.ts` and
`rotate-credentials.ts` were each taught to do across three consecutive rounds —
cleared the copy and not the original.

**And it had no control at all.** Nothing anywhere asserted zeroization: all
three `.fill(0)` lines could be deleted with every suite green.
`packages/crypto/test/zeroization.test.ts` was added, red-proven.

Two more controls that could not fail were repaired: the invariant licensing the
deleted required-blank guard filled every non-target field with `'placeholder'`
(unparseable JSON), so the service-account arm short-circuited and the email arm
was never reached; and the `AbortSignal.any` test asserted only facts that were
also true under the `??` form it was written to reject.

---

# Round 6 — Critical 2 / Major 11 / Minor 9

Date: 2026-08-02. Reviewed: `git show 0af8d4e` as the primary diff and
`git diff main...HEAD` (28 files) as the secondary.

## Changes from Previous Round

Round 5 fixed the credential-zeroing primitive and added the class's first
control. Round 6 found that fix open on its error path, and the control's own
subject one level narrower than its caption. It also found that three patterns
fixed on the Slack side in rounds 1-2 were never propagated to the Google
connector, and that the API had no server-side credential validation at all.

## Convergence

| Issue | Experts | Floor |
|---|---|---|
| `decryptCredentials` retains the full plaintext when `final()` throws | Functionality F1, Security SEC-R6-1 | **Critical** (Security escalated: `escalate: true`) |
| `zeroization.test.ts` unregistered in `CONTROL_FILES` | Security SEC-R6-3 (Major), Testing T13 (Minor) | **Major** |
| The credential record is unbounded and the "the API validates" claim is false | Functionality F4 (Major), Security SEC-R6-7 (Minor) | **Major** |

## Functionality Findings

- **F1 [Critical]** `packages/crypto/src/index.ts:136-141` — no `try`/`finally`
  around `update`/`final`. GCM authenticates in `final()`, which throws, and by
  then `update()` has returned the GENUINE plaintext — CTR-mode decryption
  happens before authentication. `rotate-credentials.ts:100-107` catches per row
  and continues the sweep, so a version-skewed rollout leaves one uncleared
  credential per failed row resident for the process's life. Neither case in the
  new `zeroization.test.ts` exercises a throw.
- **F2 [Major]** `packages/connectors/core/src/index.ts:125-131` — both
  `platformError` arms require `typeof … === 'string'`. A googleapis failure
  carries an OBJECT; gaxios' own extractor takes the same two branches
  (`gaxios@7.3.0/build/esm/src/common.js:151,158`). Every real Google diagnosis
  was `platformError: undefined`. It survived three rounds because
  `diagnose.test.ts:44` fixtured a Slack-shaped body under a Google envelope —
  a payload googleapis cannot produce.
- **F3 [Major]** `packages/connectors/google-workspace/src/index.ts` — the
  connector was still on the SDK defaults. `googleapis-common` sets
  `options.retry = true` unless asked (`apirequest.js:260`), arming gaxios' own
  3-retry interceptor UNDER `withRetry`, so `MAX_ATTEMPTS = 5` was really ~20
  requests with two backoff schedules stacked; gaxios applies a timeout only when
  supplied, so there was none; and `ctx.signal` never reached the SDK, so the
  run deadline only fired between pages. All three are verbatim the findings the
  Slack client was fixed for in rounds 1-2 and documented in a 20-line comment.
- **F4 [Major]** `apps/api/src/routes/saas-apps.ts` — `credentials` was
  `z.record(z.string(), z.string())` with no field check, so
  `PATCH {"credentials":{}}` encrypted an empty object over the working
  credential and returned 200, with no prior copy. `POST` had the mirror shape.
  Two integration fixtures were themselves registering google-workspace apps
  with no `impersonateAdminEmail` — the exact "registers fine, cannot sync"
  state, which the worker factory rejects.
- **F5 [Minor]** — the admin email was decided by two adjudicators: the browser's
  WHATWG check on the register form (inside a real `<form>`) and
  `rejectAdminEmail` on the manager (outside one). `admin@corp_internal` was
  accepted on one surface and rejected on the other (R48, strict direction).

## Security Findings

- **SEC-R6-1 [Critical, escalate: true]** — same as F1, read for blast radius.
  Measured on Node v26.5.0: both a tampered tag and a wrong AAD leave the real
  plaintext in `head`. Attacker-reachable variant: anyone able to write
  `saas_apps.credentials_enc` can force `final()` to throw on demand and grow the
  count of resident plaintexts ahead of a memory dump.
- **SEC-R6-2 [Major]** `packages/crypto/src/index.ts:27,34` —
  `parseEncryptionKeys` interpolated the raw entry into its error. The two
  likeliest operator mistakes both make the offending text the KEY ITSELF
  (omitting the `1:` prefix; transposing to `<key>:1`, which base64 cannot
  truncate). Every caller runs it unguarded at boot, and stderr ships to the log
  aggregator. The repository's own test exercises the leaking branch.
- **SEC-R6-3 [Major]** — `packages/crypto/test/zeroization.test.ts` was the only
  assertion of the zeroization invariant and was not in `CONTROL_FILES`; it reads
  no repository files, so the family-(a) addition-guard is structurally blind to
  it. Deleting it leaves every gate green.
- **SEC-R6-4 [Major]** `packages/connectors/google-workspace/src/index.ts:202` —
  `privateKey()` ran per `withRetry` invocation, each time `JSON.parse`-ing the
  document and minting a fresh JS string holding the PEM. Strings cannot be
  zeroized at any level. One audit run of a 1 000-seat tenant leaves up to 1 000
  permanently-unclearable copies of the highest-value secret in the system,
  undoing five rounds of buffer narrowing.
- **SEC-R6-5 [Major, R49]** — "this is the whole class" derived membership from
  the `createDecipheriv` CALL rather than from the DEFECT. Re-derived, the class
  also holds the encrypt-side input buffers at `saas-apps.ts:57,209` and
  `seed.ts:318`. Major and not Critical precisely because the surrounding strings
  are unzeroizable anyway — which is why the overstatement, not the code, is the
  finding.
- **SEC-R6-6 [Minor]** `apps/web/src/lib/connector-credentials.ts:119` —
  `rejectCredentials(key: string)` indexed an object literal, so `constructor`,
  `toString` and `valueOf` resolved through `Object.prototype` and were called.
  `app.key` is tenant-supplied DB text (`POST /contract-import` writes it from a
  CSV cell).
- **SEC-R6-7 [Minor, RS3]** — no size or cardinality bound on the credential
  record.

## Testing Findings

- **T1 [Critical]** — the three call-site `.fill(0)` lines named by Round 5's own
  commit message STILL had no observer. `zeroization.test.ts` watched the
  cipher's intermediates, not the buffer `decryptCredentials` returns.
  `grep -rn "fill(0)\|zeroiz" apps/worker/test apps/api/test` returned nothing.
  Deleting `rotate-credentials.ts:84` left every suite green.
- **T2 [Major]** `sync.integration.test.ts:262` — the deadline cell repaired in
  Round 5 distinguished only "the connector did not receive the caller's signal".
  `AbortSignal.any([deps.signal])` — the deadline removed — kept it green.
- **T3 [Major]** — `runTokenAudit` had no counterpart cell at all, on the
  longer-running of the two jobs.
- **T4 [Major]** `google-workspace/src/index.ts:148` — the retries-exhausted
  `cause: diagnose(...)` site had no observer; every Google cell asserting on
  `cause` reached the auth site instead. Round 2 recorded this defect verbatim
  and closed it on the Slack side only.
- **T5 [Major]** — Google's sleep mocks were declared `vi.fn(async () => {})`,
  structurally incapable of observing the backoff. `sleep(0)` — a hot loop of
  five immediate requests inside the open transaction — was green.
- **T6 [Major]** `diagnose.test.ts:117` — the listener-removal cell pinned the
  call count but not the listener identity, and the rejection-path removal had no
  case at all.
- **T7-T12 [Minor]** — `zeroization.test.ts`'s second cell had no failing state;
  two module-level fixtures reset inside test bodies rather than hooks;
  `FakeConnector.lastSignal` never reset; `privateKey()`'s catch arm unobserved;
  `factoryBody`'s end-of-body locator with no non-vacuity check; `mockClear()` in
  a test body.
- **T13 [Minor]** — see SEC-R6-3.
- **T14 [Minor, adjacent]** — `required={field.required}` added to manager inputs
  the same diff documents as inert (no `<form>`, `type="button"`): a guard with
  no failing state.

## Seed Finding Disposition

Ollama returned `No findings` for functionality and security — treated with
higher scrutiny per the seed trust advisory, since the diff changes a
cryptographic primitive; both experts recorded independent checks. For testing,
three seeds: one adopted downgraded (T9 — the static reproduces, the flakiness
claim does not: vitest runs cells in a file sequentially and no `it.concurrent`
exists anywhere), two rejected with an adjacent real finding adopted in place of
one (T11). The third seed's direction was inverted relative to the actual
Round 3/4 defect; measured against all 187 `en` keys, the current detector has
0 comment-only credits and 0 orphans.

## Recurring Issue Check

The dominant patterns are **R3** (three separate Slack-side fixes never
propagated to Google — T3, T4, T5, F3) and **R42 ①b applied to the wrong
primitive**: Round 5 correctly re-derived the class from `createDecipheriv`, but
the defect's primitive is "an exit that leaves plaintext", and that function has
two exits. **R49** fired three times (F1's closure claim, F2's "BOTH SHAPES",
F4's "the API validates").

## Resolution Status — Round 6

### F1 / SEC-R6-1 [Critical, 2-way convergence, escalated] — the throw path kept the plaintext
- Action: `try { head = update(...); tail = final(); return concat } finally { head?.fill(0); tail?.fill(0) }`.
  A red-proven case tampers the auth tag, asserts the rejection, and asserts every
  captured intermediate is zero — with its own non-vacuity check that a buffer at
  least as long as the secret was produced before the rejection, so a cleared
  secret is not confused with an empty one.
- Modified: `packages/crypto/src/index.ts:136`, `packages/crypto/test/zeroization.test.ts`

### T1 [Critical] — the three call-site zeroization lines still had no observer
- Action: the class is closed by CONSTRUCTION rather than by a fourth assertion.
  `withDecryptedCredentials(blob, version, ctx, keys, use)` decrypts, lends the
  plaintext, and zeroes it in a `finally` however `use` ends; `sync.ts`,
  `token-audit.ts` and `rotate-credentials.ts` all go through it and none of them
  owns a `.fill(0)` any more.
- **The convergence artifact required by step 3-8 for a class that expanded ≥2×**:
  `zeroization.test.ts` now enumerates the class mechanically — it scans
  `apps/{api,web,worker}/src` and reds if any production module calls
  `decryptCredentials` directly. Reading repository files makes the file family (a),
  so `package-test-parity.test.ts`'s addition-guard sees it; it is ALSO listed by
  hand, because that guard cannot see a deletion.
- Modified: `packages/crypto/src/index.ts`, `apps/worker/src/{sync,token-audit,rotate-credentials}.ts`,
  `packages/crypto/test/zeroization.test.ts`, `apps/api/test/package-test-parity.test.ts`

### SEC-R6-3 / T13 [Major] — the only zeroization control was unregistered
- Action: listed in `CONTROL_FILES`; and, per the above, it is now family (a) so
  the mechanical addition-guard covers the same shape in future.

### F2 [Major] — `platformError` was unreachable for every real googleapis error
- Action: an object arm reading `.status` (AIP-193) then `errors[0].reason` (the
  classic Admin SDK body directory_v1 returns), scrubbed like the rest. The
  fixture that hid it is replaced by two cells carrying shapes googleapis
  actually produces.
- Modified: `packages/connectors/core/src/index.ts:122`, `packages/connectors/core/test/diagnose.test.ts`

### F3 [Major] — the Google connector was still on the SDK defaults
- Action: `retry: false`, `timeout: REQUEST_TIMEOUT_MS`, and `signal` forwarded
  per request; `REQUEST_TIMEOUT_MS` hoisted to `connectors-core` beside
  `diagnose`/`waitUnlessAborted` rather than declared twice (R1/R2). The seam now
  takes a second `GoogleRequestOptions` argument so `ctx.signal` reaches gaxios.
  `packages/connectors/google-workspace/test/client-options.test.ts` is the
  sibling of the Slack file written in round 2, and it drives BOTH clients —
  they are built separately, so an option applied to one is not applied to the
  other.
- Modified: `packages/connectors/{core,slack,google-workspace}/src/index.ts`, new `google-workspace/test/client-options.test.ts`

### F4 / SEC-R6-7 [Major] — the API accepted `credentials: {}` and overwrote a working credential
- Action: `REQUIRED_CREDENTIAL_FIELDS` in the route, a `Record<ConnectorAppKey, …>`
  so a new connector without an entry is a compile error; `POST` and `PATCH` both
  refuse a blank required field with 400 `invalid_credentials`, the PATCH check
  throwing inside the transaction so a rename in the same body rolls back with it.
  `credentials` is bounded: key ≤ 64 chars, value ≤ 16 KiB, ≤ 16 fields.
  `@open-smp/api-types` cannot host the shared declaration — C39 permits only
  frozen string arrays and `is*` guards — so the agreement between the API and
  the form is pinned in `apps/web/test/connector-credentials.test.ts`, which was
  already the family-(b) control for this contract's other two ends.
- Deny AND allow sides asserted (RT8/RT10): three refusal cells assert the 400
  **and that the stored blob is byte-identical**, plus the partial-write cell.
- Two integration fixtures were themselves registering google-workspace apps with
  no `impersonateAdminEmail` — completed rather than exempted, because the worker
  factory rejects that pair.
- Modified: `apps/api/src/routes/saas-apps.ts`, `apps/api/test/api.integration.test.ts`, `apps/web/test/connector-credentials.test.ts`

### SEC-R6-2 [Major] — the master key could reach boot logs
- Action: the errors name the entry's INDEX and the expected shape, never the
  entry or any prefix of it.
- Modified: `packages/crypto/src/index.ts:19-40`

### SEC-R6-4 [Major] — a fresh unzeroizable PEM per request
- Action: `privateKey()` memoized on the instance. It cannot go below one copy
  without abandoning the scrub, and one is what the surrounding design already
  accepts.
- Modified: `packages/connectors/google-workspace/src/index.ts:202`

### SEC-R6-5 [Major, R49] — the closure claim was wider than the fix
- Action: both. The comment now says it closes the DECRYPT half and names the
  remaining members, and the encrypt-side buffers at `saas-apps.ts` are zeroed in
  a `finally` — stated as defence in depth, since the surrounding
  `JSON.stringify` result is an unzeroizable string.

### T2, T3 [Major] — the deadline had no observer on either job
- Action: `AbortSignal.timeout` is spied (passthrough by default), so one cell
  asserts the deadline was composed with the right constant and another makes it
  fire and asserts the run ends while the caller's signal stays unaborted.
  `runTokenAudit` gained the counterpart cell it never had.
- Modified: `apps/worker/src/{sync,token-audit}.ts` (constants exported), `apps/worker/test/{sync,token-audit}.integration.test.ts`

### T4, T5 [Major] — Google's second throw site and its backoff
- Action: the retries-exhausted cell now asserts the cause is a scrubbed
  projection carrying `statusCode: 500`, and the sleep mock takes a parameter so
  the schedule is asserted by argument rather than by call count.

### T6 [Major] — the listener-removal cell
- Action: `addEventListener` is spied alongside `removeEventListener` and the
  identities are compared pairwise; the rejection path gained its own cell.

### F5, SEC-R6-6, T7-T12, T14 [Minor] — applied
- One adjudicator for the admin email (`type="email"` dropped, `inputMode`
  retained); `Object.hasOwn` before the rejector lookup; the second zeroization
  cell replaced by two that observe `withDecryptedCredentials` on its return AND
  throw paths; `beforeEach` hooks for `captured`, `FakeConnector.lastSignal` and
  `construct`; a cell for `privateKey()`'s catch arm asserting a `ConnectorError`
  rather than a `SyntaxError`; a truncation guard on `factoryBody`;
  `required` → `aria-required` on the manager's inert inputs.

### Process finding — rounds 2-5 were never written to this file
- Action: restored above from the commit bodies. Step 3-4 requires each round's
  findings here; four rounds of this loop existed only in `git log`.

## Round 6 verification

typecheck 0 / lint 0 / **863 tests passed** (622 unit, 241 integration; was
603/235) / build 0 / **E2E 62 passed** / seed-preservation gate 0.

### Round 6 mutations

Seventeen run, **seventeen red, no survivors**. One probe initially reported a
survivor and the probe was wrong, not the guard: the class-enumeration cell looks
for a CALL and the mutation only rebound the name. Re-run with a real call, it
reds.

| mutation | result |
|---|---|
| the throw path stops zeroing the intermediates again | reds |
| the helper stops zeroing the plaintext it lends | reds |
| a fourth call site decrypts without the helper | reds |
| platformError goes back to string-only | reds |
| the Google client goes back to the SDK retry default | reds |
| the Google client loses its request timeout | reds |
| the run signal stops reaching the Google SDK | reds |
| the retries-exhausted throw carries the raw provider error again | reds |
| the Google backoff collapses to a hot loop | reds |
| the private key is re-parsed per request again | reds |
| the sync deadline is removed from the composite | reds |
| the token-audit deadline collapses to the `??` form | reds |
| the API stops refusing a blank required credential | reds |
| the master key goes back into the ENCRYPTION_KEYS error | reds |
| the rejector lookup resolves through Object.prototype again | reds |
| `waitUnlessAborted` removes some other listener | reds |
| `waitUnlessAborted` leaks the listener on the rejection path | reds |

Writing the spec found three fixes with no observer at all — the round's own work
exhibiting the defect the round reported five times elsewhere. Those observers
were added before the run rather than after it.

**R42 class `credential-plaintext`: member-set expanded 3x (sync.ts → token-audit.ts
→ rotate-credentials.ts → the primitive) — closed by mutation-verified guard
`packages/crypto/test/zeroization.test.ts` (red-proven: a production module
calling `decryptCredentials` directly), wired into the `unit` project and listed
in `CONTROL_FILES`.** Its limit is stated in the file: a text scan sees the
spelling, not the binding.
