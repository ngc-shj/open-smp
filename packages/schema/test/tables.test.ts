import { describe, expect, it } from 'vitest';
import {
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
});

describe('tenant-scoped table member set', () => {
  it('contains exactly the 7 tables from the C1 member-set derivation (tenants excluded)', () => {
    expect(Object.keys(tenantScopedTables).sort()).toEqual(
      [
        'identities',
        'saasApps',
        'saasAccounts',
        'accountLinks',
        'discoveryEvents',
        'users',
        'sessions',
      ].sort(),
    );
  });
});
