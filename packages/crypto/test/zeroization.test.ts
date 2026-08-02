import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptCredentials,
  encryptCredentials,
  withDecryptedCredentials,
  type CredentialContext,
} from '../src/index.js';

// SC2, review rounds 5 and 6. The control this class never had.
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
// Round 6 found Round 5's own fix open on the exit that matters most. GCM
// decrypts in CTR mode and authenticates in `final()`, so on a tag/AAD/key
// mismatch `final()` throws with the GENUINE plaintext already sitting in the
// `update` output — and the fix had no `try`. The rotation sweep catches per
// row and keeps going, so a version-skewed rollout left one uncleared
// credential per failed row resident for the life of the process.
//
// Round 6 also measured that the three call-site `.fill(0)` lines STILL had no
// observer: this file watched the cipher's intermediates, not the buffer
// `decryptCredentials` hands back, which is the buffer the callers owned. The
// answer is not a fourth assertion — it is that callers no longer own it.
// `withDecryptedCredentials` owns it, this file asserts the helper, and the
// last cell enumerates the class mechanically so a fourth caller cannot
// reintroduce the member.

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

function seal(keys: Map<number, Buffer>): { blob: Uint8Array; keyVersion: number } {
  return encryptCredentials(new TextEncoder().encode(SECRET), ctx, keys);
}

function expectAllZero(buffers: readonly Uint8Array[], what: string): void {
  for (const buffer of buffers) {
    expect(
      buffer.every((byte) => byte === 0),
      `${what} still holds plaintext: ${JSON.stringify(Buffer.from(buffer).toString('utf8').slice(0, 40))}`,
    ).toBe(true);
  }
}

// Per-cell, not per-body. A cell added without its own reset used to inherit the
// previous cell's entries, and the non-vacuity guard below would then be
// satisfied by residue rather than by this cell's own decrypt.
beforeEach(() => {
  captured.length = 0;
});

describe('decryptCredentials leaves no plaintext behind it', () => {
  it('zeroes the cipher intermediates, not only the buffer it returns', () => {
    const keys = makeKeys();
    const { blob, keyVersion } = seal(keys);

    const out = decryptCredentials(blob, keyVersion, ctx, keys);

    // Non-vacuity: the wrapper must actually have seen the cipher, and the
    // decrypt must actually have produced the secret.
    expect(captured.length, 'the cipher wrapper observed nothing').toBeGreaterThan(0);
    expect(new TextDecoder().decode(out)).toBe(SECRET);

    expectAllZero(captured, 'a cipher intermediate');
  });

  it('zeroes the intermediates when the authentication tag is rejected', () => {
    // The exit that matters: `final()` verifies the tag and THROWS, and by then
    // `update()` has already returned the real plaintext — GCM authenticates
    // after it decrypts. Reachable without an attacker: the rotation sweep hits
    // it on any row encrypted under a key version the operator has retired, and
    // keeps sweeping.
    const keys = makeKeys();
    const { blob, keyVersion } = seal(keys);

    const tampered = Buffer.from(blob);
    // First byte of the 16-byte auth tag, which follows the 12-byte nonce.
    tampered.writeUInt8(tampered.readUInt8(12) ^ 0xff, 12);

    expect(() => decryptCredentials(tampered, keyVersion, ctx, keys)).toThrow();

    expect(captured.length, 'the cipher wrapper observed nothing').toBeGreaterThan(0);
    // Non-vacuity for this cell specifically: the plaintext really was produced
    // before the rejection, so a zeroed buffer here is a cleared secret and not
    // an empty one.
    expect(captured.some((buffer) => buffer.length >= SECRET.length)).toBe(true);
    expectAllZero(captured, 'a cipher intermediate on the rejected path');
  });
});

describe('withDecryptedCredentials owns the caller half of the class', () => {
  it('zeroes the plaintext it lends once the caller is done with it', async () => {
    const keys = makeKeys();
    const { blob, keyVersion } = seal(keys);

    let lent: Uint8Array | undefined;
    const result = await withDecryptedCredentials(blob, keyVersion, ctx, keys, (plaintext) => {
      lent = plaintext;
      // Non-vacuity: the caller really did receive the secret.
      expect(new TextDecoder().decode(plaintext)).toBe(SECRET);
      return 'used';
    });

    expect(result).toBe('used');
    expect(lent).toBeDefined();
    expectAllZero([lent as Uint8Array], 'the lent plaintext');
  });

  it('zeroes the plaintext when the caller throws', async () => {
    // The rotation sweep's real shape: `reencryptRow` can fail on the UPDATE
    // after the decrypt has succeeded, and `rotateTenant` counts the failure and
    // continues to the next row.
    const keys = makeKeys();
    const { blob, keyVersion } = seal(keys);

    let lent: Uint8Array | undefined;
    await expect(
      withDecryptedCredentials(blob, keyVersion, ctx, keys, (plaintext) => {
        lent = plaintext;
        expect(new TextDecoder().decode(plaintext)).toBe(SECRET);
        throw new Error('the caller failed');
      }),
    ).rejects.toThrow('the caller failed');

    expect(lent).toBeDefined();
    expectAllZero([lent as Uint8Array], 'the lent plaintext on the throwing path');
  });
});

describe('the credential-plaintext class has one member', () => {
  // Family (a): reads repository files, so `package-test-parity.test.ts`'s
  // addition-guard sees this file mechanically once it is listed there.
  //
  // The list-based fixes did not hold. Three rounds appended one call site each
  // and each declared the class enumerated; R42 clause ①b says to stop
  // appending and derive the membership from the primitive. This is that
  // derivation, run in CI rather than remembered: every production module that
  // decrypts a credential must go through `withDecryptedCredentials`, whose
  // `finally` cannot be forgotten. A fourth caller reaching for
  // `decryptCredentials` directly reds this cell — measured, not assumed.
  //
  // WHAT IT DOES NOT COVER, so it is not read as more than it is: a text scan
  // sees the spelling, not the binding. `const d = decryptCredentials; d(...)`
  // passes it, as would a dynamic import. That residue is stated rather than
  // papered over; what it does close is the shape this class actually grew by,
  // which was three straightforward direct calls added one per round.
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const PRODUCTION_ROOTS = ['apps/api/src', 'apps/web/src', 'apps/worker/src'];

  function sourceFiles(dir: string): string[] {
    const absolute = path.join(REPO_ROOT, dir);
    return readdirSync(absolute, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));
  }

  it('no production module calls decryptCredentials directly', () => {
    const scanned = PRODUCTION_ROOTS.flatMap(sourceFiles);

    // Non-vacuity: a rename of any root would otherwise leave this cell
    // asserting over nothing, which is the tautology shape review found in the
    // orphan-key detector two rounds running.
    expect(scanned.length, 'no production sources scanned').toBeGreaterThan(20);
    expect(
      scanned.some((file) => file.includes('rotate-credentials')),
      'the rotation sweep is not in the scanned set',
    ).toBe(true);

    const direct = scanned.filter((file) =>
      /\bdecryptCredentials\s*\(/.test(readFileSync(path.join(REPO_ROOT, file), 'utf8')),
    );

    expect(direct, 'production modules bypassing withDecryptedCredentials').toEqual([]);
  });
});
