import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
// The sweeps now cover PATCH and DELETE too, so the cast cannot stay
// 'GET' | 'POST' — that asserted something false about its own input. This
// is the narrow literal union app.inject accepts (fastify's HTTPMethods is
// widened with string and does not resolve inject's overload).
type SweepMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { runMigrations, withTenant } from '@open-smp/schema';
import { decryptCredentials } from '@open-smp/crypto';
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
      const url = route.url.replace(/:[A-Za-z]+/g, () => randomUUID());
      const res = await app.inject({
        method: route.method as SweepMethod,
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
      const url = route.url.replace(/:[A-Za-z]+/g, () => randomUUID());
      const res = await app.inject({ method: route.method as 'POST', url });
      expect(res.statusCode, `${route.method} ${route.url} should 403 with missing Origin`).toBe(403);
    }
  });

  it('non-GET request with mismatched Origin returns 403 on every mutation route, no exemptions', async () => {
    const nonGetRoutes = app.apiRoutes.filter((route) => route.method !== 'GET' && route.method !== 'HEAD');
    expect(nonGetRoutes.length).toBeGreaterThan(0);

    for (const route of nonGetRoutes) {
      const url = route.url.replace(/:[A-Za-z]+/g, () => randomUUID());
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
    let lastBody = '';
    for (let i = 0; i < 6; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: APP_ORIGIN },
        payload,
      });
      lastStatus = res.statusCode;
      lastBody = res.body;
    }
    expect(lastStatus).toBe(429);
    // The body, not only the status: throttling reported as a generic client
    // error hides an abuse signal from callers and log pipelines, and the
    // status-only assertion cannot see that regression.
    expect(JSON.parse(lastBody)).toEqual({ error: 'too_many_requests' });
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

