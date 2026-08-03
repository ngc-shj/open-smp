import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_STATUSES, LINK_STATUSES } from '@open-smp/api-types';
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
    // Schema-qualified: pg_type.typname is unique per schema, not globally, so
    // a same-named enum elsewhere would interleave its labels into this ordered
    // result and red a correct public.link_status.
    const { rows } = await pool.query<{ enumlabel: string }>(
      `SELECT enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'link_status' AND n.nspname = 'public'
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
        WHERE table_schema = 'public'
          AND table_name = 'account_links'
          AND column_name = 'status'`,
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

// I6.4 — the same three questions asked of account_status, on the same
// container boot. The FILENAME stays link-status-enum.integration.test.ts:
// tables.test.ts:26-28 and the plan's SC3 and SC5 all cite it by name, and a
// rename stales three citations to save nothing. Two enums, one boot, is why
// this is a second describe rather than a second file.
//
// This is the tier that answers what I6.1 cannot: I6.1 pins the drizzle mirror
// against a transcription of migrations/0001_init.sql:8, and this pins the
// DEPLOYED type against the domain. A migration that adds a label without
// touching ACCOUNT_STATUSES reds here and nowhere else — the case
// apps/web/src/lib/account-statuses.ts's guarded read exists to survive.
describe('C2/I2.3: account_status in the deployed database matches the domain', () => {
  it('has exactly the domain members, in the domain order', async () => {
    // enumsortorder, and schema-qualified, for the reasons the link_status
    // twin above states: it is the property the declaration order claims, and
    // a same-named enum in another schema would otherwise interleave its
    // labels into this ordered result.
    const { rows } = await pool.query<{ enumlabel: string }>(
      `SELECT enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'account_status' AND n.nspname = 'public'
        ORDER BY e.enumsortorder`,
    );

    expect(rows.map((row) => row.enumlabel)).toEqual([...ACCOUNT_STATUSES]);
  });

  it('is the type the saas_accounts.account_status column actually uses', async () => {
    // Without this, the assertion above would still pass if the column were
    // switched to some other enum that happens to carry the same labels.
    const { rows } = await pool.query<{ udt_name: string }>(
      `SELECT udt_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'saas_accounts'
          AND column_name = 'account_status'`,
    );

    expect(rows.map((row) => row.udt_name)).toEqual(['account_status']);
  });

  it('rejects a value outside the domain', async () => {
    // Also the PROOF of Requirement 8's first stated exception: the render
    // site's out-of-domain fallback has no observer at any tier, because the
    // column is an enum and the engine will not let the value exist. This cell
    // is that unreachability executed, not a substitute observer for it.
    await expect(pool.query(`SELECT 'not_a_status'::account_status`)).rejects.toThrow(
      /invalid input value for enum account_status/,
    );
  });
});
