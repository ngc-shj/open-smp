import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { verifyLogin, type Hasher } from '../src/auth.js';

// C7 acceptance: wrong password, unknown email, and unknown tenant slug all
// return null AND all execute exactly one hasher.verify call (RS1 timing-shape).

function makeFakeHasher(overrides?: Partial<Hasher>): Hasher {
  return {
    hash: vi.fn(async (password: string) => `hashed:${password}`),
    verify: vi.fn(async (hash: string, password: string) => hash === `hashed:${password}`),
    ...overrides,
  };
}

type QueryCall = { text: string; values: unknown[] };

function makeFakePool(options: {
  tenant?: { id: string; slug: string };
  user?: { id: string; passwordHash: string; email: string; tenantId: string };
}): { pool: Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];

  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });

    if (text.startsWith('SELECT id FROM tenants')) {
      const slug = values[0];
      if (options.tenant && options.tenant.slug === slug) {
        return { rows: [{ id: options.tenant.id }] };
      }
      return { rows: [] };
    }

    if (text.startsWith('SELECT set_config')) {
      return { rows: [] };
    }
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] };
    }

    if (text.startsWith('SELECT id, password_hash FROM users')) {
      const [tenantId, email] = values;
      if (
        options.user &&
        options.user.tenantId === tenantId &&
        options.user.email === email
      ) {
        return { rows: [{ id: options.user.id, password_hash: options.user.passwordHash }] };
      }
      return { rows: [] };
    }

    if (text.startsWith('INSERT INTO sessions')) {
      return { rows: [{ id: 'session-row-id' }] };
    }

    throw new Error(`unexpected query: ${text}`);
  });

  const client = { query, release: vi.fn() };
  const pool = {
    connect: vi.fn(async () => client),
    query,
  } as unknown as Pool;

  return { pool, calls };
}

describe('verifyLogin', () => {
  it('returns null and executes exactly one verify for an unknown tenant slug', async () => {
    const { pool } = makeFakePool({});
    const hasher = makeFakeHasher();

    const session = await verifyLogin(pool, hasher, 'no-such-tenant', 'user@example.com', 'password');

    expect(session).toBeNull();
    expect(hasher.verify).toHaveBeenCalledTimes(1);
  });

  it('returns null and executes exactly one verify for an unknown email within a known tenant', async () => {
    const { pool } = makeFakePool({ tenant: { id: 'tenant-a', slug: 'acme' } });
    const hasher = makeFakeHasher();

    const session = await verifyLogin(pool, hasher, 'acme', 'nobody@example.com', 'password');

    expect(session).toBeNull();
    expect(hasher.verify).toHaveBeenCalledTimes(1);
  });

  it('returns null and executes exactly one verify for a wrong password', async () => {
    const { pool } = makeFakePool({
      tenant: { id: 'tenant-a', slug: 'acme' },
      user: {
        id: 'user-1',
        tenantId: 'tenant-a',
        email: 'user@example.com',
        passwordHash: 'hashed:correct-password',
      },
    });
    const hasher = makeFakeHasher();

    const session = await verifyLogin(pool, hasher, 'acme', 'user@example.com', 'wrong-password');

    expect(session).toBeNull();
    expect(hasher.verify).toHaveBeenCalledTimes(1);
  });

  it('returns a session for correct tenant slug, email, and password', async () => {
    const { pool } = makeFakePool({
      tenant: { id: 'tenant-a', slug: 'acme' },
      user: {
        id: 'user-1',
        tenantId: 'tenant-a',
        email: 'user@example.com',
        passwordHash: 'hashed:correct-password',
      },
    });
    const hasher = makeFakeHasher();

    const session = await verifyLogin(pool, hasher, 'acme', 'user@example.com', 'correct-password');

    expect(session).not.toBeNull();
    expect(session?.userId).toBe('user-1');
    expect(session?.tenantId).toBe('tenant-a');
    expect(hasher.verify).toHaveBeenCalledTimes(1);
  });

  it('uses a tenant-scoped WHERE clause for the users lookup (tenant_id AND email)', async () => {
    const { pool, calls } = makeFakePool({ tenant: { id: 'tenant-a', slug: 'acme' } });
    const hasher = makeFakeHasher();

    await verifyLogin(pool, hasher, 'acme', 'nobody@example.com', 'password');

    const userQuery = calls.find((call) => call.text.includes('FROM users'));
    expect(userQuery?.text).toMatch(/tenant_id\s*=\s*\$1/);
    expect(userQuery?.text).toMatch(/email\s*=\s*\$2/);
  });
});
