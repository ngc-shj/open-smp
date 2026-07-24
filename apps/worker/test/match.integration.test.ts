import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withTenant } from '@open-smp/schema';
import { runMatch } from '../src/match.js';

// C5 acceptance: seed identities + accounts across matched/ghost/orphan/
// ambiguous cases, run runMatch, and assert persisted account_links
// statuses — orphan/ambiguous rows must carry identity_id = null (C1 CHECK).

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;

const tenantId = randomUUID();
const saasAppId = randomUUID();

const matchedIdentityId = randomUUID();
const ghostIdentityId = randomUUID();
const ambiguousIdentityId1 = randomUUID();
const ambiguousIdentityId2 = randomUUID();

const matchedAccountId = randomUUID();
const ghostAccountId = randomUUID();
const orphanAccountId = randomUUID();
const ambiguousAccountId = randomUUID();

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(container.getConnectionUri());

  const url = new URL(container.getConnectionUri());
  url.username = 'opensmp_app';
  url.password = 'opensmp';
  appPool = new Pool({ connectionString: url.toString() });

  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Tenant')`, [
    tenantId,
    `tenant-${tenantId}`,
  ]);

  await withTenant(appPool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name) VALUES ($1, $2, 'fake-app', 'Fake App')`,
      [saasAppId, tenantId],
    );

    // matched: active identity, exact email hit.
    await tx.query(
      `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
       VALUES ($1, $2, 'emp-matched', 'matched@example.com', 'Matched Person', 'active', NULL)`,
      [matchedIdentityId, tenantId],
    );
    await tx.query(
      `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
       VALUES ($1, $2, $3, 'ext-matched', 'matched@example.com', 'Matched Person', 'active', false)`,
      [matchedAccountId, tenantId, saasAppId],
    );

    // ghost: left identity, exact email hit, account still active.
    await tx.query(
      `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
       VALUES ($1, $2, 'emp-ghost', 'ghost@example.com', 'Ghost Person', 'left', now())`,
      [ghostIdentityId, tenantId],
    );
    await tx.query(
      `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
       VALUES ($1, $2, $3, 'ext-ghost', 'ghost@example.com', 'Ghost Person', 'active', false)`,
      [ghostAccountId, tenantId, saasAppId],
    );

    // orphan: account with no matching identity.
    await tx.query(
      `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
       VALUES ($1, $2, $3, 'ext-orphan', 'nobody@example.com', 'Nobody', 'active', false)`,
      [orphanAccountId, tenantId, saasAppId],
    );

    // ambiguous: two identities tie on name-domain (same display name + domain, no email hit).
    await tx.query(
      `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
       VALUES ($1, $2, 'emp-amb-1', 'amb-one@other.example', 'Shared Name', 'active', NULL)`,
      [ambiguousIdentityId1, tenantId],
    );
    await tx.query(
      `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
       VALUES ($1, $2, 'emp-amb-2', 'amb-two@other.example', 'Shared Name', 'active', NULL)`,
      [ambiguousIdentityId2, tenantId],
    );
    await tx.query(
      `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
       VALUES ($1, $2, $3, 'ext-ambiguous', 'shared@example.com', 'Shared Name', 'active', false)`,
      [ambiguousAccountId, tenantId, saasAppId],
    );
    // give both ambiguous identities the same email domain as the account
    // via a secondary path: name-domain rule needs matching domain too, so
    // align primary_email domains to the account's domain.
    await tx.query(`UPDATE identities SET primary_email = 'amb-one@example.com' WHERE id = $1`, [
      ambiguousIdentityId1,
    ]);
    await tx.query(`UPDATE identities SET primary_email = 'amb-two@example.com' WHERE id = $1`, [
      ambiguousIdentityId2,
    ]);
  });
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe('C5 runMatch acceptance', () => {
  it('persists account_links with correct statuses and null identity_id for orphan/ambiguous', async () => {
    const result = await runMatch({ pool: appPool }, { tenantId });
    expect(result.links).toBe(4);

    const links = await withTenant(appPool, tenantId, async (tx) => {
      const { rows } = await tx.query<{
        saas_account_id: string;
        identity_id: string | null;
        status: string;
      }>('SELECT saas_account_id, identity_id, status FROM account_links');
      return rows;
    });

    const byAccount = new Map(links.map((link) => [link.saas_account_id, link]));

    expect(byAccount.get(matchedAccountId)?.status).toBe('matched');
    expect(byAccount.get(matchedAccountId)?.identity_id).toBe(matchedIdentityId);

    expect(byAccount.get(ghostAccountId)?.status).toBe('ghost');
    expect(byAccount.get(ghostAccountId)?.identity_id).toBe(ghostIdentityId);

    expect(byAccount.get(orphanAccountId)?.status).toBe('orphan');
    expect(byAccount.get(orphanAccountId)?.identity_id).toBeNull();

    expect(byAccount.get(ambiguousAccountId)?.status).toBe('ambiguous');
    expect(byAccount.get(ambiguousAccountId)?.identity_id).toBeNull();

    const events = await withTenant(appPool, tenantId, async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM discovery_events WHERE tenant_id = $1 AND kind = 'match_completed'",
        [tenantId],
      );
      return rows;
    });
    expect(events).toHaveLength(1);
  });
});
