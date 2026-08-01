// Relative imports, not the `@/` alias: this module is unit-tested and the root
// vitest project resolves no alias. Same reason as label-kinds.ts and
// csv-export.ts.
import { ACCOUNT_LABEL_KINDS, type AccountLabelKind } from './api-types';
import { LABEL_KIND_KEYS } from './label-kinds';
import type { MessageKey } from './i18n/messages';

export type LabelFilterValue = AccountLabelKind | 'none' | 'any';

/**
 * The accounts filter bar's options, in render order.
 *
 * Lives in a `.ts` module rather than beside the component because the vitest
 * unit project cannot transform `.tsx` (apps/web/tsconfig.json sets
 * `jsx: preserve`), and the rendered order is the thing worth pinning: the E2E
 * spec selects the label control by combobox value and never asserts the bar's
 * order, so without a unit test a reordering or a dropped option would ship
 * green.
 *
 * The three kind rows derive from the domain; the two pseudo-kinds and the
 * leading "All" do not, because they are not kinds. `null` clears the filter
 * and is the only way back to an unfiltered list.
 */
export const LABEL_FILTER_OPTIONS: readonly {
  value: LabelFilterValue | null;
  labelKey: MessageKey;
}[] = [
  { value: null, labelKey: 'labelFilter.all' },
  { value: 'none', labelKey: 'labelFilter.none' },
  { value: 'any', labelKey: 'labelFilter.any' },
  ...ACCOUNT_LABEL_KINDS.map((value) => ({ value, labelKey: LABEL_KIND_KEYS[value] })),
];

/**
 * The values a `?label=` query parameter may take. Membership only — the order
 * is unobservable, since the sole use is an `includes` check.
 */
export const LABEL_FILTER_VALUES: readonly LabelFilterValue[] = [
  'none',
  'any',
  ...ACCOUNT_LABEL_KINDS,
];
