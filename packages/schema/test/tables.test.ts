import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LABEL_KINDS, LINK_STATUSES } from '@open-smp/api-types';
import {
  accountLabelKindEnum,
  accountStatusEnum,
  identityStatusEnum,
  linkStatusEnum,
  tenantScopedTables,
} from '../src/tables.js';
import { stripTsComments } from './strip-ts-comments.js';
import * as schema from '../src/tables.js';


describe('enum value sets', () => {
  it('identity_status matches the C1 contract', () => {
    expect(identityStatusEnum.enumValues).toEqual(['active', 'left']);
  });

  // C41/I41.1. Asserted against the domain, not against a transcription of
  // itself — the previous form compared the enum to a hardcoded list in this
  // file, so it fired only when someone edited tables.ts and forgot the test,
  // never when the domain moved. Same correction C37 made for the label kinds
  // in the sibling assertion below.
  //
  // This pins the drizzle mirror to the domain. Whether the DEPLOYED enum
  // agrees is a different question and cannot be answered here: it lives in
  // link-status-enum.integration.test.ts, which runs the migrations against a
  // real Postgres and reads the enum back. Seven review rounds established
  // that no amount of SQL-parsing in this tier can answer it correctly.
  it('link_status derives from the shared link-status domain', () => {
    expect([...linkStatusEnum.enumValues]).toEqual([...LINK_STATUSES]);
  });

  // I6.1. The literal STAYS, deliberately, where its link_status sibling above
  // derives. It is an independent TRANSCRIPTION of
  // packages/schema/migrations/0001_init.sql:8 — the shipped migration whose
  // declaration order IS the Postgres enum's sort order, and which
  // ACCOUNT_STATUSES is required to match.
  //
  // Deriving it from ACCOUNT_STATUSES would be tautological: pgEnum at
  // drizzle-orm@0.45.2 is `pgEnumWithSchema(name, [...input])` with
  // `enumValues: values`, a verbatim order-preserving copy, so the comparison
  // would be `[...[...X]]` against `[...X]` and could not fail. Transcribing
  // the authority instead makes this a check ON the domain rather than a copy
  // OF it — and it needs no Docker, so it is the only signal on the order
  // invariant for a developer who cannot run
  // link-status-enum.integration.test.ts (I6.4).
  //
  // This cell is unchanged from before ACCOUNT_STATUSES existed, which is what
  // makes the transcription genuinely independent.
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
  it('contains exactly the tables that carry a tenant_id, derived rather than listed', () => {
    // SCL9. This assertion compared one hand-written list against another, so a
    // tenant-scoped table added without touching either passed both — which is
    // the exposure C1 closed for saas_contracts BY HAND, and would have had to
    // close again for the next one.
    //
    // Derived from the schema module: every exported Drizzle table carrying a
    // `tenantId` column. `tenants` itself is excluded because it IS the tenant —
    // its `id` is what the others point at.
    const carriesTenantId = Object.entries(schema)
      .filter(([name, value]) => {
        if (name === 'tenants') return false;
        if (typeof value !== 'object' || value === null) return false;
        return 'tenantId' in value;
      })
      .map(([name]) => name)
      .sort();

    // Non-empty, or the comparison is between two empty sets — and a filter
    // that stopped matching anything would satisfy it silently.
    expect(carriesTenantId.length).toBeGreaterThan(0);
    expect(Object.keys(tenantScopedTables).sort()).toEqual(carriesTenantId);
  });
});


// I6.8 / C2-I2.2. I6.1 above compares VALUES, so it cannot see the failure this
// cell exists for: re-inlining an identical literal produces identical
// enumValues and leaves every behavioural gate green while the single-source
// property is gone. The derivation is observable only in the source text.
// apps/api/test/accounts-query-domain.test.ts:21-34 is the in-repo precedent.
describe('I6.8: account_status derives from the domain in the SOURCE, not only in its values', () => {
  const source = readFileSync(new URL('../src/tables.ts', import.meta.url), 'utf8');

  it('builds the pgEnum from ACCOUNT_STATUSES, not a local literal', () => {
    // Tolerant of anything a formatter does: whitespace between every token and
    // a trailing comma, which prettier emits when it breaks the argument list.
    expect(source).toMatch(/pgEnum\(\s*'account_status'\s*,\s*ACCOUNT_STATUSES\s*,?\s*\)/);
  });

  it('re-spells no member of the account-status domain in code', () => {
    // 'suspended' and 'archived' ONLY. 'active' is deliberately not forbidden:
    // identityStatusEnum at ../src/tables.ts:38 is
    // `pgEnum('identity_status', ['active', 'left'])` — a different domain that
    // legitimately carries 'active' in code, so forbidding it would red an
    // intact file. The other two appear nowhere else in tables.ts, so together
    // with the positive match above they pin the derivation with no false red.
    //
    // Comments stripped: a note mentioning 'archived' is not a second
    // declaration, and redding on one would be a false red on an intact file.
    expect(stripTsComments(source)).not.toMatch(/'(suspended|archived)'/);
  });
});
