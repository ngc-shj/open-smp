import { describe, expect, it } from 'vitest';
import { rawTokenSchema } from '../src/raw-token.schema.js';

// SC3/C1, the boundary the worker will parse each grant through — the same role
// rawAccountSchema plays for sync.ts. A connector is code this repository owns
// today and may not be tomorrow, so what crosses is validated rather than
// trusted.

const validToken = {
  clientId: '407408718192.apps.googleusercontent.com',
  displayName: 'Analytics Tool',
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  anonymous: false,
  nativeApp: false,
  userKey: 'gws-user-001',
};

describe('rawTokenSchema', () => {
  it('accepts a well-formed grant', () => {
    expect(rawTokenSchema.safeParse(validToken).success).toBe(true);
  });

  it('accepts null for what the provider did not state', () => {
    // The three-state fields. A schema demanding booleans would push the mapper
    // back to coercing absence into `false`, which reports an unrecognised
    // application as a recognised one.
    const result = rawTokenSchema.safeParse({
      ...validToken,
      displayName: null,
      anonymous: null,
      nativeApp: null,
    });

    expect(result.success).toBe(true);
  });

  it('accepts a grant with no scopes', () => {
    expect(rawTokenSchema.safeParse({ ...validToken, scopes: [] }).success).toBe(true);
  });

  it('rejects a grant with no clientId', () => {
    // The aggregation key. Without it FR1 has nothing to count grants against,
    // so an empty string is as useless as an absent one and both are refused.
    expect(rawTokenSchema.safeParse({ ...validToken, clientId: '' }).success).toBe(false);

    const { clientId: _clientId, ...withoutClientId } = validToken;
    expect(rawTokenSchema.safeParse(withoutClientId).success).toBe(false);
  });

  it('rejects a grant that names no user', () => {
    expect(rawTokenSchema.safeParse({ ...validToken, userKey: '' }).success).toBe(false);
  });

  it('rejects scopes that are not strings', () => {
    expect(rawTokenSchema.safeParse({ ...validToken, scopes: [42] }).success).toBe(false);
  });

  it('rejects a boolean field that is neither a boolean nor null', () => {
    // `undefined` would pass an `.optional()` schema and arrive as a missing
    // key downstream, where `anonymous === false` and `anonymous === undefined`
    // read identically in a truthiness test.
    expect(rawTokenSchema.safeParse({ ...validToken, anonymous: undefined }).success).toBe(false);
    expect(rawTokenSchema.safeParse({ ...validToken, anonymous: 'yes' }).success).toBe(false);
  });
});
