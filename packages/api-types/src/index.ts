// Single source of truth for the C6 API wire shapes shared between
// apps/api (producer) and apps/web (consumer). Type-only — no runtime
// exports — so importing this package never pulls server code into the
// web bundle (C8 invariant).

export type LinkStatus = 'matched' | 'orphan' | 'ghost' | 'ambiguous';

export type AccountLink = {
  status: string;
  confidence: number;
  ruleId: string | null;
  identityId: string | null;
  identityName: string | null;
  evidence: {
    rule: string;
    matchedValue: string;
    candidates?: { identityId: string; displayName: string }[];
  } | null;
};

export type AccountLabelKind = 'known_shared' | 'service_account' | 'external_collaborator';

export type AccountLabel = { kind: AccountLabelKind; note: string | null };

export type AccountLabelResponse = { accountId: string; kind: AccountLabelKind; note: string | null };

export type AccountListItem = {
  accountId: string;
  appKey: string;
  appName: string;
  email: string | null;
  displayName: string | null;
  accountStatus: string;
  isAdmin: boolean;
  lastActivityAt: string | null;
  lastSyncedAt: string;
  link: AccountLink | null;
  label: AccountLabel | null;
};

export type AccountListResponse = {
  items: AccountListItem[];
  nextCursor: string | null;
};

export type DiscoveryEventListItem = {
  id: string;
  source: string;
  kind: string;
  payload: { counts?: object; runId?: string };
  createdAt: string;
};

export type DiscoveryEventListResponse = {
  items: DiscoveryEventListItem[];
  nextCursor: string | null;
};

export type JobState = {
  state: string;
  result: unknown;
};

// hr-import response (C6). Single-sourced here per D6; imported by
// apps/api/src/routes/hr-import.ts. `warnings` carries non-fatal per-row
// notices (e.g. duplicate employee_id overwrote an earlier row).
export type ImportRowIssue = { row: number; message: string };

export type HrImportResponse = {
  imported: number;
  skipped: number;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
};

export type SaasAppListItem = { id: string; key: string; displayName: string };

export type SaasAppListResponse = { items: SaasAppListItem[] };

export type SaasAppCreateResponse = { id: string; key: string; displayName: string };
