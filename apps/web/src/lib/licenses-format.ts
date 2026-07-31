// The rendering decisions on /licenses that have a failing state, kept out of
// the page so they can be asserted without a browser. What stays in the page is
// markup; what lives here is every place a plausible "improvement" would be
// wrong.

/**
 * Money, as the digits the API sent.
 *
 * `unitPrice` and `reclaimableValue` are `numeric(14,2)` and cross the wire as
 * STRINGS precisely so no JavaScript number rounds them. Any formatter that
 * takes a number — `Number(value).toFixed(2)`, `Intl.NumberFormat`, a currency
 * format — puts an exact decimal back through an IEEE 754 double, which is the
 * error the column type exists to prevent. That is why the currency code goes
 * BESIDE the figure instead of into it.
 */
export function formatMoney(value: string | null, currency: string | null): string {
  if (value === null) {
    return '—';
  }
  return currency ? `${value} ${currency}` : value;
}

export type UnassignedTone = 'absent' | 'over-allocated' | 'plain';

/**
 * How `unassigned` reads.
 *
 * Three states, not two. `null` is "this application has no contract", which is
 * not the same fact as "no seats are spare" — reporting either as `0` invents a
 * figure. And a negative value is not an error to clamp: `purchased - assigned`
 * is left unclamped by C3 because "we bought 10 and 12 people are using it" is
 * a real answer, and it is the one this screen exists to make loud.
 */
export function unassignedTone(value: number | null): UnassignedTone {
  if (value === null) {
    return 'absent';
  }
  return value < 0 ? 'over-allocated' : 'plain';
}
