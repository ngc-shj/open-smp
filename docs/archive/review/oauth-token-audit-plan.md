# Plan: oauth-token-audit

Cycle 8. `SC3` on `docs/roadmap.md`, which put it second and said why.

Revision 2 — **C1 built and executed.** Three of its four questions turned out to
be answerable from the installed `googleapis` types rather than from
documentation, and the measurements decided them; the fourth remains VE3 and the
code says so at the site that depends on it.

Revision 1 — **written from measurement, not from argument.** Cycle 7 recorded
that its plan-review rounds returned 4 then 8 Critical findings, every round-2
Critical inside a round-1 repair, and all twelve claims the plan had asserted
without running. The method that replaced it — build the artifact, execute it,
record what the execution decided — is the method here. This document states
what was measured and what each contract must answer; it does not argue for a
design it has not run.

**Built: C1.** C2, C3 and C4 are not, and each carries the findings it must
answer when it is.

## The order decision this plan already triggered

`docs/roadmap.md` reserves one decision: *"if SC5 or SC3 turns out to need a
change to the connector interface itself — not an addition to it — stop and do
SC2 first, because that is the evidence the interface is being designed against
one example."*

SC3 came within one judgement of firing it, and the measurement is recorded here
because the next reader will meet the same question:

- `SaaSConnector` declares exactly **one** method, `listUsers`, and carries **no
  capability declaration**. `SCL7` in the SC5 plan already recorded that absence
  from the other side ("no derivation path from `apps/api` to a connector
  capability").
- SC3 is the second capability, so it is the item that forces the question.

**Decided: proceed, as an addition.** `listTokens?()` is optional and changes
nothing existing — not `listUsers`, not `RawAccount`, not `ConnectorContext`. The
capability stays implicit (`typeof connector.listTokens === 'function'`) and the
vocabulary for declaring capabilities is **deliberately not designed here**,
because designing it against one implementation is precisely what the trigger
warns about. SC2 designs it against two connectors and two capabilities, with
this plan's measurements as evidence. Recorded as `SCT1`.

## Project context

- **Type**: service (Fastify API, BullMQ worker) + web app + library packages.
- **Test infrastructure**: unit + integration (vitest, Testcontainers against
  real Postgres 16) + E2E (Playwright against the compose stack) + CI
  (`checks`, `integration`, `compose-smoke`) — **all three required on `main`**,
  measured this cycle: `required_status_checks.contexts` is
  `["checks","integration","compose-smoke"]` with `strict: true` and
  `enforce_admins: true`. A red check stops a merge, which was not true when the
  cycle-6 plans were written (`SC67`).
- **Verification environment constraints**:
  - **VE1** — no real Google Workspace tenant. The seeded credentials are fake
    and `sync` fails against them by design (`e2e/specs/sync.spec.ts` asserts
    that failure). **The token path is equally unverifiable end to end**, and
    this is the single largest constraint on this plan.
  - **VE2** — the connector IS unit-testable, by the dependency injection
    `packages/connectors/google-workspace/test/list-users.test.ts` already uses
    (`deps.usersList`, JSON fixtures). The same seam serves tokens.
  - **VE3** — **Google's domain-wide delegation behaviour cannot be measured
    here.** Section "Measured current state" marks which statements about it are
    documented-but-unmeasured, and no contract may rest on an unmarked one.

## Objective

Answer the discovery half of the category question — *which applications exist
that nobody registered?* — from the connector already wired, by reading the
third-party OAuth grants the domain's own users have issued. No new integration,
no browser extension, no write to any connected system.

## Measured current state

Read from the source this cycle, not recalled:

- **`SaaSConnector` has one method and no capability declaration**
  (`packages/connectors/core/src/index.ts`). `RawAccount` is the only payload
  shape it defines.
- **`SCOPE` is a single module-level constant**
  (`admin.directory.user.readonly`) baked into one JWT client at construction:
  `new google.auth.JWT({ …, scopes: [SCOPE], subject: impersonateAdminEmail })`.
  There is one client, built lazily and cached, and every call shares it.
- **`admin.directory.tokens.list` is per-user**, `GET /users/{userKey}/tokens`,
  where `users.list` pages over a whole domain. The fan-out is therefore
  N accounts → N calls, which `listUsers`' shape does not have.
  *(Documented API surface, VE3: not exercised here.)*
- **Domain-wide delegation authorizes a scope SET.** A JWT assertion requesting a
  scope the delegation does not carry fails `unauthorized_client` — for the whole
  assertion, not for the one scope. *(Documented behaviour, VE3: not measurable
  here. C1 rests on this, and says so.)*
- **`discovery_events` is append-only by privilege** (migration 0005 revokes
  UPDATE/DELETE from `opensmp_app`), with `audit-append-only.test.ts` asserting
  `apps/api/src` holds exactly one `INSERT INTO discovery_events`, in `audit.ts`.
- **`discovery_events.source` has a declared reserved set** as of SC5's C2:
  `RESERVED_EVENT_SOURCES` in `@open-smp/api-types`, and
  `saas-app-key-pin.test.ts` asserts (a) no source is written as a literal at its
  INSERT site and (b) **every `*_EVENT_SOURCE` the package exports is a member**.
  A new source added without being reserved therefore reds mechanically.
- **`GET /events`' payload projection is a per-kind allowlist whose default
  branch drops every unknown field.** Measured in SC5/C2: a row stored under a
  kind with no branch is persisted, answers its `?source=` filter, and serves
  `{}`.
- **Queue contract**: `SyncJobData = { tenantId, saasAppId }`;
  `syncJobId` dedupes identical active jobs per (queue, tenant, app).
- **`saas_apps.key` is no longer one literal** (SC5/C2): the contract import
  writes it from a CSV cell, refusing the reserved set. Anything SC3 registers as
  an application goes through the same refusal or is not an application.

## Requirements

- **FR1** — for the connected tenant, the product reports the third-party
  applications its users have granted OAuth access to, and how many users granted
  each.
- **FR2** — a discovered application is distinguishable from one an operator
  registered. Discovery is evidence, not inventory.
- **FR3** — the audit is readable through the existing events surface rather than
  stored and never served (the defect SC5/C2 measured and fixed for its own
  family).
- **NF1** — **no change to the connector interface, only an addition.** The order
  decision above rests on this, and a contract that violates it invalidates the
  decision rather than the interface.
- **NF2** — a connector that cannot list tokens must degrade, not fail. The
  capability is optional and its absence is an ordinary state.
- **NF3** — no new write scope, and no write to any connected system.
- **NF4** — the new event source joins `RESERVED_EVENT_SOURCES`. Not a choice:
  `saas-app-key-pin.test.ts` reds otherwise, which is the control working.

## Contracts

### C1 — `listTokens` on the connector — BUILT

**Three of the four questions were measurable after all**, from the installed
`googleapis` types rather than from documentation. Revision 1 framed them as
design choices; the types decided them:

- `Schema$Tokens` carries `{kind, etag, items}` and **no `nextPageToken`**, and
  `Params$Resource$Tokens$List` accepts **`userKey` alone** — no `pageToken`, no
  `maxResults`, no `customer`.
- So the return is `Promise<readonly RawToken[]>`, **not** an `AsyncIterable`
  like `listUsers`: a streaming signature would promise paging the endpoint does
  not have.
- And the per-user fan-out is **forced by the provider**, not chosen — which is
  why it belongs to the caller, where C2 can state its bound.

**`RawToken` carries no `raw` field**, unlike `RawAccount`. The provider payload
adds `kind` and `etag` and nothing else; every field an audit needs is projected,
so storing the blob would be a retention and disclosure surface with no consumer.
It gets `rawTokenSchema` for the same reason `RawAccount` has one — the worker
parses what crosses rather than trusting it.

`anonymous` and `nativeApp` are **`boolean | null`, never coerced**. Google
returns them as optional, and `Boolean(undefined)` reports an application Google
does not recognise as one it does — the direction that hides the discovery this
feature exists for. `null` is "the provider did not say", which is a third state.

**The fourth question stays VE3, and the code says so where it matters.**
`tokens.list` needs `admin.directory.user.security`, requested by its **own JWT
client**: domain-wide delegation authorizes a scope SET, so widening
`scopes: [SCOPE]` would fail `unauthorized_client` for the *whole assertion* and
take `listUsers` — and `sync`, the entire inventory — down for any operator who
had not yet updated the admin console. Two clients confine that to the capability
needing the scope. The constant's comment states this as the reason for the
design and explicitly **not** as a measured fact.

The shared retry helper now takes an operation name. It hardcoded `users.list` in
both its messages, and a token failure reporting a user-list failure sends the
reader to the wrong call.

### C2 — the worker job — NOT BUILT

- **N accounts → N calls.** The bound belongs here, named for its subject the way
  SC5 named its caps (`HR_IMPORT_MAX_ROWS` / `CONTRACT_IMPORT_MAX_ROWS`), not
  `MAX_USERS`.
- **Its own queue, or a phase of `sync`?** A phase inherits `sync`'s
  all-or-nothing transaction and its dedupe; a queue needs its own `*JobData`,
  `*JobId` and worker registration. Neither is obviously right and the plan does
  not guess.
- **Failure model.** `sync` records `sync_failed` in its own committed
  transaction so a failed run leaves a trail. A per-user fan-out fails
  *partially*, which `sync` never does — the contract must say what a run that
  read 900 of 1000 users records.

### C3 — storage and the read path — NOT BUILT

- **A new source, reserved.** NF4 is mechanical; what C3 decides is the value and
  the kinds.
- **A projection branch is not optional.** SC5/C2 measured the failure: a stored
  row under an unbranched kind serves `{}`. Whatever payload this writes needs
  its branch and its allowlist in the same contract.
- **Aggregation.** FR1 asks for applications and a count of granting users;
  `discovery_events` is a log of runs. Where the "one row per discovered
  application" view comes from — a query over events, or a table — is C3's
  subject, and a table means `SCL9`'s catalog-derivation gap and `SCL10`'s
  composite-FK obligation both come due.

### C4 — the read surface — NOT BUILT

Deferred until C1–C3 are executed. SC5 shipped `GET /licenses` one PR before its
page and recorded what that cost: *"a shape consumed by no one is a shape nobody
has validated in use"*, and rendering it found two defects. C4 exists so the same
gap is not re-opened, not to be designed now.

## Go/No-Go Gate

| ID | Subject | Status |
|----|---------|--------|
| C1 | `listTokens` on the interface and the Google connector | **locked — built and executed** |
| C2 | the worker job and its bound | pending |
| C3 | storage, reserved source, projection branch | pending |
| C4 | the read surface | pending |

## Testing strategy

**The tier that can prove anything here is the unit tier**, and VE1 is why: the
compose stack's credentials are fake, `sync` fails against them by design, and no
E2E can exercise a real token read. The connector's existing seam
(`deps.usersList` + JSON fixtures) is the model, and C1 must ship the equivalent.

What that leaves unproven is stated rather than implied: **no test in this
repository can show that the Google call works.** The first real evidence is a
deployment against a real tenant. Every contract must therefore be honest about
which of its claims are VE3-class, and none may be written as measured.

**Mutations, not review rounds.** Cycle 7 executed 29 across three PRs; one
survived and that survivor was the cycle's most valuable finding — a test block
that could not fail on the property it named. The harness asserts each anchor
occurs exactly once before editing, because a regex that matches nothing produces
a green run that reads as "the mutation survived" when nothing was mutated.

### C1's mutations, and the one that repeated cycle 7's lesson

Nine run. Eight red; one survival was **predicted and recorded**, and one was not
— and the unpredicted one was the finding.

| mutation | result |
|---|---|
| absent `anonymous`/`nativeApp` coerced to `false` | reds |
| the token request carries `users.list`'s parameters | reds |
| a failed token read reports `users.list` again | reds |
| a missing `clientId` is yielded rather than refused | reds |
| the schema makes the three-state fields optional booleans | reds |
| the schema stops requiring the aggregation key | reds |
| the abort check is removed entirely | reds |
| the abort check moves after the client build | **survives — expected** |
| **a missing scope list becomes `undefined`** | **survived — see below** |

The expected survival is recorded rather than chased: building the JWT client
issues no request, so moving the check across it is behaviour-preserving. The
assertion is about the check existing before the *request*, and the mutation that
removes it entirely reds.

The unexpected one is the same shape cycle 7 found in `formatMoney`. The test
named "defaults a missing scope list to empty", and the fixture grant it read
carried `"scopes": []` — **present and empty, not absent**. Both inputs produce
`[]`, so dropping the `?? []` changed nothing the assertion could see. The
fixture did not contain the case the test was named for. Corrected by removing
the key, after which the mutation reds.

Suite state after C1: unit 417 green (34 files), integration 194 green, lint and
typecheck clean.

## Considerations & constraints

### Scope contract

`SCT` — `SC` is taken by the repository-wide deferrals and `SCL` by the SC5 plan.

- **SCT1** — **the connector capability vocabulary is not designed here.**
  `listTokens?()` being optional makes the capability implicit: nothing can ask a
  connector what it can do, and `apps/api` still has no derivation path to one
  (`SCL7`, unchanged). Deliberate — designing it against one implementation is
  what `docs/roadmap.md`'s order trigger warns about. Trigger: SC2, which brings
  the second implementation; the evidence it should use is this plan's measured
  facts about how the second capability differs from the first (per-user
  fan-out, a second scope, partial failure).
- **SCT2** — a scope added to domain-wide delegation is an **operator action
  outside this repository**. Nothing here can verify it was taken, and VE3 means
  nothing here can even verify what happens when it was not. Trigger: the first
  deployment against a real tenant.

### Risks

- **The largest claim in this plan is unmeasurable here.** C1's auth-client
  decision rests on documented Google behaviour that VE3 puts out of reach. That
  is a different epistemic status from every measured claim in the SC5 plan, and
  conflating the two is exactly the failure cycle 7 spent two review rounds on.
- **A per-user fan-out is the first partial failure in this codebase.** `sync` and
  `match` are all-or-nothing; a run that reads 900 of 1000 users has no precedent
  to copy, and copying one that does not fit is how the reconciliation's first
  draft got its counts wrong.
- **Discovery produces rows nobody asked for.** SC5's `SCL12` recorded that every
  authenticated session has full tenant write and no role model distinguishes
  who may create catalog rows. Discovery creating them automatically is a
  different question again, and FR2 exists so the answer is not "silently, as
  applications".
