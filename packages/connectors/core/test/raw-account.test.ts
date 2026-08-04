import { describe, expect, it } from 'vitest';
import { ACCOUNT_STATUSES } from '@open-smp/api-types';
import { rawAccountSchema } from '../src/raw-account.schema.js';

const validAccount = {
  externalId: 'gws-user-123',
  email: 'taro.yamada@corp.example',
  displayName: 'Taro Yamada',
  accountStatus: 'active',
  isAdmin: false,
  lastActivityAt: '2026-07-01T00:00:00.000Z',
  raw: { id: 'gws-user-123' },
};

describe('rawAccountSchema', () => {
  it('accepts a valid account', () => {
    const result = rawAccountSchema.safeParse(validAccount);

    expect(result.success).toBe(true);
  });

  it('rejects unknown accountStatus values', () => {
    const result = rawAccountSchema.safeParse({ ...validAccount, accountStatus: 'deleted' });

    expect(result.success).toBe(false);
  });

  // I6.10, for C1/I1.2: the validator holds the domain BY REFERENCE.
  //
  // `z.enum([...ACCOUNT_STATUSES])` typechecks identically, satisfies the C39
  // boundary gate (which sweeps the package's exports, not its call sites) and
  // passes every other observer here — and silently discards the freeze, since
  // zod@3.25.76 stores `_def.values` by reference and builds its Set cache
  // lazily on first string-valued parse. A push against a spread copy widens
  // the ingest validator; against the frozen original it throws.
  //
  // `toBe`, not `toEqual`, is the entire point: a spread passes toEqual.
  // `.options` rather than `._def.values` — the same object through zod's
  // public surface, which is what apps/api/test/accounts-query-domain.test.ts:38
  // already uses for this question. (It reads directly only because
  // accountStatus is not `.optional()`; on an optional field `shape.X` is a
  // ZodOptional and needs `.unwrap()` first.)
  it('holds the shared domain by reference rather than a copy of it', () => {
    expect(rawAccountSchema.shape.accountStatus.options).toBe(ACCOUNT_STATUSES);
  });

  it('rejects an account missing externalId', () => {
    const { externalId: _externalId, ...withoutExternalId } = validAccount;

    const result = rawAccountSchema.safeParse(withoutExternalId);

    expect(result.success).toBe(false);
  });
});
