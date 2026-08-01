# Plan: SC2 — a second connector

Cycle 9. `docs/roadmap.md` puts SC2 next and records that it was blocked on one
input this repository cannot supply — *which* provider. That input is now given:
**Slack**, chosen on what it teaches rather than on market share.

Revision 3 — **C2 built.** `CONNECTOR_APP_KEYS` has one member; Slack joins it
with the connector, because a key an operator can register and no job can sync
is worse than one they cannot register. Two of C2's own instructions were wrong
and are corrected below (⚠10, ⚠11).

Revision 2 — **plan review applied.** Nothing is built. Revision 1's structure
survived; six of its claims did not, and the corrections are marked ⚠ where a
later reader would otherwise inherit the wrong belief.

Revision 1 — written from measurement. Nothing is built.

## Why Slack, when Microsoft 365 is worth more

Microsoft 365 / Entra ID is the higher-value integration and the easier one:
Graph's `/users` and `/oauth2PermissionGrants` map onto `listUsers` and
`listTokens` without friction. That is exactly the problem. `SCT1` — the missing
capability vocabulary — cannot be designed against implementations that all
*have* every capability, because a vocabulary whose every member answers "yes"
is a rename of "optional method".

Slack is the negative case:

- it has accounts and **no per-user third-party-grant concept**, so the branch
  at `apps/worker/src/token-audit.ts:188` — *"a connector that cannot read
  grants is in an ordinary state"* — gets its first real instance instead of
  existing only for a fake;
- it is the first `authKind: 'apikey'` implementation. That member of the union
  has been declared since the interface was written and never implemented;
- it is **not an identity provider**, so whether `RawAccount` survives the
  mapping is itself the measurement. It does not — see below — and that is the
  interface defect the roadmap's ordering has been waiting to surface.

## Measured — this repository

| | measured |
|---|---|
| connector implementations | **1**, `packages/connectors/google-workspace` |
| `POST /saas-apps` key field | `key: z.literal('google-workspace')` (`apps/api/src/routes/saas-apps.ts:11`) |
| `POST /saas-apps` app-count ceiling | **none** — see ⚠1 |
| the catalog lock | `lockTenantAppCatalog`, `apps/api/src/routes/contract-import.ts:285` |
| the reserved-set refusal | `normalizeAppKey`, `apps/api/src/app-key.ts:32` |
| modules writing `saas_apps.key` | **3** (`saas-apps.ts:46`, `contract-import.ts:323`, `seed.ts:270` **and** `:311`) — four statements |
| connector registry | `apps/worker/src/connectors.ts:25`, one entry, **injectable** (`:6`) |
| `apps/api` → connector dependency | **none**; `apps/api/package.json` names `api-types`, `crypto`, `matcher`, `queues`, `schema` |
| `!connector.listTokens` branch | `token-audit.ts:188`, **never taken by a real connector** |
| capability model | `typeof connector.listTokens === 'function'`, and nothing else |

### ⚠1 — `POST /saas-apps` was never ceiling-enforced

Revision 1 said C2 would make that route "inherit the catalog lock". Measured:
`MAX_SAAS_APPS_PER_TENANT` is counted **only** in `contract-import.ts:421-436`,
inside the lock. `POST /saas-apps` (`:29-88`) calls `countTenantApps` never and
has no cap at all. So a lock taken there would serialise nothing — a control
stated stronger than its implementation, in the same sentence that quotes
`SCL11` about exactly that failure.

### ⚠2 — the `UNIQUE (tenant_id, key)` ceiling does not collapse

Revision 1 said widening the key field removes the thing holding the bound.
It does not: with a **closed** key set the bound moves from 1 row to |keys|
rows. It would collapse only under a free-text key, which is the design C2 now
explicitly does not choose.

### Three triggers fire, and two were written down in advance

- **`SCL11`** — its trigger text is this cycle, verbatim: *"the cycle that
  widens `saas_apps.key` past the literal."* What it actually holds open is
  ⚠1, not the lock.
