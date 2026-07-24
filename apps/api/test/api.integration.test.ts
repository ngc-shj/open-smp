import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { runMigrations, withTenant } from '@open-smp/schema';
import { SYNC_QUEUE, MATCH_QUEUE, type SyncJobData, type MatchJobData } from '@open-smp/queues';
import { buildApp } from '../src/app.js';
import { ARGON2ID_OPTIONS, type Hasher } from '../src/auth.js';
import type { AppDeps } from '../src/deps.js';

// C6/C7 acceptance criteria, verified end to end against real Postgres 16 +
// Redis 7 via Testcontainers, exercising the real Fastify pipeline through
// app.inject (no mocked HTTP layer).

const APP_ORIGIN = 'http://localhost:3000';

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let appPool: Pool;
let redisConnection: IORedis;
let app: FastifyInstance;
let deps: AppDeps;

const hasher: Hasher = {
  hash: (password) => argon2.hash(password, { type: argon2.argon2id, ...ARGON2ID_OPTIONS }),
  verify: (hash, password) => argon2.verify(hash, password),
};

async function seedTenant(slug: string, name: string): Promise<string> {
  const result = await appPool.query<{ id: string }>(
    'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id',
    [slug, name],
  );
  const row = result.rows[0];
  if (!row) throw new Error('tenant insert returned no row');
  return row.id;
}

async function seedUser(tenantId: string, email: string, password: string): Promise<string> {
  const passwordHash = await hasher.hash(password);
  return withTenant(appPool, tenantId, async (tx) => {
    const result = await tx.query<{ id: string }>(
      'INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [tenantId, email, passwordHash],
    );
    const row = result.rows[0];
    if (!row) throw new Error('user insert returned no row');
    return row.id;
  });
}

async function loginAndGetCookie(
  tenantSlug: string,
  email: string,
  password: string,
): Promise<string | null> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: APP_ORIGIN },
    payload: { tenantSlug, email, password },
  });
  if (res.statusCode !== 200) {
    return null;
  }
  const setCookie = res.cookies.find((c) => c.name === 'session');
  return setCookie ? `session=${setCookie.value}` : null;
}

// Cookie value is `session=${tenantId}.${token}` (auth.ts parseSessionCookie);
// requireSession looks the row up by SHA-256(token) in sessions.token_hash.
function tokenHashFromCookie(cookie: string): string {
  const raw = cookie.slice('session='.length);
  const token = raw.slice(raw.indexOf('.') + 1);
  return createHash('sha256').update(token).digest('hex');
}

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres:16').start();
  redisContainer = await new RedisContainer('redis:7').withPassword('test-password').start();

  await runMigrations(pgContainer.getConnectionUri());

  const url = new URL(pgContainer.getConnectionUri());
  url.username = 'opensmp_app';
  url.password = 'opensmp';
  appPool = new Pool({ connectionString: url.toString() });

  redisConnection = new IORedis(redisContainer.getConnectionUrl(), { maxRetriesPerRequest: null });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await redisConnection?.quit();
  await appPool?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
}, 60_000);

beforeEach(async () => {
  await app?.close();

  const syncQueue = new Queue<SyncJobData>(SYNC_QUEUE, { connection: redisConnection });
  const matchQueue = new Queue<MatchJobData>(MATCH_QUEUE, { connection: redisConnection });
  await syncQueue.obliterate({ force: true }).catch(() => undefined);
  await matchQueue.obliterate({ force: true }).catch(() => undefined);

  deps = {
    pool: appPool,
    encryptionKeys: new Map([[1, Buffer.alloc(32, 7)]]),
    appOrigin: APP_ORIGIN,
    hasher,
    syncQueue,
    matchQueue,
    getJob: async (jobId) => {
      const job = (await syncQueue.getJob(jobId)) ?? (await matchQueue.getJob(jobId));
      if (!job) return null;
      const state = await job.getState();
      return { state, result: job.returnvalue ?? null };
    },
  };

  app = buildApp(deps);
  await app.ready();
});

