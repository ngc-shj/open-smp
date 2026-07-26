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
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => readFileSync(new URL(name, dir), 'utf8'))
      .join('\n');

    const created = sql.match(/CREATE TYPE link_status AS ENUM \(([^)]*)\)/);
    expect(created, 'migrations must declare the link_status enum').not.toBeNull();
    const declared = [...created![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const added of sql.matchAll(/ALTER TYPE link_status ADD VALUE '([^']+)'/g)) {
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
