import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as tables from './tables.js';

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema: tables });
}

/**
 * Runs `fn` inside a transaction that has claimed one tenant, and cannot claim
 * another (SCL8, migration 0007).
 *
 * The previous form set `app.tenant_id` with `set_config(..., true)`. That
 * stopped leakage ACROSS pooled requests — the GUC is transaction-local — but
 * not within one: the application's own role could call `set_config` again and
 * every RLS predicate followed it, measured as a visible row count going 2 to 0
 * mid transaction. So the blast radius of any SQL injection was full
 * tenant-isolation bypass rather than one query's rows.
 *
 * The privilege system could not close that. `GRANT SET ON PARAMETER` does not
 * gate customized options: `REVOKE … FROM PUBLIC` is accepted and enforces
 * nothing, measured. `set_tenant_context` is a SECURITY DEFINER write into a
 * table this role holds no privilege on, and it refuses a second call inside
 * the same transaction — so the claim is write-once and unforgeable from SQL.
 *
 * This docstring previously claimed the stronger property the GUC did not have.
 * It is corrected here, in the change that makes the claim true.
 */
export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_tenant_context($1)', [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
