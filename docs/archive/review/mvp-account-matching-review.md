# Plan Review: mvp-account-matching
Date: 2026-07-24
Review round: 1

## Changes from Previous Round
Initial review.

Orchestration notes:
- Local LLM pre-screening (Step 1-3) and merge-findings (Step 1-5) skipped — Ollama/OpenAI-compatible backends unreachable; mechanical json-index join + manual dedup used as the documented fallback.
- Security expert S1 was flagged escalate:true → Opus escalation review ran per the Sub-agent Model Selection protocol. Opus verdict: S1 downgraded Critical → Major (Opus takes precedence for overlapping Critical findings); new findings S6 (Critical), S7, S8 (Major) merged in.
- Perspective convergence: F3 + F5 (functionality) and T2 (testing) converge on the same root cause — `/api/hr-import` lacks a locked contract. Convergent: functionality+testing; severity floor Major (already Major). Fixed first within tier.

## Functionality Findings
## Findings

[F1] Major: saas_accounts.last_seen_at source contradicts its own consumer-flow walkthrough
- File: plan §C2 Consumer-flow walkthrough vs §C5
- Evidence: C2's walkthrough lists lastActivityAt as consumed for the saas_accounts upsert, but C5 says the upsert "sets last_seen_at = run start time" (worker-generated), not RawAccount.lastActivityAt.
- Problem: Either lastActivityAt (GWS last login) is silently discarded with no persisted column, or the walkthrough is wrong. Neither is stated as intentional (R25/R40-shaped).
- Impact: A real product signal (last real activity vs last sync time) silently dropped, or walkthrough over-claims field usage.
- Fix: Persist RawAccount.lastActivityAt as saas_accounts.last_activity_at and use a separately named last_synced_at for run-start time; make C1, C2, C5, C6 agree.

[F2] Major: account_links.identity_id is unconstrained for status = 'ambiguous'
- File: plan §C1 Invariants vs §C4
- Evidence: Only cross-field CHECK is `(status = 'orphan') = (identity_id IS NULL)`; C4 defines 'ambiguous' but never states what identityId holds for ambiguous links.
- Problem: Schema permits status='ambiguous' AND identity_id IS NOT NULL (misleading "matched to X" when tied) and the walkthrough consumers have no documented handling.
- Impact: Undefined behavior at a status boundary; misleading UI display possible.
- Fix: Rule in C4: ambiguous links persist identity_id = NULL, candidates only in evidence.candidates; extend CHECK to `(status IN ('orphan','ambiguous')) = (identity_id IS NULL)`.

[F3] Major: HR CSV import (identities upsert) has no owning contract, upsert clause, or consumer-flow walkthrough
- File: plan §C6 vs §C1 vs §C5
- Evidence: POST /api/hr-import is the only mention; no ON CONFLICT clause, no CSV-row→identities column mapping, no producer named in any walkthrough, unclear sync-vs-queued (202 without jobId).
- Problem: The entry point for one of the two core data sources has no locked contract; whether it runs inside withTenant()/a transaction is undefined, so R9 cannot even be checked for this path.
- Impact: Implementation could reasonably diverge (sync handler vs worker job); core FR1 path unlocked.
- Fix: Contract the import: sync or queued decision, exact ON CONFLICT (tenant_id, employee_id) DO UPDATE column set (incl. left_at forward-progression semantics), CSV column mapping, producer walkthrough.

[F4] Major: identities.status (identity_status enum) values and consistency with left_at never defined
- File: plan §C1 vs §C4
- Evidence: identity_status member values never enumerated (contrast link_status); C4 derivation reads status='active' and "left_at set" as independently-checked, always-synchronized signals with no CHECK.
- Problem: Unenumerated values (on_leave, suspended, pending from CSV status column) have no derivation branch; nothing prevents status='active' with left_at set.
- Impact: Enum/branch coverage gap (R12-shaped) at the heart of the go/no-go matching metric; determinism guarantee is hollow if the mapping is unspecified for some inputs.
- Fix: Enumerate identity_status ('active' | 'left'); CHECK ((status = 'left') = (left_at IS NOT NULL)); make C4 derivation exhaustive with explicit rejection at import boundary for unmapped CSV values.

[F5] Minor: POST /api/hr-import uses 202 Accepted for a response that appears fully synchronous
- File: plan §C6
- Evidence: 202 { imported, skipped, errors[] } returns terminal counts, unlike the two async 202 { jobId } routes.
- Problem: 202 conventionally signals async processing; response already contains the final result.
- Impact: Clients may poll a nonexistent job or break on the shape.
- Fix: Return 200 OK if synchronous, or make genuinely async with { jobId }; state the choice.

[F6] Minor: Sync-then-match staleness window is not addressed
- File: plan §C5 vs §User Operation Scenarios
- Evidence: Concurrency 1 per queue serializes within a queue only; scenario 1 has admin trigger sync then match as two actions.
- Problem: runMatch can run against a partially-synced snapshot with no re-match trigger or staleness signal.
- Impact: Stale orphan/ghost classifications after quick sync+match; usability gap, not corruption.
- Fix: Document as accepted MVP limitation, or add ordering (UI enqueues match after sync job completes; or runSync enqueues match after its transaction commits — permitted by the forbidden pattern, which proscribes queue.add inside the transaction scope only).

[F7-A] [Adjacent → Testing] Minor: AccountListItem.appKey and link.identityId defined but never claimed by any consumer walkthrough
- File: plan §C6
- Evidence: Walkthrough enumerates neither appKey nor link.identityId.
- Problem: Locked API shape carries fields with no stated consumer need; walkthrough discipline incomplete.
- Impact: Low — could hide dead contract surface or a silently-dropped consumer need.
- Fix: Add both fields to C6's walkthrough with consumer justification.

[F8-A] [Adjacent → Testing] Minor: SessionContext and Session types referenced but never declared
- File: plan §C7
- Evidence: verifyLogin → Promise<Session | null>, requireSession → Promise<SessionContext>; neither type declared, unlike RawAccount/LinkResult/AccountListItem.
- Problem: Walkthrough field claim (userId, tenantId) asserted only in prose — the auth boundary shape is not locked.
- Impact: Weakens self-verification chain at a security-relevant boundary.
- Fix: Declare both types explicitly in C7's code block.

## Recurring Issue Check

- R1: n/a — normalizeEmail explicitly single-sourced
- R2: n/a — plan-stage, single file
- R3: n/a — withTenant applied uniformly per C1/C5/C7
- R4: n/a — no dispatch gap beyond R9/R13 (checked)
- R5: checked — upserts are single-statement ON CONFLICT
- R6: n/a — no delete operations specified
- R7: n/a — E2E deferred (SC8)
- R8: n/a — not observable at plan-prose level
- R9: checked — C5 forbidden pattern; no contract violates it
- R10: n/a — matcher pure, no I/O
- R11: n/a
- R12: FINDING F4 — identity_status enum coverage incomplete
- R13: checked — C5 forbidden pattern
- R14: n/a — single non-superuser app role at MVP scope
- R15: n/a
- R16: n/a — Testcontainers + GH Actions services matching
- R17: checked — normalizeEmail forbidden pattern
- R18: n/a
- R19: n/a — no test code in a plan
- R20: n/a
- R21: n/a
- R22: n/a
- R23: n/a
- R24: n/a — greenfield single migration
- R25: FINDING F1 — lastActivityAt has no persist target
- R26: n/a
- R27: n/a — rate limits stated once (RS2), not duplicated
- R28: n/a
- R29: checked — OWASP citation explicitly hedged; acceptable handling
- R30: n/a
- R31: n/a
- R32: n/a — plan-stage
- R33: checked — single workflow file stated
- R34: n/a
- R35: n/a — V1/V4 manual test scripts named
- R36: n/a
- R37: n/a
- R38: n/a — BullMQ job states standard
- R39: n/a — out of Functionality scope
- R40: checked — same underlying gap as F1
- R41: n/a — V1/V4 waivers have concrete fallback paths
- R42: checked — 7-table set and 9-route set independently recomputed; no delta
- R43: n/a
- R44: n/a
- R45: n/a
- R46: n/a

