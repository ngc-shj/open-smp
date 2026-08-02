import { describe, expect, it, vi } from 'vitest';
import {
  decryptCredentials,
  encryptCredentials,
  type CredentialContext,
} from '../src/index.js';

// SC2, review round 5. The control this class never had.
//
// Three call sites were fixed one at a time across three consecutive rounds to
// zero the buffer `decryptCredentials` returns — and NOTHING anywhere asserted
// any of it: all three `.fill(0)` lines could be deleted with every suite green.
// Round 5 then measured that all three were defeated anyway, because
// `decipher.update()`'s output holds the entire plaintext and was never
// cleared. The rotation sweep never stringifies a credential, so on that path
// the `update` output was the ONLY surviving plaintext for every tenant's every
// key.
//
// The control lives HERE because the class is closed here: this repository has
// exactly one `createDecipheriv`, so every present and future caller is covered
// by one assertion. R42 clause ①b — once a member set has grown by accretion
// twice, re-derive from the primitive instead of appending a fourth site.

const captured: Buffer[] = [];

vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof import('node:crypto')>();
  return {
    ...actual,
    createDecipheriv: ((...args: Parameters<typeof actual.createDecipheriv>) => {
      const decipher = actual.createDecipheriv(...args);
      const update = decipher.update.bind(decipher);
      const final = decipher.final.bind(decipher);
      // Every buffer the cipher hands back, which is where the plaintext lives
      // before `Buffer.concat` copies it.
      decipher.update = ((...u: unknown[]) => {
        const out = (update as (...args: unknown[]) => unknown)(...u);
        if (Buffer.isBuffer(out)) captured.push(out);
        return out;
      }) as typeof decipher.update;
      decipher.final = ((...f: unknown[]) => {
        const out = (final as (...args: unknown[]) => unknown)(...f);
        if (Buffer.isBuffer(out)) captured.push(out);
        return out;
      }) as typeof decipher.final;
      return decipher;
    }) as typeof actual.createDecipheriv,
  };
});

const ctx: CredentialContext = { tenantId: 'tenant-a', saasAppId: 'app-1' };
const SECRET = '-----BEGIN PRIVATE KEY-----SUPERSECRET-----END PRIVATE KEY-----';

function makeKeys(): Map<number, Buffer> {
  return new Map([[1, Buffer.alloc(32, 7)]]);
}

describe('decryptCredentials leaves no plaintext behind it', () => {
  it('zeroes the cipher intermediates, not only the buffer it returns', () => {
    captured.length = 0;
    const keys = makeKeys();
    const { blob, keyVersion } = encryptCredentials(new TextEncoder().encode(SECRET), ctx, keys);

    const out = decryptCredentials(blob, keyVersion, ctx, keys);

    // Non-vacuity: the wrapper must actually have seen the cipher, and the
    // decrypt must actually have produced the secret.
    expect(captured.length, 'the cipher wrapper observed nothing').toBeGreaterThan(0);
    expect(new TextDecoder().decode(out)).toBe(SECRET);

    for (const intermediate of captured) {
      expect(
        intermediate.every((byte) => byte === 0),
        `a cipher intermediate still holds plaintext: ${JSON.stringify(intermediate.toString('utf8').slice(0, 40))}`,
      ).toBe(true);
    }
  });

  it('returns a buffer a caller can zero, and one that is not shared', () => {
    // The other half of the contract the three call sites rely on: the returned
    // buffer is theirs to clear, and clearing it cannot corrupt anything the
    // library kept.
    captured.length = 0;
    const keys = makeKeys();
    const { blob, keyVersion } = encryptCredentials(new TextEncoder().encode(SECRET), ctx, keys);

    const first = decryptCredentials(blob, keyVersion, ctx, keys);
    first.fill(0);
    const second = decryptCredentials(blob, keyVersion, ctx, keys);

    expect(new TextDecoder().decode(second)).toBe(SECRET);
  });
});
