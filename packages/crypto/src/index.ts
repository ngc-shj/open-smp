import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface CredentialContext {
  tenantId: string;
  saasAppId: string;
}

/**
 * Parses the ENCRYPTION_KEYS env format: "version:base64key[,version:base64key...]".
 * Every key must decode to exactly 32 bytes (AES-256).
 */
export function parseEncryptionKeys(env: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();

  // POSITION, NEVER CONTENT. These messages reach stderr on every boot path
  // (apps/worker/src/main.ts, apps/api/src/main.ts, seed.ts, the rotation CLI),
  // and stderr is what ships to the log aggregator. The two likeliest operator
  // mistakes both make the offending text the KEY ITSELF: omitting the `1:`
  // prefix leaves `trimmed` as the bare 44-character base64 AES-256 key, and
  // transposing it to `<key>:1` leaves `versionText` as the key, since base64's
  // alphabet contains no `:` to truncate on. Interpolating either published the
  // master key of every tenant's credentials into a store with a wider read
  // audience than the secret store, recoverable only by a full key rotation.
  const entries = env.split(',');
  for (const [index, entry] of entries.entries()) {
    const trimmed = entry.trim();
    if (trimmed === '') {
      throw new Error(`Invalid ENCRYPTION_KEYS entry at index ${index}: empty segment`);
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(
        `Invalid ENCRYPTION_KEYS entry at index ${index}: expected "version:base64key"`,
      );
    }

    const versionText = trimmed.slice(0, separatorIndex);
    const base64Key = trimmed.slice(separatorIndex + 1);

    if (!/^\d+$/.test(versionText)) {
      throw new Error(
        `Invalid ENCRYPTION_KEYS entry at index ${index}: version is not a decimal integer`,
      );
    }
    const version = Number.parseInt(versionText, 10);
    // BOUNDED. `buildAad` writes the version with `writeUInt32BE`, which throws
    // above 2^32-1 — but only at the first encrypt, long after a bad value has
    // been accepted at boot. A version outside the range the AAD can represent
    // is a configuration error, so it is refused where it is read.
    if (!Number.isSafeInteger(version) || version < 0 || version > 0xffff_ffff) {
      throw new Error(
        `Invalid ENCRYPTION_KEYS entry at index ${index}: version is outside 0..2^32-1`,
      );
    }

    const key = Buffer.from(base64Key, 'base64');
    // CANONICAL, not merely decodable. Node's base64 decoder skips characters
    // it does not recognise and tolerates non-zero trailing bits, so several
    // distinct strings decode to the same 32 bytes and a typo inside the key can
    // decode to a DIFFERENT valid key than the operator pasted — booting cleanly
    // under a master key nothing was sealed with. Re-encoding and comparing is
    // the cheapest exact check.
    if (key.length === KEY_LENGTH && key.toString('base64') !== base64Key) {
      throw new Error(
        `Invalid ENCRYPTION_KEYS entry at index ${index}: key is not canonical base64`,
      );
    }
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `Invalid ENCRYPTION_KEYS key for version ${version}: expected ${KEY_LENGTH} bytes, got ${key.length}`,
      );
    }

    // A REPEATED version is a configuration error, not a last-one-wins merge.
    // `Map.set` silently overwrote, so `ENCRYPTION_KEYS=1:<a>,1:<b>` booted
    // cleanly under <b> while every credential sealed under <a> failed its GCM
    // tag on the next read and the rotation sweep counted them all as failures.
    if (keys.has(version)) {
      throw new Error(`Invalid ENCRYPTION_KEYS: version ${version} appears more than once`);
    }
    keys.set(version, key);
  }

  if (keys.size === 0) {
    throw new Error('ENCRYPTION_KEYS must contain at least one version:base64key entry');
  }

  return keys;
}

function currentVersion(keys: Map<number, Buffer>): number {
  return Math.max(...keys.keys());
}

function requireKey(keys: Map<number, Buffer>, version: number): Buffer {
  const key = keys.get(version);
  if (!key) {
    throw new Error(`Unknown encryption key version: ${version}`);
  }
  return key;
}

function buildAad(ctx: CredentialContext, keyVersion: number): Buffer {
  const versionBuffer = Buffer.alloc(4);
  versionBuffer.writeUInt32BE(keyVersion, 0);

  return Buffer.concat([
    Buffer.from(ctx.tenantId, 'utf8'),
    Buffer.from([0x00]),
    Buffer.from(ctx.saasAppId, 'utf8'),
    Buffer.from([0x00]),
    versionBuffer,
  ]);
}

export function encryptCredentials(
  plaintext: Uint8Array,
  ctx: CredentialContext,
  keys: Map<number, Buffer>,
): { blob: Uint8Array; keyVersion: number } {
  const keyVersion = currentVersion(keys);
  const key = requireKey(keys, keyVersion);

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(buildAad(ctx, keyVersion));

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob = Buffer.concat([nonce, tag, ciphertext]);

  return { blob, keyVersion };
}

