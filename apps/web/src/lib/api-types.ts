// Single-sourced from @open-smp/api-types, re-exported here so existing
// imports of '@/lib/api-types' keep working unchanged.
//
// This barrel is type-only. The upstream package is no longer (C29 added
// ACCOUNT_LABEL_KINDS as a value), but the C8 "API is the only data path"
// invariant is untouched either way: a frozen string array is data, not a
// path. If a future change needs that value in apps/web, re-export it here
// rather than importing @open-smp/api-types directly, so this stays the one
// place shared types and values cross into the web app.

export type {
  LinkStatus,
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