- **`saas-app-key-pin.test.ts`** — a `CONTROL_FILES` member. Its header states
  the property as *"none of the three write paths can write a product-owned
  source value"* and pins the literal as claim 1 of 3. ⚠3: **claim 3 moves
  too** — `expect(seed).toContain("'google-workspace'")` (`:116-123`) stays
  green after a Slack key is seeded and says nothing about it.
- **`SCL16`** — ⚠4: **its own text is wrong.** It says a second
  account-bearing application reds `apps.spec.ts`'s account count. Measured:
  that assertion is `/Cannot delete — 4 accounts still attributed/`
  (`e2e/specs/apps.spec.ts:161`), the row is selected by
  `SAAS_APP_KEY = 'google-workspace'`, and the API counts
  `WHERE saas_app_id = $1` (`saas-apps.ts:203`). It is **app-scoped and does
  not move.** Only `accounts.spec.ts`'s tenant-scoped orphan count moves.

## Measured — Slack

⚠5 — **provenance, stated because revision 1 misrepresented it.** Revision 1
said "read from the installed type declarations". `@slack/web-api` is **not a
dependency of this repository**: no `package.json` names it and
`pnpm-lock.yaml` has no entry. It was read from a scratch install of
`@slack/web-api@8.0.0` outside the tree, so **no reviewer can reproduce it from
this repository today**, which is the weight difference between this table and
the one above it. C1 lands the dependency; from that point `pnpm typecheck`
holds the field-existence claims and this section stops being a report.

What typecheck will *never* hold is the scope-dependent half: `users:read.email`
is what makes `profile.email` present, and its absence is a successful call with
a missing field. That stays a documented operational precondition.

**`users.list` → `{ members: Member[], response_metadata: { next_cursor } }`.**
Cursor paging, so `listUsers`' `AsyncIterable` signature fits — unlike
`tokens.list`, which had no paging at all and forced `listTokens` to be an array.

`Member` carries `id`, `team_id`, `name`, `real_name`, `deleted`, `is_admin`,
`is_owner`, `is_primary_owner`, `is_bot`, `is_app_user`, `is_connector_bot`,
`is_workflow_bot`, `is_restricted`, `is_ultra_restricted`, `updated`, `tz`, and
`profile` (holding `email`, `display_name`, `real_name`, `title`, `bot_id`,
`api_app_id`).

### `RawAccount` does not survive the mapping intact

| `RawAccount` field | Slack source | verdict |
|---|---|---|
| `externalId` | `Member.id` (`U…`) | clean — provider-stable, not the email |
| `email` | `Member.profile.email` | clean, legitimately absent for bots; already nullable |
| `displayName` | `real_name` / `profile.display_name` | clean |
| `isAdmin` | `is_admin` | **lossy** — `is_owner` and `is_primary_owner` are separately privileged and collapse into one boolean |
| `accountStatus` | `deleted` only | **lossy** — a three-state enum fed by one boolean; `'suspended'` is unreachable |
| `lastActivityAt` | **nothing** | **absent** |

**`accountStatus` is a Google-shaped enum.** `Schema$User` carries `archived`
and `suspended` as separate fields and `mapAccountStatus` reads both
(`packages/connectors/google-workspace/src/index.ts:64-68`) — that is where the
three states came from. Slack has one boolean, so nothing can produce
`'suspended'`, and a UI filter on that state silently means "Google accounts
only" — a claim no screen makes.

**`lastActivityAt` has no source, and `Member.updated` is the trap.** `updated`
is a profile-modification timestamp, not activity. Reading it would be exactly
the error `SCL7` records SC5 refusing to make, one cycle after that refusal.

### Third-party apps: Slack has the concept in the wrong shape

`admin.apps.approved.list` returns
`ApprovedApp { app: { id, name, description, is_internal, … }, scopes: Scope[],
date_updated, last_resolved_by }` — **no user attribution**, and Enterprise Grid
only (`admin.apps:read`, org-level token).

So Slack does not merely *lack* the capability; it has a differently-shaped one.
That is a stronger constraint on `SCT1` than absence: a `has` / `has not`
vocabulary would classify Slack the same as a connector with no app concept at
all, and then be unable to say why one could show something and the other could
not.

