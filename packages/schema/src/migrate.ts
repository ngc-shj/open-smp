import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applies migrations/*.sql in filename order, each inside its own
 * transaction, tracked in a `_migrations` table so re-runs are idempotent.
 * `adminDatabaseUrl` must be a role permitted to CREATE ROLE/EXTENSION/POLICY
 * (i.e. not the restricted `opensmp_app` runtime role).
 */
export async function runMigrations(adminDatabaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: adminDatabaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      const entries = await readdir(migrationsDir);
      const files = entries.filter((name) => name.endsWith('.sql')).sort();

      for (const file of files) {
        const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
        if (rows.length > 0) {
          continue;
        }

        const sqlText = await readFile(path.join(migrationsDir, file), 'utf8');

        await client.query('BEGIN');
        try {
          await client.query(sqlText);
          await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
