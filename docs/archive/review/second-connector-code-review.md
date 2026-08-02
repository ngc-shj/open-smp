# Code Review: second-connector (SC2 / C1, C2, C3)

Date: 2026-08-02
Review round: 1
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

Pending — findings reported, fixes not yet applied.
