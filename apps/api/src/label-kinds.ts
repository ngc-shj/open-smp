// Single source for the label-kind domain, shared by the two label-writing
// endpoints and the accounts filter (R2). The list is the validator's domain,
// so a fourth kind added to the DB enum and to AccountLabelKind must be added
// here once rather than in three route files — a copy missed in accounts.ts
// would make the new kind settable but not filterable, with nothing failing.
export const LABEL_KINDS = ['known_shared', 'service_account', 'external_collaborator'] as const;

// 'none' (no label row) and 'any' (some label row) are filter-only pseudo-kinds:
// they are predicates over the LEFT JOIN, never values stored in the column.
export const LABEL_FILTERS = [...LABEL_KINDS, 'none', 'any'] as const;
