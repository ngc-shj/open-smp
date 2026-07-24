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

  for (const entry of env.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') {
      throw new Error(`Invalid ENCRYPTION_KEYS entry: empty segment`);
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Invalid ENCRYPTION_KEYS entry: "${trimmed}"`);
    }

    const versionText = trimmed.slice(0, separatorIndex);
    const base64Key = trimmed.slice(separatorIndex + 1);

    if (!/^\d+$/.test(versionText)) {
      throw new Error(`Invalid ENCRYPTION_KEYS version: "${versionText}"`);
    }
    const version = Number.parseInt(versionText, 10);

    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `Invalid ENCRYPTION_KEYS key for version ${version}: expected ${KEY_LENGTH} bytes, got ${key.length}`,
      );
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

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
