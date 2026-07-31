import { describe, expect, it } from 'vitest';
import { formatMoney, unassignedTone } from '../src/lib/licenses-format';

// C4. Both of these have a plausible wrong version that looks like an
// improvement, which is the only reason they are functions rather than JSX.

describe('formatMoney keeps an exact decimal exact', () => {
  it('renders the digits the API sent, unparsed', () => {
    // The failing state: any formatter that takes a number. Number('0.07') *
    // 100 is 7.000000000000001, and `numeric(14,2)` crosses the wire as a
    // string precisely so that never happens.
    expect(formatMoney('1234567890.99', 'JPY')).toBe('1234567890.99 JPY');
    expect(formatMoney('0.07', 'USD')).toBe('0.07 USD');
  });

  it('keeps a trailing zero the column stored', () => {
    // `10.5` and `10.50` are the same number and different figures. A round
    // trip through Number() renders the first.
    expect(formatMoney('10.50', 'USD')).toBe('10.50 USD');
  });

  it('renders the figure alone when no currency is recorded', () => {
    expect(formatMoney('10.00', null)).toBe('10.00');
  });

  it('renders an em dash for no figure at all', () => {
    // Not '0': an application with no contract has no price, which is a
    // different fact from a price of zero.
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney(null, null)).toBe('—');
  });
});

describe('unassignedTone separates three states', () => {
  it.each([
    ['a spare seat', 5, 'plain'],
    ['exactly no spare seats', 0, 'plain'],
    ['one seat over', -1, 'over-allocated'],
    ['no contract at all', null, 'absent'],
  ])('reads %s as %s', (_label, value, expected) => {
    expect(unassignedTone(value)).toBe(expected);
  });

  it('does not fold "no contract" into "no spare seats"', () => {
    // The two render identically under any `value ?? 0`, and one of them is an
    // invented figure.
    expect(unassignedTone(null)).not.toBe(unassignedTone(0));
  });

  it('does not fold over-allocation into zero', () => {
    // Clamping is the mutation C3's own acceptance case reds on; this is the
    // same claim at the rendering tier.
    expect(unassignedTone(-3)).not.toBe(unassignedTone(0));
  });
});
