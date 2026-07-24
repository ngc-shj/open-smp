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

    // ambiguous: two identities tie on exact-email (duplicate HR rows sharing
    // one address — C1 has no uniqueness on primary_email). Per C4, a ≥2-way
    // tie on the first hitting rule → ambiguous; note name-domain ties do NOT
    // produce ambiguity (unique-candidate requirement → falls through to orphan).
    await tx.query(
      `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
       VALUES ($1, $2, 'emp-amb-1', 'shared@example.com', 'Amb One', 'active', NULL)`,
      [ambiguousIdentityId1, tenantId],
    );
    await tx.query(
      `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
       VALUES ($1, $2, 'emp-amb-2', 'shared@example.com', 'Amb Two', 'active', NULL)`,
      [ambiguousIdentityId2, tenantId],
    );
    await tx.query(
      `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
       VALUES ($1, $2, $3, 'ext-ambiguous', 'shared@example.com', 'Shared Name', 'active', false)`,
      [ambiguousAccountId, tenantId, saasAppId],
    );
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
        evidence: { candidates?: { identityId: string; displayName: string }[] } | null;
      }>('SELECT saas_account_id, identity_id, status, evidence FROM account_links');
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

    // CT14 / CF3: the ambiguous link's persisted evidence.candidates survives
    // the round-trip as {identityId, displayName} objects (not bare UUIDs),
    // carrying both tied identities so a human reviewer can adjudicate.
    const ambiguousCandidates = byAccount.get(ambiguousAccountId)?.evidence?.candidates ?? [];
    expect(ambiguousCandidates).toHaveLength(2);
    const candidateIds = ambiguousCandidates.map((c) => c.identityId).sort();
    expect(candidateIds).toEqual([ambiguousIdentityId1, ambiguousIdentityId2].sort());
    for (const candidate of ambiguousCandidates) {
      expect(typeof candidate.displayName).toBe('string');
      expect(candidate.displayName.length).toBeGreaterThan(0);
    }

    const events = await withTenant(appPool, tenantId, async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM discovery_events WHERE tenant_id = $1 AND kind = 'match_completed'",
        [tenantId],
      );
      return rows;
    });
    expect(events).toHaveLength(1);
  });

  // T-W1 (import-labeling-saasapp-ui-plan, C10): account_labels is a
  // dedicated table the matcher never reads or writes, so a manually-set
  // label must survive a re-match unchanged even when the account's own
  // link status flips underneath it.
  it('manual label survives re-match unchanged while link status flips', async () => {
    const labelIdentityId = randomUUID();
    const labelAccountId = randomUUID();
    const labelId = randomUUID();

    await withTenant(appPool, tenantId, async (tx) => {
      // Identity's email deliberately does not match the account yet, so the
      // first runMatch classifies the account's link as orphan.
      await tx.query(
        `INSERT INTO identities (id, tenant_id, employee_id, primary_email, display_name, status, left_at)
         VALUES ($1, $2, 'emp-label', 'label-identity@example.com', 'Label Person', 'active', NULL)`,
        [labelIdentityId, tenantId],
      );
      await tx.query(
        `INSERT INTO saas_accounts (id, tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin)
         VALUES ($1, $2, $3, 'ext-label', 'label-account@example.com', 'Label Account', 'active', false)`,
        [labelAccountId, tenantId, saasAppId],
      );
    });

    await runMatch({ pool: appPool }, { tenantId });

    const orphanStatus = await withTenant(appPool, tenantId, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        'SELECT status FROM account_links WHERE tenant_id = $1 AND saas_account_id = $2',
        [tenantId, labelAccountId],
      );
      return rows[0]?.status;
    });
    expect(orphanStatus).toBe('orphan');

    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO account_labels (id, tenant_id, saas_account_id, kind, note, created_by)
         VALUES ($1, $2, $3, 'known_shared', 'set before re-match', NULL)`,
        [labelId, tenantId, labelAccountId],
      );
    });

    type LabelRow = {
      id: string;
      tenant_id: string;
      saas_account_id: string;
      kind: string;
      note: string | null;
      created_by: string | null;
      created_at: Date;
      updated_at: Date;
    };

    const fetchLabel = () =>
      withTenant(appPool, tenantId, async (tx) => {
        const { rows } = await tx.query<LabelRow>('SELECT * FROM account_labels WHERE id = $1', [labelId]);
        return rows[0];
      });

    const labelBeforeRematch = await fetchLabel();
    expect(labelBeforeRematch).toBeDefined();

    // Flip the identity's email to match the account, so the second
    // runMatch turns this account's link from orphan into matched.
    await withTenant(appPool, tenantId, async (tx) => {
      await tx.query('UPDATE identities SET primary_email = $1 WHERE id = $2', [
        'label-account@example.com',
        labelIdentityId,
      ]);
    });

    await runMatch({ pool: appPool }, { tenantId });

    const matchedStatus = await withTenant(appPool, tenantId, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        'SELECT status FROM account_links WHERE tenant_id = $1 AND saas_account_id = $2',
        [tenantId, labelAccountId],
      );
      return rows[0]?.status;
    });
    expect(matchedStatus).toBe('matched');

    const labelAfterRematch = await fetchLabel();
    expect(labelAfterRematch).toBeDefined();
    expect(labelAfterRematch?.id).toBe(labelBeforeRematch?.id);
    expect(labelAfterRematch?.kind).toBe(labelBeforeRematch?.kind);
    expect(labelAfterRematch?.note).toBe(labelBeforeRematch?.note);
    expect(labelAfterRematch?.created_by).toBe(labelBeforeRematch?.created_by);
    expect(labelAfterRematch?.created_at.getTime()).toBe(labelBeforeRematch?.created_at.getTime());
    expect(labelAfterRematch?.updated_at.getTime()).toBe(labelBeforeRematch?.updated_at.getTime());
    expect(labelAfterRematch?.tenant_id).toBe(tenantId);
  });
});
