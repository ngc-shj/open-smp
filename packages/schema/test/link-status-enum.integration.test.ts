import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LINK_STATUSES } from '@open-smp/api-types';
import { runMigrations } from '../src/migrate.js';

// C41/I41.2 — the domain agrees with the deployed enum, in order.
//
// This replaces a unit-tier gate that read the migration files as text and
// replayed `CREATE TYPE` / `ALTER TYPE ... ADD VALUE` with regexes. Seven code
// review rounds each found one more spelling that scanner did not understand,
// and every miss failed the same way: the statement simply did not match, the
// replay carried on, and the gate stayed green while the database and the
// domain disagreed. Whitespace, then the lexical form of the label, then the
// statement's qualification and verb, then comments used as token separators —
// `ALTER/*c*/TYPE` is valid DDL that no `ALTER\s+TYPE` can see, and a
// `DROP TYPE` + `CREATE TYPE` recreate is not an `ALTER TYPE` at all.
//
// The escapes were not running out, and each patch that widened the scanner
// admitted new false reds needing a hand-maintained exemption list. So the
// gate stops parsing SQL and asks Postgres instead: run the migrations, read
// the enum back. No spelling can escape, because the parser is the one that
// will actually execute the migrations in production.
//
// The cost is a database, which moves this to the integration tier. That is
// the honest trade — VE3 already governs this tier and CI already runs it.

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  await runMigrations(container.getConnectionUri());
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('C41: link_status in the deployed database matches the domain', () => {
  it('has exactly the domain members, in the domain order', async () => {
    // enumsortorder is what a Postgres enum comparison actually uses, so this
    // reads the property the domain's declaration order is claiming — not the
    // textual order of any migration file.
    const { rows } = await pool.query<{ enumlabel: string }>(
      `SELECT enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'link_status'
        ORDER BY e.enumsortorder`,
    );

    expect(rows.map((row) => row.enumlabel)).toEqual([...LINK_STATUSES]);
  });

  it('is the type the account_links.status column actually uses', async () => {
    // Without this, the assertion above would still pass if the column were
    // switched to some other enum that happens to carry the same labels.
    const { rows } = await pool.query<{ udt_name: string }>(
      `SELECT udt_name
         FROM information_schema.columns
        WHERE table_name = 'account_links' AND column_name = 'status'`,
    );

    expect(rows.map((row) => row.udt_name)).toEqual(['link_status']);
  });

  it('rejects a value outside the domain', async () => {
    // The domain is a claim about what the column can hold. This is the claim
    // executed rather than asserted: an out-of-domain value must not be
    // insertable, which is what makes the enum a boundary rather than a label.
    await expect(pool.query(`SELECT 'not_a_status'::link_status`)).rejects.toThrow(
      /invalid input value for enum link_status/,
    );
  });
});
