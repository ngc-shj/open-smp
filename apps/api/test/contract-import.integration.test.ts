import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { runMigrations, withTenant } from '@open-smp/schema';
import type { ContractImportResponse, DiscoveryEventListResponse } from '@open-smp/api-types';
import type { MatchJobData, SyncJobData, TokenAuditJobData } from '@open-smp/queues';
import { buildApp } from '../src/app.js';
import { ARGON2ID_OPTIONS, type Hasher } from '../src/auth.js';
import {
  CONTRACT_INSERT_SQL,
  countTenantApps,
  lockTenantAppCatalog,
} from '../src/routes/contract-import.js';
import { MAX_SAAS_APPS_PER_TENANT } from '../src/import-limits.js';
import type { AppDeps } from '../src/deps.js';

// C2 acceptance, against real Postgres 16 through the real Fastify pipeline.
//
// THE CONTRACT THIS FILE EXISTS FOR. The import issues one INSERT per row
// inside one transaction with no savepoints, so a value Postgres refuses does
// not cost its own row — it aborts the transaction, every later statement
// returns `current transaction is aborted`, and the rows already applied roll
// back. "The valid row in the same file was still applied" is therefore the
// assertion that proves the validator covers a constraint, and it is an
// assertion no unit test can make.
//
// Postgres only, no Redis: nothing on this path enqueues. The queue members of
// AppDeps are bare objects — reaching one would throw rather than pass quietly.

const APP_ORIGIN = 'http://localhost:3000';

let container: StartedPostgreSqlContainer;
let appPool: Pool;
let app: FastifyInstance;

const hasher: Hasher = {
  hash: (password) => argon2.hash(password, { type: argon2.argon2id, ...ARGON2ID_OPTIONS }),
  verify: (hash, password) => argon2.verify(hash, password),
};

const CSV_COLUMNS = [
  'app_key',
  'app_name',
  'plan_name',
  'seats',
  'unit_price',
  'currency',
  'billing_cycle',
  'term_start',
  'term_end',
  'note',
] as const;

/** Every field quoted, so a value containing a comma is a value and not a column. */
function toCsv(rows: Record<string, string>[]): string {
  const line = (values: string[]): string =>
    values.map((value) => `"${value.replace(/"/g, '""')}"`).join(',');
  return [
    line([...CSV_COLUMNS]),
    ...rows.map((row) => line(CSV_COLUMNS.map((column) => row[column] ?? ''))),
  ].join('\n');
}

async function seedTenantAndLogin(): Promise<{ tenantId: string; cookie: string; userId: string }> {
  const slug = `tenant-contract-${randomUUID()}`;
  const tenant = await appPool.query<{ id: string }>(
    'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id',
    [slug, 'Contract Tenant'],
  );
  const tenantId = tenant.rows[0]!.id;
  const passwordHash = await hasher.hash('correct-password');
  const userId = await withTenant(appPool, tenantId, async (tx) => {
    const result = await tx.query<{ id: string }>(
      'INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [tenantId, 'admin@example.com', passwordHash],
    );
    return result.rows[0]!.id;
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: APP_ORIGIN },
    payload: { tenantSlug: slug, email: 'admin@example.com', password: 'correct-password' },
  });
  const setCookie = res.cookies.find((c) => c.name === 'session');
  if (!setCookie) throw new Error(`login failed in test setup: ${res.statusCode} ${res.payload}`);
  return { tenantId, cookie: `session=${setCookie.value}`, userId };
}

