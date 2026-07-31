// Single source of truth for the C6 API wire shapes shared between
// apps/api (producer) and apps/web (consumer).
//
// C8 as amended by C29: this package may export frozen primitive domain
// constants and the type guards over them, but no functions with I/O, no
// imports from apps/*, and no server-only modules. The property C8 protects —
// "the API is the only data path" — is preserved because a string array is
// data, not a path. It was previously stated as "type-only, no runtime
// exports", which C29 makes false: ACCOUNT_LABEL_KINDS below is a value.

// Declaration order is the Postgres enum's order (migration 0001_init.sql:7),
// not the accounts page's tab order — the two differ, and the migration's has
// shipped, so a Postgres enum's declaration order IS its sort order and cannot
// be changed. The tab order stays a separate hand-written list in apps/web.
//
// Frozen for the same reason as ACCOUNT_LABEL_KINDS below: `as const` is erased
// at runtime, and the C39 boundary gate requires every array this package
// exports to be frozen. Note the freeze does NOT protect z.enum() — that
// snapshots its members at construction — but it is what keeps a live-read
// guard (isAccountLabelKind's shape) honest if one is added here later.
export const LINK_STATUSES = Object.freeze([
  'matched',
  'orphan',
  'ghost',
  'ambiguous',
] as const);

export type LinkStatus = (typeof LINK_STATUSES)[number];

// Frozen for the same reason as LINK_STATUSES. Declaration order is the
// Postgres enum's sort order, so it must match migrations/0006_saas_contracts.sql.
export const BILLING_CYCLES = Object.freeze(['monthly', 'annual'] as const);

export type BillingCycle = (typeof BILLING_CYCLES)[number];

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

// The list is the value and the type derives from it, not the other way round:
// a runtime member-set is what the events projection needs to validate a stored
// payload's kind (C29/I29.1), and deriving the type guarantees the check and
// the claim cannot disagree. Adding a kind here still needs a migration — the
// DB enum is a separate copy by necessity, pinned by I29.4's pg_enum test.
// Frozen, not merely `as const`. The assertion is compile-time only: without
// the freeze, `ACCOUNT_LABEL_KINDS.push('anything')` succeeds at runtime and
// isAccountLabelKind starts returning true for it — and that guard is what the
// events projection uses to refuse an out-of-domain kind into the audit union,
// while the same array backs z.enum() in both label-write routes. Widening it
// widens both.
export const ACCOUNT_LABEL_KINDS = Object.freeze([
  'known_shared',
  'service_account',
  'external_collaborator',
] as const);

export type AccountLabelKind = (typeof ACCOUNT_LABEL_KINDS)[number];

// The audit family of discovery_events.kind. Shared rather than API-local
// because both sides must agree on which events carry audit fields: the API
// decides whether to project them, and the web app decides whether their
// absence means "this is a sync event" or "this audit event is corrupt".
// Deciding that from the payload alone conflates the two.
export const LABEL_AUDIT_KINDS = Object.freeze(['label_set', 'label_cleared'] as const);

export type LabelAuditKind = (typeof LABEL_AUDIT_KINDS)[number];

export function isLabelAuditKind(value: string): value is LabelAuditKind {
  return (LABEL_AUDIT_KINDS as readonly string[]).includes(value);
}

export function isAccountLabelKind(value: unknown): value is AccountLabelKind {
  return (
    typeof value === 'string' && (ACCOUNT_LABEL_KINDS as readonly string[]).includes(value)
  );
}

export type IdentityAccountItem = {
  accountId: string;
  appKey: string;
  appName: string;
  email: string | null;
  displayName: string | null;
  accountStatus: string;
  isAdmin: boolean;
  lastActivityAt: string | null;
  // Non-nullable because the query is driven FROM account_links: an account
  // only appears here when it has a link row. account_links has UNIQUE
  // (tenant_id, saas_account_id), so the join yields at most one row per
  // account (C18/I18.4).
  linkStatus: string;
  confidence: number;
  label: AccountLabel | null;
};

export type IdentityDetailResponse = {
  identityId: string;
  employeeId: string;
  primaryEmail: string;
  secondaryEmails: string[];
  displayName: string;
  status: 'active' | 'left';
  leftAt: string | null;
  accounts: IdentityAccountItem[];
  // The page cannot distinguish "exactly 50 accounts" from "the list was cut
  // off" by length alone, so the cap is reported explicitly (C18/I18.5).
  accountsTruncated: boolean;
};

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

// One open shape with every field optional, rather than a union discriminated
// on `kind`. Two reasons: `kind` is a plain string (narrowing it would make the
// four raw-SQL worker emitters members of a closed class nothing links them to),
// and a union payload would stop `event.payload.counts` compiling on the events
// page. The type is not the guard — projectPayload's per-kind allowlist is, and
// it is tested per kind (C21).
export type DiscoveryEventPayload = {
  counts?: object;
  runId?: string;
  actorUserId?: string;
  saasAccountId?: string;
  before?: { kind: AccountLabelKind; note: string | null } | null;
  after?: { kind: AccountLabelKind; note: string | null } | null;
};

export type DiscoveryEventListItem = {
  id: string;
  source: string;
  kind: string;
  payload: DiscoveryEventPayload;
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
