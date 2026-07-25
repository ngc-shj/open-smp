import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';
import { withTenant } from '../src/db.js';

// C1 acceptance criteria, verified end to end against a real Postgres 16
// via Testcontainers. The app role (`opensmp_app`) is used for every
// tenant-scoped query below; only migrations run as the container superuser.

const MEMBER_TABLES = [
  'identities',
  'saas_apps',
  'saas_accounts',
  'account_links',
  'discovery_events',
  'users',
  'sessions',
  'account_labels',
] as const;

// C27 splits the tenant-scoped set by what the app role may do to a row it can
// see. Every member is still covered by the SELECT and INSERT matrices; only
// the UPDATE/DELETE expectation differs, because migration 0005 revokes those
// privileges on the audit trail. Keeping both lists derived from MEMBER_TABLES
// means a table added later lands in exactly one of them by construction.
type MemberTable = (typeof MEMBER_TABLES)[number];

const APPEND_ONLY_TABLES = ['discovery_events'] as const;
type AppendOnlyTable = (typeof APPEND_ONLY_TABLES)[number];

const MUTABLE_TABLES = MEMBER_TABLES.filter(
  (table): table is Exclude<MemberTable, AppendOnlyTable> =>
    !(APPEND_ONLY_TABLES as readonly string[]).includes(table),
);

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;

const tenantA = randomUUID();
const tenantB = randomUUID();

// Seed row ids, keyed per tenant so FK chains (saas_apps -> saas_accounts ->
// account_links, users -> sessions) stay internally consistent per tenant.
type SeedIds = {
  saasAppId: string;
  saasAccountId: string;
  identityId: string;
  accountLinkId: string;
  discoveryEventId: string;
  userId: string;
  sessionId: string;
  accountLabelId: string;
};

const seeds = new Map<string, SeedIds>();

async function seedTenant(tenantId: string): Promise<SeedIds> {
  const ids: SeedIds = {
    saasAppId: randomUUID(),
    saasAccountId: randomUUID(),
    identityId: randomUUID(),
    accountLinkId: randomUUID(),
    discoveryEventId: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    accountLabelId: randomUUID(),
  };

  await withTenant(appPool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_key_version)
       VALUES ($1, $2, 'google-workspace', 'Google Workspace', 1)`,
      [ids.saasAppId, tenantId],
    );
    await tx.query(
      `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
       VALUES ($1, $2, $3, 'ext-1', 'user@example.com', 'User', 'active', false)`,
      [ids.saasAccountId, tenantId, ids.saasAppId],
    );
    await tx.query(
      `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
       VALUES ($1, $2, 'emp-1', 'user@example.com', 'User', 'active', NULL)`,
      [ids.identityId, tenantId],
    );
    await tx.query(
      `INSERT INTO account_links (id, tenant_id, saas_account_id, identity_id, status, confidence, rule_id)
       VALUES ($1, $2, $3, $4, 'matched', 1.0, 'exact-email')`,
      [ids.accountLinkId, tenantId, ids.saasAccountId, ids.identityId],
    );
    await tx.query(
      `INSERT INTO discovery_events (id, tenant_id, source, kind, payload)
       VALUES ($1, $2, 'google-workspace', 'sync_completed', '{"counts":{"upserted":1}}'::jsonb)`,
      [ids.discoveryEventId, tenantId],
    );
    await tx.query(
      `INSERT INTO users (id, tenant_id, email, password_hash)
       VALUES ($1, $2, 'admin@example.com', 'argon2id$dummy')`,
      [ids.userId, tenantId],
    );
    await tx.query(
      `INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
      [ids.sessionId, ids.userId, tenantId, `token-hash-${ids.sessionId}`],
    );
    await tx.query(
      `INSERT INTO account_labels (id, tenant_id, saas_account_id, kind, created_by)
       VALUES ($1, $2, $3, 'known_shared', $4)`,
      [ids.accountLabelId, tenantId, ids.saasAccountId, ids.userId],
    );
  });

  return ids;
}