describe('C6 acceptance: 401 sweep over every non-login route', () => {
  it('unauthenticated request to every non-login route returns 401', async () => {
    const nonLoginRoutes = app.apiRoutes.filter(
      (route) => !(route.method === 'POST' && route.url === '/api/auth/login'),
    );
    expect(nonLoginRoutes.length).toBeGreaterThan(0);

    for (const route of nonLoginRoutes) {
      const url = route.url.replace(':saasAppId', randomUUID()).replace(':jobId', 'x');
      const res = await app.inject({
        method: route.method as 'GET' | 'POST',
        url,
        headers: route.method === 'GET' ? {} : { origin: APP_ORIGIN },
      });
      expect(res.statusCode, `${route.method} ${route.url} should 401 unauthenticated`).toBe(401);
    }
  });
});

describe('C6 acceptance: Origin 403 sweep over every non-GET route', () => {
  it('non-GET request with missing Origin returns 403 on every mutation route, no exemptions', async () => {
    const nonGetRoutes = app.apiRoutes.filter((route) => route.method !== 'GET' && route.method !== 'HEAD');
    expect(nonGetRoutes.length).toBeGreaterThan(0);

    for (const route of nonGetRoutes) {
      const url = route.url.replace(':saasAppId', randomUUID()).replace(':jobId', 'x');
      const res = await app.inject({ method: route.method as 'POST', url });
      expect(res.statusCode, `${route.method} ${route.url} should 403 with missing Origin`).toBe(403);
    }
  });

  it('non-GET request with mismatched Origin returns 403 on every mutation route, no exemptions', async () => {
    const nonGetRoutes = app.apiRoutes.filter((route) => route.method !== 'GET' && route.method !== 'HEAD');
    expect(nonGetRoutes.length).toBeGreaterThan(0);

    for (const route of nonGetRoutes) {
      const url = route.url.replace(':saasAppId', randomUUID()).replace(':jobId', 'x');
      const res = await app.inject({
        method: route.method as 'POST',
        url,
        headers: { origin: 'https://evil.example' },
      });
      expect(res.statusCode, `${route.method} ${route.url} should 403 with mismatched Origin`).toBe(403);
    }
  });

  it('dedicated test: POST /api/auth/login with missing Origin returns 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { tenantSlug: 'acme', email: 'a@example.com', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('dedicated test: POST /api/auth/login with mismatched Origin returns 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { tenantSlug: 'acme', email: 'a@example.com', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('C6 acceptance: login rate limit', () => {
  it('returns 429 on the 6th login attempt within a minute', async () => {
    const payload = { tenantSlug: 'no-such-tenant-rl', email: 'nobody@example.com', password: 'wrong' };
    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: APP_ORIGIN },
        payload,
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('C6/S12 acceptance: login account-bucket independence', () => {
  it('5 failures on slugX:userX do not 429 the first attempt on slugX:userY', async () => {
    // remoteAddress (not x-forwarded-for): trustProxy is off, so req.ip only
    // varies via the injected socket address — this isolates the account
    // bucket from the 5/min/IP limit, which has its own test above.
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: `10.0.0.${i + 1}`,
        headers: { origin: APP_ORIGIN },
        payload: { tenantSlug: 'slugX', email: 'userX@example.com', password: 'wrong' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '10.0.0.99',
      headers: { origin: APP_ORIGIN },
      payload: { tenantSlug: 'slugX', email: 'userY@example.com', password: 'wrong' },
    });

    expect(res.statusCode).not.toBe(429);
  });
});

describe('C6 acceptance: saas-apps credentials never leak', () => {
  it('GET /api/saas-apps response contains no credentials key', async () => {
    const tenantId = await seedTenant(`tenant-saas-${randomUUID()}`, 'SaaS Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const cookie = await loginAndGetCookie(
      (await appPool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId])).rows[0].slug,
      'admin@example.com',
      'correct-password',
    );
    expect(cookie).not.toBeNull();

    await app.inject({
      method: 'POST',
      url: '/api/saas-apps',
      headers: { origin: APP_ORIGIN, cookie: cookie! },
      payload: {
        key: 'google-workspace',
        displayName: 'GWS',
        credentials: { serviceAccountJson: '{"secret":"value"}' },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/saas-apps',
      headers: { cookie: cookie! },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(JSON.stringify(body)).not.toContain('credentials');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

describe('C6 acceptance: hr-import', () => {
  async function importCsv(cookie: string, csv: string | Buffer, filename = 'hr.csv') {
    const boundary = '----vitestBoundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      Buffer.isBuffer(csv) ? csv : Buffer.from(csv),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    return app.inject({
      method: 'POST',
      url: '/api/hr-import',
      headers: {
        origin: APP_ORIGIN,
        cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
  }

  async function loggedInCookie(): Promise<string> {
    const tenantId = await seedTenant(`tenant-hr-${randomUUID()}`, 'HR Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const slugRow = await appPool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    const cookie = await loginAndGetCookie(slugRow.rows[0].slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed in test setup');
    return cookie;
  }

  it('(a) duplicate employee_id rows: second upserts over first, warning present', async () => {
    const cookie = await loggedInCookie();
    const csv =
      'employee_id,email,name,status,left_at\n' +
      'emp-1,first@example.com,First Name,active,\n' +
      'emp-1,second@example.com,Second Name,active,\n';

    const res = await importCsv(cookie, csv);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(2);
    expect(JSON.stringify(body)).toMatch(/warning/i);
  });

  it('(b) UTF-8-with-BOM is accepted and the BOM is stripped', async () => {
    const cookie = await loggedInCookie();
    const csvBody =
      'employee_id,email,name,status,left_at\n' + 'emp-bom,bom@example.com,BOM Name,active,\n';
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csvBody)]);

    const res = await importCsv(cookie, withBom);
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBe(1);
  });

  it('(c) Shift_JIS bytes are rejected with 400 naming UTF-8', async () => {
    const cookie = await loggedInCookie();
    // 0x82 0xA0 is Shift_JIS for "あ" — invalid as UTF-8 (lone continuation-like byte).
    const shiftJisBytes = Buffer.from([0x82, 0xa0, 0x0d, 0x0a]);

    const res = await importCsv(cookie, shiftJisBytes);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/utf-8/i);
  });

  it('(d) row exceeding email/name length caps is rejected into errors[], other rows imported', async () => {
    const cookie = await loggedInCookie();
    const longEmail = `${'a'.repeat(315)}@example.com`; // > 320 chars
    const csv =
      'employee_id,email,name,status,left_at\n' +
      `emp-long,${longEmail},Too Long,active,\n` +
      'emp-ok,ok@example.com,OK Name,active,\n';

    const res = await importCsv(cookie, csv);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.errors).toHaveLength(1);
  });

  it('(e) status=left without left_at rejects the row', async () => {
    const cookie = await loggedInCookie();
    const csv =
      'employee_id,email,name,status,left_at\n' + 'emp-left,left@example.com,Left Name,left,\n';

    const res = await importCsv(cookie, csv);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errors[0].message).toMatch(/left_at/);
  });
});

describe('C6/S5 acceptance: events payload projection', () => {
  it('GET /api/events response contains no raw account fields, even when raw payloads are persisted', async () => {
    const tenantId = await seedTenant(`tenant-events-${randomUUID()}`, 'Events Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const slugRow = await appPool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    const cookie = await loginAndGetCookie(slugRow.rows[0].slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed');

    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload)
         VALUES ($1, 'google-workspace', 'sync_completed', $2::jsonb)`,
        [
          tenantId,
          JSON.stringify({
            counts: { upserted: 3 },
            runId: 'run-1',
            rawAccounts: [{ email: 'leaked@example.com', ssn: '123-45-6789' }],
          }),
        ],
      );
    });

    const res = await app.inject({ method: 'GET', url: '/api/events', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(JSON.stringify(body)).not.toContain('leaked@example.com');
    expect(JSON.stringify(body)).not.toContain('rawAccounts');
    expect(JSON.stringify(body)).not.toContain('ssn');
    expect(body.items[0].payload).toEqual({ counts: { upserted: 3 }, runId: 'run-1' });
  });
});

describe('C6/S12 acceptance: login account-bucket rate limit fires (CT2)', () => {
  it('returns 429 at/after the 21st failed attempt against one account bucket', async () => {
    // LOGIN_ACCOUNT_BUCKET_RATE_LIMIT is max 20 / 1 hour, keyed on the raw
    // `tenantSlug:email` string (S12) — independent of client IP. remoteAddress
    // is varied per attempt (as in the bucket-independence test above) so the
    // 5/min/IP limiter never trips first; if it did, this test would 429 far
    // before the 21st attempt for the wrong reason. If the account-bucket
    // preHandler were removed, only the IP limiter would remain, and varying
    // the IP on every request means it would never 429 at all — so this
    // assertion is unsatisfiable without the account-bucket limiter.
    const payload = { tenantSlug: 'slugCT2', email: 'ct2@example.com', password: 'wrong' };
    let statusAt21: number | null = null;

    for (let i = 1; i <= 21; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: `10.1.0.${i}`,
        headers: { origin: APP_ORIGIN },
        payload,
      });
      if (i <= 20) {
        expect(res.statusCode, `attempt ${i} should not be rate-limited yet`).not.toBe(429);
      } else {
        statusAt21 = res.statusCode;
      }
    }

    expect(statusAt21).toBe(429);
  });

  it('the 429 HALTS login: a rate-limited request with CORRECT credentials sets no session cookie (CT13)', async () => {
    // RT8: proving statusCode===429 alone does not prove the preHandler stops
    // the login handler — a broken wrapper could return 429 while still
    // running verifyLogin and setting a cookie. Seed a REAL user, exhaust the
    // bucket with wrong-password attempts, then make the 21st attempt with the
    // CORRECT password: if the preHandler halts, we get 429 and no cookie; if
    // it does not, verifyLogin succeeds and a session cookie is set.
    const slug = `tenant-ct13-${randomUUID()}`;
    const tenantId = await seedTenant(slug, 'CT13 Tenant');
    await seedUser(tenantId, 'ct13@example.com', 'correct-password');

    for (let i = 0; i < 20; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: `10.2.0.${i + 1}`,
        headers: { origin: APP_ORIGIN },
        payload: { tenantSlug: slug, email: 'ct13@example.com', password: 'wrong' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '10.2.0.99',
      headers: { origin: APP_ORIGIN },
      payload: { tenantSlug: slug, email: 'ct13@example.com', password: 'correct-password' },
    });

    expect(res.statusCode).toBe(429);
    expect(res.cookies.find((c) => c.name === 'session')).toBeUndefined();

    // Cross-check the persistence side: no session row was created for the user.
    const sessionCount = await withTenant(appPool, tenantId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM sessions s
         JOIN users u ON u.id = s.user_id WHERE u.email = $1`,
        ['ct13@example.com'],
      );
      return Number(rows[0]?.n ?? '0');
    });
    expect(sessionCount).toBe(0);
  });
});

describe('C6/S13 acceptance: no HTTP route exposes the rotation sweep (CT11, cross-check)', () => {
  it('apiRoutes contains no route whose url references rotation', () => {
    // Static source-level assertion lives in apps/api/test/no-rotation-route.test.ts;
    // this is a cheap runtime cross-check over the actually-registered routes.
    for (const route of app.apiRoutes) {
      expect(route.url.toLowerCase()).not.toMatch(/rotat/);
    }
  });
});

describe('C7 acceptance: expired or deleted session returns 401 (CT6)', () => {
  async function loggedInSessionCookie(): Promise<{ cookie: string; tenantId: string }> {
    const tenantId = await seedTenant(`tenant-sess-${randomUUID()}`, 'Session Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const slugRow = await appPool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    const cookie = await loginAndGetCookie(slugRow.rows[0].slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed in test setup');
    return { cookie, tenantId };
  }

  it('(a) backdating sessions.expires_at to the past causes the next request to 401', async () => {
    const { cookie, tenantId } = await loggedInSessionCookie();

    const sanity = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(sanity.statusCode).toBe(200);

    const tokenHash = tokenHashFromCookie(cookie);
    await withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query(
        `UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE token_hash = $1`,
        [tokenHash],
      );
      expect(result.rowCount).toBe(1);
    });

    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('(b) deleting the sessions row causes the next request to 401', async () => {
    const { cookie, tenantId } = await loggedInSessionCookie();

    const sanity = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(sanity.statusCode).toBe(200);

    const tokenHash = tokenHashFromCookie(cookie);
    await withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
      expect(result.rowCount).toBe(1);
    });

    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});

describe('C6 acceptance: sliding session TTL refreshes on authenticated request (CT7)', () => {
  it('sessions.expires_at advances after an authenticated request through requireSession', async () => {
    const tenantId = await seedTenant(`tenant-ttl-${randomUUID()}`, 'TTL Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const slugRow = await appPool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    const cookie = await loginAndGetCookie(slugRow.rows[0].slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed in test setup');

    const tokenHash = tokenHashFromCookie(cookie);

    // Force expires_at to a known-nearer value first, so the post-request
    // value is unambiguously later regardless of wall-clock resolution.
    const nearExpiry = await withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ expires_at: Date }>(
        `UPDATE sessions SET expires_at = now() + interval '1 minute'
         WHERE token_hash = $1 RETURNING expires_at`,
        [tokenHash],
      );
      return result.rows[0]!.expires_at;
    });

    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const refreshed = await withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ expires_at: Date }>(
        'SELECT expires_at FROM sessions WHERE token_hash = $1',
        [tokenHash],
      );
      return result.rows[0]!.expires_at;
    });

    expect(refreshed.getTime()).toBeGreaterThan(nearExpiry.getTime());
  });
});

