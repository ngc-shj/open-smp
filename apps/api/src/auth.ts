import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyRequest } from 'fastify';
import { withTenant } from '@open-smp/schema';

export type Session = { id: string; userId: string; tenantId: string; expiresAt: string };
export type SessionContext = { userId: string; tenantId: string };
export type User = { id: string; tenantId: string; email: string };

// argon2id parameters per OWASP Password Storage Cheat Sheet,
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html,
// retrieved 2026-07-24, minimum recommendation m=19MiB,t=2,p=1.
export const ARGON2ID_OPTIONS = {
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export interface Hasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Precomputed at module load so unknown-slug / unknown-email / wrong-password
// all traverse one argon2 verify against a fixed hash (RS1 timing-shape).
// The plaintext behind this hash is never used to authenticate anything.
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(hasher: Hasher): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hasher.hash(randomBytes(32).toString('hex'));
  }
  return dummyHashPromise;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createUser(
  pool: Pool,
  hasher: Hasher,
  tenantId: string,
  email: string,
  password: string,
): Promise<User> {
  const passwordHash = await hasher.hash(password);
  return withTenant(pool, tenantId, async (tx) => {
    const { rows } = await tx.query<{ id: string; tenant_id: string; email: string }>(
      `INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, tenant_id, email`,
      [tenantId, email, passwordHash],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('createUser: insert returned no row');
    }
    return { id: row.id, tenantId: row.tenant_id, email: row.email };
  });
}

/**
 * Resolves tenantSlug -> users(tenant_id, email) -> Session, executing exactly
 * one hasher.verify regardless of whether the slug/email/password resolve, so
 * unknown-slug, unknown-email, and wrong-password share one timing profile (S8/RS1).
 */
export async function verifyLogin(
  pool: Pool,
  hasher: Hasher,
  tenantSlug: string,
  email: string,
  password: string,
): Promise<Session | null> {
  const dummyHash = await getDummyHash(hasher);

  const tenantResult = await pool.query<{ id: string }>(
    'SELECT id FROM tenants WHERE slug = $1',
    [tenantSlug],
  );
  const tenant = tenantResult.rows[0];

  if (!tenant) {
    await hasher.verify(dummyHash, password);
    return null;
  }

  // Tenant-scoped lookup only (never `email` without `tenant_id` in the WHERE — S8).
  // Runs inside withTenant since `users` is RLS-protected.
  const user = await withTenant(pool, tenant.id, async (tx) => {
    const userResult = await tx.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE tenant_id = $1 AND email = $2',
      [tenant.id, email],
    );
    return userResult.rows[0] ?? null;
  });

  if (!user) {
    await hasher.verify(dummyHash, password);
    return null;
  }

  const valid = await hasher.verify(user.password_hash, password);
  if (!valid) {
    return null;
  }

  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await withTenant(pool, tenant.id, async (tx) => {
    const sessionResult = await tx.query<{ id: string }>(
      `INSERT INTO sessions (user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [user.id, tenant.id, tokenHash, expiresAt.toISOString()],
    );
    if (!sessionResult.rows[0]) {
      throw new Error('verifyLogin: session insert returned no row');
    }
  });

  return {
    id: `${tenant.id}.${token}`,
    userId: user.id,
    tenantId: tenant.id,
    expiresAt: expiresAt.toISOString(),
  };
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

const SESSION_COOKIE_NAME = 'session';

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cookie value is `${tenantId}.${token}`: sessions is RLS-protected, so the
// tenant id is needed up front for withTenant to claim a tenant before the
// token-hash lookup can run at all. The embedded tenantId is untrusted input
// used only to pick which tenant to claim — it grants nothing by itself: RLS
// scopes the token_hash lookup to that tenant, so a forged/mismatched
// tenantId simply yields zero rows (fail-closed, same as claiming none).
//
// It MUST still be validated as a UUID here, and SCL8 moved WHERE the failure
// would land rather than removing it. Before migration 0007 an unvalidated
// non-UUID reached `set_config` and then the RLS predicate's `::uuid` cast;
// now `set_tenant_context(uuid)` refuses it at the call, measured as
// `invalid input syntax for type uuid`. Either way it is a pg error and not an
// UnauthorizedError, so it surfaces as a 500 carrying raw DB error text
// instead of the documented fail-closed 401 (CS1).
function parseSessionCookie(cookie: string): { tenantId: string; token: string } | null {
  const separatorIndex = cookie.indexOf('.');
  if (separatorIndex === -1) {
    return null;
  }
  const tenantId = cookie.slice(0, separatorIndex);
  const token = cookie.slice(separatorIndex + 1);
  if (!UUID_RE.test(tenantId) || !token) {
    return null;
  }
  return { tenantId, token };
}

/**
 * Reads the session cookie, looks it up by SHA-256 hash (never by raw token
 * equality), checks expiry, and refreshes the sliding TTL. Throws
 * UnauthorizedError (mapped to 401) when the cookie is missing/invalid/expired.
 */
export async function requireSession(
  pool: Pool,
  req: FastifyRequest,
): Promise<SessionContext> {
  const cookie = req.cookies[SESSION_COOKIE_NAME];
  if (!cookie) {
    throw new UnauthorizedError('missing session cookie');
  }

  const parsed = parseSessionCookie(cookie);
  if (!parsed) {
    throw new UnauthorizedError('malformed session cookie');
  }

  const tokenHash = hashSessionToken(parsed.token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const row = await withTenant(pool, parsed.tenantId, async (tx) => {
    const result = await tx.query<{ user_id: string; tenant_id: string }>(
      `UPDATE sessions SET expires_at = $2
       WHERE token_hash = $1 AND expires_at > now()
       RETURNING user_id, tenant_id`,
      [tokenHash, expiresAt.toISOString()],
    );
    return result.rows[0] ?? null;
  });

  if (!row) {
    throw new UnauthorizedError('invalid or expired session');
  }

  return { userId: row.user_id, tenantId: row.tenant_id };
}

export async function destroySession(pool: Pool, cookie: string): Promise<void> {
  const parsed = parseSessionCookie(cookie);
  if (!parsed) {
    return;
  }
  const tokenHash = hashSessionToken(parsed.token);
  await withTenant(pool, parsed.tenantId, async (tx) => {
    await tx.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  });
}
