import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LABEL_KINDS, LINK_STATUSES } from '@open-smp/api-types';
import {
  accountLabelKindEnum,
  accountStatusEnum,
  identityStatusEnum,
  linkStatusEnum,
  tenantScopedTables,
} from '../src/tables.js';

/**
 * Strip SQL comments without touching string literals.
 *
 * A blind `--[^\n]*` replace is wrong: `--` inside a quoted literal (a
 * separator, some default text) swallows the rest of the line, which can eat a
 * real `ADD VALUE` or even the `CREATE TYPE` itself and red the gate for a
 * reason unrelated to what it asserts. So this walks the text and only treats a
 * comment marker as one when it is outside a literal.
 *
 * Two things it does NOT handle, stated because they are unreachable by the
 * current corpus rather than by design — the next person to add one turns a
 * note into a false green:
 * - **Nested block comments.** Postgres nests `/* ... /* ... *\/ ... *\/`; this
 *   stops at the first `*\/`. The migrations contain zero block comments.
 * - **Dollar-quoting.** `$$ ... $$` bodies are walked as ordinary text.
 *   `0001_init.sql` has a `DO $$` block whose literals happen to be
 *   quote-balanced, so the walk stays in sync — by luck, not by design.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1);
      if (end === -1) return out + sql.slice(i);
      out += sql.slice(i, end + 1);
      i = end + 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * `ALTER TYPE link_status ADD VALUE` up to (not including) the new label's
 * opening quote.
 *
 * One source for both the positional detector and the replay, because the two
 * were written separately and drifted: a fix for "a string literal is its own
 * token, so no whitespace is required before it" was applied to `BEFORE/AFTER`
 * and not to `VALUE`, two tokens to the left in the same pattern. Postgres
 * accepts `ADD VALUE'x'`, which the `\s+` form silently missed — a false green
 * letting the database hold a status the domain does not list.
 *
 * Hence `\s*` at every keyword-to-literal boundary, once.
 */
const ADD_VALUE =
  `ALTER\\s+TYPE\\s+(?:\\w+\\.)?"?link_status"?\\s+ADD\\s+VALUE\\s*(?:IF\\s+NOT\\s+EXISTS\\s*)?`;

// The scanners get their own table rather than being validated only through
// the gates that consume them. Four review rounds found the same class of bug
// — a keyword-to-literal boundary assuming whitespace Postgres does not
// require — each time in a different spot, because the only way to notice was
// to run the gate end to end against a hand-built migration. A direct table
// makes the next spelling a one-line addition.
describe('the migration scanner accepts what Postgres accepts', () => {
  const ADDS = new RegExp(`${ADD_VALUE}'([^']+)'`, 'gi');

  it.each([
    ['canonical', "ALTER TYPE link_status ADD VALUE 'x';"],
    ['no space before the literal', "ALTER TYPE link_status ADD VALUE'x';"],
    ['IF NOT EXISTS', "ALTER TYPE link_status ADD VALUE IF NOT EXISTS 'x';"],
    ['IF NOT EXISTS, no space', "ALTER TYPE link_status ADD VALUE IF NOT EXISTS'x';"],
    ['lowercase', "alter type link_status add value 'x';"],
    ['quoted identifier', `ALTER TYPE "link_status" ADD VALUE 'x';`],
    ['schema-qualified', "ALTER TYPE public.link_status ADD VALUE 'x';"],
    ['multiline', "ALTER TYPE  link_status\n  ADD VALUE\n  'x';"],
  ])('finds the added value: %s', (_label, sql) => {
    expect([...stripSqlComments(sql).matchAll(ADDS)].map((m) => m[1])).toEqual(['x']);
  });

  it.each([
    ['line comment', "-- ALTER TYPE link_status ADD VALUE 'x';"],
    ['block comment', "/* ALTER TYPE link_status ADD VALUE 'x'; */"],
  ])('ignores a commented-out statement: %s', (_label, sql) => {
    expect([...stripSqlComments(sql).matchAll(ADDS)]).toEqual([]);
  });

  it.each([
    ['-- inside a literal', "ALTER TABLE t ALTER COLUMN c SET DEFAULT 'a--b'; ALTER TYPE link_status ADD VALUE 'x';"],
    ['/* inside a literal', "ALTER TABLE t ALTER COLUMN c SET DEFAULT 'a/*b'; ALTER TYPE link_status ADD VALUE 'x';"],
  ])('does not let a comment marker in a literal eat real DDL: %s', (_label, sql) => {
    expect([...stripSqlComments(sql).matchAll(ADDS)].map((m) => m[1])).toEqual(['x']);
  });
});