```json
[
  {"id": "F1", "severity": "Major", "title": "saas_accounts.last_seen_at source contradicts its own consumer-flow walkthrough (RawAccount.lastActivityAt unmapped)", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 184, "adjacent": false, "escalate": null},
  {"id": "F2", "severity": "Major", "title": "account_links.identity_id unconstrained for status='ambiguous'", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 109, "adjacent": false, "escalate": null},
  {"id": "F3", "severity": "Major", "title": "HR CSV import (identities upsert) has no owning contract, upsert clause, or consumer-flow walkthrough", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 331, "adjacent": false, "escalate": null},
  {"id": "F4", "severity": "Major", "title": "identities.status (identity_status enum) values and consistency with left_at never defined", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 94, "adjacent": false, "escalate": null},
  {"id": "F5", "severity": "Minor", "title": "POST /api/hr-import uses 202 Accepted for an apparently synchronous response", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 331, "adjacent": false, "escalate": null},
  {"id": "F6", "severity": "Minor", "title": "Sync-then-match staleness window across BullMQ queues not addressed", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 300, "adjacent": false, "escalate": null},
  {"id": "F7", "severity": "Minor", "title": "AccountListItem.appKey and link.identityId defined but never claimed by consumer walkthrough", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 388, "adjacent": true, "escalate": null},
  {"id": "F8", "severity": "Minor", "title": "SessionContext and Session types referenced but never declared", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 425, "adjacent": true, "escalate": null}
]
```

## Security Findings

