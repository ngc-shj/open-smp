// Single-sourced from @open-smp/api-types, re-exported here so existing
// imports of '@/lib/api-types' keep working unchanged.
//
// Mostly types, plus the few runtime values apps/web genuinely needs — C29
// added ACCOUNT_LABEL_KINDS upstream, and isLabelAuditKind crosses here. The
// C8 "API is the only data path" invariant is untouched: a frozen string array
// and a predicate over it are data, not a path. A future value belongs here
// too, re-exported rather than imported from @open-smp/api-types directly, so
// this stays the one place shared types and values cross into the web app.

// The values that cross into apps/web (see the note above). isLabelAuditKind
// lets the events page tell a sync event's missing audit fields apart from an
// audit event whose fields the API withheld as corrupt; ACCOUNT_LABEL_KINDS is
// what the accounts filter bar derives its options from instead of re-listing
// them.
//
// LINK_STATUSES has no runtime consumer in apps/web yet — the chip-class map is
// keyed by the `LinkStatus` *type*, which crosses in the type block below. It is
// re-exported here anyway, because the policy above is that a shared value
// crosses at this one place: a guard like isAccountLabelKind is the consumer
// this anticipates, and leaving it out is what pushes the next one into
// importing @open-smp/api-types directly.
export {
  ACCOUNT_LABEL_KINDS,
  CONTRACT_IMPORT_MAX_ROWS,
  HR_IMPORT_MAX_ROWS,
  LINK_STATUSES,
  MAX_UPLOAD_BYTES,
  isLabelAuditKind,
} from '@open-smp/api-types';

export type {
  LinkStatus,
  BillingCycle,
  LicenseMatchState,
  LicenseRollupItem,
  LicenseListResponse,
  ContractImportResponse,
  AccountLink,
  AccountLabelKind,
  AccountLabel,
  AccountLabelResponse,
  AccountListItem,
  AccountListResponse,
  IdentityAccountItem,
  IdentityDetailResponse,
  DiscoveryEventPayload,
  DiscoveryEventListItem,
  DiscoveryEventListResponse,
  JobState,
  ImportRowIssue,
  HrImportResponse,
  SaasAppListItem,
  SaasAppListResponse,
  SaasAppCreateResponse,
} from '@open-smp/api-types';
