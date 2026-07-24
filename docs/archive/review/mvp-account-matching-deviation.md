# Coding Deviation Log: mvp-account-matching

## D1 — C9 module location
- Plan: `apps/api/src/crypto` (C9 heading). Implemented: `packages/crypto`.
- Reason: C5 (worker) decrypts credentials and hosts the rotation sweep CLI; C6 (api) encrypts on registration. A shared package avoids a cross-app source import. Contract signatures, invariants, forbidden patterns, and acceptance criteria unchanged.
