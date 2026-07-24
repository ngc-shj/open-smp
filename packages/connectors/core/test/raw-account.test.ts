import { describe, expect, it } from 'vitest';
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

  it('rejects an account missing externalId', () => {
    const { externalId, ...withoutExternalId } = validAccount;

    const result = rawAccountSchema.safeParse(withoutExternalId);

    expect(result.success).toBe(false);
  });
});
