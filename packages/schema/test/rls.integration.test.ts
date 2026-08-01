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
  'saas_contracts',
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
  saasContractId: string;
  // A second application per tenant, existing only so the WITH CHECK arm for
  // saas_contracts can target a (tenant_id, saas_app_id) pair the seeded
  // contract does not already occupy. Without it the arm's INSERT collides on
  // saas_contracts_tenant_id_saas_app_id_key and `rejects.toThrow()` passes on
  // a 23505 without the policy ever being consulted — measured: the
  // `WITH CHECK (true)` mutation left the suite green.
  spareSaasAppId: string;
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
    saasContractId: randomUUID(),
    spareSaasAppId: randomUUID(),
  };

  await withTenant(appPool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_key_version)
       VALUES ($1, $2, 'google-workspace', 'Google Workspace', 1)`,
      [ids.saasAppId, tenantId],
    );
    await tx.query(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_key_version)
       VALUES ($1, $2, 'spare-app', 'Spare App', 1)`,
      [ids.spareSaasAppId, tenantId],
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
    await tx.query(
      `INSERT INTO saas_contracts (id, tenant_id, saas_app_id, plan_name, seats, unit_price, currency, billing_cycle)
       VALUES ($1, $2, $3, 'Business', 10, '1500.00', 'JPY', 'monthly')`,
      [ids.saasContractId, tenantId, ids.saasAppId],
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
    case 'saas_contracts':
      return ids.saasContractId;
  }
}

