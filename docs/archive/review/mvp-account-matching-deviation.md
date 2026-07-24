# Coding Deviation Log: mvp-account-matching

## D1 — C9 module location
- Plan: `apps/api/src/crypto` (C9 heading). Implemented: `packages/crypto`.
- Reason: C5 (worker) decrypts credentials and hosts the rotation sweep CLI; C6 (api) encrypts on registration. A shared package avoids a cross-app source import. Contract signatures, invariants, forbidden patterns, and acceptance criteria unchanged.

## D2 — shared queue constants package
- Plan: queue names / job payload shapes appear in C5 prose only; no owning module named.
- Implemented: `packages/queues` (types + name constants + jobId builders) consumed by both apps/api (enqueue) and apps/worker (process).
- Reason: hardcoding queue names and jobId format in two apps is an R2 violation waiting to happen; a 20-line shared package is the minimal fix. No contract content changed.

## D3 — web UI component library
- Plan (Technical Approach): "Next.js + shadcn/ui". Implemented: Next.js + plain Tailwind v4 utility components.
- Reason: shadcn/ui adds an interactive CLI setup and a component-vendoring step that buys nothing at MVP scope (3 pages, 1 table). Revisit when the UI grows (SC8 trigger). No contract acceptance criterion references shadcn.

## D4 — sessions.token_hash column + tenant-embedded session cookie
- Plan (C1/C7): sessions table had no explicit token-hash column; C7 requires 32-byte tokens stored as SHA-256. `sessions.id uuid` cannot hold a 64-hex digest, so migration 0002 adds `token_hash text UNIQUE NOT NULL` (additive; id stays the PK).
- Also: sessions/users are RLS-protected, but requireSession must pick a tenant GUC BEFORE any lookup can run (chicken-and-egg). Cookie value is `${tenantId}.${token}` — the embedded tenantId is untrusted and only selects which withTenant GUC to open; the actual authorization is the token_hash lookup under that tenant's RLS. Forged tenantId → zero rows → 401 (fail-closed, same shape as an unset GUC).
- Contract impact: none of C7's invariants change (lookup is by hash, timing shape preserved); C1 gains one additive column via migration 0002.

## D5 — ADMIN_DATABASE_URL / DATABASE_URL split
- Plan: C1/C6 name a single DATABASE_URL. Implemented: api boot runs runMigrations(ADMIN_DATABASE_URL) (privileged, DDL) while the app pool uses DATABASE_URL (opensmp_app, RLS-constrained).
- Reason: a single URL forces the app pool onto the superuser, and superusers bypass RLS entirely — the composed deployment would silently lose tenant isolation while every RLS test stays green (tests connect as opensmp_app explicitly). Fail-safe requires the split.

## D6 — packages/api-types (type-only wire-shape package)
- Plan: C6 declares wire shapes in prose; implementation initially twinned them (api routes local types vs apps/web/src/lib/api-types.ts hand-copy). Phase-2 self-R-check flagged RT9 Major: twin drift was test-invisible.
- Implemented: `@open-smp/api-types` (zero runtime, `export type` only) is the single declaration site; api serializers carry explicit return-type annotations pinning the produced shape; web re-exports the same types. C8's "API is the only data path" invariant untouched (types are erased at build).

## Self-R-check disposition (Step 2-5)
- R2 Major (demo credentials duplicated seed.ts ↔ ci.yml): YAML cannot import TS — sync comment anchor added in seed.ts (comment in the ci.yml shell block would corrupt the line-continued curl, so the anchor lives on the TS side only). Accepted residual: worst case = compose-smoke job fails loudly on credential rotation (no silent behavior), likelihood low, cost of stronger coupling (generated YAML) not justified.
- R2 Minor (rate-limit literals): extracted to apps/api/src/rate-limits.ts; no literals remain in route files.
- RT9 Major (wire-type twins): fixed via D6.
- check-orphaned-checks "eslint.config.mjs uninvoked": false positive — invoked implicitly by `pnpm lint` (eslint auto-discovers flat config); wired via package.json gate surface.
- check-new-code-untested (schema table consts): covered by packages/schema tests (enum sets, member set) and every integration test; no action.
- check-propagation: hook itself failed on this machine (bash 3.2 lacks `declare -g`); greenfield diff has no rename-propagation surface — N/A.

## D7 — Origin gate scope: "non-GET" → "non-GET/HEAD" + RLS NULLIF hardening
- Plan (C6/S9): Origin verification on "every non-GET request". Fastify auto-registers a HEAD route for every GET; HEAD is a safe method (RFC 9110 §9.3.2, no state change) and browsers cannot issue cross-site HEAD form posts, so gating it adds friction without CSRF value. Implemented: gate covers non-GET/HEAD; the 403 sweep enumerates unsafe methods only. Plan text amended in place.
- Also (C1): integration testing surfaced the documented Postgres behavior that a transaction-scoped set_config leaves the custom GUC DEFINED with an empty-string session value after commit on a pooled connection — `''::uuid` then ERRORS instead of returning zero rows (still fail-closed: no data exposure, but not the contracted "zero rows"). Policies hardened to `NULLIF(current_setting('app.tenant_id', true), '')::uuid`, restoring the zero-rows contract on both fresh and reused connections. Found only by running against real Postgres — the class of gap the real-environment test obligation exists for.

## D8 — standalone login account-bucket limiter (Phase 3 CT2 bug fix)
- Phase-3 test CT2 surfaced a real production defect: @fastify/rate-limit guards each request with one shared `rateLimitRan` symbol per plugin instance, so a route carrying BOTH the IP limiter (config.rateLimit) AND the account bucket (a second app.rateLimit preHandler) fires only the first — the S12 account bucket (20/h) never actually enforced.
- Fix: the account bucket is now a standalone fixed-window limiter (apps/api/src/account-bucket.ts), keyed on the raw sha256(tenantSlug:email) per S12, independent of @fastify/rate-limit's shared guard. In-memory (single-instance compose posture, same as the IP limiter's default store); a multi-instance deployment moves it to Redis (noted). Contract values unchanged (20/h). Covered by account-bucket.test.ts (unit, injected clock) + the CT2 integration test (wired path, 21 attempts across varied IPs → 429).

## D9 — numeric(3,2) confidence coercion (post-review live bug)
- Manual smoke of the running compose stack (user-driven) surfaced a server-side 500 on /accounts: `link.confidence.toFixed is not a function`.
- Cause: Postgres returns numeric(3,2) as a STRING (pg driver, to avoid float precision loss). apps/api/src/routes/accounts.ts typed link_confidence as `number` (a lie — TS annotations don't coerce at runtime) and passed it through unconverted; the web UI's confidence.toFixed() then threw.
- Fix: serializer coerces with Number(); row type corrected to `string | null`. Regression test added (api.integration.test.ts: seeds a matched link, asserts typeof link.confidence === 'number'). Verified live: confidence renders as a JSON number, /accounts loads 200 in the browser.
- Review-process note: Phase 3's integration tests checked field PRESENCE in AccountListItem but never field TYPE — a `numeric`-string vs number mismatch is invisible to presence checks and to unit tests that build fixtures by hand. This is the R40/RT1 class (cross-boundary serialization shape vs strict consumer) that only a real-DB round-trip through the actual consumer surfaces. The added test closes it for the only numeric column in the schema.
