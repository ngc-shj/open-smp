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
// `{0,2}` qualifiers, not `?`: Postgres accepts db.schema.type, and allowing
// only one made `ALTER TYPE opensmp.public.link_status ADD VALUE 'x'` match
// nothing at all — invisible to the parse-completeness counter below, which is
// the one blind spot that counter cannot see past.
const TYPE_REF = `(?:"?\\w+"?\\.){0,2}"?link_status"?`;

const ADD_VALUE = `ALTER\\s+TYPE\\s+${TYPE_REF}\\s+ADD\\s+VALUE\\s*(?:IF\\s+NOT\\s+EXISTS\\s*)?`;

/**
 * The new label. Postgres accepts more spellings than a plain `'x'`.
 *
 * `E'x'` (escape), `U&'x'` (unicode) and `$$x$$` (dollar-quoted) are all valid
 * and were all silently skipped by a bare `'([^']+)'` — a false green in the
 * worst direction, since the database gains a status the domain does not list
 * and the gate whose whole purpose is catching that divergence stays quiet.
 * `''` is the SQL escape for a quote inside a literal, so it is part of the
 * label rather than its end.
 */
const LABEL = `(?:(?:E|U&)?'((?:[^']|'')*)'|\\$\\$([^$]*)\\$\\$)`;

/**
 * Every `ALTER TYPE` that touches `link_status`, whatever it does to it.
 *
 * The anti-blindness half of the pair, and it is deliberately scoped to the
 * *statement* rather than to `ADD VALUE`. The first version counted
 * `ADD_VALUE + \S`, which inherited that prefix as its own blind spot: a
 * three-part-qualified name and `RENAME VALUE` both failed the prefix, so they
 * were invisible to the counter *and* to the replay, and the completeness
 * assertion compared 0 to 0 and passed. Six review rounds have each found one
 * more spelling the scanner did not know; the only durable answer is to count
 * everything aimed at this type and refuse to proceed on anything unrecognised.
 *
 * `RENAME TO` is excluded on purpose — it renames the type, not a label.
 */
const ALTERS_TYPE = `ALTER\\s+TYPE\\s+${TYPE_REF}\\s+(?!RENAME\\s+TO\\b)\\S`;