/** A minimal, FK/CHECK-satisfying row for `table` under `tenantId`, with the given `id` and `tenant_id` override. */
function insertStatementFor(
  table: MemberTable,
  tenantId: string,
  rowTenantId: string,
  ids: SeedIds,
  foreignSeed: SeedIds,
  rowTenantSeed: SeedIds,
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
    case 'saas_contracts':
      // References the ROW TENANT's application, not the acting tenant's. The
      // FK is composite over (tenant_id, saas_app_id) and referential-integrity
      // checks run as the table owner, so they see the foreign row that RLS
      // hides — which is the point: pointing at the acting tenant's app would
      // fail on the FK (23503) and the assertion below, a bare rejects.toThrow,
      // would pass without the policy ever being consulted.
      return {
        text: `INSERT INTO saas_contracts (id, tenant_id, saas_app_id, plan_name, seats, unit_price, currency, billing_cycle)
               VALUES ($1, $2, $3, 'Foreign', 5, '10.00', 'USD', 'monthly')`,
        values: [newId, rowTenantId, rowTenantSeed.spareSaasAppId],
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
  it('pg_class.relrowsecurity is true for every member table', async () => {
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

describe('C1 acceptance: fail-closed with no tenant claimed', () => {
  it.each(MEMBER_TABLES)('%s: a transaction that claimed no tenant reads zero rows', async (table) => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      // Deliberately do not call set_tenant_context(...). current_tenant_id()
      // returns NULL, which every policy compares as false — the same
      // fail-closed shape the GUC form had for an unset setting (SCL8).
      const { rows } = await client.query(`SELECT * FROM ${table}`);
      expect(rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('SCL8 acceptance: a transaction cannot re-point itself at another tenant', () => {
  // THE assertion this change exists to make possible, and one no earlier test
  // could fail on: the per-table matrices answer correctly under both the old
  // GUC predicate and the new one, because both are right for a well-behaved
  // transaction. What was wrong was what a MISbehaving one could do.
  //
  // Measured before the fix, as the application's own role: set the GUC to
  // tenant A, read 2 rows, call set_config again with another uuid, read 0 —
  // so any SQL injection was a full tenant-isolation bypass rather than one
  // query's rows.

  it('refuses a second claim inside one transaction', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_tenant_context($1)', [tenantA]);

      await expect(
        client.query('SELECT set_tenant_context($1)', [tenantB]),
      ).rejects.toMatchObject({ code: '42501' });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it.each(MEMBER_TABLES)('%s: the visible rows do not move when a re-point is attempted', async (table) => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_tenant_context($1)', [tenantA]);
      const before = await client.query(`SELECT id FROM ${table}`);

      // The attempt aborts the transaction, so the row set is compared across
      // a fresh one on the same pooled connection — which also proves the
      // refusal did not leave the claim in a state the next transaction
      // inherits.
      await expect(client.query('SELECT set_tenant_context($1)', [tenantB])).rejects.toThrow();
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query('SELECT set_tenant_context($1)', [tenantA]);
      const after = await client.query(`SELECT id FROM ${table}`);
      await client.query('ROLLBACK');

      // Non-empty, or "unchanged" is a comparison between two empty sets — the
      // vacuous shape this suite exists to refuse.
      expect(before.rows.length).toBeGreaterThan(0);
      expect(after.rows).toEqual(before.rows);
    } finally {
      client.release();
    }
  });

  it.each(['SELECT * FROM tenant_context', 'DELETE FROM tenant_context'])(
    'denies the application role direct access: %s',
    async (statement) => {
      // The setter's refusal is only a control while the table underneath it is
      // unreachable. Without these, an injection could delete its own row and
      // claim again.
      const client = await appPool.connect();
      try {
        await expect(client.query(statement)).rejects.toMatchObject({ code: '42501' });
      } finally {
        client.release();
      }
    },
  );

  it('cannot replace the reader function', async () => {
    const client = await appPool.connect();
    try {
      await expect(
        client.query('CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$'),
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it('no tenant_isolation policy still reads the GUC', async () => {
    // Derived from pg_policies, not from MEMBER_TABLES — that list is hand-kept
    // (SCL9), so a table missing from it is a table the migration might also
    // have missed, and this is the assertion that would not notice.
    const { rows } = await adminPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
        WHERE policyname = 'tenant_isolation'
          AND (coalesce(qual, '') LIKE '%current_setting%'
            OR coalesce(with_check, '') LIKE '%current_setting%')`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);

    const { rows: total } = await adminPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM pg_policies WHERE policyname = 'tenant_isolation'",
    );
    // Anti-vacuity: an empty policy set satisfies the assertion above.
    expect(Number(total[0]!.n)).toBeGreaterThan(0);
  });
});

describe('SCL10 acceptance: no foreign key accepts a cross-tenant parent', () => {
  // Referential-integrity checks run as the REFERENCED table's OWNER and bypass
  // RLS, so a single-column FK accepts a child pointing at another tenant's
  // parent: the row's own tenant_id satisfies WITH CHECK while the RI check
  // sees a row the same transaction cannot SELECT. Migration 0006 closed it for
  // saas_contracts; 0008 closes it for the rest.
  //
  // Attempted through adminPool, which bypasses RLS entirely. That is the
  // point: the refusal has to come from the CONSTRAINT, not from a policy the
  // attacker is already inside of.

  it('no single-column foreign key remains between two tenant-scoped tables', async () => {
    // Derived from pg_constraint, and deriving is what found the recorded list
    // was short: SCL10 named four, the catalog returned six. The two it omitted
    // were added to account_labels a cycle after the entry was written.
    const { rows } = await adminPool.query<{ conname: string }>(
      `SELECT c.conname
         FROM pg_constraint c
         JOIN pg_class src ON src.oid = c.conrelid
        WHERE c.contype = 'f'
          AND src.relnamespace = 'public'::regnamespace
          AND cardinality(c.conkey) = 1
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.conrelid AND a.attname = 'tenant_id' AND a.attnum > 0)
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.confrelid AND a.attname = 'tenant_id' AND a.attnum > 0)`,
    );

    expect(rows.map((r) => r.conname)).toEqual([]);
  });

  it('every remaining tenant-to-tenant foreign key carries tenant_id', async () => {
    // Anti-vacuity for the assertion above: an empty foreign-key set satisfies
    // it. This counts the composite ones, so a migration that DROPPED the keys
    // instead of re-declaring them fails here.
    const { rows } = await adminPool.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM pg_constraint c
         JOIN pg_class src ON src.oid = c.conrelid
        WHERE c.contype = 'f'
          AND src.relnamespace = 'public'::regnamespace
          AND cardinality(c.conkey) = 2
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.confrelid AND a.attname = 'tenant_id' AND a.attnum > 0)`,
    );

    // Six from 0008 plus saas_contracts' own from 0006.
    expect(Number(rows[0]!.n)).toBe(7);
  });

  /**
   * A parent set nothing else references, created per case.
   *
   * The first draft reused the seeded rows and three cases failed on 23505
   * instead of 23503 — tenant B already had a link and a label on its seeded
   * account, so the deny cases collided on a UNIQUE pair and took the allow
   * case with them. That is the defect C1's own history records, reproduced
   * here; pinning the SQLSTATE rather than asserting `rejects.toThrow()` is
   * what made it visible instead of green.
   */
  async function freshParents(tenantId: string) {
    const ids = {
      saasAppId: randomUUID(),
      saasAccountId: randomUUID(),
      identityId: randomUUID(),
      userId: randomUUID(),
    };
    const suffix = ids.saasAppId.slice(0, 8);
    await adminPool.query(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_key_version)
       VALUES ($1, $2, 'fk-probe-' || $3, 'FK Probe', 1)`,
      [ids.saasAppId, tenantId, suffix],
    );
    await adminPool.query(
      `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, account_status, is_admin)
       VALUES ($1, $2, $3, 'fk-probe-' || $4, 'active', false)`,
      [ids.saasAccountId, tenantId, ids.saasAppId, suffix],
    );
    await adminPool.query(
      `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status)
       VALUES ($1, $2, 'fk-probe-' || $3, 'fk-probe-' || $3 || '@example.com', 'FK Probe', 'active')`,
      [ids.identityId, tenantId, suffix],
    );
    await adminPool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash)
       VALUES ($1, $2, 'fk-probe-' || $3 || '@example.com', 'argon2id$dummy')`,
      [ids.userId, tenantId, suffix],
    );
    return ids;
  }

  type Parents = Awaited<ReturnType<typeof freshParents>>;

  const crossTenantInserts: [string, (a: Parents, b: Parents) => { text: string; values: unknown[] }][] = [
    [
      'saas_accounts.saas_app_id',
      (a) => ({
        text: `INSERT INTO saas_accounts (tenant_id, saas_app_id, external_id, account_status, is_admin)
               VALUES ($1, $2, 'cross-' || gen_random_uuid()::text, 'active', false)`,
        values: [tenantB, a.saasAppId],
      }),
    ],
    [
      'account_links.saas_account_id',
      (a, b) => ({
        text: `INSERT INTO account_links (tenant_id, saas_account_id, identity_id, status, confidence)
               VALUES ($1, $2, $3, 'matched', 1.0)`,
        values: [tenantB, a.saasAccountId, b.identityId],
      }),
    ],
    [
      'account_links.identity_id',
      (a, b) => ({
        text: `INSERT INTO account_links (tenant_id, saas_account_id, identity_id, status, confidence)
               VALUES ($1, $2, $3, 'matched', 1.0)`,
        values: [tenantB, b.saasAccountId, a.identityId],
      }),
    ],
    [
      'sessions.user_id',
      (a) => ({
        text: `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
               VALUES ($1, $2, 'cross-' || gen_random_uuid()::text, now() + interval '1 day')`,
        values: [tenantB, a.userId],
      }),
    ],
    [
      'account_labels.saas_account_id',
      (a) => ({
        text: `INSERT INTO account_labels (tenant_id, saas_account_id, kind) VALUES ($1, $2, 'known_shared')`,
        values: [tenantB, a.saasAccountId],
      }),
    ],
    [
      'account_labels.created_by',
      (a, b) => ({
        text: `INSERT INTO account_labels (tenant_id, saas_account_id, kind, created_by)
               VALUES ($1, $2, 'known_shared', $3)`,
        values: [tenantB, b.saasAccountId, a.userId],
      }),
    ],
  ];

  it.each(crossTenantInserts)('%s refuses a parent in another tenant', async (_label, build) => {
    const [a, b] = await Promise.all([freshParents(tenantA), freshParents(tenantB)]);
    const { text, values } = build(a, b);

    // The SQLSTATE, not just "it threw". 23505 would mean the fixture collided
    // and the foreign key was never consulted.
    await expect(adminPool.query(text, values)).rejects.toMatchObject({ code: '23503' });
  });

  it('deleting a user nulls the label it authored and keeps the label', async () => {
    // The delete action, which the composite form nearly broke. A plain
    // `ON DELETE SET NULL` on (tenant_id, created_by) nulls BOTH columns, and
    // tenant_id is NOT NULL — so a user who had ever labelled an account would
    // become undeletable, with a 23502 no route expects.
    //
    // Added because the mutation that removes the column list SURVIVED: the
    // migration applies fine either way, and nothing here had ever deleted a
    // user. PostgreSQL 15's `SET NULL (column)` is what makes the composite
    // form expressible at all.
    const b = await freshParents(tenantB);
    const labelId = randomUUID();
    await adminPool.query(
      `INSERT INTO account_labels (id, tenant_id, saas_account_id, kind, created_by)
       VALUES ($1, $2, $3, 'external_collaborator', $4)`,
      [labelId, tenantB, b.saasAccountId, b.userId],
    );

    await expect(adminPool.query('DELETE FROM users WHERE id = $1', [b.userId])).resolves.toMatchObject({
      rowCount: 1,
    });

    const { rows } = await adminPool.query<{ created_by: string | null; tenant_id: string }>(
      'SELECT created_by, tenant_id FROM account_labels WHERE id = $1',
      [labelId],
    );
    // The label survives its author, which is why the column is nullable — the
    // audit trail outlives the user row (C28).
    expect(rows).toHaveLength(1);
    expect(rows[0]!.created_by).toBeNull();
    expect(rows[0]!.tenant_id).toBe(tenantB);
  });

  it('still accepts a parent in the SAME tenant', async () => {
    // The paired allow case. A migration that made every one of these fail —
    // by referencing a column that is never populated, say — would satisfy
    // every rejection above (RT10).
    const b = await freshParents(tenantB);

    await expect(
      adminPool.query(
        `INSERT INTO account_labels (tenant_id, saas_account_id, kind, created_by)
         VALUES ($1, $2, 'service_account', $3) RETURNING id`,
        [tenantB, b.saasAccountId, b.userId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('C1 acceptance: saas_contracts constraints are schema-enforced', () => {
  // Each case asserts the SQLSTATE *and* the constraint name. SQLSTATE alone
  // cannot distinguish them: the composite FK and the tenants FK both raise
  // 23503, and every CHECK raises 23514. Every constraint is named explicitly
  // in the migration for the same reason — Postgres names a multi-column CHECK
  // positionally, so an unrelated CHECK added later would move the name.
  // Every case gets its OWN application, so no case can occupy the
  // (tenant_id, saas_app_id) pair another one needs. Measured why this matters:
  // with a shared application, a deny case that a mutation wrongly lets through
  // takes the unique pair and reds the allow case too — the failure then depends
  // on execution order rather than on the constraint under test.
  async function freshApp(tenantId: string): Promise<string> {
    const appId = randomUUID();
    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_key_version)
         VALUES ($1, $2, $3, 'Case App', 1)`,
        [appId, tenantId, `case-app-${appId}`],
      );
    });
    return appId;
  }

  async function insertContract(overrides: Record<string, unknown>): Promise<void> {
    const row = {
      id: randomUUID(),
      tenant_id: tenantA,
      saas_app_id: overrides.saas_app_id ?? (await freshApp(tenantA)),
      plan_name: 'Business',
      seats: 10,
      unit_price: '1500.00',
      currency: 'JPY',
      billing_cycle: 'monthly',
      term_start: '2026-01-01',
      term_end: '2026-12-31',
      note: null,
      ...overrides,
    };
    // Explicit casts: the placeholders are built dynamically, so Postgres has
    // no literal in the statement to infer a parameter type from.
    const casts: Record<string, string> = {
      id: 'uuid',
      tenant_id: 'uuid',
      saas_app_id: 'uuid',
      seats: 'int',
      unit_price: 'numeric',
      billing_cycle: 'billing_cycle',
      term_start: 'date',
      term_end: 'date',
    };
    const cols = Object.keys(row);
    const text = `INSERT INTO saas_contracts (${cols.join(', ')}) VALUES (${cols
      .map((col, i) => (casts[col] ? `$${i + 1}::${casts[col]}` : `$${i + 1}`))
      .join(', ')})`;
    await withTenant(appPool, tenantA, async (tx) => {
      await tx.query(text, Object.values(row));
    });
  }

  it.each([
    ['seats below zero', { seats: -1 }, '23514', 'saas_contracts_seats_check'],
    ['seats above the cap', { seats: 10_000_001 }, '23514', 'saas_contracts_seats_check'],
    // Postgres defines NaN = NaN as TRUE for numeric and NaN >= 0 as TRUE, so
    // `unit_price = unit_price` does NOT exclude it — measured, that form stores
    // NaN. The constraint uses <> 'NaN'::numeric instead.
    ['unit_price NaN', { unit_price: 'NaN' }, '23514', 'saas_contracts_unit_price_check'],
    ['unit_price negative', { unit_price: '-1.00' }, '23514', 'saas_contracts_unit_price_check'],
    ['term_end before term_start', { term_start: '2026-12-31', term_end: '2026-01-01' }, '23514', 'saas_contracts_term_order_check'],
    ['currency of four letters', { currency: 'USDX' }, '23514', 'saas_contracts_currency_check'],
    ['currency lowercase', { currency: 'jpy' }, '23514', 'saas_contracts_currency_check'],
    ['plan_name over 200 chars', { plan_name: 'x'.repeat(201) }, '23514', 'saas_contracts_plan_name_check'],
    ['note over 500 chars', { note: 'x'.repeat(501) }, '23514', 'saas_contracts_note_check'],
  ])('rejects %s', async (_label, overrides, code, constraint) => {
    await expect(insertContract(overrides)).rejects.toMatchObject({ code, constraint });
  });

  it("rejects a contract referencing another tenant's application", async () => {
    const foreignAppId = await freshApp(tenantB);
    await expect(insertContract({ saas_app_id: foreignAppId })).rejects.toMatchObject({
      code: '23503',
      constraint: 'saas_contracts_tenant_id_saas_app_id_fkey',
    });
  });

  it('rejects a second contract for the same application', async () => {
    const appId = await freshApp(tenantA);
    await insertContract({ saas_app_id: appId });
    await expect(insertContract({ saas_app_id: appId })).rejects.toMatchObject({
      code: '23505',
      constraint: 'saas_contracts_tenant_id_saas_app_id_key',
    });
  });

  // The allow side (RT10). Without it every CHECK above is satisfied by
  // CHECK (false), and the deny cases would still pass.
  it('accepts a contract at the boundary values', async () => {
    await expect(
      insertContract({
        seats: 10_000_000,
        unit_price: '999999999999.99',
        currency: 'USD',
        term_start: '2026-06-01',
        term_end: '2026-06-01',
        plan_name: 'x'.repeat(200),
        note: 'x'.repeat(500),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('C1 acceptance: WITH CHECK rejects a foreign tenant_id on INSERT', () => {
  it.each(MEMBER_TABLES)(
    '%s: INSERT with tenant_id = tenant B under tenant A GUC is rejected',
    async (table) => {
      const aIds = seeds.get(tenantA)!;
      const bIds = seeds.get(tenantB)!;
      const stmt = insertStatementFor(table, tenantA, tenantB, aIds, aIds, bIds);

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