function tableRowId(table: MemberTable, ids: SeedIds): string {
  switch (table) {
    case 'identities':
      return ids.identityId;
    case 'saas_apps':
      return ids.saasAppId;
    case 'saas_accounts':
      return ids.saasAccountId;
    case 'account_links':
      return ids.accountLinkId;
    case 'discovery_events':
      return ids.discoveryEventId;
    case 'users':
      return ids.userId;
    case 'sessions':
      return ids.sessionId;
    case 'account_labels':
      return ids.accountLabelId;
  }
}

/** A minimal, FK/CHECK-satisfying row for `table` under `tenantId`, with the given `id` and `tenant_id` override. */
function insertStatementFor(
  table: MemberTable,
  tenantId: string,
  rowTenantId: string,
  ids: SeedIds,
  foreignSeed: SeedIds,
): { text: string; values: unknown[] } {
  const newId = randomUUID();
  switch (table) {
    case 'identities':
      return {
        text: `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
               VALUES ($1, $2, 'emp-foreign', 'foreign@example.com', 'Foreign', 'active', NULL)`,
        values: [newId, rowTenantId],
      };
    case 'saas_apps':
      return {
        text: `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_key_version)
               VALUES ($1, $2, 'foreign-app', 'Foreign App', 1)`,
        values: [newId, rowTenantId],
      };
    case 'saas_accounts':
      // Must reference a saas_app row visible under the acting session's own
      // tenant GUC (RLS applies to the FK target read too), so we point at
      // the row owned by whichever tenant is executing the INSERT.
      return {
        text: `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
               VALUES ($1, $2, $3, 'ext-foreign', 'foreign@example.com', 'Foreign', 'active', false)`,
        values: [newId, rowTenantId, foreignSeed.saasAppId],
      };
    case 'account_links':
      return {
        text: `INSERT INTO account_links (id, tenant_id, saas_account_id, identity_id, status, confidence, rule_id)
               VALUES ($1, $2, $3, $4, 'matched', 1.0, 'exact-email')`,
        values: [newId, rowTenantId, foreignSeed.saasAccountId, foreignSeed.identityId],
      };
    case 'discovery_events':
      return {
        text: `INSERT INTO discovery_events (id, tenant_id, source, kind, payload)
               VALUES ($1, $2, 'google-workspace', 'sync_completed', '{}'::jsonb)`,
        values: [newId, rowTenantId],
      };
    case 'users':
      return {
        text: `INSERT INTO users (id, tenant_id, email, password_hash)
               VALUES ($1, $2, 'foreign@example.com', 'argon2id$dummy')`,
        values: [newId, rowTenantId],
      };
    case 'sessions':
      return {
        text: `INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at)
               VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
        values: [newId, foreignSeed.userId, rowTenantId, `token-hash-${newId}`],
      };
    case 'account_labels':
      // Must reference a saas_account row visible under the acting session's
      // own tenant GUC (RLS applies to the FK target read too), same
      // reasoning as the saas_accounts case above.
      return {
        text: `INSERT INTO account_labels (id, tenant_id, saas_account_id, kind)
               VALUES ($1, $2, $3, 'known_shared')`,
        values: [newId, rowTenantId, foreignSeed.saasAccountId],
      };
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();

  adminPool = new Pool({ connectionString: container.getConnectionUri() });

  await runMigrations(container.getConnectionUri());

  const url = new URL(container.getConnectionUri());
  url.username = 'opensmp_app';
  url.password = 'opensmp';
  appPool = new Pool({ connectionString: url.toString() });

  // account_labels.tenant_id (C10) is the first tenant-scoped column with a
  // real FK to tenants(id), so a tenants row must exist before seeding.
  await adminPool.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3), ($4, $5, $6)', [
    tenantA,
    `tenant-a-${tenantA}`,
    'Tenant A',
    tenantB,
    `tenant-b-${tenantB}`,
    'Tenant B',
  ]);

  seeds.set(tenantA, await seedTenant(tenantA));
  seeds.set(tenantB, await seedTenant(tenantB));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe('C1 acceptance: RLS enabled on all member tables', () => {
  it('pg_class.relrowsecurity is true for all 7 member tables', async () => {
    const { rows } = await adminPool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relname = ANY($1) AND relkind = 'r'`,
      [MEMBER_TABLES],
    );

    expect(rows).toHaveLength(MEMBER_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(true);
    }
  });
});

