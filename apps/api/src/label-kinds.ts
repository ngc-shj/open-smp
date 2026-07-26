// The label-kind domain now lives in @open-smp/api-types (C29), so the API's
// validators and the wire type cannot disagree about what a kind is. This
// module keeps the name its three importers already use, plus LABEL_FILTERS,
// which is API-only.
//
// A separate value import is required as well as the re-export: `export { X }
// from '...'` does not bind X in local scope, so LABEL_FILTERS below could not
// spread it.
import { ACCOUNT_LABEL_KINDS } from '@open-smp/api-types';

export { ACCOUNT_LABEL_KINDS as LABEL_KINDS } from '@open-smp/api-types';

// 'none' (no label row) and 'any' (some label row) are filter-only pseudo-kinds:
// they are predicates over the LEFT JOIN, never values stored in the column.
export const LABEL_FILTERS = [...ACCOUNT_LABEL_KINDS, 'none', 'any'] as const;