### Sonnet round (S1 severity superseded by Opus escalation below)
[S1] Critical: Unbound AES-GCM ciphertext for connector credentials — no tenant AAD binding
- File: plan §C1, §C6
- Evidence: "credentials for saas_apps stored encrypted at rest (AES-256-GCM via ENCRYPTION_KEY env, 32 bytes); never returned by any GET endpoint." Also C1: "[app-enforced] All queries execute inside withTenant(); no viable schema-enforced equivalent exists for 'GUC always set'."
- Problem: The plan specifies AES-256-GCM with a single global `ENCRYPTION_KEY` but never states that tenant_id/saas_app_id is bound into GCM's AAD. The plan itself documents that tenant isolation for this table is app-enforced only (RLS "GUC always set" has no schema-enforced backstop other than fail-closed zero-rows, per C1's own text) — meaning a future maintenance script, admin tool, or migration that forgets `withTenant()` is architecturally possible. If such a code path (or an operator restoring/copying a row between tenants for support purposes) moves a `saas_apps.credentials` ciphertext blob to a different tenant's row, AES-GCM without AAD binding will decrypt successfully under the shared key — a silent cross-tenant credential substitution that no integrity check catches.
- Impact: Cross-tenant Google Workspace service-account credential exposure/substitution; attacker or buggy tooling with any DB write path can cause tenant B to unknowingly run tenant A's connector credentials (or vice versa), leaking one company's full Workspace directory (emails, names, admin flags) to another tenant's synced dataset.
- Fix: Bind `tenant_id` (and `saas_app_id`) as AES-GCM AAD on encrypt/decrypt so ciphertext moved across tenant rows fails authentication and cannot be decrypted. Add an acceptance criterion: "decrypting a credentials blob against a different tenant_id fails."
escalate: true
escalate_reason: chained trust-boundary issue — depends on both the crypto design (C1/C6) and the app-enforced-only RLS boundary (C1's own admitted gap) plus a hypothetical future maintenance-tooling bug; assessing full exploitability requires reasoning across multiple contracts and future code paths not yet written, appropriate for a second opinion before lock.

[S2] Major: No CSRF defense beyond SameSite=Lax for high-impact mutation routes
- File: plan §Technical Approach, §C6
- Evidence: "server-side session cookie (SameSite=Lax, HttpOnly, Secure), login rate-limited." C6 routes include `POST /api/hr-import` (bulk PII import) and `POST /api/saas-apps` (registers connector credentials) with no CSRF token or Origin/Referer check mentioned.
- Problem: SameSite=Lax is not a complete CSRF defense — it permits cookies on top-level GET navigations and has documented gaps (older browsers, certain redirect chains, proxy method-rewriting). The plan states Lax as the sole defense without justifying why Origin/Referer verification or CSRF tokens are unnecessary for the two highest-impact mutation routes (credential registration, PII bulk import). OWASP's CSRF Prevention Cheat Sheet recommends SameSite as defense-in-depth alongside, not instead of, token or Origin verification for security-critical actions (citation unverified — exact cheat-sheet revision not checked here, but the general recommendation is a documented OWASP position).
- Impact: If any gap in SameSite=Lax is hit (browser quirk, reverse-proxy normalization, future subdomain-per-tenant deployment per SC6's stated direction), a cross-site attacker page can trigger credential registration or PII import using the victim admin's live session.
- Fix: Add an explicit Origin/Referer header check in the C6 auth preHandler for all mutation routes, or add an explicit plan justification for why SameSite=Lax alone is deemed sufficient for the MVP threat model.
escalate: false

[S3] Major: argon2id parameters flagged as unverified with no acceptance gate to force confirmation
- File: plan §C7
- Evidence: "argon2id parameters: memory 19 MiB, iterations 2, parallelism 1 (... citation to be confirmed, not asserted from memory)."
- Problem: The plan itself marks this citation unverified. No acceptance criterion requires re-checking the parameters against current OWASP guidance before merge, so the unverified number could ship unchecked, potentially under-provisioning brute-force resistance for the `users.password_hash` store — a high-value target since this password protects the entire tenant's SaaS-inventory data.
- Impact: If final parameters underspecify memory/iteration cost relative to current OWASP minimums, a leaked `users` table (backup leak, insider, future SQLi) is more crackable than intended.
- Fix: Add an acceptance criterion to C7 requiring the argon2id parameters be cross-checked against the OWASP Password Storage Cheat Sheet revision current at implementation time, with the citation recorded (permalink/date) in code.
escalate: false

[S4] Major: CSV export has no formula-injection mitigation for attacker-influenced fields
- File: plan §C8
- Evidence: "CSV export of current filter (client-side)." Elsewhere: "account names/emails are attacker-influenced (a malicious SaaS display name is untrusted input)."
- Problem: The plan already recognizes SaaS display names/emails as attacker-influenced input and forbids `dangerouslySetInnerHTML` for the HTML rendering path, but does not extend equivalent reasoning to the CSV export path. A Google Workspace display name beginning with `=`, `+`, `-`, `@`, tab, or CR becomes a formula when the exported CSV is opened in Excel/Sheets/LibreOffice — classic CSV/formula injection (OWASP CSV Injection).
- Impact: An attacker who controls or compromises a single Workspace account display name can achieve command execution or data exfiltration on the admin's workstation when the admin exports and opens the orphan/ghost list — a realistic action since the export exists specifically for human review.
- Fix: Add to C8 acceptance criteria: CSV export must neutralize (e.g., prefix with `'`) any cell value beginning with `=`, `+`, `-`, `@`, tab, or CR, applied to all attacker-influenced fields (`email`, `displayName`, `appName`, `evidence.matchedValue`, `evidence.candidates`).
escalate: false

[S5] Minor: `DISCOVERY_STORE_RAW=true` payload exposure/retention not fully specified
- File: plan §C5, §C6
- Evidence: "Privacy: `RawAccount.raw` is persisted only when `DISCOVERY_STORE_RAW=true` (default false) — raw GWS payloads contain org unit, phone, etc. beyond MVP need." C6 consumer-flow: "reads `{ source, kind, payload.counts, created_at }`" from `GET /api/events`.
- Problem: The plan names the privacy concern and defaults it off (good), but doesn't state whether `GET /api/events` returns the full `payload` jsonb column (which would include nested raw PII once the flag is enabled) or a projected subset. It also states no retention/deletion policy for `discovery_events` rows once raw payloads accumulate.
- Impact: If an operator enables `DISCOVERY_STORE_RAW=true`, any authenticated tenant-admin session could receive extra PII (phone, org unit) via the events API beyond the stated MVP need, with unbounded retention.
- Fix: Specify that `GET /api/events` projects `payload` to exclude raw per-account blobs regardless of the flag (or gates it behind a separate scope), and add a retention note or SC deferral for `discovery_events` row expiry.
escalate: false

## Recurring Issue Check

R1: N/A — no shared-utility reimplementation surfaced in plan prose.
R2: N/A — no duplicated hardcoded constants observed.
R3: N/A — no partial pattern propagation visible at plan stage.
R4: N/A — no event/notification dispatch gap.
R5: N/A — transaction wrapping addressed via `withTenant`.
R6: N/A — no cascade-delete design present in plan.
R7: N/A — out of scope (E2E deferred, SC8).
R8: N/A — no UI pattern inconsistency.
R9: Addressed — plan explicitly forbids `db.transaction` spanning `queue.add` (C5 forbidden patterns).
R10: N/A — no circular module dependency evident.
R11: N/A — no display/subscription group construct.
R12: N/A — no enum/action-group coverage gap identified.
R13: Addressed — plan explicitly forbids re-entrant `queue.add` inside `runSync`/failure handlers.
R14: Open (Major, non-security direction) — adjacent, flagged as [Adjacent] not in this report per scope; role grants not yet enumerated at plan stage.
R15: N/A — no migration-specific hardcoded env values shown.
R16: N/A — dev/CI parity addressed via Testcontainers + CI section.
R17: Addressed — `normalizeEmail()` single-source forbidden-pattern for matcher (C4).
R18: N/A — no allowlist/safelist construct in scope.
R19: N/A — no test-mock/helper drift observable at plan stage.
R20: N/A — no mechanical multi-statement edit in scope.
R21: N/A — not applicable to plan-prose review.
R22: N/A — no established-helper inversion case.
R23: N/A — no UI mid-stroke input control described.
R24: N/A — no single migration mixing additive+strict constraints described.
R25: N/A — no persist/hydrate symmetry construct in scope (session persistence not described as client-cached).
R26: N/A — no disabled-state UI control described.
R27: N/A — no hardcoded numeric range in user-facing string found (confidence precision governed by schema CHECK, not a UI string).
R28: N/A — no toggle/switch labels in plan.
R29: Open — argon2id citation explicitly marked unverified by the plan itself; see S3.
R30: N/A — no markdown autolink citation issue observed.
R31: N/A — no destructive-operation UX in scope.
R32: N/A — no new long-running runtime artifact beyond what CI covers.
R33: Addressed — plan states "Single workflow file; no duplicated config (R33)."
R34: N/A — no pre-existing adjacent bug deferred without justification observed.
R35: N/A — manual test plans provided for both blocked-deferred items (V1, V4).
R36: N/A — no static-analysis suppression discussed.
R37: N/A — no internal jargon in user-facing strings observed.
R38: N/A — no async state-machine UI/worker lifecycle with non-terminal state described (BullMQ jobs have terminal states via job status endpoint).
R39: Open (Minor-leaning) — see S5; also credentials-at-rest encryption (C6) doesn't describe zeroization of decrypted credential buffers in worker memory after connector use — plan does not specify in-memory credential lifecycle, only "never logged/serialized." Not raised as standalone finding (insufficient concrete attack vector at plan-prose stage) but flagged here for awareness.
R40: N/A — no cross-boundary serialization shape mismatch found; C1→C4→C5→C6 field walkthroughs are internally consistent.
R41: N/A — no declared capability without backing path observed.
R42: Checked — recomputed both universal invariants from the plan's own enumerations (RLS 7-table member set; 9-route auth-coverage set with 1 exemption). No delta found against the plan's own derivation; note this is prose-stage only — the `rg` derivation commands themselves must be re-run once code exists (Phase 2/3), this is not yet verified against real code.
R43: N/A — no security-boundary-widening fix observed (this is an initial plan, not a fix).
R44: N/A — no CI gate exit-status-through-pipeline construct.
R45: N/A — no repo-wide analyzer scaling issue described.
R46: N/A — no security-analyzer binding-resolution scope issue.
RS1: Addressed — C7 explicitly implements dummy-hash timing defense with a unit test asserting call-count parity.
RS2: Addressed — C6 specifies rate limits for login, mutation, and list routes.
RS3: Addressed — C6 specifies zod validation on every body/query plus CSV row length caps.
RS4: Addressed — testing strategy specifies "sanitized, synthetic data only" for connector fixtures.
RS5: N/A — no externally-supplied crypto/authz parameter (KDF iterations, algorithm id) is sourced from an untrusted external party in this plan; argon2id params are developer-chosen constants (see S3 for the separate unverified-citation concern, which is R29 not RS5).
RS6: N/A — no chained-escape sanitizer construct described in the plan.

```json
[
  {"id": "S1", "severity": "Critical", "title": "Unbound AES-GCM ciphertext for connector credentials — no tenant AAD binding", "file": "plan §C1, §C6", "line": null, "adjacent": false, "escalate": true},
  {"id": "S2", "severity": "Major", "title": "No CSRF defense beyond SameSite=Lax for high-impact mutation routes", "file": "plan §Technical Approach, §C6", "line": null, "adjacent": false, "escalate": null},
  {"id": "S3", "severity": "Major", "title": "argon2id parameters flagged as unverified with no acceptance gate to force confirmation", "file": "plan §C7", "line": null, "adjacent": false, "escalate": null},
  {"id": "S4", "severity": "Major", "title": "CSV export has no formula-injection mitigation for attacker-influenced fields", "file": "plan §C8", "line": null, "adjacent": false, "escalate": null},
  {"id": "S5", "severity": "Minor", "title": "DISCOVERY_STORE_RAW=true payload exposure/retention not fully specified", "file": "plan §C5, §C6", "line": null, "adjacent": false, "escalate": null}
]
```

### Opus escalation
# Escalation Review (Opus) — open-smp mvp-account-matching-plan

## S1 (escalation assessment) — DOWNGRADE Critical → Major. Confidence: high.

**Verdict on the attack chain.** S1's exploit chain does not hold against the plan *as written*. The premise — "ciphertext moved across tenant rows decrypts successfully" — requires an attacker in tenant A to obtain tenant B's ciphertext and feed it to a decrypt under the global key. But `saas_apps` is an RLS member table (C1 member set), RLS is fail-closed (unset GUC → zero rows), and `BYPASSRLS` is a forbidden pattern. So a tenant-A session physically cannot read tenant B's `credentials` row to substitute it. The three vectors S1 itself names are all *future/operational*: "a future non-`withTenant` code path," "admin tooling," "restore." None exist in this plan. This is defense-in-depth against a hypothetical future regression of an app-enforced boundary — real value, but not a live sensitive-data-exposure exploit. That places it in the Major "crypto hardening / insufficient-isolation backstop" tier, not Critical.

**Is AAD the right fix?** Yes, and it is neither insufficient nor over-engineered: binding `tenant_id + saas_app_id` as GCM AAD converts any future cross-row ciphertext substitution into a *loud* auth-tag failure. Keep the fix; keep the acceptance test. Only the severity label changes.

**But AAD is the shallower half of the problem.** The plan specifies "AES-256-GCM via ENCRYPTION_KEY, 32 bytes" and *nothing about the nonce*. See S6.

## S6 (Critical) — GCM nonce management unspecified under a single long-lived key; nonce reuse breaks confidentiality AND integrity of GWS service-account keys. Confidence: high.

- Attacker: anyone who can obtain two ciphertexts (a DB-read-capable operator, a backup thief, or a tenant admin reading their own `saas_apps` history) plus, in the forgery case, an attacker who can later submit ciphertexts.
- Attack vector: The plan pins AES-256-GCM under one global, long-lived `ENCRYPTION_KEY` but never specifies nonce (IV) generation, length, or storage. A naive implementation — fixed/zero IV, a per-process counter that resets on restart, or a nonce narrower than 96 random bits — causes (key, nonce) reuse. GCM nonce reuse is catastrophic: two messages under the same key+nonce leak `P1 ⊕ P2`, and allow recovery of the GHASH authentication subkey `H`, letting an attacker **forge valid authentication tags** for arbitrary ciphertexts.
- Preconditions: implementation chooses a reused/deterministic nonce (a common default when the plan is silent) under the single static key; ciphertexts observable or injectable.
- Impact: confidentiality break and forgeability of the most sensitive secret in the system — Google Workspace **service-account private keys with domain-wide delegation**. Critical (sensitive-data exposure) on its own merits, independent of any cross-tenant angle.
- Fix: Contract the GCM construction explicitly. (1) Random 96-bit nonce per encryption via `crypto.randomBytes(12)`; store nonce + 128-bit tag alongside ciphertext. (2) Forbidden pattern: fixed/zero/constant IV, or counter-derived nonce, under the global key. (3) Specify key rotation: `key_version` column and rotation procedure (birthday bound for random 96-bit nonces ~2³² encryptions per key — comfortable for this volume but must be stated). (4) Acceptance criterion: encrypting the same plaintext twice yields different ciphertexts; tamper of any byte fails auth. Fold S1's AAD binding into the same contract (`tenant_id || saas_app_id || key_version` as AAD).

## S7 (Major) — Worker trusts `job.data.tenantId` with no contracted binding to the enqueuing session; Redis/BullMQ enqueue authorization unspecified. Confidence: medium-high.

- Attacker: any principal with write access to the Redis/BullMQ queue (internal-network foothold, SSRF landing on Redis, a future second API path, or a compromised co-located service). Not, currently, a plain tenant-A API user.
- Attack vector: The worker sets the tenant GUC directly from the untrusted job payload — `withTenant(job.data.tenantId, ...)` — treating it as ground truth. The plan never states that the enqueue path binds `job.data.tenantId := session.tenantId`, and states no auth on the Redis connection. Whoever enqueues chooses the tenant the worker operates as, bypassing RLS entirely (the GUC is set to the attacker's chosen value, so RLS faithfully scopes to the forged tenant).
- Preconditions: ability to enqueue to Redis. The documented HTTP routes take no tenantId input, so a normal API user cannot forge a tenantId today — which is why this is Major, not a live Critical bypass. The gap: the trust boundary is uncontracted.
- Impact: full cross-tenant read/write — complete isolation bypass for anyone who reaches the queue.
- Fix: Add a C5/C6 invariant: "the API is the sole enqueuer; `job.data.tenantId` is set exclusively from `SessionContext.tenantId`, never from request input." Forbidden pattern: request-derived `tenantId` reaching `queue.add`. Require an authenticated Redis connection (password/ACL, network-isolated). Acceptance criterion: route-table sweep asserts no route reads tenantId from body/query.

## S8 (Major) — Login is tenant-ambiguous: `{ email, password }` with `UNIQUE(tenant_id, email)` makes `verifyLogin` non-deterministic and enables cross-tenant account confusion. Confidence: high.

- Attacker: an unauthenticated user, or a user in tenant A whose email collides with a user in tenant B.
- Attack vector: `users` is unique on `(tenant_id, email)`, so the same email can exist in multiple tenants with different passwords. But `POST /api/auth/login` and `verifyLogin(email, password)` take no tenant discriminator. The lookup `WHERE email = $1` across all tenants either matches multiple rows (undefined which session/tenant is minted) or matches the first-created row regardless of intended tenant. The resulting `SessionContext.tenantId` seeds every `withTenant()` call — an ambiguous login directly determines which tenant's data the whole session sees.
- Preconditions: two tenants share a user email (expected; likely for admin@ / common corporate addresses).
- Impact: (1) login undefined when emails collide — user may be silently logged into the wrong tenant; (2) cross-tenant account confusion; a password-spray / enumeration oracle across the whole user population; potential cross-tenant login. Also undercuts the RS1 timing-safe story: "user not found" is ill-defined when the email exists in some tenant but not the caller's intended one.
- Fix: Make the tenant explicit at login: tenant discriminator in the login request (tenant slug/subdomain → resolve tenant before user lookup, then `WHERE tenant_id = $1 AND email = $2`). Invariant: "user lookup at login is always tenant-scoped; a bare `WHERE email = ?` on `users` is a forbidden pattern." Acceptance criterion: two tenants with the same email+different passwords each log into their own tenant deterministically; a credential valid in tenant B cannot mint a session in tenant A.

## Note on scope

No additional Critical beyond S6 in the tenant-isolation/credential/session area. The RLS design itself (fail-closed GUC, no BYPASSRLS, transaction-local set_config, member-set derivation R42) is sound as planned and is precisely what defuses S1 to Major.

```json
[
  {"id": "S1", "severity": "Major", "title": "saas_apps.credentials AES-256-GCM lacks tenant AAD binding — cross-row ciphertext substitution decrypts silently (defense-in-depth backstop; RLS blocks the live path)", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": null, "adjacent": false, "escalate": null},
  {"id": "S6", "severity": "Critical", "title": "GCM nonce management unspecified under a single long-lived ENCRYPTION_KEY; nonce reuse breaks confidentiality and integrity of GWS service-account keys", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": null, "adjacent": false, "escalate": null},
  {"id": "S7", "severity": "Major", "title": "Worker trusts job.data.tenantId with no contracted binding to the enqueuing session; Redis/BullMQ enqueue authorization unspecified", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": null, "adjacent": false, "escalate": null},
  {"id": "S8", "severity": "Major", "title": "Login is tenant-ambiguous: {email,password} with UNIQUE(tenant_id,email) makes verifyLogin non-deterministic, enabling cross-tenant account confusion", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": null, "adjacent": false, "escalate": null}
]
```

## Testing Findings
## Findings

[T1] Major: Precision go/no-go metric has no numeric threshold
- File: plan §Objective, §C4 Acceptance criteria, §Go/No-Go Gate
- Evidence: "Matching precision on real data is the go/no-go metric for the whole product... precision reporting will quantify the gap" (§Considerations) and "precision measured and reported by the test run" (C4 Acceptance criteria)
- Problem: The plan repeatedly declares precision as *the* gating metric for the entire product but never states what precision value constitutes a pass. The Go/No-Go Gate table lists only contract IDs with `pending` status — there is no row or criterion tying a numeric precision threshold to go/no-go.
- Impact: The golden-corpus test can run, print a precision number, and the CI/review process has no objective pass/fail line to check it against — a regression that silently drops precision from 95% to 60% is "measured and reported" but nothing fails.
- Fix: Add a concrete threshold to the C4 acceptance criteria (e.g., "precision ≥ X% across the golden corpus; test suite fails if below threshold") or explicitly state the threshold will be set post-corpus-review with an owner and date, added to the Go/No-Go Gate table as a first-class row.

[T2] Major: No acceptance-criteria test coverage for CSV import scenarios (duplicate rows, encoding rejection)
- File: plan §C6 Acceptance criteria; §User Operation Scenarios 5, 6
- Evidence: Scenario 5 — "same `employee_id` twice in CSV → second row upserts over the first, per-row warning"; Scenario 6 — "importer accepts UTF-8 (with BOM) and rejects other encodings with a clear error." C6's Acceptance criteria section lists only: unauthenticated-401 sweep, login rate-limit 429, and credentials-absence in GET /api/saas-apps — nothing about `/api/hr-import`.
- Problem: `/api/hr-import` is one of the nine routes in C6's contract and is central to FR1, yet it has zero acceptance-criteria test commitment. The behaviors described in scenarios 5 and 6 (duplicate-row upsert-and-warn, BOM acceptance, non-UTF-8 rejection with named-encoding error, row length caps, max-100-errors-reported) are all testable with Vitest alone — this is not an infrastructure gap, it's an omitted commitment.
- Impact: A regression in duplicate-row handling, BOM handling, or Shift_JIS rejection ships with green CI, because no test asserts these behaviors exist.
- Fix: Add explicit acceptance criteria to C6 for `/api/hr-import`: (a) duplicate `employee_id` rows upsert with a per-row warning; (b) UTF-8-with-BOM accepted and stripped; (c) non-UTF-8 file rejected with named-encoding error; (d) rows exceeding length caps rejected per-row, not aborting the whole import.

[T3] Major: RLS cross-tenant test wording does not commit to asserting mutation-absence, only "cannot read/write"
- File: plan §C1 Acceptance criteria
- Evidence: "Integration test: session with tenant A GUC cannot read/write tenant B rows (all 7 tables)."
- Problem: Per RT8 (Vacuous denial-path test), a denial-path test must assert both the denial result AND that the guarded mutation did not occur — not merely a status/error/empty-result check that could pass vacuously. The wording "cannot read/write" is ambiguous, unlike the adjacent fail-closed test ("reads zero rows") and the C5 test ("writes zero rows visible to tenant B").
- Impact: If implemented literally, the test could pass by only checking that a write "throws" or "returns an error," without independently verifying under a legitimate tenant-B session that the row was actually left untouched — a classic vacuous-pass path per RT8.
- Fix: Reword: "session with tenant A GUC reads zero tenant-B rows on SELECT, and UPDATE/DELETE against tenant-B rows affects zero rows (verified by re-querying under tenant B's own GUC) — across all 7 member tables."

[T4] Minor: Testcontainers Redis version not pinned to match CI's `redis:7`
- File: plan §Testing Strategy; §Project Context
- Evidence: "CI (GitHub Actions): ... (services: postgres:16, redis:7)" vs. "Testcontainers (Postgres, Redis)" — Postgres pinned to 16 consistently, Redis has no stated version for the local Testcontainers path.
- Problem: Per R16 (Dev/CI environment parity), divergent versions between local Testcontainers and CI service containers is a known drift source.
- Impact: Un-pinned local image could silently drift to a different major version and produce CI-only or local-only BullMQ failures.
- Fix: State the Testcontainers Redis image tag explicitly (`redis:7`) so both environments are pinned by construction.

[T5] Minor: Fixture-drift bound (RT1) for GWS connector relies on manual re-recording with no documented trigger or cadence
- File: plan §V1, §Testing Strategy
- Evidence: "recorded GWS `users.list` responses (sanitized, synthetic data only — RS4)" with only a manual test script covering the live gap.
- Problem: No documented re-recording trigger; zod validation covers the connector's normalized RawAccount output, not the raw fixture JSON against the real GWS API shape, so a real-API field change is not caught by fixture tests.
- Impact: Silent fixture drift could go undetected indefinitely between manual test runs.
- Fix: Define a re-recording trigger (re-record fixtures on every `googleapis` dependency bump; rerun the manual test script at least once per quarter, logging the date).

[T6] Major: CI plan has no boot smoke test for the docker-compose stack that is itself an NFR1 deliverable
- File: plan §Testing Strategy, §NFR1
- Evidence: NFR1 — "`docker compose up` boots Postgres, Redis, API, worker, web with seed data." CI: "lint → typecheck → unit → integration (services: postgres:16, redis:7)."
- Problem: Per R32, the compose stack is a long-running runtime artifact requiring a real boot smoke test with a declared ready signal. CI never runs `docker compose up` — CI's `services:` blocks are a different verification path than the compose artifact promised in NFR1 and demonstrated in C8's acceptance criteria.
- Impact: A broken compose file (wrong env var, missing healthcheck, broken seed script) could merge without CI catching it; the "Seeded docker-compose demo shows ≥1 orphan/ghost" criterion becomes a manual, undated, unrepeated check.
- Fix: Add a CI step that runs `docker compose up -d`, polls a declared readiness signal (API health endpoint 200), and curls `/api/accounts` after seeding to confirm non-empty orphan/ghost counts.

[T7-A] [Adjacent] Severity: Problem — this may overlap with Functionality expert's scope.
- File: plan §C4, §Considerations
- Evidence: "Old-surname handling beyond secondary-email data is out of MVP scope — precision reporting will quantify the gap." / golden corpus "seeded with ... old surnames via secondary_emails".
- Problem (testing angle): the rule pipeline has no `old-surname` rule — only exact-email, alias-normalized, secondary-email, name-domain. Unclear whether "old surnames via secondary_emails" corpus cases are expected `matched` (via secondary-email rule) or intentionally-orphan negative cases documenting the known gap. This ambiguity affects whether the ≥40-case corpus's expected-status labels are well-defined.
- Impact: Ambiguous/inconsistent corpus labeling makes the precision number ill-defined.
- Fix (for Functionality expert): state explicitly whether "old surname via secondary_emails" is a matched-expected case or a documented-gap orphan-expected case.

## Recurring Issue Check

- R1: Not applicable — no shared-utility duplication observed in plan prose (normalizeEmail single-sourcing is explicitly required).
- R2: Not applicable — no hardcoded-constant duplication found.
- R3: Not applicable — no partial pattern propagation observed at plan stage.
- R4: Not applicable — no event/notification dispatch gap found; discovery_events audit trail is explicit.
- R5: Not applicable — transaction wrapping (withTenant) explicitly specified.
- R6: Not applicable — no cascade-delete behavior specified in plan.
- R7: Not applicable — no E2E selectors in scope (E2E explicitly deferred, SC8).
- R8: Not applicable — no UI pattern inconsistency observed.
- R9: Addressed — plan explicitly forbids db.transaction spanning queue.add (C5 forbidden patterns).
- R10: Not applicable — no circular module dependency evidence.
- R11: Not applicable — no display/subscription group concept in this plan.
- R12: Not applicable — link_status enum coverage appears complete with CHECK constraint backstop.
- R13: Addressed — plan explicitly forbids re-entrant queue.add inside job handlers.
- R14: Not applicable — no DB role-grant matrix issue found beyond the single non-superuser app role already specified.
- R15: Not applicable — no migration hardcoding of environment-specific values observed.
- R16: Finding raised — T4 (Redis version pin not stated for local Testcontainers vs CI).
- R17: Addressed — normalizeEmail single-sourcing explicitly forbidden-pattern-enforced (C4).
- R18: Not applicable — no config allowlist/safelist synchronization concern found.
- R19: Not applicable — no existing test mocks to realign (greenfield).
- R20: Not applicable — no mechanical multi-statement edit in scope.
- R21: Not applicable — no subagent completion claims to verify at plan stage.
- R22: Not applicable — no established helper perspective-inversion issue found.
- R23: Not applicable — no UI input-control mid-stroke mutation concern.
- R24: Not applicable — greenfield schema, single initial migration expected.
- R25: Not applicable — no persist/hydrate asymmetry found.
- R26: Not applicable — no disabled-state UI concern in scope.
- R27: Not applicable — no hardcoded numeric range in user-facing strings found.
- R28: Not applicable — no toggle/switch label grammar issue found.
- R29: Addressed — argon2id parameters explicitly flagged "citation to be confirmed" (C7).
- R30: Not applicable — no markdown autolink citation issue found.
- R31: Not applicable — no destructive operation described in plan.
- R32: Finding raised — T6 (no boot smoke test for the docker-compose stack in CI).
- R33: Addressed — plan explicitly states "Single workflow file; no duplicated config (R33)."
- R34: Not applicable — no pre-existing bug in an adjacent file to defer (greenfield).
- R35: Addressed — manual test plans provided for both blocked-deferred paths (V1, V4) with concrete script file paths named.
- R36: Not applicable — no static-analysis suppression observed.
- R37: Not applicable — no internal jargon in user-facing strings observed.
- R38: Not applicable — no async state machine with non-terminal/fail-open supersession found.
- R39: Not applicable — no secret/metadata zeroization lifecycle concern found (session tokens stored hashed; credentials encrypted at rest).
- R40: Not applicable — cross-boundary shapes are explicitly walked through per contract; no shape mismatch found.
- R41: Not applicable — no declared capability without a backing path found.
- R42: Addressed — plan explicitly applies R42 member-set derivation twice (RLS table set at C1, auth-route set at C6) with derivation commands specified.
- R43: Not applicable — no fix-induced security-boundary widening in scope.
- R44: Not applicable — no gate-exit-status-through-pipeline pattern found in the described CI steps.
- R45: Not applicable — no repo-wide analyzer scaling concern found.
- R46: Not applicable — no security-analyzer binding-resolution concern in scope.
- RT1: Finding raised — T5 (fixture drift re-recording procedure undocumented for GWS connector fixtures).
- RT2: Applied as a filter — all recommendations checked for testability against Vitest+Testcontainers+CI; none rejected as untestable.
- RT3: Not applicable — no shared-constant-in-tests issue found.
- RT4: Not applicable — no race/concurrency test described (concurrency handled via idempotent upserts; isolation probe waived).
- RT5: Verified — RLS, auth-sweep, and rate-limit tests explicitly run against real Postgres/Fastify/Redis via Testcontainers, not mocks; no finding.
- RT6: Not applicable — no newly-added production exports without test diff to check (plan stage).
- RT7: Verified — 401 sweep's programmatic route-table iteration mechanism is itself testable and self-updating; no finding beyond T3's wording-precision concern.
- RT8: Finding raised — T3 (C1's cross-tenant RLS test wording does not explicitly commit to mutation-absence assertion).
- RT9: Not applicable — no parallel-implementation twin described; matcher/auth/RLS all specified as single-sourced.

```json
[
  {"id": "T1", "severity": "Major", "title": "Precision go/no-go metric has no numeric threshold", "file": "plan §Objective, §C4 Acceptance criteria, §Go/No-Go Gate", "line": null, "adjacent": false, "escalate": null},
  {"id": "T2", "severity": "Major", "title": "No acceptance-criteria test coverage for CSV import scenarios (duplicate rows, encoding rejection)", "file": "plan §C6 Acceptance criteria", "line": null, "adjacent": false, "escalate": null},
  {"id": "T3", "severity": "Major", "title": "RLS cross-tenant test wording does not commit to asserting mutation-absence, only \"cannot read/write\"", "file": "plan §C1 Acceptance criteria", "line": 134, "adjacent": false, "escalate": null},
  {"id": "T4", "severity": "Minor", "title": "Testcontainers Redis version not pinned to match CI's redis:7", "file": "plan §Testing Strategy", "line": 477, "adjacent": false, "escalate": null},
  {"id": "T5", "severity": "Minor", "title": "Fixture-drift bound (RT1) for GWS connector relies on manual re-recording with no documented trigger or cadence", "file": "plan §V1, §Testing Strategy", "line": null, "adjacent": false, "escalate": null},
  {"id": "T6", "severity": "Major", "title": "CI plan has no boot smoke test for the docker-compose stack that is itself an NFR1 deliverable", "file": "plan §Testing Strategy, §NFR1", "line": null, "adjacent": false, "escalate": null},
  {"id": "T7-A", "severity": "Problem", "title": "Golden corpus expected-status labeling for old-surname-via-secondary_emails cases is ambiguous given no dedicated rule exists", "file": "plan §C4, §Considerations", "line": null, "adjacent": true, "escalate": null}
]
```

## Adjacent Findings
- F7-A (Functionality → Testing): AccountListItem.appKey / link.identityId not claimed by any consumer walkthrough. Routed: orchestrator applied walkthrough justification directly (routing target had no conflicting report).
- F8-A (Functionality → Testing): Session/SessionContext types undeclared. Routed likewise; also security-relevant per S8 (login tenant scoping) — resolved jointly.
- T7-A (Testing → Functionality): golden-corpus labeling ambiguity for old-surname-via-secondary_emails cases. Routed to functionality scope; resolved by explicit corpus labeling rule in C4.

## Quality Warnings
merge-findings quality gate unavailable (local LLM down). Manual screen by orchestrator: no VAGUE / NO-EVIDENCE / UNTESTED-CLAIM entries detected — all findings carry evidence quotes and concrete fixes.

## Resolution Status (Round 1)
All findings applied to the plan (no Skipped/Accepted/Out-of-scope entries — Anti-Deferral format not required for applied fixes):
- F1 Applied — saas_accounts split into last_activity_at (from RawAccount.lastActivityAt) + last_synced_at (run start); C1/C2/C5/C6/C8 aligned.
- F2 Applied — ambiguous links persist identity_id = NULL; CHECK extended to (status IN ('orphan','ambiguous')) = (identity_id IS NULL).
- F3/F5/T2 Applied (convergent) — hr-import contracted as synchronous 200 OK inside withTenant + single transaction, ON CONFLICT column set incl. left_at semantics, CSV column mapping, producer walkthrough, 4 acceptance criteria.
- F4 Applied — identity_status enum enumerated ('active'|'left'), CHECK ((status='left') = (left_at IS NOT NULL)), exhaustive C4 derivation, import-boundary rejection of unmapped CSV status values.
- F6 Applied — staleness window documented as accepted MVP limitation + UI ordering rule (match enqueued only after sync job completes).
- F7-A Applied — appKey / link.identityId consumer justifications added to C6 walkthrough.
- F8-A Applied — Session / SessionContext types declared in C7.
- S1 (Major per Opus) + S6 (Critical) Applied — new contract C9 (credential encryption module): random 96-bit nonce, nonce||tag||ciphertext storage, key_version, AAD = tenant_id||saas_app_id||key_version, forbidden IV patterns, rotation bound, acceptance criteria (distinct ciphertexts, tamper fails, cross-tenant decrypt fails).
- S2 Applied — Origin verification on all non-GET /api routes added to C6 auth preHandler contract.
- S3 Applied — C7 acceptance criterion: argon2id params verified against OWASP Password Storage Cheat Sheet at implementation time, permalink+date recorded in code.
- S4 Applied — C8 acceptance criterion: CSV export neutralizes cells starting with = + - @ TAB CR by prefixing '.
- S5 Applied — GET /api/events projects payload to exclude raw per-account blobs regardless of DISCOVERY_STORE_RAW; retention deferred as SC10.
- S7 Applied — invariant: API sole enqueuer, job.data.tenantId exclusively from SessionContext.tenantId; forbidden pattern request-derived tenantId at queue.add; Redis AUTH required; route-sweep acceptance criterion.
- S8 Applied — login takes tenantSlug; tenant resolved before user lookup; forbidden pattern: bare WHERE email on users without tenant_id; deterministic per-tenant login acceptance criterion; RS1 dummy-hash story restated tenant-scoped.
- T1 Applied — corpus precision threshold ≥ 0.95 (CI-failing) + Go/No-Go row M1 for real-data evaluation.
- T3 Applied — RLS cross-tenant test reworded to assert mutation-absence via re-query under owning tenant GUC.
- T4 Applied — redis:7 pinned for local Testcontainers = CI.
- T5 Applied — fixture re-record trigger: every googleapis bump + quarterly manual run logged.
- T6 Applied — CI compose-smoke job (compose up, health poll, seeded /api/accounts non-empty).
- T7-A Applied — corpus labeling rule: old-surname cases matched-expected iff old address present in secondary_emails; otherwise orphan-expected documented-gap cases.

---

# Plan Review: mvp-account-matching
Date: 2026-07-24
Review round: 2

## Changes from Previous Round
All 20 round-1 findings applied: C9 crypto contract added; tenant-scoped login (tenantSlug); Origin check; hr-import contract; identity_status enum + CHECKs; last_activity_at/last_synced_at split; ambiguous→NULL identity; precision gate 0.95 + M1; compose smoke CI; redis pin; fixture re-record cadence; events projection; Redis AUTH; route tenantId sweep. Local LLM merge still unavailable — manual dedup fallback.

## Functionality Findings
[F9] (new in round 2) Major: AccountListItem.link.identityName has no declared producer in any consumer-flow walkthrough
- File: plan C6 type (identityName), C1 walkthrough (C6 join list), C6→C8 walkthrough
- Evidence: C1's C6-consumer walkthrough join list reads account_links + saas_accounts + saas_apps only — identities is not joined, so identities.display_name is never read; C4's LinkResult does not carry a name; yet AccountListItem.link.identityName exists and C8 consumes it. Same defect class as F7 (fixed for identityId) one field over.
- Problem: identityName has no data source per the plan's own walkthrough-enforcement discipline.
- Impact: Major — field unpopulatable as specified; ad-hoc mid-build join or silently-null UI field.
- Fix: (a) add identities to C1's C6-walkthrough join (account_links.identity_id → identities.id, read display_name; null when identity_id IS NULL per F2), or (b) drop identityName until SC11.

All round-1 fixes F1-F8 re-verified consistent across schema fields, invariants, walkthroughs, acceptance criteria, forbidden patterns; no stale last_seen_at references; security/testing surface changes introduce no functional contradictions.

## Recurring Issue Check
R1 pass (normalizeEmail forbidden pattern); R9 pass; R13 pass; R17 pass; R33 pass; R39 pass; R42 pass (both derivations present). R2-R8, R10-R12, R14-R16, R18-R32, R34-R38, R40-R41, R43-R46: n/a — no textual anchor / not applicable to this round's diff.

```json
[
  {"id": "F9", "severity": "Major", "title": "AccountListItem.link.identityName has no declared producer in any consumer-flow walkthrough", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 417, "adjacent": false, "escalate": null}
]
```

## Security Findings
Round-1 fix verification: S1/S6 (C9) correct and complete for what they cover; S7 resolved; S8 resolved; S3/S4/S5 resolved; S2 NOT fully resolved (see S9).

[S9] (new in round 2) Major: CSRF Origin-check preHandler bundled with login-exempt session-auth preHandler — POST /api/auth/login has no Origin verification
- Evidence: invariant reads as one fused "Auth + Origin preHandler at scope root" with a single login exemption; 403 sweep runs via "the same programmatic iteration" as the login-exempt 401 sweep; no criterion asserts login rejects missing/mismatched Origin.
- Attack: login-CSRF — cross-site form POST to /api/auth/login with attacker credentials; SameSite=Lax does not block top-level form POST and no session cookie is needed; victim's browser stores attacker-session cookie; victim's subsequent HR CSV / GWS credential uploads land in the attacker's tenant.
- Fix: two independent gates — Origin check on EVERY non-GET under /api with zero exemptions (incl. login); session auth on every route except login. Dedicated login-Origin 403 acceptance test independent of the 401 sweep.

[S10] (new in round 2) Major: Lazy key rotation has no eager sweep or deletion gate
- Evidence: "re-encrypt rows lazily on next successful decrypt" is the only migration mechanism; rotation test only checks mixed-version decrypt while both keys present.
- Problem: inactive/low-frequency connectors never re-encrypt → removing an old key silently shreds those credentials (discovered at next connector run), or old keys are never removable, defeating compromise recovery.
- Fix: (a) eager re-encryption sweep job/CLI walking rows with non-current credentials_key_version, plus (b) deletion gate: a key version may be removed only when count(rows on that version) = 0; acceptance criterion for both.

[S11] (new in round 2) Minor: Zeroization claim overstates protection — JSON.parse-derived JS strings (PEM private key) are immutable and unzeroable; buf.fill(0) covers only the initial buffer.
- Fix: narrow the claim: initial buffer zeroed; derived string fields have GC-dependent lifetime; residual heap-dump exposure accurately scoped.

[S12] (new in round 2) Minor: Login rate-limit "20/hour/account" bucket keying unspecified — if keyed on resolved tenant, nonexistent slugs never accrue the account bucket → tenant-slug existence oracle outside RS1's scope.
- Fix: bucket key = hash of raw submitted `tenantSlug:email` pair, resolution-independent.

## Recurring Issue Check
R39 open (S11); RS1 checked (verifyLogin) but not extended to rate-limiter (S12); RS2 checked with S12 caveat; R42 checked — note S9 shows Origin-gate needs a 0-exempt member set distinct from the auth-gate 1-exempt set; R5/R9/R13/R17/R29/R33 checked-intact; others n/a.

```json
[
  {"id": "S9", "severity": "Major", "title": "Origin check bundled with login-exempt auth preHandler — login lacks Origin verification (login-CSRF)", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 477, "adjacent": false, "escalate": false},
  {"id": "S10", "severity": "Major", "title": "Lazy key rotation lacks eager sweep and deletion gate", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 616, "adjacent": false, "escalate": false},
  {"id": "S11", "severity": "Minor", "title": "Zeroization claim overstates protection for JSON-parsed credential strings", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 620, "adjacent": false, "escalate": false},
  {"id": "S12", "severity": "Minor", "title": "Login rate-limit account-bucket keying unspecified — tenant-slug enumeration oracle", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 442, "adjacent": false, "escalate": false}
]
```

## Testing Findings
[T8] (new in round 2) Major: RLS acceptance criteria omit a WITH CHECK / cross-tenant INSERT test
- File: plan §C1 Acceptance criteria
- Evidence: criteria cover SELECT read-isolation, UPDATE/DELETE mutation-absence, and no-GUC fail-closed — INSERT is never mentioned.
- Problem: Postgres RLS distinguishes USING (SELECT/UPDATE/DELETE target visibility) from WITH CHECK (rows being written by INSERT/UPDATE). A tenant-A session INSERTing a row with explicit tenant_id = tenant-B is a live cross-tenant write path no current assertion exercises.
- Impact: A policy regression dropping/misconfiguring WITH CHECK on any of the 7 member tables ships with green RLS tests.
- Fix: Fourth criterion: INSERT with foreign tenant_id fails WITH CHECK (or is rejected), verified by re-querying under tenant B's GUC that no such row exists — all 7 member tables.

[T9] (new in round 2) Minor: Precision-gate denominator includes known-gap cases that pass by construction
- Fix: report non-known-gap subset precision as a secondary CI-visible number AND/OR cap known-gap fraction (≤25% of corpus).

[T10] (new in round 2) Minor: M1 Go/No-Go row has no objective pass/fail bar
- Fix: non-binding target in M1 row (e.g., real-tenant precision ≥0.90, within 5 points of corpus gate, reviewed with mislink count/severity).

[T11] (new in round 2) Minor: S4 CSV neutralization specified only as sanitizer-function unit test; wiring into the actual export path untested
- Fix: second unit-level assertion calling the real export function with a poisoned AccountListItem, asserting the entire resulting CSV row is neutralized.

## Recurring Issue Check
R12 resolved (F4); R16 resolved (T4); R25/R40 resolved (F1); R32 resolved (T6); R1/R5/R9/R13/R17/R29/R33/R42 checked-intact; RT1 checked (T5 resolved); RT2 applied; RT5 checked (real-HTTP statement present); RT7 checked (programmatic sweeps); RT8 partially open — new T8 (INSERT path); RT9 n/a; others n/a per plan-stage.

```json
[
  {"id": "T8", "severity": "Major", "title": "RLS acceptance criteria omit a WITH CHECK / cross-tenant INSERT test", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 160, "adjacent": false, "escalate": null},
  {"id": "T9", "severity": "Minor", "title": "Precision-gate denominator diluted by known-gap cases", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 317, "adjacent": false, "escalate": null},
  {"id": "T10", "severity": "Minor", "title": "M1 Go/No-Go row has no objective pass/fail bar", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 653, "adjacent": false, "escalate": null},
  {"id": "T11", "severity": "Minor", "title": "CSV neutralization wiring into actual export path untested", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 588, "adjacent": false, "escalate": null}
]
```

## Adjacent Findings
None in round 2.

## Quality Warnings
merge-findings quality gate unavailable (local LLM down). Manual screen: all 9 findings carry evidence and concrete fixes; no VAGUE/NO-EVIDENCE/UNTESTED-CLAIM.

## Resolution Status (Round 2)
All 9 round-2 findings applied to the plan (no Skipped/Accepted entries):
- F9 Applied — C1 walkthrough gains LEFT JOIN identities.display_name → link.identityName (NULL for orphan/ambiguous per F2); C6 walkthrough justification added.
- S9 Applied — Origin gate and session-auth gate split into two independent scope-root preHandlers; Origin gate has ZERO exemptions incl. login; dedicated login-Origin 403 test; R42 member sets split (6 non-GET routes / 9 routes 1-exempt).
- S10 Applied — eager re-encryption sweep (admin CLI/job) + key-retirement gate (count=0 before removing a version) + sweep integration test.
- S11 Applied — zeroization claim narrowed: buffer zeroed, JSON-parsed immutable strings GC-dependent, residual heap-dump exposure documented as accepted for MVP.
- S12 Applied — login account bucket keyed on hash of raw tenantSlug:email, resolution-independent.
- T8 Applied — C1 invariant: every policy defines USING and WITH CHECK; fourth RLS acceptance criterion: foreign-tenant INSERT rejected, verified by re-query under tenant B GUC, all 7 tables.
- T9 Applied — known-gap cases capped at 25% of corpus; non-known-gap subset precision reported separately in CI.
- T10 Applied — M1 documented bar: real-tenant precision ≥ 0.90 AND zero Critical mislinks.
- T11 Applied — export wiring test: actual export function with poisoned AccountListItem, full output neutralized.

---

# Plan Review: mvp-account-matching
Date: 2026-07-24
Review round: 3

## Changes from Previous Round
All 9 round-2 findings applied (Origin/auth gate split, key-rotation sweep + retirement gate, RLS WITH CHECK INSERT test, identityName join, known-gap cap, M1 bar, export wiring test, zeroization scoping, rate-limit bucket keying).

## Functionality Findings
No findings.

## Recurring Issue Check
R1/R9/R13/R17/R33/R39/R42 resolved-verified; all other R rules n/a. R42 round-3 verification: Origin gate 6 routes 0-exempt, session-auth 9 routes 1-exempt, both match route table (6 POST + 3 GET).

```json
[]
```

## Security Findings
[S13] (new in round 3) Major: C9 re-encryption sweep has no stated authorization/execution model, in tension with the BYPASSRLS forbidden pattern
- Location: C9 Rotation (S10) bullet.
- Chain: the sweep and the key-retirement gate query are cross-tenant-by-necessity, but the plan's only isolation mechanism is withTenant per single tenant; either (a) the sweep loops per-tenant (never stated, acceptance criteria don't verify all tenants covered) or (b) it runs BYPASSRLS, contradicting C1's forbidden pattern. Invocation authorization for a job that decrypts every tenant's GWS credentials in one run is entirely unspecified.
- Fix: state the sweep loops withTenant(tenantId) per tenant enumerated from the tenants root table (no BYPASSRLS pass); restrict invocation to a non-HTTP operator CLI; add both to C9 acceptance criteria.
- escalate: false (operational-path completeness gap, not a demonstrated request-facing bypass).

S9/S10-core/S11/S12 verified correctly applied; S12 raw-string keying introduces no new griefing surface.

## Recurring Issue Check
R1/R9/R13/R17/R33/R39/R42 hold; RS1-RS4 hold; RS5/RS6 n/a; others n/a.

```json
[
  {"id": "S13", "severity": "Major", "title": "C9 re-encryption sweep lacks authorization/execution model (BYPASSRLS tension)", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 644, "adjacent": false, "escalate": false}
]
```

## Testing Findings
[T12] (new in round 3) Minor: RLS USING+WITH CHECK coverage complete but split across two separately-labeled tests without a note tying them together as the full invariant. Documentation completeness only; test surface is complete.
[T13] (new in round 3) Major: S12 raw-string-hash bucket-keying has no dedicated acceptance criterion — the existing "429 on 6th attempt/min" test passes under a resolved-id keying implementation too, so the security-relevant distinguishing property is untested. Fix: acceptance criterion asserting two distinct unknown-account bucket keys are tracked independently (5 failures on X does not 429 the 1st attempt on Y).
Round-2 fixes T8/T9/T10/T11 and new surface S9/S10 tests verified correct; RT4/RT5/RT7/RT8 scans clean.
Note: T13 json index entry deviated from the standard schema (status/area/summary keys) — prose authoritative; accepted without bounce.

```json
[
  {"id": "T12", "severity": "Minor", "title": "RLS USING+WITH CHECK coverage split without tying note", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 163, "adjacent": false, "escalate": null},
  {"id": "T13", "severity": "Major", "title": "S12 bucket-keying property lacks a discriminating acceptance criterion", "file": "docs/archive/review/mvp-account-matching-plan.md", "line": 461, "adjacent": false, "escalate": null}
]
```

## Adjacent Findings
None in round 3.

## Quality Warnings
Local LLM merge unavailable — manual screen: all findings carry evidence and concrete fixes. Note: T13's json index entry deviated from the standard schema; prose treated as authoritative.

## Resolution Status (Round 3)
All 3 round-3 findings applied:
- S13 Applied — sweep execution model contracted: per-tenant withTenant loop over tenants root table, no BYPASSRLS carve-out; invocation = operator CLI only (pnpm rotate-credentials, ROTATE_CONFIRM=yes, never HTTP); two-tenant sweep integration test + no-rotation-route static check.
- T12 Applied — coverage note tying the three RLS tests to the full USING/WITH CHECK/fail-closed surface.
- T13 Applied — discriminating acceptance criterion: independent buckets for two unresolvable tenantSlug:email keys.

---

# Plan Review: mvp-account-matching
Date: 2026-07-24
Review round: 4 (final)

## Changes from Previous Round
Round-3 findings applied: S13 (sweep per-tenant withTenant execution model + CLI-only invocation authorization + two-tenant sweep test + static no-rotation-route check), T12 (RLS coverage note), T13 (rate-limit bucket-independence acceptance test).

## Functionality Findings
No findings. Three round-3 edits verified consistent with C1/C5/C6/C9, walkthroughs, and forbidden patterns (sweep CLI outside route-grep scope; retirement gate sum arithmetically equivalent; T12 note accurate; T13 test matches S12 intent).

## Recurring Issue Check
R1-R46: n/a for this verification round; R42/R9/R13 re-checked against the C9 sweep addition and satisfied.

```json
[]
```

## Security Findings
No findings. S13 fix verified correct and complete; no new attack surface from the three edits.

## Recurring Issue Check
R1-R41, R43-R46: n/a. R42 re-verified — sweep enumerates tenants root table, excluded from the RLS member set by design. RS1-RS6: n/a for this round.

```json
[]
```

## Testing Findings
No findings. Both C9 test additions sound (two-tenant sweep test falsifiable and RLS-primitive-faithful; static route check useful); T13 discriminating; T12 mapping accurate. RT1/RT4/RT5/RT7/RT8 all pass.

## Recurring Issue Check
R1-R46 n/a; RT1 satisfied; RT4/RT5/RT7 passed; RT8 mapping verified; RT2/RT3/RT6/RT9 n/a.

```json
[]
```

## Adjacent Findings
None.

## Quality Warnings
None (manual screen; local LLM unavailable throughout — documented fallback used every round).

## Termination
All three experts returned "No findings" in round 4. Review loop closed at round 4 of 10.
Totals: 32 findings raised and applied across rounds 1-3 (round 1: 20 incl. Opus escalation adding S6 Critical and downgrading S1; round 2: 9; round 3: 3). Zero skipped/accepted/deferred findings — Anti-Deferral log empty by construction.
Go/No-Go Gate: C1-C9 locked. M1's BAR is locked (real-tenant precision ≥ 0.90, zero Critical mislinks); its EXECUTION is post-implementation by definition (blocked-deferred per V1) and does not gate the Phase 1→2 transition.
