import { describe, expect, it } from 'vitest';
import { ACCOUNT_STATUSES } from '@open-smp/api-types';
import { matchAccounts } from '../src/match.js';
import { defaultRules } from '../src/rules.js';
import type { AccountView, IdentityView } from '../src/types.js';

function makeIdentity(seed: number): IdentityView {
  const left = seed % 4 === 0;
  return {
    id: `identity-${seed}`,
    primaryEmail: `person${seed}@example.com`,
    secondaryEmails: seed % 3 === 0 ? [`person${seed}.old@example.com`] : [],
    displayName: `Person ${seed}`,
    status: left ? 'left' : 'active',
    leftAt: left ? '2026-01-01' : null,
  };
}

function makeAccount(seed: number): AccountView {
  // Interleave patterns: exact match, aliased match, secondary-email match,
  // name-domain match, and pure orphans, across a range of seeds.
  const accountStatus = ACCOUNT_STATUSES[seed % ACCOUNT_STATUSES.length] ?? 'active';

  if (seed % 5 === 0) {
    return {
      id: `account-${seed}`,
      email: `person${seed}@example.com`,
      displayName: `Person ${seed}`,
      accountStatus,
    };
  }
  if (seed % 5 === 1) {
    return {
      id: `account-${seed}`,
      email: `person${seed}+tag@example.com`,
      displayName: `Person ${seed}`,
      accountStatus,
    };
  }
  if (seed % 5 === 2) {
    return {
      id: `account-${seed}`,
      email: `person${seed}.old@example.com`,
      displayName: `Person ${seed}`,
      accountStatus,
    };
  }
  if (seed % 5 === 3) {
    return {
      id: `account-${seed}`,
      email: `p${seed}.alt@example.com`,
      displayName: `Person ${seed}`,
      accountStatus,
    };
  }
  return {
    id: `account-${seed}`,
    email: `nobody-${seed}@unrelated.org`,
    displayName: `Nobody ${seed}`,
    accountStatus,
  };
}

const SAMPLE_SIZES = [0, 1, 2, 5, 13, 30];

describe('matchAccounts properties', () => {
  for (const size of SAMPLE_SIZES) {
    describe(`with ${size} identities and accounts`, () => {
      const identities = Array.from({ length: size }, (_, i) => makeIdentity(i));
      const accounts = Array.from({ length: size }, (_, i) => makeAccount(i));

      it('returns exactly one result per input account, no drops or duplicates', () => {
        const results = matchAccounts(identities, accounts, defaultRules);
        expect(results).toHaveLength(accounts.length);

        const resultAccountIds = results.map((result) => result.saasAccountId).sort();
        const inputAccountIds = accounts.map((acc) => acc.id).sort();
        expect(resultAccountIds).toEqual(inputAccountIds);
      });

      it('identityId is null if and only if status is orphan or ambiguous', () => {
        const results = matchAccounts(identities, accounts, defaultRules);
        for (const result of results) {
          const isNullEligibleStatus = result.status === 'orphan' || result.status === 'ambiguous';
          expect(result.identityId === null).toBe(isNullEligibleStatus);
        }
      });

      it('is deterministic across repeated runs on the same input', () => {
        const first = matchAccounts(identities, accounts, defaultRules);
        const second = matchAccounts(identities, accounts, defaultRules);
        expect(second).toEqual(first);
      });
    });
  }

  it('handles duplicate-HR-row style ambiguity without dropping the account', () => {
    const identities: IdentityView[] = [
      { id: 'dup-1', primaryEmail: 'shared@example.com', secondaryEmails: [], displayName: 'Shared A', status: 'active', leftAt: null },
      { id: 'dup-2', primaryEmail: 'shared@example.com', secondaryEmails: [], displayName: 'Shared B', status: 'active', leftAt: null },
    ];
    const accounts: AccountView[] = [
      { id: 'acc-shared', email: 'shared@example.com', displayName: 'Shared', accountStatus: 'active' },
    ];

    const results = matchAccounts(identities, accounts, defaultRules);
    expect(results).toHaveLength(1);
    expect(results[0]?.identityId).toBeNull();
    expect(results[0]?.status).toBe('ambiguous');
  });
});
