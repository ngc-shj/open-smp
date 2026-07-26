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
    //
    // `\s*` before the quote, not `\s`: a string literal is its own token, so
    // `AFTER'matched'` is valid and Postgres inserts positionally. Requiring
    // whitespace there made this detector miss that form — and then the
    // append-only replay asserted the wrong order, passing a sequence that
    // disagrees with the database and failing the one that matches it.
    const positional = sql.match(
      /ALTER\s+TYPE\s+(?:\w+\.)?"?link_status"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'[^']+'\s*(BEFORE|AFTER)\s*'/i,
    );
    expect(
      positional,
      'positional ADD VALUE ... BEFORE/AFTER is not replayed here; teach this test the ordering rule before using it',
    ).toBeNull();

    for (const added of sql.matchAll(
      /ALTER\s+TYPE\s+(?:\w+\.)?"?link_status"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi,
    )) {
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