## Contracts

### C1 — the Slack connector

**Package.** `packages/connectors/slack`, implementing `listUsers` and **not**
`listTokens`. `authKind: 'apikey'`. It joins `packages/connectors/*` in
`pnpm-workspace.yaml` automatically, which makes four things obligations rather
than choices — a prior cycle turned CI red on the last of them:

1. `scripts.test` **byte-identical** to
   `pnpm -w exec vitest run --project unit packages/connectors/slack/`
   (`package-test-parity.test.ts`'s `canonicalScript`);
2. `vitest` in `devDependencies` (the D1 ≡ D2 equality);
3. `packages/connectors` must not itself become a workspace member (the nested
   check names this path);
4. `tsconfig.json` with `include: ["src", "test"]`. `["src"]` leaves the unit
   suite green and reds only the CI-only "every assigned test file is inside a
   typecheck program" gate — the `SC58` asymmetry.

**Dependency.** `@slack/web-api`, added here so ⚠5 stops being true.

**Credentials.** A bot token. Scopes `users:read` and `users:read.email` —
**exactly two, and C4 may not add a third**; see ⚠6.

**What injection proves, cell by cell**, matching
`packages/connectors/google-workspace/test/list-users.test.ts`. The injection
surface is the constructor's second argument, the same shape as Google's
`{ usersList, sleep }`:

| cell | assertion |
|---|---|
| paging | a 3-page cursor fixture yields every member once, with every `RawAccount` field compared in full |
| rate limit | 429 retries once and yields no duplicate |
| auth | `invalid_auth` / `not_authed` → `ConnectorError{kind:'auth', retryable:false}`, no retry |
| transient | repeated 5xx → `kind:'transient', retryable:true`, bounded attempts |

**Two fixture requirements, because without them the load-bearing claims cannot
fail:**

- **every fixture member carries a non-zero `updated`.** "`lastActivityAt` is
  always `null`" is satisfied vacuously by a fixture with no `updated` — and
  then the `SCL7` Forbidden below has no detector.
- **`accountStatus` is asserted as a set equality over both `deleted` inputs**:
  the image of `{true, false}` is exactly `{'archived', 'active'}`. "No fixture
  produces `'suspended'`" is trivially true and proves nothing.

**Three invariants, each closing a path no existing control covers:**

- **No module-level or cross-run provider client.** The client is constructed
  per run from that run's decrypted credentials, as Google's is
  (`google-workspace/src/index.ts:154-156`, instance-scoped). A memoised
  module-scope `WebClient` — the idiom the SDK's own examples use — would write
  tenant A's members into tenant B's `saas_accounts` *inside* `withTenant(B)`:
  RLS passes, the composite tenant FK passes, the AAD binding passes. **This
  platform's two isolation controls give zero coverage here**, which is why it
  is a contract and not a code-review note.
- **Connector errors carry fixed strings; provider errors travel in `cause`.**
  `apps/worker/src/sync.ts:183` writes `error.message` into `discovery_events`,
  and migration `0005` REVOKEs UPDATE and DELETE — anything landing there is
  unredactable by the application. Google holds this by convention and asserts
  it nowhere. Asserted here: a thrown error's `.message` contains no substring
  of `ctx.credentials`. Testable under injection.
- **`raw` is narrowed to the mapped subset.** `Member.profile` carries phone,
  images, title and custom fields; `DISCOVERY_STORE_RAW` persists up to 500 raw
  payloads into that same append-only table. More PII at rest, unredactable, no
  consumer — the `RawToken` reasoning applied to an account.

**Forbidden**: reading `Member.updated` into `lastActivityAt` (`SCL7`); a
provider client outliving one run; interpolating any credential or request
config into an error message.

**Bots and guests** are a decision C1 makes explicitly, not a default — see
Considerations, and note that it also decides the *shape* of C5's orphan
assertion.

**Honest limit.** No test here can show the call works — there is no workspace.
Injection proves the four cells above and nothing about the wire.

### C2 — `saas_apps.key` stops being a literal

**Design chosen: a closed key set.** ⚠2 removed the argument for the
alternative, and revision 1 asked for both at once.

- **The key list is shared data, and the arrow points from it to the registry.**
  `apps/api` has no dependency on any connector package, and the worker registry
  is *injectable* — deriving the route's accepted domain from it would make that
  domain runtime-mutable, and `SaaSConnector.id` is an unconstrained `string`
  authored inside a connector package. So: `CONNECTOR_APP_KEYS` lives in
  `@open-smp/api-types`, the route's `z.enum` reads it, and
  `apps/worker/src/connectors.ts` is asserted to have exactly those keys.
- **Disjointness is enforced at the derivation site**, throwing at module init
  if `CONNECTOR_APP_KEYS ∩ RESERVED_EVENT_SOURCES ≠ ∅` — with the test as the
  second line rather than the only one. A build-time check on two sets with
  different owners is not a boundary.
- **The zod field declaration stays in `apps/api/src`**; the pin test's
  count-of-one device is scoped there, and hoisting the schema reds it for a
  reason unrelated to the property.
- **`POST /saas-apps` gets the ceiling it never had** (⚠1): the app count
  against `MAX_SAAS_APPS_PER_TENANT`, checked inside `lockTenantAppCatalog`.
  The lock without the count is decorative.
- **`normalizeAppKey` is NOT added to this route.** Against a closed enum it is
  a no-op, and naming two controls where one is load-bearing is how a later
  reader miscounts. It remains the control on `POST /contract-import`, whose
  key comes from free CSV text.

**The pin test's claim 1 becomes behavioural, not textual.** A disjointness
assertion has no coupling to the route's schema — the field could degrade to
`z.string()` and disjointness would still hold, which is a check that passes by
construction. Instead, import the route's schema and assert three cells:

| cell | assertion | what it catches |
|---|---|---|
| deny | every `RESERVED_EVENT_SOURCES` member fails `parse` | a reserved source becoming registerable |
| allow | every `CONNECTOR_APP_KEYS` member parses | a key set the route does not actually accept |
| **degradation** | an arbitrary non-member (`'not-a-connector'`) fails `parse` | `z.string()`, `z.enum` widened, the field deleted |

The third cell is the one the disjointness form lacked, and it is the failing
state that makes the other two mean anything. Note also that the existing
`KEY_DECLARATION` regex stops at the first comma, so an inline
`z.enum(['google-workspace', 'slack'])` would truncate — another reason the
proof leaves source-scanning.

**Claim 3 moves too** (⚠3) — but ⚠10: **not to the subset form this plan
specified.** *"The set of keys seed writes is a subset of
`CONNECTOR_APP_KEYS`"* is **false by design**: `ensureContractOnlyApp` seeds
`'notion'` precisely because `SCL16` needs an application with a contract and no
connector visible in the demo. The claim that holds for every seeded key is the
reserved-set refusal, which claim 4 already makes. Claim 3 becomes the narrower
true statement: the seeded connector key is one the route would also accept.

⚠11 — **the module-init guard had no failing state, and a second control chose
its shape.** Written as a bare block over the constant, a mutation deleting it
survived: with the shipped keys clean, removing the check changes nothing
observable, and a guard whose only subject is data that already satisfies it
cannot be shown able to fire (RT7). It takes the set as an argument now, and a
test hands it a colliding one.

The first repair exported an `assert`-shaped function, and
`api-types-boundary.test.ts` (C39) redded — that control constrains this
package's runtime exports to frozen primitive data and one-argument guards named
`is*`, because what crosses into the browser bundle is its subject. The guard is
a **predicate** as a result. Fitting an existing control's contract is cheaper
and safer than widening the control to admit new code, and this is the second
time this cycle that a control shaped a design rather than merely checking it.

### What C2 built, and what it deliberately did not

`CONNECTOR_APP_KEYS` ships with **one member**. Slack joins it in C1, with the
connector — a key an operator can register and no sync job can resolve is worse
than one they cannot register, and `runSync` would surface it as
`No connector registered for saas_apps.key` in a worker log.

So nothing user-visible changed, which is the point: what landed is the
structure the rest of SC2 reads, plus ⚠1 — a missing ceiling that was never
about Slack.

| mutation | result |
|---|---|
| the route accepts any string | reds — **the cell the old text-scanning control could not have** |
| the key set gains a reserved source | reds |
| the collision predicate stops detecting a collision | reds |
| the registry loses the key the route accepts | reds |
| the registry gains a key the route refuses | reds |
| the ceiling is read outside the lock | SURVIVED (declared — no unit-tier assertion can observe a lock ordering; the contract import's acceptance test is the only thing driving two real transactions through these primitives, and it is scoped to that route) |

### C3 — credentials become per-connector

- Validation is per key in `apps/worker/src/connectors.ts:13-15` today; a second
  shape makes it a dispatch. Note that this throw is **inside `runSync`'s try**,
  so its message becomes an audit payload — C1's fixed-string invariant governs
  it.
- **The Slack fields live in the existing `SaasAppForm.tsx` /
  `SaasAppManager.tsx`.** Not a new component: those two carry the SEC-F2/SEC-F7
  anti-idiom (*"caught values are classified and discarded, never read for their
  text… Do not 'fix' this back to the codebase idiom"*) as **a comment and
  nothing else** — the forbidden-pattern grep its originating plan specified was
  never implemented, and the surrounding codebase idiom is the opposite. A new
  file starts with no comment, no gate, and a maintainer's reflex pointing the
  wrong way.
- The bot token has no structural client-side check analogous to
  `validateServiceAccountJson`. C3 states what replaces it (a shape check that
  classifies without echoing) and that the field carries `autoComplete="off"`.
- ⚠7 — revision 1 said "four fields named for a service account". Measured: a
  disabled select plus four inputs, of which **three** are service-account
  fields; `displayName` is connector-agnostic and does not move.
- **`apps.spec.ts`'s three register specs depend on the Google-fixed form
  shape** — two of them assert *zero* requests to `/api/saas-apps`, which
  presumes the service-account fields are present on first render. C3 decides
  whether the connector select defaults to `google-workspace` or the specs gain
  a selection step.
- New copy goes through the dictionary; the ratchet enforces it mechanically. A
  per-connector key `<option>` adds a second operator-typed identifier to
  `untranslated-literals.ts`'s allowlist, which the ratchet does **not** enforce.

### C4 — the capability vocabulary (`SCT1`), reduced to what is implementable

⚠8 — revision 1 named `/discovery` as the vocabulary's falsifier: *"it renders a
`Users` column that one of those three states cannot fill."* Measured, that is
wrong twice. The `!listTokens` branch writes `token_audit_failed`
(`token-audit.ts:192`), and `apps/web/src/lib/discovery-runs.ts:30` drops
everything that is not `token_audit_completed` — so a Slack app renders
**nothing**, not an unfillable column. And no spec asserts the `Users` column at
all.

Revision 1 also demanded three states while only two have implementations, which
is the criticism this plan levels at the existing model one level up.

So C4 is **two states, declared, with a stated third**:

- `SaaSConnector` gains a declaration replacing
  `typeof listTokens === 'function'`. Two members have implementations: grants
  with per-user attribution (Google), and none (Slack).
- The third — workspace-level apps without attribution — is **declared and not
  implemented**, with `admin.apps.approved.list`'s shape recorded as the reason
  it is a distinct member rather than a synonym for "none". Fetching it is
  **out of scope for SC2** (⚠6).
- `apps/api` reads the declaration through `@open-smp/api-types`, alongside
  `CONNECTOR_APP_KEYS` — the same edge C2 creates, not a second one.
- `/discovery` must say something for a connector that cannot be audited, rather
  than rendering nothing. C4 names the spec that asserts it; there is none
  today.

### C5 — the demo, and the counts that actually move

- Seed a second account-bearing application, which is what `SCL16` needs to show
  "has accounts, no contract" and "has both" at once.
- ⚠4 — **`apps.spec.ts`'s count does not move.** If a Slack delete-refusal is
  worth proving, it is a *new* spec, not an edit to that one.
- **`accounts.spec.ts:61-67` moves, and must not be renumbered.** It asserts a
  named orphan is visible **and** `tbody tr` `toHaveCount(1)` — an exhaustiveness
  claim tied to one named row. Bumping `1` to `3` produces exactly the test the
  plan warns against. Instead: a named orphan set in `seed-facts.ts`, asserted
  as **set equality** against the rendered rows, so both "one too many" and "one
  missing" red and name the row.
- **Seeding is a three-point simultaneous change** — `apps/api/src/seed.ts`,
  `e2e/fixtures/seed-facts.ts`, `e2e/scripts/assert-seed-preserved.sh` — and
  `apps/api/test/seed-gate-agreement.test.ts` (a `CONTROL_FILES` member)
  requires all three to agree. Its `parseFixture` matches **any**
  `\w+: { email: '…' }` in the fixture, so putting the Slack accounts in a
  separate `const` does not exempt them: each demands an `assert_status` and an
  `assert_label_null` in the shell gate. The `assert_license` map is keyed to
  exactly two app keys and requires exact agreement — a Slack app with no
  contract is consistent with that, and a Slack app *with* one is not.

### C6 — the events source filter

`apps/web/src/components/SourceFilter.tsx:13` hardcodes
`{ value: 'google-workspace', … }`, and a sync writes `source = saas_apps.key`
(`apps/worker/src/sync.ts:152`). A Slack sync therefore produces events
reachable only by hand-editing the URL — the exact condition that component's
own comment says `C20` added the filter to prevent. The filter derives from
`CONNECTOR_APP_KEYS` rather than gaining a second literal.

## Considerations

- **Bots are accounts with no human, and Slack has four flags for them**
  (`is_bot`, `is_app_user`, `is_connector_bot`, `is_workflow_bot`). Synced, they
  become orphans by construction — correctly orphaned, not actionable, and noise
  on the one screen that exists to make orphans actionable. Excluded, the
  inventory is incomplete in a way nothing records. This also sets the size of
  C5's orphan set, so it is not only a product call.
- **Guests map onto a label kind that already exists.** `is_restricted` and
  `is_ultra_restricted` are `external_collaborator` in this product's own
  vocabulary. Auto-labelling writes an audit row attributed to a user who did
  nothing, which is why this is a decision and not an obvious yes.
- ⚠6 — **Slack has no second-client containment.** `oauth-token-audit-plan.md`
  records that `tokens.list` needed a scope whose addition to the shared JWT
  client would have failed `unauthorized_client` for the *whole* assertion,
  taking sync down with it — so it got its own client. Slack's scopes live on
  one installed bot token, so that escape does not exist. Any future fetch of
  workspace apps arrives as a **separate credential field** (an org-level
  token), never as a scope added to the sync token. Written down so a later
  cycle cannot re-derive it as a one-line scope addition.
- ⚠9 — **`POST /contract-import` can squat a connector key.** `normalizeAppKey`
  admits `slack`, `createApp` inserts `ON CONFLICT DO NOTHING`, and
  `POST /saas-apps` returns 409 `duplicate_key` with no adopt path. Any
  authenticated tenant user (`SCL12`: no role model distinguishes them) can
  create a credential-less row keyed `slack` and block the operator's
  registration. Recoverable through `PATCH`, so it is recorded rather than
  fixed — but C3 gives the form a key selector that will land on it.
- **A bot token is a strictly larger leak-and-replay surface than a service
  account key**, even though the storage path is identical. `encryptCredentials`
  is shape-agnostic and its AAD binds `tenantId‖saasAppId‖keyVersion`; what
  differs is that `xoxb-` is a directly replayable bearer credential on every
  request, while the Google artifact is a *signing* key still requiring an
  assertion exchange and revocable server-side without touching the app.
  Revision 1's "a different shape, not a different sensitivity" was true of
  storage and read as a blanket claim; C1's fixed-string invariant is what
  closes the difference.
- **Nothing here writes to Slack.** `users:read` is a read scope, and SC4
  remains the only item that writes to a customer's system.
