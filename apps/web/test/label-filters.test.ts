import { describe, expect, it } from 'vitest';
import { ACCOUNT_LABEL_KINDS } from '../src/lib/api-types';
import { LABEL_FILTER_OPTIONS, LABEL_FILTER_VALUES } from '../src/lib/label-filters';

// I37.3. The filter bar's options are derived from the domain, so this is what
// stops the derivation from changing what an operator sees. The E2E spec picks
// the label control by combobox value and never asserts the bar's order, so
// without this a reordering or a dropped option ships green.

describe('the accounts filter bar renders the same options in the same order', () => {
  it('is All, the two pseudo-kinds, then the three label kinds', () => {
    expect(LABEL_FILTER_OPTIONS).toEqual([
      { value: null, label: 'All' },
      { value: 'none', label: 'Unlabeled' },
      { value: 'any', label: 'Any label' },
      { value: 'known_shared', label: 'Known shared' },
      { value: 'service_account', label: 'Service account' },
      { value: 'external_collaborator', label: 'External collaborator' },
    ]);
  });

  // The leading entry is the only control that clears the filter. Neither of
  // the arrays being derived from contains it, so a naive "spread the domain"
  // rewrite would drop it and leave no way back to an unfiltered list.
  it('leads with the null option that clears the filter', () => {
    expect(LABEL_FILTER_OPTIONS[0]).toEqual({ value: null, label: 'All' });
    expect(LABEL_FILTER_OPTIONS.filter((o) => o.value === null)).toHaveLength(1);
  });

  it('renders one option per label kind, and no more', () => {
    const kindOptions = LABEL_FILTER_OPTIONS.filter(
      (o) => o.value !== null && o.value !== 'none' && o.value !== 'any',
    );

    expect(kindOptions.map((o) => o.value)).toEqual([...ACCOUNT_LABEL_KINDS]);
  });
});

describe('the ?label= membership predicate accepts the domain plus the pseudo-kinds', () => {
  it('accepts every label kind', () => {
    for (const kind of ACCOUNT_LABEL_KINDS) {
      expect(LABEL_FILTER_VALUES).toContain(kind);
    }
  });

  it('accepts the two filter-only pseudo-kinds', () => {
    expect(LABEL_FILTER_VALUES).toContain('none');
    expect(LABEL_FILTER_VALUES).toContain('any');
  });

  // The pseudo-kinds are predicates over a LEFT JOIN, never values stored in
  // the column — so they must not leak back into the storable domain.
  it('does not let the pseudo-kinds into the label-kind domain', () => {
    expect(ACCOUNT_LABEL_KINDS).not.toContain('none');
    expect(ACCOUNT_LABEL_KINDS).not.toContain('any');
  });

  it('carries no value that is neither a kind nor a pseudo-kind', () => {
    expect(LABEL_FILTER_VALUES).toHaveLength(ACCOUNT_LABEL_KINDS.length + 2);
  });
});