export function decryptCredentials(
  blob: Uint8Array,
  keyVersion: number,
  ctx: CredentialContext,
  keys: Map<number, Buffer>,
): Uint8Array {
  const key = requireKey(keys, keyVersion);

  const buffer = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (buffer.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid credential blob: too short');
  }

  const nonce = buffer.subarray(0, NONCE_LENGTH);
  const tag = buffer.subarray(NONCE_LENGTH, NONCE_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(NONCE_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(buildAad(ctx, keyVersion));
  decipher.setAuthTag(tag);

  // The INTERMEDIATES are zeroed, not just the result, and ON BOTH EXITS.
  //
  // `Buffer.concat([update(...), final(...)])` allocates a third buffer and
  // leaves the first two holding the complete plaintext — for AES-256-GCM
  // `update` returns all of it and `final` returns nothing. Three call sites
  // were fixed one at a time across three review rounds to zero the buffer this
  // function returns, and every one of them was defeated here: the sweep in
  // rotate-credentials never stringifies a credential, so after its own fix the
  // `update` output was the ONLY surviving plaintext for every tenant's every
  // key.
  //
  // THE THROW PATH. `final()` is where GCM verifies the tag, and it is the call
  // that throws — on a tampered blob, on a retired key version, on any AAD
  // mismatch. GCM decrypts in CTR mode BEFORE authenticating, so at that moment
  // `head` holds the genuine plaintext, not garbage. The first version of this
  // fix had no `try`, so the whole class stayed open on the error path: the
  // rotation sweep catches per row and continues, leaving one uncleared
  // credential per failed row resident for the life of the process.
  //
  // Fixed at the primitive rather than at a fourth call site. There is exactly
  // one `createDecipheriv` in this repository, so this closes the DECRYPT half
  // of the class — which is what R42 clause ①b prescribes once a member set has
  // grown by accretion twice. It is not the whole class: the encrypt-side input
  // buffers at apps/api/src/routes/saas-apps.ts and the JS strings derived from
  // the plaintext by sync.ts / token-audit.ts are separate members, handled
  // where they are allocated and accepted respectively (C9's in-memory
  // lifecycle note). `withDecryptedCredentials` below is what keeps the callers'
  // half of the class at one member.
  let head: Buffer | undefined;
  let tail: Buffer | undefined;
  try {
    head = decipher.update(ciphertext);
    tail = decipher.final();
    return Buffer.concat([head, tail]);
  } finally {
    head?.fill(0);
    tail?.fill(0);
  }
}

/**
 * Encodes `value` as JSON, encrypts it, and zeroes the plaintext buffer.
 *
 * THE ENCRYPT HALF, at the same primitive as the decrypt half. Round 6 closed
 * the decrypt side here and then opened two fresh `plaintext.fill(0)` call sites
 * on the encrypt side in `apps/api/src/routes/saas-apps.ts`, in the same commit
 * — appended rather than derived, which is exactly the accretion R42 clause ①b
 * names and exactly what four rounds of this review already paid for.
 *
 * The residue is unchanged and is not claimed away: `JSON.stringify` produces an
 * immutable JS string that cannot be zeroized at any level, so this bounds the
 * clearable copy and nothing more. See C9's in-memory lifecycle note.
 */
export function encryptCredentialRecord(
  // `Record<string, string>`, not `unknown`. `JSON.stringify(undefined)` returns
  // undefined and `TextEncoder#encode()` defaults to `''`, so the wider type
  // would encrypt and persist a zero-length plaintext with a valid tag — failing
  // much later as a `JSON.parse('')` in the worker, with no pointer to the write.
  value: Record<string, string>,
  ctx: CredentialContext,
  keys: Map<number, Buffer>,
): { blob: Uint8Array; keyVersion: number } {
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  try {
    return encryptCredentials(plaintext, ctx, keys);
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Decrypts, hands the plaintext to `use`, and zeroes it however `use` ends.
 *
 * THE CALLERS' HALF OF THE CLASS, AT ONE MEMBER. Three worker call sites were
 * each taught to zero the returned buffer, one per review round — sync.ts, then
 * token-audit.ts, then rotate-credentials.ts — and each time the class was
 * declared enumerated and was not. R42 clause ①b: after a member set has grown
 * by accretion twice, stop appending sites and derive the control from the
 * primitive. Every production decrypt goes through here, so the `finally` is
 * written once and cannot be forgotten by a fourth caller.
 *
 * `packages/crypto/test/zeroization.test.ts` enumerates the class mechanically
 * and reds if a production module calls `decryptCredentials` directly.
 */
export async function withDecryptedCredentials<T>(
  blob: Uint8Array,
  keyVersion: number,
  ctx: CredentialContext,
  keys: Map<number, Buffer>,
  use: (plaintext: Uint8Array) => T | Promise<T>,
): Promise<T> {
  const plaintext = decryptCredentials(blob, keyVersion, ctx, keys);
  try {
    return await use(plaintext);
  } finally {
    plaintext.fill(0);
  }
}
