import { describe, expect, it } from 'vitest';
import { ACCOUNT_LABEL_KINDS } from '@open-smp/api-types';
import { LABEL_FILTERS, LABEL_KINDS } from '../src/label-kinds.js';

// C29 acceptance criterion 5. LABEL_FILTERS is the accounts-filter domain
// (`z.enum(LABEL_FILTERS)` at routes/accounts.ts), and after C29 it is derived
// from ACCOUNT_LABEL_KINDS rather than from a local literal.
//
// Two directions matter and only one is obvious. A kind missing from
// LABEL_FILTERS makes it settable but not filterable — the failure
// label-kinds.ts has warned about in prose since cycle 1. The other direction
// is what the derivation newly makes possible: 'none' and 'any' are filter-only
// pseudo-kinds, predicates over a LEFT JOIN and never values in the column, so
// a refactor that let either leak back into ACCOUNT_LABEL_KINDS would make them
// storable. Nothing else checks that — the projection test iterates
// ACCOUNT_LABEL_KINDS and would pass unchanged if 'none' joined it.

describe('C29 acceptance: LABEL_FILTERS derives from the domain without widening it', () => {
  it('re-exports the domain unchanged', () => {
    expect([...LABEL_KINDS]).toEqual([...ACCOUNT_LABEL_KINDS]);
  });

  it('is the domain plus exactly the two filter-only pseudo-kinds', () => {
    expect([...LABEL_FILTERS]).toEqual([
      'known_shared',
      'service_account',
      'external_collaborator',
      'none',
      'any',
    ]);
  });

  it('keeps the pseudo-kinds out of the storable domain', () => {
    expect(ACCOUNT_LABEL_KINDS).not.toContain('none');
    expect(ACCOUNT_LABEL_KINDS).not.toContain('any');
  });
});
