import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withTenant } from '@open-smp/schema';
import { decryptCredentials, encryptCredentials } from '@open-smp/crypto';
import { runRotationSweep } from '../src/rotate-credentials.js';

// C9 S10/S13 acceptance: TWO seeded tenants each holding saas_apps rows on
// key version 1 while version 2 is current. One runRotationSweep call must
// re-encrypt BOTH tenants' rows, the retirement-gate sum must reach 0, and
// all rows must still decrypt under v2 — using the ordinary app role only
// (no RLS bypass).

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;

const tenantA = randomUUID();
const tenantB = randomUUID();
const tenantC = randomUUID();

const keys = new Map<number, Buffer>([
  [1, Buffer.alloc(32, 1)],
  [2, Buffer.alloc(32, 2)],
]);

async function seedStaleApp(tenantId: string): Promise<string> {
  const saasAppId = randomUUID();
  const plaintext = Buffer.from(JSON.stringify({ apiKey: `key-for-${tenantId}` }), 'utf8');

  // Encrypt under version 1 explicitly (not "current"), by building the blob
  // by hand with the v1 key via encryptCredentials against a single-key map.
  const v1Only = new Map([[1, keys.get(1)!]]);
  const { blob, keyVersion } = encryptCredentials(plaintext, { tenantId, saasAppId }, v1Only);
  expect(keyVersion).toBe(1);

  await withTenant(appPool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_enc, credentials_key_version)
       VALUES ($1, $2, 'fake-app', 'Fake App', $3, 1)`,
      [saasAppId, tenantId, Buffer.from(blob)],
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

  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Tenant A')`, [
    tenantA,
    `tenant-a-${tenantA}`,
  ]);
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Tenant B')`, [
    tenantB,
    `tenant-b-${tenantB}`,
  ]);
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Tenant C')`, [
    tenantC,
    `tenant-c-${tenantC}`,
  ]);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe('C9 rotation sweep acceptance', () => {
  it('re-encrypts stale rows for BOTH tenants in one sweep and reaches gate 0', async () => {
    const saasAppIdA = await seedStaleApp(tenantA);
    const saasAppIdB = await seedStaleApp(tenantB);

    // appPool connects as opensmp_app (the ordinary app role) — no
    // BYPASSRLS grant is used anywhere in this test.
    const result = await runRotationSweep({ pool: appPool, encryptionKeys: keys });

    expect(result.anyFailed).toBe(false);
    expect(result.remainingOnNonCurrentVersions).toBe(0);

    const tenantAResult = result.perTenant.find((r) => r.tenantId === tenantA);
    const tenantBResult = result.perTenant.find((r) => r.tenantId === tenantB);
    expect(tenantAResult?.reencrypted).toBe(1);
    expect(tenantBResult?.reencrypted).toBe(1);

    const rowA = await withTenant(appPool, tenantA, async (tx) => {
      const { rows } = await tx.query<{ credentials_enc: Buffer; credentials_key_version: number }>(
        'SELECT credentials_enc, credentials_key_version FROM saas_apps WHERE id = $1',
        [saasAppIdA],
      );
      return rows[0]!;
    });
    const rowB = await withTenant(appPool, tenantB, async (tx) => {
      const { rows } = await tx.query<{ credentials_enc: Buffer; credentials_key_version: number }>(
        'SELECT credentials_enc, credentials_key_version FROM saas_apps WHERE id = $1',
        [saasAppIdB],
      );
      return rows[0]!;
    });

    expect(rowA.credentials_key_version).toBe(2);
    expect(rowB.credentials_key_version).toBe(2);

    const decryptedA = decryptCredentials(
      rowA.credentials_enc,
      rowA.credentials_key_version,
      { tenantId: tenantA, saasAppId: saasAppIdA },
      keys,
    );
    const decryptedB = decryptCredentials(
      rowB.credentials_enc,
      rowB.credentials_key_version,
      { tenantId: tenantB, saasAppId: saasAppIdB },
      keys,
    );

    expect(JSON.parse(Buffer.from(decryptedA).toString('utf8'))).toEqual({ apiKey: `key-for-${tenantA}` });
    expect(JSON.parse(Buffer.from(decryptedB).toString('utf8'))).toEqual({ apiKey: `key-for-${tenantB}` });
  });

  it('an app registered without credentials does not hold the retirement gate open', async () => {
    // The case the sweep above cannot reach, because every row it seeds HAS
    // credentials. `loadStaleSaasApps` skips a row with none — there is nothing
    // to re-encrypt — while the gate counted it, so the two disagreed and the
    // gate could not reach 0.
    //
    // Found by running the documented rotation procedure against the demo stack,
    // where the seeded `notion` app is registered with no credentials:
    // `re-encrypted 2, failed 0` and `1 rows remaining`, exit 1, unmoved by
    // re-runs. Nothing in this suite could see it, because the suite only ever
    // asked about rows that were rotation targets.
    const saasAppId = randomUUID();
    await withTenant(appPool, tenantC, async (tx) => {
      await tx.query(
        `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_enc, credentials_key_version)
         VALUES ($1, $2, 'no-credentials-app', 'No Credentials', NULL, 1)`,
        [saasAppId, tenantC],
      );
    });

    try {
      const result = await runRotationSweep({ pool: appPool, encryptionKeys: keys });

      expect(result.anyFailed).toBe(false);
      // Not a rotation target...
      expect(result.perTenant.find((r) => r.tenantId === tenantC)?.reencrypted).toBe(0);
      // ...so it must not be counted as one either. This is the assertion that
      // reds without the fix.
      expect(result.remainingOnNonCurrentVersions).toBe(0);
    } finally {
      // The gate sums across every tenant, so a row left behind here would decide
      // the outcome of any sweep asserted elsewhere in this file. Removing it
      // keeps the two tests independent of the order they run in.
      await withTenant(appPool, tenantC, async (tx) => {
        await tx.query('DELETE FROM saas_apps WHERE id = $1', [saasAppId]);
      });
    }
  });
});
