import { describe, expect, it } from 'vitest';
import { ACCOUNT_LABEL_KINDS } from '@open-smp/api-types';
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

  it('link_status matches the C1 contract', () => {
    expect(linkStatusEnum.enumValues).toEqual(['matched', 'orphan', 'ghost', 'ambiguous']);
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