describe('enum value sets', () => {
  it('identity_status matches the C1 contract', () => {
    expect(identityStatusEnum.enumValues).toEqual(['active', 'left']);
  });

  // C41/I41.1. Asserted against the domain, not against a transcription of
  // itself — the previous form compared the enum to a hardcoded list in this
  // file, so it fired only when someone edited tables.ts and forgot the test,
  // never when the domain moved. Same correction C37 made for the label kinds
  // in the sibling assertion below.
  it('link_status derives from the shared link-status domain', () => {
    expect([...linkStatusEnum.enumValues]).toEqual([...LINK_STATUSES]);
  });

  // C41/I41.2. The domain's order is not free: a Postgres enum's declaration
  // order is its sort order, and 0001_init.sql has shipped. This pins the
  // domain against the migration text so a reorder fails here rather than
  // silently disagreeing with the deployed database.
  //
  // Every migration is read, not just 0001, and the enum's evolution is
  // replayed — CREATE TYPE then each ALTER TYPE ... ADD VALUE in filename
  // order, which is the order migrate.ts applies them. Reading 0001 alone
  // would red on a *correct* schema: a shipped migration cannot be edited, so
  // adding a status necessarily lands in a later file, and the only ways to
  // satisfy a 0001-only assertion are to edit history or delete the test.
  it('link_status order matches the shipped migrations', () => {
    const dir = new URL('../migrations/', import.meta.url);
    const raw = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => readFileSync(new URL(name, dir), 'utf8'))
      .join('\n');
    const sql = stripSqlComments(raw);

    const created = sql.match(/CREATE\s+TYPE\s+(?:\w+\.)?"?link_status"?\s+AS\s+ENUM\s*\(([^)]*)\)/i);
    expect(created, 'migrations must declare the link_status enum').not.toBeNull();
    const declared = [...created![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    // Postgres also accepts BEFORE/AFTER positional insertion, which this
    // append-only replay would get wrong — and getting the ORDER wrong is the
    // one thing this test exists to prevent, so it refuses to guess rather
    // than asserting a sequence that disagrees with the database.
    const positional = sql.match(new RegExp(`${ADD_VALUE}'[^']+'\\s*(BEFORE|AFTER)\\s*'`, 'i'));
    expect(
      positional,
      'positional ADD VALUE ... BEFORE/AFTER is not replayed here; teach this test the ordering rule before using it',
    ).toBeNull();

    for (const added of sql.matchAll(new RegExp(`${ADD_VALUE}'([^']+)'`, 'gi'))) {
      declared.push(added[1]);
    }

    expect(declared).toEqual([...LINK_STATUSES]);
  });

  it('account_status matches the C1 contract', () => {
    expect(accountStatusEnum.enumValues).toEqual(['active', 'suspended', 'archived']);
  });

  // Asserted against the domain, not against a transcription of itself. The
  // previous form compared the enum to a hardcoded list in this file, so it
  // fired only when someone edited tables.ts and forgot the test — never when
  // the domain moved. Now a kind added to ACCOUNT_LABEL_KINDS without the
  // matching migration fails here.
  it('account_label_kind derives from the shared label-kind domain', () => {
    expect([...accountLabelKindEnum.enumValues]).toEqual([...ACCOUNT_LABEL_KINDS]);
  });
});

describe('tenant-scoped table member set', () => {
  it('contains exactly the 8 tables from the C1/C10 member-set derivation (tenants excluded)', () => {
    expect(Object.keys(tenantScopedTables).sort()).toEqual(
      [
        'identities',
        'saasApps',
        'saasAccounts',
        'accountLinks',
        'discoveryEvents',
        'users',
        'sessions',
        'accountLabels',
      ].sort(),
    );
  });
});
