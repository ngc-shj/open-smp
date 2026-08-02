import type { Pool, PoolClient } from 'pg';
import { withTenant } from '@open-smp/schema';
import { encryptCredentials, withDecryptedCredentials } from '@open-smp/crypto';

export interface RotationDeps {
  pool: Pool;
  encryptionKeys: Map<number, Buffer>;
  logger?: { info: (msg: string) => void; error: (msg: string) => void };
}

interface TenantRow {
  id: string;
}

interface StaleSaasAppRow {
  id: string;
  credentials_enc: Buffer;
  credentials_key_version: number;
}

export interface TenantRotationResult {
  tenantId: string;
  reencrypted: number;
  failed: number;
}

export interface RotationSweepResult {
  perTenant: TenantRotationResult[];
  remainingOnNonCurrentVersions: number;
  anyFailed: boolean;
}

function currentVersion(keys: Map<number, Buffer>): number {
  return Math.max(...keys.keys());
}

async function loadTenants(pool: Pool): Promise<TenantRow[]> {
  // tenants is the root table: no tenant_id column, no RLS (C1) — a plain
  // SELECT under the ordinary app role is sufficient, no BYPASSRLS needed.
  const { rows } = await pool.query<TenantRow>('SELECT id FROM tenants ORDER BY id');
  return rows;
}

async function loadStaleSaasApps(tx: PoolClient, currentKeyVersion: number): Promise<StaleSaasAppRow[]> {
  const { rows } = await tx.query<StaleSaasAppRow>(
    `SELECT id, credentials_enc, credentials_key_version
     FROM saas_apps
     WHERE credentials_enc IS NOT NULL AND credentials_key_version <> $1`,
    [currentKeyVersion],
  );
  return rows;
}

async function reencryptRow(
  tx: PoolClient,
  tenantId: string,
  row: StaleSaasAppRow,
  keys: Map<number, Buffer>,
): Promise<void> {
  const oldCtx = { tenantId, saasAppId: row.id };

  // The zeroization lives in `withDecryptedCredentials`, not here. This site was
  // the third one taught to zero the returned buffer, one per review round, and
  // each round declared the class enumerated. It is the worst of the three:
  // rotation never stringifies the credential, so the plaintext buffer is the
  // ONLY holder on this path, and `rotateTenant` below catches per row and keeps
  // sweeping every tenant's every stale credential in one process.
  await withDecryptedCredentials(
    row.credentials_enc,
    row.credentials_key_version,
    oldCtx,
    keys,
    async (plaintext) => {
      // keyVersion is part of the AAD (C9/S1), so re-encryption must build the
      // AAD under the NEW version, not reuse the old row's AAD bytes.
      const { blob, keyVersion } = encryptCredentials(plaintext, oldCtx, keys);

      await tx.query(
        'UPDATE saas_apps SET credentials_enc = $1, credentials_key_version = $2 WHERE id = $3',
        [Buffer.from(blob), keyVersion, row.id],
      );
    },
  );
}

async function rotateTenant(
  pool: Pool,
  tenantId: string,
  keys: Map<number, Buffer>,
  currentKeyVersion: number,
): Promise<TenantRotationResult> {
  let reencrypted = 0;
  let failed = 0;

  await withTenant(pool, tenantId, async (tx) => {
    const staleRows = await loadStaleSaasApps(tx, currentKeyVersion);

    for (const row of staleRows) {
      try {
        await reencryptRow(tx, tenantId, row, keys);
        reencrypted += 1;
      } catch {
        failed += 1;
      }
    }
  });

  return { tenantId, reencrypted, failed };
}

/**
 * C9/S10/S13 rotation sweep: walks every tenant (root table, no RLS bypass),
 * re-encrypts each saas_apps row on a non-current credentials_key_version
 * in place, and returns the retirement-gate count. Never invoked over HTTP;
 * see rotate-credentials.ts for the CLI entrypoint + ROTATE_CONFIRM gate.
 */
export async function runRotationSweep(deps: RotationDeps): Promise<RotationSweepResult> {
  const currentKeyVersion = currentVersion(deps.encryptionKeys);
  const tenants = await loadTenants(deps.pool);

  const perTenant: TenantRotationResult[] = [];
  for (const tenant of tenants) {
    const result = await rotateTenant(deps.pool, tenant.id, deps.encryptionKeys, currentKeyVersion);
    perTenant.push(result);
    deps.logger?.info(
      `tenant ${result.tenantId}: re-encrypted ${result.reencrypted}, failed ${result.failed}`,
    );
  }

  const remainingOnNonCurrentVersions = await countRemaining(deps.pool, tenants, currentKeyVersion);
  const anyFailed = perTenant.some((result) => result.failed > 0);

  return { perTenant, remainingOnNonCurrentVersions, anyFailed };
}

async function countRemaining(pool: Pool, tenants: TenantRow[], currentKeyVersion: number): Promise<number> {
  let sum = 0;
  for (const tenant of tenants) {
    await withTenant(pool, tenant.id, async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM saas_apps WHERE credentials_key_version <> $1',
        [currentKeyVersion],
      );
      sum += Number.parseInt(rows[0]?.count ?? '0', 10);
    });
  }
  return sum;
}

// --- CLI entrypoint (thin wrapper; see runRotationSweep above for the logic) ---
// Sweep invocation authorization (S13): this is an operator-shell CLI only —
// never exposed as an HTTP endpoint or enqueued from the API. Possession of
// deploy shell access + ENCRYPTION_KEYS is the authorization boundary.
async function main(): Promise<void> {
  if (process.env.ROTATE_CONFIRM !== 'yes') {
    console.error('Refusing to run: set ROTATE_CONFIRM=yes to confirm this operator action.');
    process.exit(1);
  }

  const { createPool } = await import('@open-smp/schema');
  const { parseEncryptionKeys } = await import('@open-smp/crypto');
  const { parseEnv } = await import('./env.js');

  const env = parseEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  const encryptionKeys = parseEncryptionKeys(env.ENCRYPTION_KEYS);

  try {
    const result = await runRotationSweep({
      pool,
      encryptionKeys,
      logger: { info: (msg) => console.log(msg), error: (msg) => console.error(msg) },
    });

    console.log(`retirement-gate: ${result.remainingOnNonCurrentVersions} rows remaining on non-current versions`);

    if (result.anyFailed || result.remainingOnNonCurrentVersions > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  void main();
}
