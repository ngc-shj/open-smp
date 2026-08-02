import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withTenant } from '@open-smp/schema';
import { encryptCredentials } from '@open-smp/crypto';
import type { ConnectorContext, RawAccount, SaaSConnector } from '@open-smp/connectors-core';
import { runSync } from '../src/sync.js';

// C5 acceptance: (a) re-running the same sync twice yields identical row
// counts and last_synced_at monotonicity; (b) a sync job for tenant A writes
// zero rows visible under tenant B's GUC.

const FAKE_ACCOUNTS: RawAccount[] = [
  {
    externalId: 'ext-1',
    email: 'alice@example.com',
    displayName: 'Alice',
    accountStatus: 'active',
    isAdmin: false,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    raw: { note: 'fixture' },
  },
  {
    externalId: 'ext-2',
    email: 'bob@example.com',
    displayName: 'Bob',
    accountStatus: 'suspended',
    isAdmin: true,
    lastActivityAt: null,
    raw: { note: 'fixture' },
  },
];

class FakeConnector implements SaaSConnector {
  id = 'fake-app';
  authKind: SaaSConnector['authKind'] = 'apikey';
  tokenCapability: SaaSConnector['tokenCapability'] = 'none';

  async *listUsers(ctx: ConnectorContext): AsyncIterable<RawAccount> {
    // The signal IS observed, like both real connectors observe it. A fake that
    // ignored it made the deadline unobservable at this tier — reverting
    // runSync to a never-aborting controller left this suite green, which is
    // the state the deadline exists to prevent (RT1: the fake must not be more
    // permissive than the thing it stands for).
    for (const account of FAKE_ACCOUNTS) {
      if (ctx.signal.aborted) {
        throw new Error('fake connector: run aborted');
      }
      yield account;
    }
  }
}

// Mutable Map (not the ReadonlyMap ConnectorRegistry alias) so seedTenantWithApp
// can register a per-seed unique key; runSync accepts it structurally.
const fakeRegistry = new Map<string, () => SaaSConnector>([['fake-app', () => new FakeConnector()]]);

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;

const tenantA = randomUUID();
const tenantB = randomUUID();
const encryptionKeys = new Map<number, Buffer>([[1, Buffer.alloc(32, 7)]]);