describe('C6/S7 acceptance: no route schema declares a client-supplied tenantId (CT3)', () => {
  it('no route module declares a tenantId field in its body/query zod schema', async () => {
    // app.apiRoutes exposes only { method, url } (see apps/api/src/app.ts) —
    // the zod schemas are module-local to each route file, not attached to
    // Fastify's schema introspection, so runtime introspection cannot reach
    // them. Falling back to the documented pragmatic equivalent: read every
    // route module and grep for a `tenantId` key inside its schema object
    // literal. tenantId must come exclusively from SessionContext (S7); a
    // route that added `tenantId: z...` to its body/query schema would make
    // this test fail.
    const { readdir, readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const routesDir = path.join(import.meta.dirname, '..', 'src', 'routes');
    const files = (await readdir(routesDir)).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(path.join(routesDir, file), 'utf8');
      // Match a tenantId key as used in a zod object shape, e.g. `tenantId:`.
      expect(source, `${file} schema must not declare a tenantId field`).not.toMatch(
        /\btenantId\s*:\s*z\./,
      );
    }
  });
});

describe('C7/S8 acceptance: tenant-scoped login matrix', () => {
  it('two tenants seeded with the same email and different passwords each log into their own tenant only', async () => {
    const tenantASlug = `tenant-a-${randomUUID()}`;
    const tenantBSlug = `tenant-b-${randomUUID()}`;
    const tenantAId = await seedTenant(tenantASlug, 'Tenant A');
    const tenantBId = await seedTenant(tenantBSlug, 'Tenant B');
    await seedUser(tenantAId, 'shared@example.com', 'password-a');
    await seedUser(tenantBId, 'shared@example.com', 'password-b');

    const cookieA = await loginAndGetCookie(tenantASlug, 'shared@example.com', 'password-a');
    const cookieB = await loginAndGetCookie(tenantBSlug, 'shared@example.com', 'password-b');
    expect(cookieA).not.toBeNull();
    expect(cookieB).not.toBeNull();

    // tenant-B credential with tenant-A slug -> 401
    const crossTenant = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: APP_ORIGIN },
      payload: { tenantSlug: tenantASlug, email: 'shared@example.com', password: 'password-b' },
    });
    expect(crossTenant.statusCode).toBe(401);
  });
});
