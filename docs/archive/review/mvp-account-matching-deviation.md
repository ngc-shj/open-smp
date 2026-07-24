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
