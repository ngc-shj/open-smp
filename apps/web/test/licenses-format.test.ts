import { describe, expect, it } from 'vitest';
import { formatMoney, unassignedTone } from '../src/lib/licenses-format';

// C4. Both of these have a plausible wrong version that looks like an
// improvement, which is the only reason they are functions rather than JSX.

describe('formatMoney keeps the scale the column stored', () => {
  // WHAT IS ACTUALLY FALSIFIABLE HERE. The first draft of this block asserted
  // that a value survives "unparsed", using 1234567890.99 and 0.07 — and the
  // mutation that re-parses through `Number(v).toFixed(2)` PASSED it, because
  // every value numeric(14,2) can hold round-trips through a double exactly
  // (14 significant digits fit in one). Those assertions read as coverage of a
  // property they could not fail on.
  //
  // The scale is what a number loses, so the scale is what these pin.
  it.each([
    ['a trailing zero', '10.50', '10.50 USD'],
    ['two trailing zeros', '10.00', '10.00 USD'],
    ['a zero price, which is not the same as no price', '0.00', '0.00 USD'],
    ['a tenth', '0.10', '0.10 USD'],
  ])('keeps %s', (_label, value, expected) => {
    // `String(Number('10.50'))` is '10.5' — the realistic wrong version, and
    // what `{Number(item.unitPrice)}` in the cell would render.
    expect(formatMoney(value, 'USD')).toBe(expected);
  });

  it('renders a figure at the column ceiling without reformatting it', () => {
    expect(formatMoney('999999999999.99', 'JPY')).toBe('999999999999.99 JPY');
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
