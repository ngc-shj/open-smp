import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withTenant } from '@open-smp/schema';
import type { LicenseRollupItem } from '@open-smp/api-types';
import { ROLLUP_SQL, toItem } from '../src/routes/licenses.js';

// C3 acceptance, against real Postgres 16. The test executes the SHIPPED
// ROLLUP_SQL and the SHIPPED toItem, never a copy of either: the reconciliation
// is a SQL expression, so a JavaScript re-implementation in the test would
// assert a twin's behaviour and drift from production silently.
//
// Postgres only — no Redis, no Fastify. The HTTP layer for this route is a
// session-guarded GET with no parameters, and the sweeps in
// api.integration.test.ts already cover authentication, Origin and rate-limit
// coverage for every registered route via the onRoute hook. The cost is one
// container boot for this file; folding these cases into api.integration.test.ts
// would avoid it, at the price of sharing that file's fixture, which is what
// made two earlier attempts at this contract vacuous.

let container: StartedPostgreSqlContainer;
let appPool: Pool;

const tenantId = randomUUID();

type AccountSpec = {
  externalId: string;
  status: 'active' | 'suspended' | 'archived';
  link: 'matched' | 'ghost' | 'orphan' | 'ambiguous' | null;
  /** Minutes behind the application's newest sync stamp. 0 = seen in the latest run. */
  syncLagMinutes?: number;
};

type ContractSpec = { seats: number; unitPrice: string; currency: string; cycle: 'monthly' | 'annual' };