// The scanners get their own table rather than being validated only through
// the gates that consume them. Four review rounds found the same class of bug
// — a keyword-to-literal boundary assuming whitespace Postgres does not
// require — each time in a different spot, because the only way to notice was
// to run the gate end to end against a hand-built migration. A direct table
// makes the next spelling a one-line addition.
describe('the migration scanner accepts what Postgres accepts', () => {
  const ADDS = new RegExp(`${ADD_VALUE}${LABEL}`, 'gi');
  const labelOf = (m: RegExpMatchArray) =>
    m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];

  it.each([
    ['canonical', "ALTER TYPE link_status ADD VALUE 'x';"],
    ['no space before the literal', "ALTER TYPE link_status ADD VALUE'x';"],
    ['IF NOT EXISTS', "ALTER TYPE link_status ADD VALUE IF NOT EXISTS 'x';"],
    ['IF NOT EXISTS, no space', "ALTER TYPE link_status ADD VALUE IF NOT EXISTS'x';"],
    ['lowercase', "alter type link_status add value 'x';"],
    ['quoted identifier', `ALTER TYPE "link_status" ADD VALUE 'x';`],
    ['schema-qualified', "ALTER TYPE public.link_status ADD VALUE 'x';"],
    ['schema-qualified and quoted', `ALTER TYPE "public"."link_status" ADD VALUE 'x';`],
    ['multiline', "ALTER TYPE  link_status\n  ADD VALUE\n  'x';"],
    // The label has more spellings than a plain literal, and every one of these
    // was a false green until round 5 — the statement simply did not match.
    ['escape-string label', "ALTER TYPE link_status ADD VALUE E'x';"],
    ['unicode-escape label', "ALTER TYPE link_status ADD VALUE U&'x';"],
    ['dollar-quoted label', 'ALTER TYPE link_status ADD VALUE $$x$$;'],
  ])('finds the added value: %s', (_label, sql) => {
    expect([...stripSqlComments(sql).matchAll(ADDS)].map(labelOf)).toEqual(['x']);
  });

  it("reads '' as an escaped quote inside the label, not as its end", () => {
    const sql = "ALTER TYPE link_status ADD VALUE 'qu''ar';";
    expect([...stripSqlComments(sql).matchAll(ADDS)].map(labelOf)).toEqual(["qu'ar"]);
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
    expect([...stripSqlComments(sql).matchAll(ADDS)].map(labelOf)).toEqual(['x']);
  });

  // The property that matters more than any individual spelling. Six rounds
  // each found a form the scanner did not know, and each failed silently by
  // simply not matching. The gate compares "statements seen" against
  // "statements replayed", so anything unrecognised reds instead of vanishing.
  // These pin that the counts genuinely diverge — including for the two shapes
  // that escaped the first version of this counter, because it was scoped to
  // ADD VALUE rather than to the statement.
  it.each([
    ['an unparseable label', 'ALTER TYPE link_status ADD VALUE ??unparseable??;'],
    ['RENAME VALUE, which changes the label set', "ALTER TYPE link_status RENAME VALUE 'a' TO 'b';"],
  ])('sees but cannot replay: %s', (_label, sql) => {
    const seen = [...sql.matchAll(new RegExp(ALTERS_TYPE, 'gi'))].length;
    expect(seen).toBe(1);
    expect([...sql.matchAll(ADDS)].length).toBeLessThan(seen);
  });

  it('replays a three-part-qualified ADD VALUE it can read', () => {
    const sql = "ALTER TYPE db.public.link_status ADD VALUE 'x';";
    expect([...stripSqlComments(sql).matchAll(ADDS)].map(labelOf)).toEqual(['x']);
  });

  // Renaming the type is not a change to its labels, so it must not red.
  it('ignores RENAME TO, which renames the type rather than a label', () => {
    const sql = 'ALTER TYPE link_status RENAME TO link_state;';
    expect([...sql.matchAll(new RegExp(ALTERS_TYPE, 'gi'))]).toEqual([]);
  });

  it("does not attribute another enum's ALTER TYPE to link_status", () => {
    const sql = "ALTER TYPE account_status ADD VALUE 'x';";
    expect([...sql.matchAll(new RegExp(ALTERS_TYPE, 'gi'))]).toEqual([]);
    expect([...stripSqlComments(sql).matchAll(ADDS)]).toEqual([]);
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

    const created = sql.match(
      /CREATE\s+TYPE\s+(?:"?\w+"?\.)?"?link_status"?\s+AS\s+ENUM\s*\(([^)]*)\)/i,
    );
    expect(created, 'migrations must declare the link_status enum').not.toBeNull();
    const declared = [...created![1]!.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
      m[1]!.replace(/''/g, "'"),
    );

    // Every ALTER TYPE aimed at link_status, then every one this test can
    // actually read. A statement in the first set but not the second is one the
    // scanner does not understand — an unknown label spelling, or an unknown
    // verb like RENAME VALUE, which changes the label set without adding to it.
    // Six review rounds each found one more, every time failing silently. So
    // anything unrecognised fails loudly instead of passing unseen.
    const seen = [...sql.matchAll(new RegExp(ALTERS_TYPE, 'gi'))].length;
    const parsed = [...sql.matchAll(new RegExp(`${ADD_VALUE}${LABEL}`, 'gi'))];
    expect(
      parsed.length,
      `every ALTER TYPE on link_status must be one this test can replay (saw ${seen}, replayed ${parsed.length}); teach it the statement rather than letting it pass unseen`,
    ).toBe(seen);

    // Postgres also accepts BEFORE/AFTER positional insertion, which this
    // append-only replay would get wrong — and getting the ORDER wrong is the
    // one thing this test exists to prevent, so it refuses to guess rather
    // than asserting a sequence that disagrees with the database.
    const positional = sql.match(
      new RegExp(`${ADD_VALUE}${LABEL}\\s*(?:BEFORE|AFTER)\\s*\\S`, 'i'),
    );
    expect(
      positional,
      'positional ADD VALUE ... BEFORE/AFTER is not replayed here; teach this test the ordering rule before using it',
    ).toBeNull();

    for (const added of parsed) {
      // Group 1 is a quoted label (with '' unescaped), group 2 a dollar-quoted one.
      declared.push(added[1] !== undefined ? added[1].replace(/''/g, "'") : added[2]!);
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