describe('C6 acceptance: GET /api/accounts response shape', () => {
  it('link.confidence is a JS number, not the pg numeric string (regression)', async () => {
    // numeric(3,2) comes back from pg as a string; if the serializer does not
    // coerce it, the web UI's confidence.toFixed() throws a server-side 500.
    const slug = `tenant-conf-${randomUUID()}`;
    const tenantId = await seedTenant(slug, 'Confidence Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
    expect(cookie).not.toBeNull();

    // Seed one matched account+identity+link with a fractional confidence.
    await withTenant(appPool, tenantId, async (tx) => {
      const appId = randomUUID();
      const accountId = randomUUID();
      const identityId = randomUUID();
      await tx.query(
        `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_key_version)
         VALUES ($1, $2, 'google-workspace', 'GWS', 1)`,
        [appId, tenantId],
      );
      await tx.query(
        `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
         VALUES ($1, $2, $3, 'ext-c', 'c@example.com', 'C', 'active', false)`,
        [accountId, tenantId, appId],
      );
      await tx.query(
        `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status)
         VALUES ($1, $2, 'emp-c', 'c@example.com', 'C', 'active')`,
        [identityId, tenantId],
      );
      await tx.query(
        `INSERT INTO account_links (id, tenant_id, saas_account_id, identity_id, status, confidence, rule_id, computed_at)
         VALUES ($1, $2, $3, $4, 'matched', 0.90, 'alias-normalized', now())`,
        [randomUUID(), tenantId, accountId, identityId],
      );
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/accounts?status=matched',
      headers: { cookie: cookie! },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { link: { confidence: unknown } | null }[] };
    expect(body.items.length).toBeGreaterThan(0);
    const link = body.items[0]!.link;
    expect(link).not.toBeNull();
    expect(typeof link!.confidence).toBe('number');
    expect(link!.confidence).toBeCloseTo(0.9);
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

  it('rejects an over-limit (~11MB) upload with 400, not a stream error', async () => {
    // Regression for the 500 "Premature close" the e2e tier surfaced:
    // @fastify/multipart v10 rejects toBuffer() with FST_REQ_FILE_TOO_LARGE
    // at the fileSize limit; the route must map it to the documented 400.
    const cookie = await loggedInCookie();
    const header = 'employee_id,email,name,status,left_at\n';
    const row = 'E999,oversize@example.com,Oversize Row,active,\n';
    const csv = header + row.repeat(Math.ceil((11 * 1024 * 1024) / row.length));

    const res = await importCsv(cookie, csv);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'file exceeds 10MB limit' });
  });

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

  // C21 makes the projection kind-aware, which turns the `kind` value into a
  // load-bearing input the test above does not vary — it inserts
  // 'sync_completed'. sync_raw is the kind that actually carries provider PII
  // (sole writer: apps/worker/src/sync.ts), so it needs its own case, using
  // the payload shape that writer really emits: { runId, accounts }.
  it('sync_raw serves only {counts, runId} — the provider blob never reaches the wire', async () => {
    const tenantId = await seedTenant(`tenant-rawproj-${randomUUID()}`, 'Raw Projection Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const slugRow = await appPool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    const cookie = await loginAndGetCookie(slugRow.rows[0].slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed');

    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload)
         VALUES ($1, 'google-workspace', 'sync_raw', $2::jsonb)`,
        [
          tenantId,
          JSON.stringify({
            runId: 'run-raw-1',
            accounts: [
              { email: 'leaked@example.com', phone: '090-0000-0000', orgUnit: '/engineering' },
            ],
          }),
        ],
      );
    });

    const res = await app.inject({ method: 'GET', url: '/api/events', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('leaked@example.com');
    expect(serialized).not.toContain('090-0000-0000');
    expect(serialized).not.toContain('/engineering');
    expect(serialized).not.toContain('accounts');
    expect(body.items[0].payload).toEqual({ runId: 'run-raw-1' });
  });

  it('an unknown kind falls through to the restrictive default, not passthrough', async () => {
    const tenantId = await seedTenant(`tenant-unkproj-${randomUUID()}`, 'Unknown Kind Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const slugRow = await appPool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    const cookie = await loginAndGetCookie(slugRow.rows[0].slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed');

    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload)
         VALUES ($1, 'future-source', 'some_future_kind', $2::jsonb)`,
        [tenantId, JSON.stringify({ secret: 'do-not-serialize', counts: { n: 1 } })],
      );
    });

    const res = await app.inject({ method: 'GET', url: '/api/events', headers: { cookie } });
    const body = res.json();
    expect(JSON.stringify(body)).not.toContain('do-not-serialize');
    expect(body.items[0].payload).toEqual({ counts: { n: 1 } });
  });

  it('label audit events serve their own four fields', async () => {
    const tenantId = await seedTenant(`tenant-auditproj-${randomUUID()}`, 'Audit Projection Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const slugRow = await appPool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    const cookie = await loginAndGetCookie(slugRow.rows[0].slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed');

    const actorUserId = randomUUID();
    const saasAccountId = randomUUID();
    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload)
         VALUES ($1, 'label', 'label_set', $2::jsonb)`,
        [
          tenantId,
          JSON.stringify({
            actorUserId,
            saasAccountId,
            before: null,
            after: { kind: 'known_shared', note: 'why' },
          }),
        ],
      );
    });

    const res = await app.inject({ method: 'GET', url: '/api/events', headers: { cookie } });
    expect(res.json().items[0].payload).toEqual({
      actorUserId,
      saasAccountId,
      before: null,
      after: { kind: 'known_shared', note: 'why' },
    });
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
    // app.apiRoutes exposes only { method, url, hasRateLimit } (see apps/api/src/app.ts) —
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

describe('C11 acceptance: account labeling', () => {
  async function seedTenantWithAccount(
    slugPrefix: string,
  ): Promise<{ tenantId: string; slug: string; userId: string; accountId: string }> {
    const slug = `tenant-${slugPrefix}-${randomUUID()}`;
    const tenantId = await seedTenant(slug, 'Label Tenant');
    const userId = await seedUser(tenantId, 'admin@example.com', 'correct-password');

    const accountId = await withTenant(appPool, tenantId, async (tx) => {
      const appId = randomUUID();
      const acctId = randomUUID();
      await tx.query(
        `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_key_version)
         VALUES ($1, $2, 'google-workspace', 'GWS', 1)`,
        [appId, tenantId],
      );
      await tx.query(
        `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
         VALUES ($1, $2, $3, 'ext-label', 'label@example.com', 'Label Target', 'active', false)`,
        [acctId, tenantId, appId],
      );
      return acctId;
    });

    return { tenantId, slug, userId, accountId };
  }

  async function labelRow(
    tenantId: string,
    accountId: string,
  ): Promise<
    { kind: string; note: string | null; created_by: string | null; created_at: Date; updated_at: Date }[]
  > {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query(
        'SELECT kind, note, created_by, created_at, updated_at FROM account_labels WHERE tenant_id = $1 AND saas_account_id = $2',
        [tenantId, accountId],
      );
      return result.rows;
    });
  }

  describe('T-L1: PUT happy path', () => {
    it('sets a label and returns 200 with the label body', async () => {
      const { tenantId, slug, userId, accountId } = await seedTenantWithAccount('l1');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'service_account', note: 'Jenkins deploy bot' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accountId).toBe(accountId);
      expect(typeof body.kind).toBe('string');
      expect(body.kind).toBe('service_account');
      expect(body.note).toBe('Jenkins deploy bot');

      const rows = await labelRow(tenantId, accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('service_account');
      expect(rows[0]!.note).toBe('Jenkins deploy bot');
      expect(rows[0]!.created_by).toBe(userId);
      expect(rows[0]!.updated_at).toBeInstanceOf(Date);
    });
  });

  describe('T-L2: PUT upsert', () => {
    it('a second PUT updates kind/note and updated_at, leaving created_by unchanged', async () => {
      const { tenantId, slug, userId, accountId } = await seedTenantWithAccount('l2');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const first = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'service_account', note: 'first note' },
      });
      expect(first.statusCode).toBe(200);
      const firstRows = await labelRow(tenantId, accountId);
      const firstUpdatedAt = firstRows[0]!.updated_at;

      // Ensure a measurable clock delta before the second PUT.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared', note: 'second note' },
      });
      expect(second.statusCode).toBe(200);

      const rows = await labelRow(tenantId, accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('known_shared');
      expect(rows[0]!.note).toBe('second note');
      expect(rows[0]!.created_by).toBe(userId);
      expect(rows[0]!.updated_at.getTime()).toBeGreaterThan(firstUpdatedAt.getTime());
    });

    it('created_by stays NULL after the original setter is deleted, even after a second-user PUT', async () => {
      const { tenantId, slug, userId, accountId } = await seedTenantWithAccount('l2-del');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const put1 = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'service_account', note: 'set by original user' },
      });
      expect(put1.statusCode).toBe(200);

      // sessions.user_id has no cascading ON DELETE; delete sessions first,
      // then the user row, so created_by is set NULL by ON DELETE SET NULL.
      await withTenant(appPool, tenantId, async (tx) => {
        await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
        const result = await tx.query('DELETE FROM users WHERE id = $1', [userId]);
        expect(result.rowCount).toBe(1);
      });

      const rowsAfterDelete = await labelRow(tenantId, accountId);
      expect(rowsAfterDelete[0]!.created_by).toBeNull();

      const secondUserId = await seedUser(tenantId, 'second@example.com', 'correct-password-2');
      const secondCookie = await loginAndGetCookie(slug, 'second@example.com', 'correct-password-2');
      expect(secondCookie).not.toBeNull();

      const put2 = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: secondCookie! },
        payload: { kind: 'external_collaborator', note: 'set by second user' },
      });
      expect(put2.statusCode).toBe(200);

      const rowsAfterSecondPut = await labelRow(tenantId, accountId);
      expect(rowsAfterSecondPut).toHaveLength(1);
      expect(rowsAfterSecondPut[0]!.kind).toBe('external_collaborator');
      expect(rowsAfterSecondPut[0]!.created_by).not.toBe(secondUserId);
      expect(rowsAfterSecondPut[0]!.created_by).toBeNull();
    });
  });

  describe('T-L3: validation', () => {
    it('rejects an unknown kind with 400 invalid_body', async () => {
      const { slug, accountId } = await seedTenantWithAccount('l3-kind');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'not_a_real_kind' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_body' });
    });

    it('rejects a 501-character note with 400 invalid_body', async () => {
      const { slug, accountId } = await seedTenantWithAccount('l3-long-note');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared', note: 'a'.repeat(501) },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_body' });
    });

    it('rejects an explicit empty-string note with 400 invalid_body', async () => {
      const { slug, accountId } = await seedTenantWithAccount('l3-empty-note');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared', note: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_body' });
    });

    it('rejects a non-UUID account id with 400 invalid_params', async () => {
      const { slug } = await seedTenantWithAccount('l3-param');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/not-a-uuid/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_params' });
    });

    it('rejects an extra body field with 400 invalid_body (strict schema)', async () => {
      const { slug, accountId } = await seedTenantWithAccount('l3-extra');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared', extra: 'field' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_body' });
    });
  });

  describe('T-L4: PUT on nonexistent account', () => {
    it('returns 404 and creates no account_labels row', async () => {
      const { tenantId, slug } = await seedTenantWithAccount('l4');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      const nonexistentAccountId = randomUUID();

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${nonexistentAccountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });

      const rows = await labelRow(tenantId, nonexistentAccountId);
      expect(rows).toHaveLength(0);
    });
  });

  describe('T-L5: cross-tenant PUT', () => {
    it('returns 404 for a real tenant-A account under a tenant-B session, no row created either side', async () => {
      const tenantA = await seedTenantWithAccount('l5-a');
      const slugB = `tenant-l5-b-${randomUUID()}`;
      const tenantBId = await seedTenant(slugB, 'Label Tenant B');
      await seedUser(tenantBId, 'admin@example.com', 'correct-password');
      const cookieB = await loginAndGetCookie(slugB, 'admin@example.com', 'correct-password');
      expect(cookieB).not.toBeNull();

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${tenantA.accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookieB! },
        payload: { kind: 'known_shared' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });

      const rowsUnderA = await labelRow(tenantA.tenantId, tenantA.accountId);
      expect(rowsUnderA).toHaveLength(0);
      const rowsUnderB = await labelRow(tenantBId, tenantA.accountId);
      expect(rowsUnderB).toHaveLength(0);
    });

    it('DELETE by a tenant-B session on a labeled tenant-A account is 404 and leaves the label intact', async () => {
      const tenantA = await seedTenantWithAccount('l5-del-a');
      const cookieA = await loginAndGetCookie(tenantA.slug, 'admin@example.com', 'correct-password');
      expect(cookieA).not.toBeNull();
      const put = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${tenantA.accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookieA! },
        payload: { kind: 'service_account' },
      });
      expect(put.statusCode).toBe(200);

      const slugB = `tenant-l5-del-b-${randomUUID()}`;
      const tenantBId = await seedTenant(slugB, 'Label Tenant B');
      await seedUser(tenantBId, 'admin@example.com', 'correct-password');
      const cookieB = await loginAndGetCookie(slugB, 'admin@example.com', 'correct-password');
      expect(cookieB).not.toBeNull();

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/accounts/${tenantA.accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookieB! },
      });

      expect(del.statusCode).toBe(404);
      const rowsUnderA = await labelRow(tenantA.tenantId, tenantA.accountId);
      expect(rowsUnderA).toHaveLength(1);
      expect(rowsUnderA[0]?.kind).toBe('service_account');
    });
  });

  describe('T-L6: DELETE', () => {
    it('deletes an existing label (204), repeat DELETE stays 204, DELETE on nonexistent account is 404', async () => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('l6');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const put = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared' },
      });
      expect(put.statusCode).toBe(200);

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
      });
      expect(del.statusCode).toBe(204);

      const rows = await labelRow(tenantId, accountId);
      expect(rows).toHaveLength(0);

      const secondDel = await app.inject({
        method: 'DELETE',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
      });
      expect(secondDel.statusCode).toBe(204);

      const delOnMissing = await app.inject({
        method: 'DELETE',
        url: `/api/accounts/${randomUUID()}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
      });
      expect(delOnMissing.statusCode).toBe(404);
    });
  });

  describe('T-L7: GET /accounts label field', () => {
    it('a labeled item has label {kind, note}; an unlabeled item has label: null', async () => {
      const { slug, accountId } = await seedTenantWithAccount('l7');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const put = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'external_collaborator', note: 'contractor' },
      });
      expect(put.statusCode).toBe(200);

      const res = await app.inject({
        method: 'GET',
        url: '/api/accounts',
        headers: { cookie: cookie! },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: { accountId: string; label: { kind: string; note: string | null } | null }[];
      };

      const labeled = body.items.find((item) => item.accountId === accountId);
      expect(labeled).toBeDefined();
      expect(labeled!.label).not.toBeNull();
      expect(typeof labeled!.label!.kind).toBe('string');
      expect(labeled!.label!.kind).toBe('external_collaborator');
      expect(typeof labeled!.label!.note).toBe('string');
      expect(labeled!.label!.note).toBe('contractor');
    });

    it('an item with no label has label: null', async () => {
      const { slug, accountId } = await seedTenantWithAccount('l7-null');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const res = await app.inject({
        method: 'GET',
        url: '/api/accounts',
        headers: { cookie: cookie! },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: { accountId: string; label: unknown }[] };

      const unlabeled = body.items.find((item) => item.accountId === accountId);
      expect(unlabeled).toBeDefined();
      expect(unlabeled!.label).toBeNull();
    });

    it('a labeled orphan account survives the ?status= filter with its label attached', async () => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('l7-filter');
      await withTenant(appPool, tenantId, async (tx) => {
        await tx.query(
          `INSERT INTO account_links (id, tenant_id, saas_account_id, identity_id, status, confidence, rule_id, computed_at)
           VALUES ($1, $2, $3, NULL, 'orphan', 0, NULL, now())`,
          [randomUUID(), tenantId, accountId],
        );
      });
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const put = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared', note: 'shared mailbox' },
      });
      expect(put.statusCode).toBe(200);

      const res = await app.inject({
        method: 'GET',
        url: '/api/accounts?status=orphan',
        headers: { cookie: cookie! },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: {
          accountId: string;
          link: { status: string } | null;
          label: { kind: string; note: string | null } | null;
        }[];
      };

      const item = body.items.find((it) => it.accountId === accountId);
      expect(item).toBeDefined();
      expect(item!.link!.status).toBe('orphan');
      expect(item!.label).not.toBeNull();
      expect(item!.label!.kind).toBe('known_shared');
      expect(item!.label!.note).toBe('shared mailbox');
    });
  });

  describe('T-L8: Origin-mismatch PUT creates no label row', () => {
    it('returns 403 and account_labels has no row for the account', async () => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('l8');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: 'https://evil.example', cookie: cookie! },
        payload: { kind: 'known_shared' },
      });

      expect(res.statusCode).toBe(403);

      const rows = await labelRow(tenantId, accountId);
      expect(rows).toHaveLength(0);
    });
  });

  // ---- C19: label audit trail ----

  async function auditRows(
    tenantId: string,
  ): Promise<{ kind: string; source: string; payload: Record<string, unknown> }[]> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query(
        `SELECT kind, source, payload FROM discovery_events
         WHERE tenant_id = $1 AND source = 'label'
         ORDER BY created_at, id`,
        [tenantId],
      );
      return result.rows;
    });
  }

  async function eventCount(tenantId: string): Promise<number> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM discovery_events WHERE tenant_id = $1',
        [tenantId],
      );
      return Number(result.rows[0]!.n);
    });
  }

  describe('T-A1: PUT on an unlabeled account emits label_set with before:null', () => {
    it('writes exactly one audit row naming the actor and the new label', async () => {
      const { tenantId, slug, userId, accountId } = await seedTenantWithAccount('a1');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared', note: 'shared mailbox' },
      });
      expect(res.statusCode).toBe(200);

      const events = await auditRows(tenantId);
      expect(events).toHaveLength(1);
      expect(events[0]!.kind).toBe('label_set');
      expect(events[0]!.source).toBe('label');
      expect(events[0]!.payload).toEqual({
        actorUserId: userId,
        saasAccountId: accountId,
        before: null,
        after: { kind: 'known_shared', note: 'shared mailbox' },
      });
    });
  });

  describe('T-A2: re-labelling captures the prior state as `before`', () => {
    it('second PUT emits before = the previous {kind, note}', async () => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('a2');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      const headers = { origin: APP_ORIGIN, cookie: cookie! };

      await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers,
        payload: { kind: 'known_shared', note: 'first' },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers,
        payload: { kind: 'service_account' },
      });

      const events = await auditRows(tenantId);
      expect(events).toHaveLength(2);
      expect(events[1]!.payload).toMatchObject({
        before: { kind: 'known_shared', note: 'first' },
        after: { kind: 'service_account', note: null },
      });
    });
  });

  describe('T-A3: DELETE emits label_cleared carrying the removed label', () => {
    it('before deep-equals the label that was removed, after is null', async () => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('a3');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      const headers = { origin: APP_ORIGIN, cookie: cookie! };

      await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers,
        payload: { kind: 'external_collaborator', note: 'contractor' },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/accounts/${accountId}/label`,
        headers,
      });
      expect(res.statusCode).toBe(204);

      const events = await auditRows(tenantId);
      expect(events).toHaveLength(2);
      expect(events[1]!.kind).toBe('label_cleared');
      expect(events[1]!.payload).toMatchObject({
        before: { kind: 'external_collaborator', note: 'contractor' },
        after: null,
      });
    });
  });

  describe('T-A4: DELETE on an unlabeled account writes no audit row', () => {
    it('returns 204 and the event count is unchanged', async () => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('a4');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      const before = await eventCount(tenantId);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
      });

      expect(res.statusCode).toBe(204);
      expect(await eventCount(tenantId)).toBe(before);
    });
  });

  describe('T-A5: a failed PUT writes no audit row', () => {
    it('404 on an unknown account leaves discovery_events unchanged', async () => {
      const { tenantId, slug } = await seedTenantWithAccount('a5');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      const before = await eventCount(tenantId);

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${randomUUID()}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared' },
      });

      expect(res.statusCode).toBe(404);
      expect(await eventCount(tenantId)).toBe(before);
    });
  });

  // ---- C24/I24.1: note newline rejection ----

  describe('T-N1: notes containing line breaks are rejected at the boundary', () => {
    it.each(['a\r\nb', 'a\nb', 'a\rb'])('rejects note %j with 400 and writes no label', async (note) => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('n1');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared', note },
      });

      expect(res.statusCode).toBe(400);
      expect(await labelRow(tenantId, accountId)).toHaveLength(0);
      expect(await eventCount(tenantId)).toBe(0);
    });
  });

  describe('T-N2: ordinary notes and absent notes both still succeed', () => {
    it('accepts a note containing a plain space', async () => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('n2a');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared', note: 'a b' },
      });

      expect(res.statusCode).toBe(200);
      expect((await labelRow(tenantId, accountId))[0]!.note).toBe('a b');
    });

    // Guards the regression where adding .regex(...) drops .optional() and
    // makes `note` required on a shipped endpoint — every other criterion in
    // this file supplies a note, so nothing else would catch it.
    it('accepts a body with no note at all', async () => {
      const { tenantId, slug, accountId } = await seedTenantWithAccount('n2b');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/accounts/${accountId}/label`,
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { kind: 'known_shared' },
      });

      expect(res.statusCode).toBe(200);
      expect((await labelRow(tenantId, accountId))[0]!.note).toBeNull();
    });
  });

  describe('T-L9: rate-limit config sweep (RT7-proven via captured field)', () => {
    it('every /api route carries a truthy object rate-limit config', () => {
      // The `onRoute` hook in app.ts computes hasRateLimit from
      // routeOptions.config?.rateLimit at REGISTRATION time and this test
      // reads only that captured field — it never re-derives the value from
      // route behavior. If a future route omits config.rateLimit (or the
      // hasRateLimit computation is weakened back to a mere non-null
      // check), `typeof undefined === 'object'` is false and this loop
      // fails on that route. RT7 strip-and-confirm-red proof executed
      // 2026-07-25 on a throwaway git worktree (never on this tree):
      // removing the DELETE label route's `config` made this test fail with
      // "DELETE /api/accounts/:saasAccountId/label should carry a
      // rate-limit config: expected false to be true".
      // An exact count, not a floor: every sweep in this file iterates whatever
      // registered, so a route dropped from app.ts leaves all of them green and
      // surfaces later as a confusing 404 in an unrelated test. The number is
      // the assertion that names the cause.
      expect(app.apiRoutes.map((route) => `${route.method} ${route.url}`).sort()).toEqual([
        'DELETE /api/accounts/:saasAccountId/label',
        'DELETE /api/saas-apps/:saasAppId',
        'GET /api/accounts',
        'GET /api/events',
        'GET /api/identities/:identityId',
        'GET /api/jobs/:jobId',
        'GET /api/saas-apps',
        // Fastify registers a HEAD companion for every GET; they are listed so
        // the count stays exact rather than approximately right.
        'HEAD /api/accounts',
        'HEAD /api/events',
        'HEAD /api/identities/:identityId',
        'HEAD /api/jobs/:jobId',
        'HEAD /api/saas-apps',
        'PATCH /api/saas-apps/:saasAppId',
        'POST /api/accounts/labels/bulk',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/hr-import',
        'POST /api/match',
        'POST /api/saas-apps',
        'POST /api/sync/:saasAppId',
        'PUT /api/accounts/:saasAccountId/label',
      ]);
      for (const route of app.apiRoutes) {
        expect(route.hasRateLimit, `${route.method} ${route.url} should carry a rate-limit config`).toBe(
          true,
        );
      }
    });
  });
});