async function upload(cookie: string, csv: string) {
  const boundary = '----vitestBoundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="contracts.csv"\r\nContent-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return app.inject({
    method: 'POST',
    url: '/api/contract-import',
    headers: {
      origin: APP_ORIGIN,
      cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

function canaryKey(): string {
  return `canary-${randomUUID()}`;
}

/** A row C1 accepts in every column, used as the survivor beside a rejected one. */
function validRow(appKey: string): Record<string, string> {
  return {
    app_key: appKey,
    app_name: 'Canary',
    plan_name: 'Business',
    seats: '10',
    unit_price: '12.50',
    currency: 'USD',
    billing_cycle: 'monthly',
    term_start: '2025-01-01',
    term_end: '2025-12-31',
    note: 'canary',
  };
}

async function contractFor(tenantId: string, appKey: string) {
  return withTenant(appPool, tenantId, async (tx) => {
    const result = await tx.query<Record<string, unknown>>(
      `SELECT c.* FROM saas_contracts c
       JOIN saas_apps a ON a.id = c.saas_app_id
       WHERE a.tenant_id = $1 AND a.key = $2`,
      [tenantId, appKey],
    );
    return result.rows[0] ?? null;
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  await runMigrations(container.getConnectionUri());

  const url = new URL(container.getConnectionUri());
  url.username = 'opensmp_app';
  url.password = 'opensmp';
  appPool = new Pool({ connectionString: url.toString() });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await container?.stop();
}, 60_000);

beforeEach(async () => {
  await app?.close();
  const deps: AppDeps = {
    pool: appPool,
    encryptionKeys: new Map([[1, Buffer.alloc(32, 7)]]),
    appOrigin: APP_ORIGIN,
    hasher,
    // Never reached from this route; a bare object throws on any use rather
    // than answering plausibly.
    syncQueue: {} as Queue<SyncJobData>,
    matchQueue: {} as Queue<MatchJobData>,
    tokenAuditQueue: {} as Queue<TokenAuditJobData>,
    getJob: async () => null,
  };
  app = buildApp(deps);
  await app.ready();
});

// One case per value C1 refuses. The file always carries a valid row alongside
// the rejected one, because what is being measured is not the error message —
// it is that the rejection never reached the transaction.
type RejectionCase = { label: string; cells: Record<string, string>; message: RegExp };

const CONSTRAINT_COVERAGE: Record<
  string,
  { rejects: RejectionCase[] } | { structural: string }
> = {
  saas_contracts_seats_check: {
    rejects: [
      { label: 'seats above the ceiling', cells: { seats: '10000001' }, message: /seats/ },
      { label: 'negative seats', cells: { seats: '-4' }, message: /seats/ },
    ],
  },
  saas_contracts_unit_price_check: {
    rejects: [
      { label: 'a negative price', cells: { unit_price: '-1.00' }, message: /unit_price/ },
      // `unit_price >= 0 AND unit_price = unit_price` — round 1's recommendation
      // — stores this, because numeric defines NaN as equal to itself.
      { label: 'NaN', cells: { unit_price: 'NaN' }, message: /unit_price/ },
    ],
  },
  saas_contracts_term_order_check: {
    rejects: [
      {
        label: 'a term that ends before it starts',
        cells: { term_start: '2025-12-31', term_end: '2025-01-01' },
        message: /term_end/,
      },
    ],
  },
  saas_contracts_currency_check: {
    rejects: [{ label: 'a four-letter currency', cells: { currency: 'USDX' }, message: /currency/ }],
  },
  saas_contracts_plan_name_check: {
    rejects: [
      { label: 'a 201-character plan name', cells: { plan_name: 'p'.repeat(201) }, message: /plan_name/ },
    ],
  },
  saas_contracts_note_check: {
    rejects: [{ label: 'a 501-character note', cells: { note: 'n'.repeat(501) }, message: /note/ }],
  },
  saas_contracts_tenant_id_saas_app_id_key: {
    structural:
      'ON CONFLICT ON CONSTRAINT … DO UPDATE in CONTRACT_INSERT_SQL — covered by the re-import and duplicate-row cases',
  },
  saas_contracts_tenant_id_saas_app_id_fkey: {
    structural:
      'every row resolves or creates its application inside the same transaction — covered by the creation case',
  },
  saas_contracts_pkey: { structural: 'id defaults to gen_random_uuid()' },
};

// Rejections Postgres raises from the COLUMN TYPE rather than from a
// constraint: they abort the transaction identically, and pg_constraint cannot
// enumerate them, so this list is by hand and says so.
const TYPE_LEVEL_CASES: RejectionCase[] = [
  { label: 'a day the calendar does not have', cells: { term_start: '2025-02-30' }, message: /term_start/ },
  { label: 'a date Postgres cannot parse', cells: { term_end: 'someday' }, message: /term_end/ },
  { label: 'a value outside the billing_cycle enum', cells: { billing_cycle: 'yearly' }, message: /billing_cycle/ },
  { label: 'a price past numeric(14,2) precision', cells: { unit_price: '1000000000000' }, message: /unit_price/ },
  { label: 'a price past numeric(14,2) scale', cells: { unit_price: '10.005' }, message: /unit_price/ },
  { label: 'seats past int4', cells: { seats: '99999999999' }, message: /seats/ },
];

describe('C2 acceptance: no value reaches the transaction that C1 can reject', () => {
  it('has a case for every constraint the catalog declares on saas_contracts', async () => {
    // Derived from pg_constraint, not from the migration text and not from the
    // plan's prose. Revision 2's hand-written validator list omitted plan_name
    // and both term dates and disagreed with C1 on the seats ceiling; a list
    // written by hand is exactly what this replaces.
    const result = await appPool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'saas_contracts'::regclass AND contype IN ('c', 'u', 'f', 'p')
       ORDER BY conname`,
    );
    const declared = result.rows.map((row) => row.conname);

    expect(declared.length).toBeGreaterThan(0);
    expect(
      declared.filter((name) => !(name in CONSTRAINT_COVERAGE)),
      'constraints with no case in CONSTRAINT_COVERAGE',
    ).toEqual([]);
    expect(
      Object.keys(CONSTRAINT_COVERAGE).filter((name) => !declared.includes(name)),
      'cases naming a constraint the catalog does not have',
    ).toEqual([]);
  });

  it('writes every NOT NULL column that has no default', async () => {
    // 23502 aborts the transaction like any other rejection, and a column added
    // to C1 later would be invisible to every case above.
    const result = await appPool.query<{ attname: string }>(
      `SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = 'saas_contracts'::regclass
         AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull
         AND NOT EXISTS (
           SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum
         )`,
    );
    const required = result.rows.map((row) => row.attname);

    const columnList = /INSERT INTO saas_contracts\s*\(([^)]*)\)/.exec(CONTRACT_INSERT_SQL);
    expect(columnList, 'could not read the INSERT column list').not.toBeNull();
    const written = columnList![1]!.split(',').map((column) => column.trim());

    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((column) => !written.includes(column))).toEqual([]);
  });

  const rejectionCases = [
    ...Object.entries(CONSTRAINT_COVERAGE).flatMap(([constraint, entry]) =>
      'rejects' in entry ? entry.rejects.map((c) => ({ ...c, constraint })) : [],
    ),
    ...TYPE_LEVEL_CASES.map((c) => ({ ...c, constraint: 'column type' })),
  ];

  it.each(rejectionCases)('rejects $label without costing the valid row ($constraint)', async (testCase) => {
    const { tenantId, cookie } = await seedTenantAndLogin();
    const survivor = canaryKey();
    const offender = canaryKey();

    // The offending row FIRST. Ordered the other way, an unvalidated value
    // would abort the transaction after the valid row's INSERT had already
    // succeeded — and the rollback would still be observable, but only because
    // of the ordering rather than because of the transaction.
    const res = await upload(
      cookie,
      toCsv([
        { ...validRow(offender), ...testCase.cells },
        validRow(survivor),
      ]),
    );

    expect(res.statusCode, res.payload).toBe(200);
    const body = res.json<ContractImportResponse>();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.row).toBe(2);
    expect(body.errors[0]!.message).toMatch(testCase.message);

    // The property. A validator blind to this value would have taken the
    // survivor down with it.
    expect(await contractFor(tenantId, survivor)).not.toBeNull();
    expect(await contractFor(tenantId, offender)).toBeNull();
  });
});

describe('C2 acceptance: the catalog rows an upload creates', () => {
  it('creates the application, applies the contract, and reports both', async () => {
    const { tenantId, cookie } = await seedTenantAndLogin();
    const key = canaryKey();

    const res = await upload(cookie, toCsv([validRow(key)]));

    expect(res.statusCode, res.payload).toBe(200);
    const body = res.json<ContractImportResponse>();
    expect(body).toMatchObject({ imported: 1, skipped: 0, createdApps: [key], errors: [], warnings: [] });

    const contract = await contractFor(tenantId, key);
    expect(contract).toMatchObject({
      plan_name: 'Business',
      seats: 10,
      // numeric arrives as the string pg formats, at the column's scale.
      unit_price: '12.50',
      currency: 'USD',
      billing_cycle: 'monthly',
    });
  });

  it('re-imports over the same application instead of raising a unique violation', async () => {
    const { tenantId, cookie } = await seedTenantAndLogin();
    const key = canaryKey();

    await upload(cookie, toCsv([validRow(key)]));
    const second = await upload(
      cookie,
      toCsv([{ ...validRow(key), seats: '25', plan_name: 'Enterprise' }]),
    );

    expect(second.statusCode, second.payload).toBe(200);
    const body = second.json<ContractImportResponse>();
    // The application already existed, so the second upload creates nothing.
    expect(body).toMatchObject({ imported: 1, createdApps: [] });
    expect(await contractFor(tenantId, key)).toMatchObject({ seats: 25, plan_name: 'Enterprise' });
  });

  it('lets the last of two rows for one application win, with a warning', async () => {
    const { tenantId, cookie } = await seedTenantAndLogin();
    const key = canaryKey();

    const res = await upload(
      cookie,
      toCsv([validRow(key), { ...validRow(key), seats: '99' }]),
    );

    const body = res.json<ContractImportResponse>();
    expect(body.warnings).toEqual([
      { row: 3, message: `duplicate app_key "${key}" overwrites an earlier row` },
    ]);
    expect(await contractFor(tenantId, key)).toMatchObject({ seats: 99 });
  });

  it('refuses a reserved app_key and creates no application for it', async () => {
    const { tenantId, cookie } = await seedTenantAndLogin();
    const survivor = canaryKey();

    const res = await upload(
      cookie,
      toCsv([{ ...validRow('label'), app_key: ' LABEL ' }, validRow(survivor)]),
    );

    const body = res.json<ContractImportResponse>();
    expect(body.errors[0]!.message).toMatch(/reserved/);
    expect(body.createdApps).toEqual([survivor]);

    // The point of the refusal: an application under this key would emit sync
    // events answering ?source=label beside the audit trail.
    //
    // Read through withTenant. A bare pool query sets no `app.tenant_id`, so
    // the RLS predicate is NULL and the table answers empty for every key —
    // the assertion would hold with the row present.
    const planted = await withTenant(appPool, tenantId, (tx) =>
      tx.query("SELECT 1 FROM saas_apps WHERE tenant_id = $1 AND key = 'label'", [tenantId]),
    );
    expect(planted.rowCount).toBe(0);
    expect(
      (await withTenant(appPool, tenantId, (tx) =>
        tx.query('SELECT 1 FROM saas_apps WHERE tenant_id = $1 AND key = $2', [tenantId, survivor]),
      )).rowCount,
      'the read path itself must be able to see a row',
    ).toBe(1);
  });
});

describe('C2 acceptance: the upload is readable in the audit trail', () => {
  it('serves the recorded fields through GET /events', async () => {
    const { cookie, userId } = await seedTenantAndLogin();
    const key = canaryKey();

    await upload(cookie, toCsv([validRow(key), { ...validRow(canaryKey()), seats: '-1' }]));

    const res = await app.inject({
      method: 'GET',
      url: '/api/events?source=contract',
      headers: { cookie },
    });

    expect(res.statusCode, res.payload).toBe(200);
    const body = res.json<DiscoveryEventListResponse>();
    expect(body.items).toHaveLength(1);
    // Stored AND served. The projection is a per-kind allowlist whose default
    // branch drops every unknown field, so a row written without a matching
    // branch is persisted and then answered as `{}` — present in the table,
    // absent from the trail.
    expect(body.items[0]).toMatchObject({ source: 'contract', kind: 'contract_import' });
    expect(body.items[0]!.payload).toEqual({
      actorUserId: userId,
      imported: 1,
      skipped: 1,
      createdAppKeys: [key],
    });
  });

  it('records an upload that applied nothing', async () => {
    const { cookie } = await seedTenantAndLogin();

    await upload(cookie, toCsv([{ ...validRow(canaryKey()), seats: 'lots' }]));

    const res = await app.inject({
      method: 'GET',
      url: '/api/events?source=contract',
      headers: { cookie },
    });
    const body = res.json<DiscoveryEventListResponse>();

    // "Nobody uploaded anything" and "somebody uploaded a file we rejected
    // entirely" are different facts about an operator.
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.payload).toMatchObject({ imported: 0, skipped: 1, createdAppKeys: [] });
  });
});

describe('C2 acceptance: the per-tenant application ceiling', () => {
  async function fillCatalog(tenantId: string, count: number): Promise<void> {
    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO saas_apps (tenant_id, key, display_name)
         SELECT $1, 'bulk-' || g, 'Bulk ' || g FROM generate_series(1, $2::int) g`,
        [tenantId, count],
      );
    });
  }

  it('refuses the rows that would create an application past the ceiling, and applies the rest', async () => {
    const { tenantId, cookie } = await seedTenantAndLogin();
    await fillCatalog(tenantId, MAX_SAAS_APPS_PER_TENANT);
    const existing = 'bulk-1';
    const newcomer = canaryKey();

    const res = await upload(cookie, toCsv([validRow(newcomer), validRow(existing)]));

    expect(res.statusCode, res.payload).toBe(200);
    const body = res.json<ContractImportResponse>();
    // A full catalog must not stop an operator re-pricing what is already in it.
    expect(body.imported).toBe(1);
    expect(body.errors[0]!.message).toMatch(/catalog is full/);
    expect(await contractFor(tenantId, existing)).not.toBeNull();
    expect(await contractFor(tenantId, newcomer)).toBeNull();
  });

  it('serialises two concurrent transactions so the second counts the first', async () => {
    // The measured defect: `SELECT count(*)` takes no lock at READ COMMITTED,
    // so both transactions read the same pre-insert count and both spend it
    // (two transactions took a ceiling of 10 to 18 rows). Driven through the
    // SHIPPED lock and count, with the interleave forced rather than hoped for
    // — a Promise.all of two uploads passes whether or not the lock exists.
    const { tenantId } = await seedTenantAndLogin();

    let signalLocked!: () => void;
    const firstHasLocked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let countedFirst = -1;
    const first = withTenant(appPool, tenantId, async (tx) => {
      await lockTenantAppCatalog(tx, tenantId);
      countedFirst = await countTenantApps(tx, tenantId);
      await tx.query('INSERT INTO saas_apps (tenant_id, key, display_name) VALUES ($1, $2, $3)', [
        tenantId,
        canaryKey(),
        'First',
      ]);
      signalLocked();
      await firstMayCommit;
    });

    await firstHasLocked;
    const second = withTenant(appPool, tenantId, async (tx) => {
      await lockTenantAppCatalog(tx, tenantId);
      return countTenantApps(tx, tenantId);
    });

    await waitForBlockedAdvisoryLock();
    releaseFirst();
    await first;

    // Without the lock this reads the pre-commit count and equals countedFirst.
    expect(await second).toBe(countedFirst + 1);
  });

  /**
   * Blocks until a backend is WAITING on an advisory lock. Not a sleep: the
   * condition is the state the assertion depends on, and its absence is the
   * failure being tested for — a no-op lock never blocks, so this times out
   * with a message naming the cause instead of passing vacuously.
   */
  async function waitForBlockedAdvisoryLock(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const res = await appPool.query<{ n: string }>(
        `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
      );
      if (Number(res.rows[0]!.n) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('no backend ever blocked on the catalog advisory lock');
  }
});
