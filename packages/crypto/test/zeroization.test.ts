import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptCredentials,
  encryptCredentialRecord,
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

describe('encryptCredentialRecord owns the encrypt half', () => {
  it('zeroes the plaintext it builds', () => {
    // The encrypt side was closed one round after the decrypt side, and in
    // between it lived as two `plaintext.fill(0)` call sites in the API routes
    // with nothing asserting either. The buffer is allocated inside the helper,
    // so the only way to see it is to capture what `TextEncoder` handed back.
    const captured: Uint8Array[] = [];
    // A fresh encoder rather than `this`: TextEncoder is stateless and always
    // UTF-8, and the receiver is not typed the same way in every tsconfig this
    // package builds under.
    const realEncode = TextEncoder.prototype.encode;
    const spy = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation((input?: string) => {
      const out = realEncode.call(new TextEncoder(), input);
      captured.push(out);
      return out;
    });

    try {
      const keys = makeKeys();
      const { blob } = encryptCredentialRecord({ botToken: SECRET }, ctx, keys);

      // Non-vacuity: the encode really happened, it really carried the secret,
      // and the ciphertext really was produced.
      expect(captured.length, 'nothing was encoded').toBeGreaterThan(0);
      expect(
        captured.some((buffer) => buffer.length >= SECRET.length),
        'the captured buffer never held the credential',
      ).toBe(true);
      expect(blob.length).toBeGreaterThan(0);

      expectAllZero(captured, 'the encrypt-side plaintext');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the credential-plaintext class has one member', () => {
  // Family (a): reads repository files, so `package-test-parity.test.ts`'s
  // addition-guard sees this file mechanically once it is listed there.
  //
  // The list-based fixes did not hold. Three rounds appended one call site each
  // and each declared the class enumerated; R42 clause ①b says to stop
  // appending and derive the membership from the primitive. This is that
  // derivation, run in CI rather than remembered — and the SCAN ITSELF is
  // derived, because the first version of this cell hard-coded three roots and
  // left every `packages/*/src` unscanned while claiming to enumerate the class.
  //
  // WHAT IT DOES NOT COVER, so it is not read as more than it is: a text scan
  // sees the spelling, not the binding. `const d = decryptCredentials; d(...)`
  // passes it, as would a dynamic import. That residue is stated rather than
  // papered over; what it does close is the shape this class actually grew by,
  // which was three straightforward direct calls added one per round.
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

  /** Every `src` directory a workspace package ships, discovered rather than listed. */
  function productionRoots(): string[] {
    const roots: string[] = [];
    const walk = (relative: string, depth: number): void => {
      for (const entry of readdirSync(path.join(REPO_ROOT, relative), { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'node_modules') continue;
        const child = `${relative}/${entry.name}`;
        if (entry.name === 'src') roots.push(child);
        else if (depth > 0) walk(child, depth - 1);
      }
    };
    walk('apps', 2);
    walk('packages', 2);
    return roots.sort();
  }

  function sourceFiles(dir: string): string[] {
    const absolute = path.join(REPO_ROOT, dir);
    return readdirSync(absolute, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));
  }

  it.each([
    ['decryptCredentials', /\bdecryptCredentials\s*\(/],
    // BOTH HALVES. The encrypt side was closed one round later than the decrypt
    // side, and in between it had two `plaintext.fill(0)` call sites in the API
    // routes with nothing asserting either — the class re-opening at the very
    // moment the other half was declared derived.
    ['encryptCredentials', /\bencryptCredentials\s*\(/],
  ])('no production module calls %s directly', (_label, pattern) => {
    const roots = productionRoots();

    // Per ROOT, not over the union. A `> 20` floor across three roots was
    // satisfied with a whole root removed — the shape R50 names, and the reason
    // the first version of this cell could have lost `apps/api/src` silently.
    for (const root of roots) {
      expect(sourceFiles(root).length, `${root} scanned nothing`).toBeGreaterThan(0);
    }
    // Named representatives, one per area this class has actually reached or
    // could reach next: the worker sweep it grew in, the API routes that hold
    // the encrypt half, and a connector package — the tree the first version
    // never looked at.
    const scanned = roots.flatMap(sourceFiles);
    for (const representative of [
      'apps/worker/src/rotate-credentials.ts',
      'apps/api/src/routes/saas-apps.ts',
      'packages/connectors/core/src/index.ts',
    ]) {
      expect(scanned, `${representative} is not in the scanned set`).toContain(representative);
    }

    const direct = scanned
      // The definer, which necessarily calls both — the helpers live here.
      .filter((file) => file !== 'packages/crypto/src/index.ts')
      .filter((file) => {
        const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
        if (!pattern.test(source)) return false;
        // Exempt by STRUCTURE rather than by name: a module INSIDE a
        // `withDecryptedCredentials` callback is re-encrypting a plaintext the
        // helper already owns and clears — the rotation sweep's shape. A module
        // that builds its own plaintext buffer does not call the decrypt helper
        // and is not exempted, which is the case this cell exists for.
        return !/\bwithDecryptedCredentials\s*\(/.test(source);
      });

    expect(direct, 'production modules bypassing the crypto package helpers').toEqual([]);
  });

  it('the decrypt primitive itself has exactly one call site', () => {
    // The sentence the primitive-level fix rests on — "there is exactly one
    // `createDecipheriv` in this repository" — was load-bearing prose that
    // nothing asserted. A fourth site reaching for `node:crypto` directly never
    // touches `decryptCredentials` and would not trip the cell above.
    const definers = productionRoots()
      .flatMap(sourceFiles)
      .filter((file) =>
        /\bcreateDecipheriv\s*\(/.test(readFileSync(path.join(REPO_ROOT, file), 'utf8')),
      );

    expect(definers, 'the decrypt primitive is called outside packages/crypto').toEqual([
      'packages/crypto/src/index.ts',
    ]);
  });

  it('hands the caller zeros if it returns the lent buffer itself', () => {
    // The helper's contract is a convention: `use` receives a live buffer and
    // nothing in the type system stops it being returned. Pinned rather than
    // assumed, so the behaviour is at least known — a caller that does this gets
    // zeros, not a plaintext that escaped the finally.
    const keys = makeKeys();
    const { blob, keyVersion } = seal(keys);

    return withDecryptedCredentials(blob, keyVersion, ctx, keys, (plaintext) => plaintext).then(
      (escaped) => {
        expectAllZero([escaped], 'a plaintext returned out of the helper');
      },
    );
  });
});
