import { randomUUID } from 'node:crypto';
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
    const nonGetRoutes = app.apiRoutes.filter((route) => route.method !== 'GET');
    expect(nonGetRoutes.length).toBeGreaterThan(0);

    for (const route of nonGetRoutes) {
      const url = route.url.replace(':saasAppId', randomUUID()).replace(':jobId', 'x');
      const res = await app.inject({ method: route.method as 'POST', url });
      expect(res.statusCode, `${route.method} ${route.url} should 403 with missing Origin`).toBe(403);
    }
  });

  it('non-GET request with mismatched Origin returns 403 on every mutation route, no exemptions', async () => {
    const nonGetRoutes = app.apiRoutes.filter((route) => route.method !== 'GET');

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
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: APP_ORIGIN, 'x-forwarded-for': `10.0.0.${i + 1}` },
        payload: { tenantSlug: 'slugX', email: 'userX@example.com', password: 'wrong' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: APP_ORIGIN, 'x-forwarded-for': '10.0.0.99' },
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
