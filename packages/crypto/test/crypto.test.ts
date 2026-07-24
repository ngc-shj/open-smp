import { describe, expect, it } from 'vitest';
import {
  decryptCredentials,
  encryptCredentials,
  parseEncryptionKeys,
  type CredentialContext,
} from '../src/index.js';

function makeKeys(...versions: number[]): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const version of versions) {
    keys.set(version, Buffer.alloc(32, version));
  }
  return keys;
}

function flipByte(buffer: Buffer, offset: number): Buffer {
  const flipped = Buffer.from(buffer);
  flipped.writeUInt8(flipped.readUInt8(offset) ^ 0xff, offset);
  return flipped;
}

const ctx: CredentialContext = { tenantId: 'tenant-a', saasAppId: 'app-1' };
const plaintext = new TextEncoder().encode('super-secret-credential-payload');

describe('encryptCredentials', () => {
  it('yields different blobs when encrypting the same plaintext twice', () => {
    const keys = makeKeys(1);

    const first = encryptCredentials(plaintext, ctx, keys);
    const second = encryptCredentials(plaintext, ctx, keys);

    expect(Buffer.from(first.blob).equals(Buffer.from(second.blob))).toBe(false);
  });

  it('encrypts under the current (highest) key version', () => {
    const keys = makeKeys(1, 2, 5);

    const { keyVersion } = encryptCredentials(plaintext, ctx, keys);

    expect(keyVersion).toBe(5);
  });
});

describe('decryptCredentials', () => {
  it('round-trips plaintext for a valid blob', () => {
    const keys = makeKeys(1);
    const { blob, keyVersion } = encryptCredentials(plaintext, ctx, keys);

    const decrypted = decryptCredentials(blob, keyVersion, ctx, keys);

    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('throws when a byte in the nonce region is flipped', () => {
    const keys = makeKeys(1);
    const { blob, keyVersion } = encryptCredentials(plaintext, ctx, keys);
    const tampered = flipByte(Buffer.from(blob), 0); // nonce is bytes [0, 12)

    expect(() => decryptCredentials(tampered, keyVersion, ctx, keys)).toThrow();
  });

  it('throws when a byte in the tag region is flipped', () => {
    const keys = makeKeys(1);
    const { blob, keyVersion } = encryptCredentials(plaintext, ctx, keys);
    const tampered = flipByte(Buffer.from(blob), 12); // tag is bytes [12, 28)

    expect(() => decryptCredentials(tampered, keyVersion, ctx, keys)).toThrow();
  });

  it('throws when a byte in the ciphertext region is flipped', () => {
    const keys = makeKeys(1);
    const { blob, keyVersion } = encryptCredentials(plaintext, ctx, keys);
    const tampered = flipByte(Buffer.from(blob), 28); // ciphertext starts at byte 28

    expect(() => decryptCredentials(tampered, keyVersion, ctx, keys)).toThrow();
  });

  it('throws when decrypting with a different tenantId in AAD', () => {
    const keys = makeKeys(1);
    const { blob, keyVersion } = encryptCredentials(plaintext, ctx, keys);

    expect(() =>
      decryptCredentials(blob, keyVersion, { ...ctx, tenantId: 'tenant-b' }, keys),
    ).toThrow();
  });

  it('throws when decrypting with a different saasAppId in AAD', () => {
    const keys = makeKeys(1);
    const { blob, keyVersion } = encryptCredentials(plaintext, ctx, keys);

    expect(() =>
      decryptCredentials(blob, keyVersion, { ...ctx, saasAppId: 'app-2' }, keys),
    ).toThrow();
  });

  it('throws when decrypting with a different keyVersion in AAD', () => {
    const keys = makeKeys(1, 2);
    const { blob } = encryptCredentials(plaintext, ctx, keys);

    // blob was encrypted under version 2 (highest); claim version 1 instead.
    expect(() => decryptCredentials(blob, 1, ctx, keys)).toThrow();
  });

  it('throws for an unknown key version', () => {
    const keys = makeKeys(1);
    const { blob } = encryptCredentials(plaintext, ctx, keys);

    expect(() => decryptCredentials(blob, 99, ctx, keys)).toThrow();
  });
});

describe('key rotation', () => {
  it('decrypts a blob encrypted under version 1 while version 2 is current, and new encrypts carry version 2', () => {
    const keysAtV1 = makeKeys(1);
    const { blob: blobV1, keyVersion: versionV1 } = encryptCredentials(plaintext, ctx, keysAtV1);
    expect(versionV1).toBe(1);

    const keysAtV2 = makeKeys(1, 2);

    const decrypted = decryptCredentials(blobV1, versionV1, ctx, keysAtV2);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);

    const { keyVersion: newVersion } = encryptCredentials(plaintext, ctx, keysAtV2);
    expect(newVersion).toBe(2);
  });
});

describe('parseEncryptionKeys', () => {
  it('parses a single version:base64key pair', () => {
    const key = Buffer.alloc(32, 7);
    const keys = parseEncryptionKeys(`1:${key.toString('base64')}`);

    expect(keys.size).toBe(1);
    expect(keys.get(1)?.equals(key)).toBe(true);
  });

  it('parses multiple comma-separated version:base64key pairs', () => {
    const key1 = Buffer.alloc(32, 1);
    const key2 = Buffer.alloc(32, 2);
    const keys = parseEncryptionKeys(`1:${key1.toString('base64')},2:${key2.toString('base64')}`);

    expect(keys.size).toBe(2);
    expect(keys.get(1)?.equals(key1)).toBe(true);
    expect(keys.get(2)?.equals(key2)).toBe(true);
  });

  it('rejects a key that decodes to fewer than 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');

    expect(() => parseEncryptionKeys(`1:${shortKey}`)).toThrow();
  });

  it('rejects a key that decodes to more than 32 bytes', () => {
    const longKey = Buffer.alloc(48, 1).toString('base64');

    expect(() => parseEncryptionKeys(`1:${longKey}`)).toThrow();
  });

  it('rejects malformed input missing the version:key separator', () => {
    const key = Buffer.alloc(32, 1).toString('base64');

    expect(() => parseEncryptionKeys(key)).toThrow();
  });

  it('rejects malformed input with a non-numeric version', () => {
    const key = Buffer.alloc(32, 1).toString('base64');

    expect(() => parseEncryptionKeys(`v1:${key}`)).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => parseEncryptionKeys('')).toThrow();
  });
});
