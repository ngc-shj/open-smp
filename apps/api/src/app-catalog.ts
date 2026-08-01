import type { PoolClient } from 'pg';

// SC2/C2. The two primitives that bound a tenant's application catalog.
//
// They used to live in `routes/contract-import.ts`, which was their only caller.
// `POST /saas-apps` is now a second one — measured, it had no ceiling at all —
// and a route importing another route to reach them would make the dependency
// read as a relationship between two features rather than as both using the
// same primitive.

/**
 * Serialises catalog growth for one tenant, for the life of the transaction.
 *
 * `SELECT count(*)` acquires no lock at READ COMMITTED, so two concurrent
 * imports both read the same pre-insert count and both spend it — measured on
 * 16, two transactions took a ceiling of 10 to 18 rows. A row lock is not
 * available for the same purpose (`tenants` grants SELECT and INSERT only, and
 * FOR UPDATE needs UPDATE), and the rows being counted are the rows being
 * created, so there is nothing to lock until it exists.
 *
 * Exported so the acceptance test can drive two real transactions through the
 * shipped primitive rather than through a re-implementation of it.
 */
export async function lockTenantAppCatalog(tx: PoolClient, tenantId: string): Promise<void> {
  // hashtext is stable within a major version and collisions merely serialise
  // two unrelated tenants, which costs latency and never correctness. The first
  // key namespaces the lock so it cannot alias another feature's advisory lock.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('saas_apps_catalog'), hashtext($1))`, [
    tenantId,
  ]);
}

/** Counts a tenant's applications. `count()` is bigint, which pg returns as a string. */
export async function countTenantApps(tx: PoolClient, tenantId: string): Promise<number> {
  const result = await tx.query<{ n: string }>(
    'SELECT count(*) AS n FROM saas_apps WHERE tenant_id = $1',
    [tenantId],
  );
  return Number(result.rows[0]!.n);
}
