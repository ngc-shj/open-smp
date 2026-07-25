// Single-sourced from @open-smp/api-types (type-only import — no runtime
// code enters the web bundle, so the C8 "API is the only data path"
// invariant is untouched). Re-exported here so existing imports of
// '@/lib/api-types' keep working unchanged.

export type {
  LinkStatus,
  AccountLink,
  AccountLabelKind,
  AccountLabel,
  AccountLabelResponse,
  AccountListItem,
  AccountListResponse,
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
