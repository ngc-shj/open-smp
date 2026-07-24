// Single-sourced from @open-smp/api-types (type-only import — no runtime
// code enters the web bundle, so the C8 "API is the only data path"
// invariant is untouched). Re-exported here so existing imports of
// '@/lib/api-types' keep working unchanged.

export type {
  LinkStatus,
  AccountLink,
  AccountListItem,
  AccountListResponse,
  DiscoveryEventListItem,
  DiscoveryEventListResponse,
  JobState,
} from '@open-smp/api-types';
