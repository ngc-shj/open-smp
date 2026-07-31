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

/** How much of an application's account set the matcher has decided. */
export type LicenseMatchState = 'no-accounts' | 'not-matched' | 'partially-matched' | 'matched';

export type LicenseRollupItem = {
  appKey: string;
  appName: string;
  /** Derived from credentials presence, not from connector support. */
  hasConnector: boolean;
  matchState: LicenseMatchState;
  planName: string | null;
  /** numeric(14,2) as the string pg returns; a JSON number would round it. */
  unitPrice: string | null;
  currency: string | null;
  billingCycle: BillingCycle | null;
  termStart: string | null;
  termEnd: string | null;
  purchased: number | null;
  assigned: number;
  /** purchased - assigned; negative means over-allocation and is never clamped. */
  unassigned: number | null;
  needsReview: number;
  unlinked: number;
  reclaimable: { ghost: number; orphan: number; total: number };
  reclaimableValue: string | null;
  /** The period reclaimableValue is expressed in; two rows with different periods are not comparable. */
  reclaimableValuePeriod: BillingCycle | null;
};

export type LicenseListResponse = { items: LicenseRollupItem[] };

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

// The audit family C2 adds. Separate from LABEL_AUDIT_KINDS rather than folded
// into it because the two carry different payload fields, and the events
// projection allowlists per family — merging them would let a label event
// project a contract event's fields and the reverse.
export const CONTRACT_AUDIT_KINDS = Object.freeze(['contract_import'] as const);

export type ContractAuditKind = (typeof CONTRACT_AUDIT_KINDS)[number];

export function isContractAuditKind(value: string): value is ContractAuditKind {
  return (CONTRACT_AUDIT_KINDS as readonly string[]).includes(value);
}

// `discovery_events.source` values the PRODUCT writes. Every other source value
// is a `saas_apps.key`, written by sync — so a tenant that could register an
// application under one of these keys would emit sync rows indistinguishable
// from the product's own audit family under `?source=`, and sync payloads carry
// connector-supplied content. These three are therefore the reserved key set
// that every write path to `saas_apps.key` must refuse.
//
// Declared here, as scalars, and imported by every writer — apps/api's audit
// module, apps/worker's matcher, and the contract import. The set is only a
// true derivation of "what the code writes" while the writers hold no literal
// of their own; saas-app-key-pin.test.ts is what keeps that so.
export const LABEL_EVENT_SOURCE = 'label';
export const MATCH_EVENT_SOURCE = 'matcher';
export const CONTRACT_EVENT_SOURCE = 'contract';

export const RESERVED_EVENT_SOURCES = Object.freeze([
  LABEL_EVENT_SOURCE,
  MATCH_EVENT_SOURCE,
  CONTRACT_EVENT_SOURCE,
] as const);

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
  // contract_import. `createdAppKeys` is the security-relevant fact — which
  // catalog rows the upload brought into existence — and it is bounded by the
  // per-tenant application ceiling, not by the row count.
  imported?: number;
  skipped?: number;
  createdAppKeys?: string[];
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

// contract-import response (C2). `createdApps` names the saas_apps rows the
// upload created, because a contract CSV is the only path that writes the
// application catalog without naming a connector.
export type ContractImportResponse = {
  imported: number;
  skipped: number;
  createdApps: string[];
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
};

// SC37. Both import routes bound the multipart body at this size, and the
// upload form refuses a larger file before sending it — three sites that were
// hand-synced comments until C39's gate was widened to admit a scalar. The
// user-facing "max 10MB" strings are still literals: they are asserted by an
// E2E spec and by the manual-test doc, so deriving them is a separate change.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// The row caps cross for the same reason the byte cap does, and for one more:
// each route's over-limit error message INTERPOLATES its cap, and the upload
// forms key their friendlier copy off that exact string. A hand-written key
// stops matching the moment a cap moves, and the page falls back to generic
// copy — a silent degradation, in the one place that explains a refusal.
//
// Named for their subjects. `MAX_SAAS_APPS_PER_TENANT` and `MAX_IMPORT_ERRORS`
// stay server-side in apps/api: nothing in the browser bounds either.
export const HR_IMPORT_MAX_ROWS = 20_000;

export const CONTRACT_IMPORT_MAX_ROWS = 2_000;

export type SaasAppListItem = { id: string; key: string; displayName: string };

export type SaasAppListResponse = { items: SaasAppListItem[] };

export type SaasAppCreateResponse = { id: string; key: string; displayName: string };