async function seedTenantWithApp(tenantId: string): Promise<string> {
  const saasAppId = randomUUID();
  // Register the per-seed unique key so runSync's registry lookup resolves it.
  fakeRegistry.set(`fake-app-${saasAppId.slice(0, 8)}`, () => new FakeConnector());

  const credentials = JSON.stringify({ apiKey: 'fake-key' });
  const { blob, keyVersion } = encryptCredentials(
    Buffer.from(credentials, 'utf8'),
    { tenantId, saasAppId },
    encryptionKeys,
  );

  await withTenant(appPool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Tenant') ON CONFLICT DO NOTHING`,
      [tenantId, `tenant-${tenantId}`],
    );
    // Unique key per seed call: UNIQUE (tenant_id, key) would collide when a
    // test seeds the same tenant twice, and the ciphertext AAD is bound to
    // this call's saasAppId, so reusing an existing row is not an option.
    await tx.query(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_enc, credentials_key_version)
       VALUES ($1, $2, $5, 'Fake App', $3, $4)`,
      [saasAppId, tenantId, Buffer.from(blob), keyVersion, `fake-app-${saasAppId.slice(0, 8)}`],
    );
  });

  return saasAppId;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(container.getConnectionUri());

  const url = new URL(container.getConnectionUri());
  url.username = 'opensmp_app';
  url.password = 'opensmp';
  appPool = new Pool({ connectionString: url.toString() });

  // tenants is a root table with no RLS; insert directly via the admin pool
  // ahead of any withTenant call (tenants has no tenant_id column).
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Tenant A') ON CONFLICT DO NOTHING`, [
    tenantA,
    `tenant-a-${tenantA}`,
  ]);
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Tenant B') ON CONFLICT DO NOTHING`, [
    tenantB,
    `tenant-b-${tenantB}`,
  ]);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe('C5 runSync acceptance', () => {
  it('re-running the same sync twice yields identical row counts and monotonic last_synced_at', async () => {
    const saasAppId = await seedTenantWithApp(tenantA);
    const deps = {
      pool: appPool,
      connectorRegistry: fakeRegistry,
      encryptionKeys,
      logger: noopLogger,
      discoveryStoreRaw: false,
    };

    const first = await runSync(deps, { tenantId: tenantA, saasAppId });
    expect(first.upserted).toBe(FAKE_ACCOUNTS.length);

    const firstSyncedAt = await withTenant(appPool, tenantA, async (tx) => {
      const { rows } = await tx.query<{ last_synced_at: Date }>(
        'SELECT last_synced_at FROM saas_accounts WHERE saas_app_id = $1 ORDER BY external_id',
        [saasAppId],
      );
      return rows.map((row) => row.last_synced_at);
    });

    const second = await runSync(deps, { tenantId: tenantA, saasAppId });
    expect(second.upserted).toBe(FAKE_ACCOUNTS.length);
    expect(second.runId).not.toBe(first.runId);

    const rowCount = await withTenant(appPool, tenantA, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM saas_accounts WHERE saas_app_id = $1', [saasAppId]);
      return rows.length;
    });
    expect(rowCount).toBe(FAKE_ACCOUNTS.length);

    const secondSyncedAt = await withTenant(appPool, tenantA, async (tx) => {
      const { rows } = await tx.query<{ last_synced_at: Date }>(
        'SELECT last_synced_at FROM saas_accounts WHERE saas_app_id = $1 ORDER BY external_id',
        [saasAppId],
      );
      return rows.map((row) => row.last_synced_at);
    });

    for (let i = 0; i < firstSyncedAt.length; i += 1) {
      expect(secondSyncedAt[i]!.getTime()).toBeGreaterThanOrEqual(firstSyncedAt[i]!.getTime());
    }

    // CT4-A: >= alone is satisfied by a runSync that never touches
    // last_synced_at at all (a no-op UPDATE), so it does not actually prove
    // the field is rewritten. Force every row to a fixed past timestamp,
    // re-run sync, and assert every row's last_synced_at is strictly greater
    // than that fixed point — deterministic, no wall-clock sleep race.
    const pastTimestamp = new Date('2020-01-01T00:00:00.000Z');
    await withTenant(appPool, tenantA, async (tx) => {
      await tx.query('UPDATE saas_accounts SET last_synced_at = $1 WHERE saas_app_id = $2', [
        pastTimestamp.toISOString(),
        saasAppId,
      ]);
    });

    const third = await runSync(deps, { tenantId: tenantA, saasAppId });
    expect(third.upserted).toBe(FAKE_ACCOUNTS.length);

    const thirdSyncedAt = await withTenant(appPool, tenantA, async (tx) => {
      const { rows } = await tx.query<{ last_synced_at: Date }>(
        'SELECT last_synced_at FROM saas_accounts WHERE saas_app_id = $1 ORDER BY external_id',
        [saasAppId],
      );
      return rows.map((row) => row.last_synced_at);
    });

    expect(thirdSyncedAt.length).toBe(FAKE_ACCOUNTS.length);
    for (const syncedAt of thirdSyncedAt) {
      expect(syncedAt.getTime()).toBeGreaterThan(pastTimestamp.getTime());
    }

    const events = await withTenant(appPool, tenantA, async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM discovery_events WHERE tenant_id = $1 AND kind = 'sync_completed'",
        [tenantA],
      );
      return rows;
    });
    // 3 runSync calls in this test (first, second, and the CT4-A third run).
    expect(events).toHaveLength(3);
  });

  it('a sync job for tenant A writes zero rows visible under tenant B GUC', async () => {
    const saasAppId = await seedTenantWithApp(tenantA);

    await runSync(
      {
        pool: appPool,
        connectorRegistry: fakeRegistry,
        encryptionKeys,
        logger: noopLogger,
        discoveryStoreRaw: false,
      },
      { tenantId: tenantA, saasAppId },
    );

    const visibleUnderB = await withTenant(appPool, tenantB, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM saas_accounts WHERE saas_app_id = $1', [saasAppId]);
      return rows.length;
    });

    expect(visibleUnderB).toBe(0);
  });

  it('stops when the run deadline has passed', async () => {
    // The deadline signal had no observer at all: reverting it to a
    // never-aborting controller left this suite green, which is exactly the
    // state it was added to leave. It is injectable now, so an already-aborted
    // signal reaches the connector's own guard.
    const saasAppId = await seedTenantWithApp(tenantA);

    await expect(
      runSync(
        {
          pool: appPool,
          connectorRegistry: fakeRegistry,
          encryptionKeys,
          logger: noopLogger,
          discoveryStoreRaw: false,
          signal: AbortSignal.abort(),
        },
        { tenantId: tenantA, saasAppId },
      ),
    ).rejects.toThrow();
  });
});