describe('C1 acceptance: cross-tenant SELECT and UPDATE/DELETE are no-ops', () => {
  it.each(MEMBER_TABLES)('%s: tenant A GUC reads zero tenant-B rows', async (table) => {
    await withTenant(appPool, tenantA, async (tx) => {
      const { rows } = await tx.query(`SELECT * FROM ${table} WHERE tenant_id = $1`, [tenantB]);
      expect(rows).toHaveLength(0);
    });
  });

  it.each(MUTABLE_TABLES)(
    '%s: UPDATE targeting a tenant-B row under tenant A GUC affects zero rows',
    async (table) => {
      const bIds = seeds.get(tenantB)!;
      const rowId = tableRowId(table, bIds);

      const updateColumn = table === 'sessions' ? 'expires_at' : 'tenant_id';
      // Use a no-op-shaped UPDATE that would be observable if it succeeded:
      // for sessions (no free-text column), bump expires_at; for others, a
      // harmless self-assignment of tenant_id (RLS should block regardless).
      const result = await withTenant(appPool, tenantA, async (tx) => {
        if (updateColumn === 'expires_at') {
          return tx.query(`UPDATE ${table} SET expires_at = now() + interval '2 days' WHERE id = $1`, [
            rowId,
          ]);
        }
        return tx.query(`UPDATE ${table} SET tenant_id = tenant_id WHERE id = $1`, [rowId]);
      });

      expect(result.rowCount).toBe(0);

      // Re-query under tenant B's own GUC: the row is unchanged.
      await withTenant(appPool, tenantB, async (tx) => {
        const { rows } = await tx.query(`SELECT * FROM ${table} WHERE id = $1`, [rowId]);
        expect(rows).toHaveLength(1);
      });
    },
  );

  it.each(MUTABLE_TABLES)(
    '%s: DELETE targeting a tenant-B row under tenant A GUC affects zero rows',
    async (table) => {
      const bIds = seeds.get(tenantB)!;
      const rowId = tableRowId(table, bIds);

      const result = await withTenant(appPool, tenantA, async (tx) => {
        return tx.query(`DELETE FROM ${table} WHERE id = $1`, [rowId]);
      });

      expect(result.rowCount).toBe(0);

      // Re-query under tenant B's own GUC: the row still exists.
      await withTenant(appPool, tenantB, async (tx) => {
        const { rows } = await tx.query(`SELECT * FROM ${table} WHERE id = $1`, [rowId]);
        expect(rows).toHaveLength(1);
      });
    },
  );

  // C27: discovery_events leaves the two matrices above because migration 0005
  // revokes UPDATE/DELETE from opensmp_app — and Postgres checks table
  // privilege BEFORE row-level security, so those statements now raise 42501
  // instead of returning rowCount 0. Asserting the denial here keeps the table
  // covered rather than dropping it from the suite, which would silently stop
  // testing an append-only invariant that is stronger than the RLS one.
  it.each(APPEND_ONLY_TABLES)(
    '%s: UPDATE is denied outright for the app role (42501), not merely filtered by RLS',
    async (table) => {
      const bIds = seeds.get(tenantB)!;
      const rowId = tableRowId(table, bIds);

      await expect(
        withTenant(appPool, tenantA, async (tx) =>
          tx.query(`UPDATE ${table} SET tenant_id = tenant_id WHERE id = $1`, [rowId]),
        ),
      ).rejects.toMatchObject({ code: '42501' });

      // The row survives, read back under its owning tenant.
      await withTenant(appPool, tenantB, async (tx) => {
        const { rows } = await tx.query(`SELECT * FROM ${table} WHERE id = $1`, [rowId]);
        expect(rows).toHaveLength(1);
      });
    },
  );

  it.each(APPEND_ONLY_TABLES)(
    '%s: DELETE is denied outright for the app role (42501)',
    async (table) => {
      const bIds = seeds.get(tenantB)!;
      const rowId = tableRowId(table, bIds);

      await expect(
        withTenant(appPool, tenantA, async (tx) =>
          tx.query(`DELETE FROM ${table} WHERE id = $1`, [rowId]),
        ),
      ).rejects.toMatchObject({ code: '42501' });

      await withTenant(appPool, tenantB, async (tx) => {
        const { rows } = await tx.query(`SELECT * FROM ${table} WHERE id = $1`, [rowId]);
        expect(rows).toHaveLength(1);
      });
    },
  );

  // The revoke must not have been written too broadly: the writers this audit
  // trail depends on still have to work.
  it.each(APPEND_ONLY_TABLES)('%s: INSERT and SELECT still work for the app role', async (table) => {
    await withTenant(appPool, tenantA, async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO ${table} (tenant_id, source, kind, payload)
         VALUES ($1, 'c27-probe', 'c27_probe', '{}'::jsonb)
         RETURNING id`,
        [tenantA],
      );
      expect(inserted.rows).toHaveLength(1);

      const read = await tx.query(`SELECT id FROM ${table} WHERE tenant_id = $1`, [tenantA]);
      expect(read.rows.length).toBeGreaterThan(0);
    });
  });
});

describe('C1 acceptance: fail-closed with no GUC set', () => {
  it.each(MEMBER_TABLES)('%s: a session with no app.tenant_id GUC reads zero rows', async (table) => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      // Deliberately do not call set_config('app.tenant_id', ...).
      const { rows } = await client.query(`SELECT * FROM ${table}`);
      expect(rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('C1/D7 acceptance: an empty-string (defined but empty) GUC is fail-closed, not a cast error', () => {
  it('SELECT under a pooled client with app.tenant_id set to the empty string reads zero rows and does not throw', async () => {
    const client = await appPool.connect();
    try {
      // First exercise one complete, normal withTenant-shaped transaction on
      // this same pooled client, so the GUC has definitely been set to a real
      // value at least once on this connection before we probe the empty-GUC
      // path — this is the pooled-connection reuse scenario D7 addresses,
      // distinct from the "GUC never set on this connection" case covered by
      // the no-GUC test above.
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantA]);
      const { rows: warmupRows } = await client.query('SELECT * FROM identities WHERE tenant_id = $1', [
        tenantA,
      ]);
      expect(warmupRows.length).toBeGreaterThan(0);
      await client.query('COMMIT');

      // Now, on the SAME client/connection, open a fresh transaction and set
      // the GUC to the empty string — defined but empty, not unset. Without
      // the D7 NULLIF fix, `''::uuid` throws a cast error inside the RLS
      // predicate instead of yielding zero rows.
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', '', true)");

      await expect(client.query('SELECT * FROM identities')).resolves.toMatchObject({ rows: [] });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('C1 acceptance: WITH CHECK rejects a foreign tenant_id on INSERT', () => {
  it.each(MEMBER_TABLES)(
    '%s: INSERT with tenant_id = tenant B under tenant A GUC is rejected',
    async (table) => {
      const aIds = seeds.get(tenantA)!;
      const stmt = insertStatementFor(table, tenantA, tenantB, aIds, aIds);

      await expect(
        withTenant(appPool, tenantA, async (tx: PoolClient) => {
          await tx.query(stmt.text, stmt.values);
        }),
      ).rejects.toThrow();

      // Re-query under tenant B's GUC: no such row exists (the id we
      // attempted to insert is not visible/present).
      const insertedId = stmt.values[0] as string;
      await withTenant(appPool, tenantB, async (tx) => {
        const { rows } = await tx.query(`SELECT * FROM ${table} WHERE id = $1`, [insertedId]);
        expect(rows).toHaveLength(0);
      });
    },
  );
});
