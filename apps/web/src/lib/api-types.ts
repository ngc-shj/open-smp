// Types mirror the C6 API contract (apps/api). Copied here deliberately —
// apps/web has no dependency on any @open-smp/* server package (C8 forbidden
// pattern: no drizzle / server-package import). This is the only source of
// truth for shapes on the web side; keep in sync with apps/api/src/routes.

export type LinkStatus = 'matched' | 'orphan' | 'ghost' | 'ambiguous';

export type AccountLink = {
  status: string;
  confidence: number;
  ruleId: string | null;
  identityId: string | null;
  identityName: string | null;
  evidence: { rule: string; matchedValue: string; candidates?: string[] } | null;
};

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