async function seedApp(
  key: string,
  opts: { accounts?: AccountSpec[]; contract?: ContractSpec; withCredentials?: boolean } = {},
): Promise<void> {
  await withTenant(appPool, tenantId, async (tx) => {
    const appRes = await tx.query<{ id: string }>(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_enc)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [randomUUID(), tenantId, key, `${key} app`, opts.withCredentials ? Buffer.from('x') : null],
    );
    const appId = appRes.rows[0]!.id;

    for (const spec of opts.accounts ?? []) {
      const accountId = randomUUID();
      await tx.query(
        `INSERT INTO saas_accounts
           (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, now() - ($8 || ' minutes')::interval)`,
        [
          accountId,
          tenantId,
          appId,
          spec.externalId,
          `${spec.externalId}@example.com`,
          spec.externalId,
          spec.status,
          String(spec.syncLagMinutes ?? 0),
        ],
      );

      if (spec.link === null) continue;

      // orphan and ambiguous carry identity_id IS NULL; ghost and matched must
      // carry one. account_links_status_identity_id_check enforces exactly this,
      // so a fixture that got it backwards would fail loudly rather than skew a
      // count.
      let identityId: string | null = null;
      if (spec.link === 'ghost' || spec.link === 'matched') {
        const left = spec.link === 'ghost';
        const idRes = await tx.query<{ id: string }>(
          `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            randomUUID(),
            tenantId,
            `emp-${spec.externalId}`,
            `${spec.externalId}@example.com`,
            spec.externalId,
            left ? 'left' : 'active',
            left ? new Date('2026-03-31T00:00:00Z') : null,
          ],
        );
        identityId = idRes.rows[0]!.id;
      }

      await tx.query(
        `INSERT INTO account_links (id, tenant_id, saas_account_id, identity_id, status, confidence, rule_id)
         VALUES ($1, $2, $3, $4, $5, 1.0, 'fixture')`,
        [randomUUID(), tenantId, accountId, identityId, spec.link],
      );
    }

    if (opts.contract) {
      await tx.query(
        `INSERT INTO saas_contracts
           (id, tenant_id, saas_app_id, plan_name, seats, unit_price, currency, billing_cycle)
         VALUES ($1, $2, $3, 'Business', $4::int, $5::numeric, $6, $7::billing_cycle)`,
        [
          randomUUID(),
          tenantId,
          appId,
          opts.contract.seats,
          opts.contract.unitPrice,
          opts.contract.currency,
          opts.contract.cycle,
        ],
      );
    }
  });
}

async function rollup(): Promise<Map<string, LicenseRollupItem>> {
  const rows = await withTenant(appPool, tenantId, async (tx) => {
    const result = await tx.query(ROLLUP_SQL);
    return result.rows;
  });
  return new Map(rows.map((row) => [row.app_key as string, toItem(row as never)]));
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  await runMigrations(container.getConnectionUri());

  appPool = new Pool({
    connectionString: container.getConnectionUri().replace(/\/\/[^@]+@/, '//opensmp_app:opensmp@'),
  });
  await appPool.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
    tenantId,
    'rollup-tenant',
    'Rollup Tenant',
  ]);

  // over-allocated: 4 active accounts against 2 purchased seats, one ghost and
  // one orphan among them.
  await seedApp('over-allocated', {
    withCredentials: true,
    contract: { seats: 2, unitPrice: '1500.00', currency: 'JPY', cycle: 'monthly' },
    accounts: [
      { externalId: 'oa-matched', status: 'active', link: 'matched' },
      { externalId: 'oa-ghost', status: 'active', link: 'ghost' },
      { externalId: 'oa-orphan', status: 'active', link: 'orphan' },
      { externalId: 'oa-ambiguous', status: 'active', link: 'ambiguous' },
    ],
  });

  // The account the admin already deleted upstream: sync never reaps it, so it
  // is still `active`, but it was absent from the newest run.
  await seedApp('stale', {
    contract: { seats: 10, unitPrice: '10.00', currency: 'USD', cycle: 'annual' },
    accounts: [
      { externalId: 'st-current', status: 'active', link: 'matched' },
      { externalId: 'st-deleted-upstream', status: 'active', link: 'ghost', syncLagMinutes: 60 },
    ],
  });

  // Accounts, no contract — the ordinary state before anyone uploads a CSV.
  await seedApp('uncontracted', {
    withCredentials: true,
    accounts: [{ externalId: 'un-1', status: 'active', link: 'matched' }],
  });

  // Contract, no accounts — every CSV-created application on day one.
  await seedApp('contract-only', {
    contract: { seats: 5, unitPrice: '99.99', currency: 'EUR', cycle: 'monthly' },
  });

  // Synced but never matched, and a partially matched sibling: sync and match
  // are separate jobs, so both states occur in normal operation.
  await seedApp('never-matched', {
    accounts: [
      { externalId: 'nm-1', status: 'active', link: null },
      { externalId: 'nm-2', status: 'active', link: null },
    ],
  });
  await seedApp('partially-matched', {
    accounts: [
      { externalId: 'pm-1', status: 'active', link: 'matched' },
      { externalId: 'pm-2', status: 'active', link: null },
    ],
  });

  // A suspended orphan consumes no seat by the plan's own rule, so it must not
  // be reported as a reclaimable one.
  await seedApp('suspended-orphan', {
    contract: { seats: 3, unitPrice: '20.00', currency: 'USD', cycle: 'monthly' },
    accounts: [
      { externalId: 'so-active', status: 'active', link: 'matched' },
      { externalId: 'so-suspended', status: 'suspended', link: 'orphan' },
    ],
  });
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await container?.stop();
});

describe('C3 acceptance: the reconciliation', () => {
  it('reports over-allocation as a negative number rather than clamping it', async () => {
    const row = (await rollup()).get('over-allocated')!;
    expect(row.purchased).toBe(2);
    expect(row.assigned).toBe(4);
    expect(row.unassigned).toBe(-2);
  });

  it('counts ghost and orphan as reclaimable and ambiguous as needing review', async () => {
    const row = (await rollup()).get('over-allocated')!;
    expect(row.reclaimable).toEqual({ ghost: 1, orphan: 1, total: 2 });
    expect(row.needsReview).toBe(1);
  });

  it('keeps every reason a restriction of assigned, so the partition holds', async () => {
    for (const row of (await rollup()).values()) {
      expect(row.reclaimable.total + row.needsReview).toBeLessThanOrEqual(row.assigned);
      expect(row.reclaimable.ghost + row.reclaimable.orphan).toBe(row.reclaimable.total);
    }
  });

  it('excludes an account absent from the latest sync run from both assigned and reclaimable', async () => {
    const row = (await rollup()).get('stale')!;
    // Two rows exist and both are `active`; only one was seen in the newest run.
    expect(row.assigned).toBe(1);
    // The stale one is a ghost. Counting it would charge for a seat the same
    // query has just decided is not assigned.
    expect(row.reclaimable.total).toBe(0);
  });

  it('does not count a suspended account as an assigned or a reclaimable seat', async () => {
    const row = (await rollup()).get('suspended-orphan')!;
    expect(row.assigned).toBe(1);
    expect(row.reclaimable).toEqual({ ghost: 0, orphan: 0, total: 0 });
  });

  it('reports an application with accounts and no contract, with null contract fields', async () => {
    const row = (await rollup()).get('uncontracted')!;
    expect(row.assigned).toBe(1);
    expect(row.purchased).toBeNull();
    expect(row.unassigned).toBeNull();
    expect(row.unitPrice).toBeNull();
    expect(row.reclaimableValue).toBeNull();
  });

  it('distinguishes no-accounts, not-matched, partially-matched and matched', async () => {
    const rows = await rollup();
    expect(rows.get('contract-only')!.matchState).toBe('no-accounts');
    expect(rows.get('never-matched')!.matchState).toBe('not-matched');
    expect(rows.get('partially-matched')!.matchState).toBe('partially-matched');
    expect(rows.get('over-allocated')!.matchState).toBe('matched');
  });

  it('reports zero reclaimable for an application with no accounts, not an unmatched state', async () => {
    const row = (await rollup()).get('contract-only')!;
    expect(row.assigned).toBe(0);
    expect(row.unassigned).toBe(5);
    expect(row.reclaimable.total).toBe(0);
  });

  it('returns money as an exact string and carries the period it is expressed in', async () => {
    const row = (await rollup()).get('over-allocated')!;
    expect(row.unitPrice).toBe('1500.00');
    // 2 reclaimable seats x 1500.00, computed in SQL.
    expect(row.reclaimableValue).toBe('3000.00');
    expect(row.reclaimableValuePeriod).toBe('monthly');
    expect(typeof row.reclaimableValue).toBe('string');
  });

  it('derives hasConnector from stored credentials', async () => {
    const rows = await rollup();
    expect(rows.get('over-allocated')!.hasConnector).toBe(true);
    expect(rows.get('contract-only')!.hasConnector).toBe(false);
  });
});
