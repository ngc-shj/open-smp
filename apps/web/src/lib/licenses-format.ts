// The rendering decisions on /licenses that have a failing state, kept out of
// the page so they can be asserted without a browser. What stays in the page is
// markup; what lives here is every place a plausible "improvement" would be
// wrong.

/**
 * Money, as the digits the API sent.
 *
 * `unitPrice` and `reclaimableValue` are `numeric(14,2)` and cross the wire as
 * STRINGS. What that buys at THIS boundary is the scale, not the value:
 * measured, every value the column can hold round-trips through a double
 * exactly, because 14 significant digits fit inside one. `Number(v).toFixed(2)`
 * returns v for all of them — an earlier draft of this comment claimed
 * otherwise, and the mutation that should have failed passed instead.
 *
 * What a number DOES lose is the trailing zero: `String(Number('10.50'))` is
 * `'10.5'` and `String(Number('0.00'))` is `'0'`, and that is the realistic
 * edit — `{Number(item.unitPrice)}` in the cell. A price of 10.5 is a price
 * rendered wrong, and `0` where the contract says `0.00` reads as "not priced"
 * rather than "free".
 *
 * The value argument still holds one step out: `numeric` is exact under
 * ARITHMETIC and a double is not, which is why C3 computes reclaimableValue in
 * SQL. Nothing here does arithmetic, and the currency code goes beside the
 * figure rather than into it so that nothing here needs to.
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