describe('C13 acceptance: saas-apps duplicate key', () => {
  describe('T-S1: duplicate registration', () => {
    it('a second POST with the same key returns 409 duplicate_key; GET still returns one item', async () => {
      const slug = `tenant-s1-${randomUUID()}`;
      const tenantId = await seedTenant(slug, 'S1 Tenant');
      await seedUser(tenantId, 'admin@example.com', 'correct-password');
      const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
      expect(cookie).not.toBeNull();

      const payload = {
        key: 'google-workspace',
        displayName: 'GWS Primary',
        credentials: { serviceAccountJson: '{"client_email":"a@b.iam.gserviceaccount.com"}' },
      };

      const first = await app.inject({
        method: 'POST',
        url: '/api/saas-apps',
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload,
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/api/saas-apps',
        headers: { origin: APP_ORIGIN, cookie: cookie! },
        payload: { ...payload, displayName: 'GWS Duplicate Attempt' },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({ error: 'duplicate_key' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/saas-apps',
        headers: { cookie: cookie! },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      // The surviving row is the FIRST registration — the 409'd attempt's
      // differing displayName must not have overwritten it (C13: insert-then
      // -catch, not upsert).
      expect(body.items[0].displayName).toBe('GWS Primary');
      expect(JSON.stringify(body)).not.toContain('credentials');
      expect(JSON.stringify(body)).not.toContain('client_email');
    });
  });
});

describe('C18 acceptance: identity detail', () => {
  async function seedIdentity(
    tenantId: string,
    opts: { employeeId: string; status: 'active' | 'left'; displayName: string; email: string },
  ): Promise<string> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO identities
           (tenant_id, employee_id, primary_email, secondary_emails, display_name, status, left_at)
         VALUES ($1, $2, $3, '{}', $4, $5, $6)
         RETURNING id`,
        [
          tenantId,
          opts.employeeId,
          opts.email,
          opts.displayName,
          opts.status,
          opts.status === 'left' ? '2024-03-31T00:00:00.000Z' : null,
        ],
      );
      return result.rows[0]!.id;
    });
  }

  async function seedLinkedAccount(
    tenantId: string,
    saasAppId: string,
    identityId: string | null,
    opts: { externalId: string; email: string; linkStatus: string; confidence: string },
  ): Promise<string> {
    return withTenant(appPool, tenantId, async (tx) => {
      const account = await tx.query<{ id: string }>(
        `INSERT INTO saas_accounts
           (tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
         VALUES ($1, $2, $3, $4, $5, 'active', false)
         RETURNING id`,
        [tenantId, saasAppId, opts.externalId, opts.email, `Display ${opts.externalId}`],
      );
      const accountId = account.rows[0]!.id;
      await tx.query(
        `INSERT INTO account_links
           (tenant_id, saas_account_id, identity_id, status, confidence, rule_id)
         VALUES ($1, $2, $3, $4, $5, 'exactEmail')`,
        [tenantId, accountId, identityId, opts.linkStatus, opts.confidence],
      );
      return accountId;
    });
  }

  async function seedApp(tenantId: string, key: string): Promise<string> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO saas_apps (tenant_id, key, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, key, 'Google Workspace'],
      );
      return result.rows[0]!.id;
    });
  }

  async function setup(prefix: string) {
    const slug = `tenant-${prefix}-${randomUUID()}`;
    const tenantId = await seedTenant(slug, 'Identity Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed in test setup');
    const saasAppId = await seedApp(tenantId, 'google-workspace');
    return { tenantId, cookie, saasAppId };
  }

  it('an active identity with one matched account returns that account and no leftAt', async () => {
    const { tenantId, cookie, saasAppId } = await setup('idt1');
    const identityId = await seedIdentity(tenantId, {
      employeeId: 'E100',
      status: 'active',
      displayName: 'Active Person',
      email: 'active@example.com',
    });
    await seedLinkedAccount(tenantId, saasAppId, identityId, {
      externalId: 'gws-1',
      email: 'active@example.com',
      linkStatus: 'matched',
      confidence: '0.95',
    });

    const res = await app.inject({ method: 'GET', url: `/api/identities/${identityId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('active');
    expect(body.leftAt).toBeNull();
    expect(body.displayName).toBe('Active Person');
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].linkStatus).toBe('matched');
    expect(body.accountsTruncated).toBe(false);
    // numeric(3,2) arrives as a string from the driver (D9) — the route must
    // coerce, and asserting the value alone would pass on "0.95".
    expect(typeof body.accounts[0].confidence).toBe('number');
    expect(body.accounts[0].confidence).toBeCloseTo(0.95);
  });

  it('a left identity returns status left, a non-null leftAt, and its ghost account', async () => {
    const { tenantId, cookie, saasAppId } = await setup('idt2');
    const identityId = await seedIdentity(tenantId, {
      employeeId: 'E200',
      status: 'left',
      displayName: 'Departed Person',
      email: 'gone@example.com',
    });
    await seedLinkedAccount(tenantId, saasAppId, identityId, {
      externalId: 'gws-2',
      email: 'gone@example.com',
      linkStatus: 'ghost',
      confidence: '0.90',
    });

    const res = await app.inject({ method: 'GET', url: `/api/identities/${identityId}`, headers: { cookie } });
    const body = res.json();
    expect(body.status).toBe('left');
    expect(body.leftAt).not.toBeNull();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].linkStatus).toBe('ghost');
  });

  it('an identity with no accounts returns an empty list, not an error', async () => {
    const { tenantId, cookie } = await setup('idt3');
    const identityId = await seedIdentity(tenantId, {
      employeeId: 'E300',
      status: 'active',
      displayName: 'Unattributed',
      email: 'none@example.com',
    });

    const res = await app.inject({ method: 'GET', url: `/api/identities/${identityId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toEqual([]);
  });

  it('a foreign-tenant identity returns 404 with no row disclosure', async () => {
    const { cookie } = await setup('idt4');
    const otherTenantId = await seedTenant(`tenant-idt4other-${randomUUID()}`, 'Other Tenant');
    const foreignIdentityId = await seedIdentity(otherTenantId, {
      employeeId: 'E400',
      status: 'active',
      displayName: 'Someone Else',
      email: 'other@example.com',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/identities/${foreignIdentityId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('Someone Else');
  });

  it('a non-uuid identityId returns 400', async () => {
    const { cookie } = await setup('idt5');
    const res = await app.inject({ method: 'GET', url: '/api/identities/not-a-uuid', headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });

  it('orphan and ambiguous accounts never appear (identity_id IS NULL by schema check)', async () => {
    const { tenantId, cookie, saasAppId } = await setup('idt6');
    const identityId = await seedIdentity(tenantId, {
      employeeId: 'E600',
      status: 'active',
      displayName: 'Has One Match',
      email: 'match@example.com',
    });
    await seedLinkedAccount(tenantId, saasAppId, identityId, {
      externalId: 'gws-6a',
      email: 'match@example.com',
      linkStatus: 'matched',
      confidence: '1.00',
    });
    await seedLinkedAccount(tenantId, saasAppId, null, {
      externalId: 'gws-6b',
      email: 'orphan@example.com',
      linkStatus: 'orphan',
      confidence: '0.00',
    });

    const res = await app.inject({ method: 'GET', url: `/api/identities/${identityId}`, headers: { cookie } });
    const body = res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].email).toBe('match@example.com');
  });

  it('caps the account list at PAGE_SIZE and reports accountsTruncated', async () => {
    const { tenantId, cookie, saasAppId } = await setup('idt7');
    const identityId = await seedIdentity(tenantId, {
      employeeId: 'E700',
      status: 'active',
      displayName: 'Over Capped',
      email: 'many@example.com',
    });

    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO saas_accounts
           (tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
         SELECT $1, $2, 'bulk-' || g, 'bulk' || g || '@example.com', 'Bulk ' || g, 'active', false
         FROM generate_series(1, 60) AS g`,
        [tenantId, saasAppId],
      );
      await tx.query(
        `INSERT INTO account_links (tenant_id, saas_account_id, identity_id, status, confidence, rule_id)
         SELECT $1, sa.id, $2, 'matched', 0.80, 'exactEmail'
         FROM saas_accounts sa
         WHERE sa.tenant_id = $1 AND sa.external_id LIKE 'bulk-%'`,
        [tenantId, identityId],
      );
    });

    const res = await app.inject({ method: 'GET', url: `/api/identities/${identityId}`, headers: { cookie } });
    const body = res.json();
    expect(body.accounts).toHaveLength(50);
    expect(body.accountsTruncated).toBe(true);
  });

  it('exactly PAGE_SIZE accounts reports accountsTruncated false', async () => {
    const { tenantId, cookie, saasAppId } = await setup('idt8');
    const identityId = await seedIdentity(tenantId, {
      employeeId: 'E800',
      status: 'active',
      displayName: 'Exactly Fifty',
      email: 'fifty@example.com',
    });

    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO saas_accounts
           (tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
         SELECT $1, $2, 'fifty-' || g, 'fifty' || g || '@example.com', 'Fifty ' || g, 'active', false
         FROM generate_series(1, 50) AS g`,
        [tenantId, saasAppId],
      );
      await tx.query(
        `INSERT INTO account_links (tenant_id, saas_account_id, identity_id, status, confidence, rule_id)
         SELECT $1, sa.id, $2, 'matched', 0.80, 'exactEmail'
         FROM saas_accounts sa
         WHERE sa.tenant_id = $1 AND sa.external_id LIKE 'fifty-%'`,
        [tenantId, identityId],
      );
    });

    const res = await app.inject({ method: 'GET', url: `/api/identities/${identityId}`, headers: { cookie } });
    const body = res.json();
    expect(body.accounts).toHaveLength(50);
    // This is the case that distinguishes "capped" from "happens to be 50" —
    // an implementation computing the flag from accounts.length > PAGE_SIZE
    // after slicing would report true here.
    expect(body.accountsTruncated).toBe(false);
  });
});

describe('C22 acceptance: SaaS app management', () => {
  async function setup(prefix: string) {
    const slug = `tenant-${prefix}-${randomUUID()}`;
    const tenantId = await seedTenant(slug, 'App Mgmt Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed in test setup');
    return { tenantId, cookie, headers: { origin: APP_ORIGIN, cookie } };
  }

  async function registerApp(headers: Record<string, string>): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/saas-apps',
      headers,
      payload: {
        key: 'google-workspace',
        displayName: 'GWS Original',
        credentials: { serviceAccountJson: '{"client_email":"a@b.c"}', impersonateAdminEmail: 'a@b.c' },
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function readCredentials(
    tenantId: string,
    saasAppId: string,
  ): Promise<{ blob: Buffer; keyVersion: number; displayName: string }> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{
        credentials_enc: Buffer;
        credentials_key_version: number;
        display_name: string;
      }>(
        'SELECT credentials_enc, credentials_key_version, display_name FROM saas_apps WHERE id = $1',
        [saasAppId],
      );
      const row = result.rows[0]!;
      return {
        blob: row.credentials_enc,
        keyVersion: row.credentials_key_version,
        displayName: row.display_name,
      };
    });
  }

  it('rename changes display_name and leaves the ciphertext byte-identical', async () => {
    const { tenantId, headers } = await setup('c22a');
    const saasAppId = await registerApp(headers);
    const before = await readCredentials(tenantId, saasAppId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/saas-apps/${saasAppId}`,
      headers,
      payload: { displayName: 'GWS Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: saasAppId, key: 'google-workspace', displayName: 'GWS Renamed' });

    const after = await readCredentials(tenantId, saasAppId);
    expect(after.displayName).toBe('GWS Renamed');
    // A rename must not re-encrypt. Asserting only "the name changed" would
    // pass against an implementation that rewrote the credential blob too.
    expect(after.blob.equals(before.blob)).toBe(true);
    expect(after.keyVersion).toBe(before.keyVersion);
  });

  it('credential replacement re-encrypts and decrypts back to the submitted plaintext', async () => {
    const { tenantId, headers } = await setup('c22b');
    const saasAppId = await registerApp(headers);
    const before = await readCredentials(tenantId, saasAppId);

    const replacement = { serviceAccountJson: '{"client_email":"new@example.com"}', impersonateAdminEmail: 'new@example.com' };
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/saas-apps/${saasAppId}`,
      headers,
      payload: { credentials: replacement },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain('client_email');

    const after = await readCredentials(tenantId, saasAppId);
    expect(after.blob.equals(before.blob)).toBe(false);

    // Decrypt with the version READ BACK FROM THE ROW, not the one the test
    // would have encrypted with: that is what proves credentials_key_version
    // travelled with the ciphertext. Passing a locally-chosen version would
    // pass against a row left on a stale version.
    const plaintext = decryptCredentials(
      after.blob,
      after.keyVersion,
      { tenantId, saasAppId },
      deps.encryptionKeys,
    );
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(replacement);
  });

  it('replacement under a two-version key map lands on the newer version and still decrypts', async () => {
    const { tenantId, headers, cookie } = await setup('c22c');
    const saasAppId = await registerApp(headers);
    const before = await readCredentials(tenantId, saasAppId);
    expect(before.keyVersion).toBe(1);

    // The shared app is built with a single-version key map, so "1 stays 1"
    // would be unfalsifiable there. A second instance with versions 1 and 2
    // is what makes the version-column assertion mean anything.
    const twoVersionKeys = new Map([
      [1, Buffer.alloc(32, 7)],
      [2, Buffer.alloc(32, 9)],
    ]);
    const rolloutApp = buildApp({ ...deps, encryptionKeys: twoVersionKeys });
    await rolloutApp.ready();
    try {
      const replacement = { serviceAccountJson: '{"client_email":"rolled@example.com"}' };
      const res = await rolloutApp.inject({
        method: 'PATCH',
        url: `/api/saas-apps/${saasAppId}`,
        headers: { origin: APP_ORIGIN, cookie },
        payload: { credentials: replacement },
      });
      expect(res.statusCode).toBe(200);

      const after = await readCredentials(tenantId, saasAppId);
      expect(after.keyVersion).toBe(2);
      const plaintext = decryptCredentials(
        after.blob,
        after.keyVersion,
        { tenantId, saasAppId },
        twoVersionKeys,
      );
      expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(replacement);
    } finally {
      await rolloutApp.close();
    }
  });

  it('PATCH with an empty body returns 400 rather than a silent no-op 200', async () => {
    const { headers } = await setup('c22d');
    const saasAppId = await registerApp(headers);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/saas-apps/${saasAppId}`,
      headers,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE removes an app that has no accounts', async () => {
    const { tenantId, headers } = await setup('c22e');
    const saasAppId = await registerApp(headers);

    const res = await app.inject({ method: 'DELETE', url: `/api/saas-apps/${saasAppId}`, headers });
    expect(res.statusCode).toBe(204);

    const remaining = await withTenant(appPool, tenantId, async (tx) =>
      tx.query('SELECT id FROM saas_apps WHERE id = $1', [saasAppId]),
    );
    expect(remaining.rows).toHaveLength(0);
  });

  it('DELETE refuses an app with accounts and mutates nothing', async () => {
    const { tenantId, headers } = await setup('c22f');
    const saasAppId = await registerApp(headers);

    const accountId = await withTenant(appPool, tenantId, async (tx) => {
      const account = await tx.query<{ id: string }>(
        `INSERT INTO saas_accounts
           (tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
         VALUES ($1, $2, 'ext-1', 'held@example.com', 'Held', 'active', false)
         RETURNING id`,
        [tenantId, saasAppId],
      );
      const id = account.rows[0]!.id;
      await tx.query(
        `INSERT INTO account_links (tenant_id, saas_account_id, identity_id, status, confidence)
         VALUES ($1, $2, NULL, 'orphan', 0.00)`,
        [tenantId, id],
      );
      await tx.query(
        `INSERT INTO account_labels (tenant_id, saas_account_id, kind) VALUES ($1, $2, 'known_shared')`,
        [tenantId, id],
      );
      return id;
    });

    const res = await app.inject({ method: 'DELETE', url: `/api/saas-apps/${saasAppId}`, headers });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'app_has_accounts', accountCount: 1 });

    // The refusal must leave every related table untouched — a partial cascade
    // would destroy match evidence and label history that nothing reproduces.
    await withTenant(appPool, tenantId, async (tx) => {
      for (const [table, column, value] of [
        ['saas_apps', 'id', saasAppId],
        ['saas_accounts', 'id', accountId],
        ['account_links', 'saas_account_id', accountId],
        ['account_labels', 'saas_account_id', accountId],
      ] as const) {
        const rows = await tx.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [value]);
        expect(rows.rows, `${table} must be unchanged`).toHaveLength(1);
      }
    });
  });

  it('PATCH and DELETE on another tenant\'s app return 404, not 403', async () => {
    const { headers } = await setup('c22g');
    const otherSlug = `tenant-c22other-${randomUUID()}`;
    const otherTenantId = await seedTenant(otherSlug, 'Other Tenant');
    const foreignAppId = await withTenant(appPool, otherTenantId, async (tx) => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO saas_apps (tenant_id, key, display_name) VALUES ($1, 'google-workspace', 'Theirs')
         RETURNING id`,
        [otherTenantId],
      );
      return result.rows[0]!.id;
    });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/saas-apps/${foreignAppId}`,
      headers,
      payload: { displayName: 'Hijacked' },
    });
    expect(patched.statusCode).toBe(404);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/saas-apps/${foreignAppId}`,
      headers,
    });
    expect(deleted.statusCode).toBe(404);

    const survived = await withTenant(appPool, otherTenantId, async (tx) =>
      tx.query<{ display_name: string }>('SELECT display_name FROM saas_apps WHERE id = $1', [foreignAppId]),
    );
    expect(survived.rows[0]!.display_name).toBe('Theirs');
  });
});

describe('C23 acceptance: label filtering and bulk labeling', () => {
  async function setup(prefix: string) {
    const slug = `tenant-${prefix}-${randomUUID()}`;
    const tenantId = await seedTenant(slug, 'Bulk Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed in test setup');

    const saasAppId = await withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO saas_apps (tenant_id, key, display_name)
         VALUES ($1, 'google-workspace', 'Google Workspace') RETURNING id`,
        [tenantId],
      );
      return result.rows[0]!.id;
    });

    return { tenantId, cookie, headers: { origin: APP_ORIGIN, cookie }, saasAppId };
  }

  async function seedAccounts(tenantId: string, saasAppId: string, count: number): Promise<string[]> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO saas_accounts
           (tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
         SELECT $1, $2, 'bulk-' || g, 'bulk' || g || '@example.com', 'Bulk ' || g, 'active', false
         FROM generate_series(1, $3) AS g
         RETURNING id`,
        [tenantId, saasAppId, count],
      );
      return result.rows.map((row) => row.id);
    });
  }

  async function labelCount(tenantId: string): Promise<number> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM account_labels WHERE tenant_id = $1',
        [tenantId],
      );
      return Number(result.rows[0]!.n);
    });
  }

  async function auditCount(tenantId: string): Promise<number> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM discovery_events WHERE tenant_id = $1 AND source = 'label'`,
        [tenantId],
      );
      return Number(result.rows[0]!.n);
    });
  }

  it('labels every supplied account and emits one audit row per account', async () => {
    const { tenantId, headers, saasAppId } = await setup('c23a');
    const ids = await seedAccounts(tenantId, saasAppId, 3);

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: ids, kind: 'service_account', note: 'batch' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 3 });
    expect(await labelCount(tenantId)).toBe(3);
    // Per-account, not per-request: a single "bulk" record would erase every
    // account's individual before-state.
    expect(await auditCount(tenantId)).toBe(3);
  });

  it('an unknown id fails the whole batch, writing no labels and no audit rows', async () => {
    const { tenantId, headers, saasAppId } = await setup('c23b');
    const ids = await seedAccounts(tenantId, saasAppId, 2);
    const ghostId = randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: [...ids, ghostId], kind: 'known_shared' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', missing: [ghostId] });
    expect(await labelCount(tenantId)).toBe(0);
    expect(await auditCount(tenantId)).toBe(0);
  });

  it('another tenant\'s account is indistinguishable from an absent one', async () => {
    const { tenantId, headers, saasAppId } = await setup('c23c');
    const ids = await seedAccounts(tenantId, saasAppId, 1);

    const otherTenantId = await seedTenant(`tenant-c23other-${randomUUID()}`, 'Other');
    const otherAppId = await withTenant(appPool, otherTenantId, async (tx) => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO saas_apps (tenant_id, key, display_name)
         VALUES ($1, 'google-workspace', 'Theirs') RETURNING id`,
        [otherTenantId],
      );
      return result.rows[0]!.id;
    });
    const [foreignAccountId] = await seedAccounts(otherTenantId, otherAppId, 1);

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: [...ids, foreignAccountId!], kind: 'known_shared' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().missing).toEqual([foreignAccountId]);
    expect(await labelCount(tenantId)).toBe(0);
  });

  it('re-labelling in bulk records each account\'s prior state', async () => {
    const { tenantId, headers, saasAppId } = await setup('c23d');
    const ids = await seedAccounts(tenantId, saasAppId, 2);

    await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: ids, kind: 'known_shared', note: 'first' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: ids, kind: 'service_account' },
    });

    expect(await labelCount(tenantId)).toBe(2);
    expect(await auditCount(tenantId)).toBe(4);

    const second = await withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM discovery_events
         WHERE tenant_id = $1 AND source = 'label'
         ORDER BY created_at DESC, id DESC LIMIT 2`,
        [tenantId],
      );
      return result.rows;
    });
    for (const row of second) {
      expect(row.payload).toMatchObject({
        before: { kind: 'known_shared', note: 'first' },
        after: { kind: 'service_account', note: null },
      });
    }
  });

  it('rejects an over-cap batch, a duplicated id, and a note containing a line break', async () => {
    const { tenantId, headers, saasAppId } = await setup('c23e');
    const ids = await seedAccounts(tenantId, saasAppId, 2);

    const overCap = await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: Array.from({ length: 101 }, () => randomUUID()), kind: 'known_shared' },
    });
    expect(overCap.statusCode).toBe(400);

    const duplicated = await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: [ids[0]!, ids[0]!], kind: 'known_shared' },
    });
    expect(duplicated.statusCode).toBe(400);

    // R42-C: the note guard covers BOTH endpoints that accept a note, not just
    // the per-account one.
    const newline = await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: ids, kind: 'known_shared', note: 'a\r\nb' },
    });
    expect(newline.statusCode).toBe(400);

    expect(await labelCount(tenantId)).toBe(0);
    expect(await auditCount(tenantId)).toBe(0);
  });

  it('?label= filters the list and composes with the status tab', async () => {
    const { tenantId, cookie, headers, saasAppId } = await setup('c23f');
    const ids = await seedAccounts(tenantId, saasAppId, 4);
    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO account_links (tenant_id, saas_account_id, identity_id, status, confidence)
         SELECT $1, account_id, NULL, 'orphan', 0.00 FROM unnest($2::uuid[]) AS account_id`,
        [tenantId, ids],
      );
    });

    const listWith = async (query: string) => {
      const res = await app.inject({ method: 'GET', url: `/api/accounts?${query}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      return res.json().items as { accountId: string }[];
    };

    expect(await listWith('label=none')).toHaveLength(4);
    expect(await listWith('label=any')).toHaveLength(0);

    await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: [ids[0]!], kind: 'known_shared' },
    });

    expect(await listWith('label=none')).toHaveLength(3);
    expect(await listWith('label=any')).toHaveLength(1);
    expect(await listWith('label=known_shared')).toHaveLength(1);
    expect(await listWith('label=service_account')).toHaveLength(0);
    // The pre-existing status filter must keep working alongside it.
    expect(await listWith('status=orphan&label=none')).toHaveLength(3);

    const bogus = await app.inject({
      method: 'GET',
      url: '/api/accounts?label=bogus',
      headers: { cookie },
    });
    expect(bogus.statusCode).toBe(400);
  });

  it('nextCursor is derived from the filtered set, not the unfiltered one', async () => {
    const { tenantId, cookie, headers, saasAppId } = await setup('c23g');
    const ids = await seedAccounts(tenantId, saasAppId, 70);

    // Label the first 10 by id order, so an unfiltered cursor would skip past
    // unlabeled rows when resuming. 60 unlabeled accounts remain, which is what
    // makes hasMore true on the filtered page — with exactly PAGE_SIZE left the
    // cursor is legitimately null and the test would prove nothing.
    const sorted = [...ids].sort();
    await app.inject({
      method: 'POST',
      url: '/api/accounts/labels/bulk',
      headers,
      payload: { accountIds: sorted.slice(0, 10), kind: 'known_shared' },
    });

    const page1 = await app.inject({
      method: 'GET',
      url: '/api/accounts?label=none',
      headers: { cookie },
    });
    const body1 = page1.json();
    expect(body1.items).toHaveLength(50);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await app.inject({
      method: 'GET',
      url: `/api/accounts?label=none&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: { cookie },
    });
    const body2 = page2.json();

    const seen = [...body1.items, ...body2.items].map((item: { accountId: string }) => item.accountId);
    const labeled = new Set(sorted.slice(0, 10));
    // All 60 unlabeled accounts across the two pages, none missing and none
    // repeated, and no labeled account leaking through — the clause that
    // falsifies a cursor derived from the unfiltered ordering, which would skip
    // ahead by the filtered-out rows and silently drop results.
    expect(new Set(seen).size).toBe(60);
    expect(seen.filter((id) => labeled.has(id))).toHaveLength(0);
  });
});

describe('C20 acceptance: chronological events with a filter-bound cursor', () => {
  async function setup(prefix: string) {
    const slug = `tenant-${prefix}-${randomUUID()}`;
    const tenantId = await seedTenant(slug, 'Events Tenant');
    await seedUser(tenantId, 'admin@example.com', 'correct-password');
    const cookie = await loginAndGetCookie(slug, 'admin@example.com', 'correct-password');
    if (!cookie) throw new Error('login failed in test setup');
    return { tenantId, cookie };
  }

  async function insertEvent(tenantId: string, source: string, createdAt: string): Promise<string> {
    return withTenant(appPool, tenantId, async (tx) => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload, created_at)
         VALUES ($1, $2, 'sync_completed', '{}'::jsonb, $3)
         RETURNING id`,
        [tenantId, source, createdAt],
      );
      return result.rows[0]!.id;
    });
  }

  async function listEvents(
    cookie: string,
    query = '',
  ): Promise<{ items: { id: string; createdAt: string }[]; nextCursor: string | null }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/events${query ? `?${query}` : ''}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('returns newest first, asserted on the exact id sequence', async () => {
    const { tenantId, cookie } = await setup('c20a');
    const oldest = await insertEvent(tenantId, 'matcher', '2026-07-01T00:00:00.000Z');
    const middle = await insertEvent(tenantId, 'matcher', '2026-07-02T00:00:00.000Z');
    const newest = await insertEvent(tenantId, 'matcher', '2026-07-03T00:00:00.000Z');

    const { items } = await listEvents(cookie);
    expect(items.map((item) => item.id)).toEqual([newest, middle, oldest]);
  });

  it('breaks a created_at tie by id, descending', async () => {
    const { tenantId, cookie } = await setup('c20b');
    // now() is transaction-constant, so a tie must be written explicitly — it
    // cannot simply be "seeded at the same moment".
    const tie = '2026-07-04T00:00:00.000Z';
    const ids = [
      await insertEvent(tenantId, 'matcher', tie),
      await insertEvent(tenantId, 'matcher', tie),
      await insertEvent(tenantId, 'matcher', tie),
    ];

    const { items } = await listEvents(cookie);
    expect(items.map((item) => item.id)).toEqual([...ids].sort().reverse());
  });

  it('pages across a tie at the boundary with no gap and no duplicate', async () => {
    const { tenantId, cookie } = await setup('c20c');
    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload, created_at)
         SELECT $1, 'matcher', 'sync_completed', '{}'::jsonb,
                timestamptz '2026-07-05T00:00:00.000Z' + (g || ' seconds')::interval
         FROM generate_series(1, 49) AS g`,
        [tenantId],
      );
      // Two rows sharing an exact timestamp, positioned to straddle the page
      // boundary once the 49 above are ordered ahead of them.
      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload, created_at)
         SELECT $1, 'matcher', 'sync_completed', '{}'::jsonb, timestamptz '2026-07-05T00:00:00.000Z'
         FROM generate_series(1, 2)`,
        [tenantId],
      );
    });

    const page1 = await listEvents(cookie);
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listEvents(cookie, `cursor=${encodeURIComponent(page1.nextCursor!)}`);
    const all = [...page1.items, ...page2.items].map((item) => item.id);

    // Set equality falsifies both a skipped row and a repeated one; a bare
    // count would pass against either.
    expect(all).toHaveLength(51);
    expect(new Set(all).size).toBe(51);

    // Set equality cannot see an inverted tie-break that preserves the row set:
    // the tied members would come back in the wrong relative order with every id
    // still present. Ordering across the seam is what this case is named for, so
    // it is asserted directly (C20, round-2 TEST-F5).
    const ordered = [...page1.items, ...page2.items];
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1]!;
      const cur = ordered[i]!;
      const prevKey = `${prev.createdAt}|${prev.id}`;
      const curKey = `${cur.createdAt}|${cur.id}`;
      expect(prevKey >= curKey).toBe(true);
    }
  });

  it('resumes at microsecond precision, not the millisecond a JS Date can hold', async () => {
    const { tenantId, cookie } = await setup('c20b2');
    // timestamptz stores microseconds; a JS Date holds milliseconds. Encoding
    // the cursor from the driver's Date truncates, which moves the keyset
    // boundary EARLIER and drops every row in the gap — silently, with no error
    // and no duplicate. The other boundary fixtures all land on exact
    // milliseconds, so this defect is invisible to them by construction.
    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload, created_at)
         SELECT $1, 'matcher', 'sync_completed', '{}'::jsonb,
                timestamptz '2026-07-09T00:00:00.000Z' + (g || ' seconds')::interval
         FROM generate_series(1, 49) AS g`,
        [tenantId],
      );
      // Row 50 (the page-1 boundary) carries .500900; row 51 sits at .500400 —
      // inside the same millisecond, so a truncated .500 cursor excludes it.
      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload, created_at)
         VALUES ($1, 'matcher', 'sync_completed', '{}'::jsonb, timestamptz '2026-07-09T00:00:00.500900Z'),
                ($1, 'matcher', 'sync_completed', '{}'::jsonb, timestamptz '2026-07-09T00:00:00.500400Z')`,
        [tenantId],
      );
    });

    const page1 = await listEvents(cookie);
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listEvents(cookie, `cursor=${encodeURIComponent(page1.nextCursor!)}`);
    const all = [...page1.items, ...page2.items].map((item) => item.id);
    expect(new Set(all).size).toBe(51);
  });

  it('filters by source, and an unknown source is an empty page rather than an error', async () => {
    const { tenantId, cookie } = await setup('c20d');
    await insertEvent(tenantId, 'label', '2026-07-06T00:00:00.000Z');
    await insertEvent(tenantId, 'google-workspace', '2026-07-06T00:00:01.000Z');

    expect((await listEvents(cookie, 'source=label')).items).toHaveLength(1);
    // 400 here would leak which sources exist in this tenant.
    expect((await listEvents(cookie, 'source=nonexistent')).items).toHaveLength(0);
  });

  it('rejects a cursor replayed under a dropped or changed filter', async () => {
    const { tenantId, cookie } = await setup('c20e');
    await withTenant(appPool, tenantId, async (tx) => {
      for (const source of ['label', 'google-workspace']) {
        await tx.query(
          `INSERT INTO discovery_events (tenant_id, source, kind, payload, created_at)
           SELECT $1, $2, 'sync_completed', '{}'::jsonb,
                  timestamptz '2026-07-07T00:00:00.000Z' + (g || ' seconds')::interval
           FROM generate_series(1, 51) AS g`,
          [tenantId, source],
        );
      }
    });

    const page1 = await listEvents(cookie, 'source=label');
    expect(page1.nextCursor).not.toBeNull();
    const cursor = encodeURIComponent(page1.nextCursor!);

    const sameFilter = await app.inject({
      method: 'GET',
      url: `/api/events?source=label&cursor=${cursor}`,
      headers: { cookie },
    });
    expect(sameFilter.statusCode).toBe(200);

    // Without the binding these would return a silently unfiltered page that
    // omits every non-label row newer than the cursor position.
    for (const url of [`/api/events?cursor=${cursor}`, `/api/events?source=matcher&cursor=${cursor}`]) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(400);
    }
  });

  it('rejects malformed cursors and treats an empty one as no cursor', async () => {
    const { cookie } = await setup('c20f');

    const malformed = [
      'not-a-cursor',
      Buffer.from('plain text').toString('base64url'),
      Buffer.from(JSON.stringify({ t: '2026-07-01T00:00:00.000Z' })).toString('base64url'),
      Buffer.from(JSON.stringify({ t: '2026-07-01T00:00:00.000Z', id: 'nope', s: null })).toString(
        'base64url',
      ),
      Buffer.from(
        JSON.stringify({ t: '2026-07-01T00:00:00.000Z', id: randomUUID(), s: null, extra: 1 }),
      ).toString('base64url'),
      // Date.parse accepts '0'; timestamptz does not. Before the format check
      // this reached the query and came back as a 500 quoting the driver's
      // "date/time field value out of range" — a 500 where the decoder promises
      // a 400, with database internals in the body.
      Buffer.from(JSON.stringify({ t: '0', id: randomUUID(), s: null })).toString('base64url'),
      // Shape-valid but calendar-invalid. Both were measured returning 500 at
      // the live API before the calendar and year-zero checks landed: Date.parse
      // rolls Feb 30 forward instead of failing, and JS numbers years
      // astronomically so year 0 survives a field-by-field round-trip.
      Buffer.from(JSON.stringify({ t: '2026-02-30T00:00:00Z', id: randomUUID(), s: null })).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ t: '0000-01-01T00:00:00Z', id: randomUUID(), s: null })).toString(
        'base64url',
      ),
    ];
    for (const cursor of malformed) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/events?cursor=${encodeURIComponent(cursor)}`,
        headers: { cookie },
      });
      expect(res.statusCode, cursor).toBe(400);
      // The status alone would not catch a rejection that answers correctly
      // while quoting the driver: assert the body is the flat error shape and
      // carries no database text.
      expect(res.json()).toEqual({ error: 'invalid_query' });
      expect(res.body).not.toMatch(/date\/time|timestamptz|out of range/i);
    }

    const empty = await app.inject({ method: 'GET', url: '/api/events?cursor=', headers: { cookie } });
    expect(empty.statusCode).toBe(200);
  });

  it('a well-formed cursor from another tenant returns an empty page, not an error', async () => {
    const { tenantId: theirTenant } = await setup('c20g-them');
    const theirEventId = await insertEvent(theirTenant, 'matcher', '2026-07-08T00:00:00.000Z');
    const { cookie: ourCookie } = await setup('c20g-us');

    const foreignCursor = Buffer.from(
      JSON.stringify({ t: '2026-07-08T00:00:00.000Z', id: theirEventId, s: null }),
    ).toString('base64url');

    const res = await app.inject({
      method: 'GET',
      url: `/api/events?cursor=${encodeURIComponent(foreignCursor)}`,
      headers: { cookie: ourCookie },
    });

    // Indistinguishable from an exhausted cursor: 400 would confirm the cursor
    // is syntactically well-formed but belongs to someone else.
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
  });
});
