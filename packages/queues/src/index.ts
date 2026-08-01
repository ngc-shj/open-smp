export const SYNC_QUEUE = 'sync-saas';
export const MATCH_QUEUE = 'match-links';

// SC3/C2. Its OWN queue rather than a phase of sync, for three measured
// reasons: its input is `saas_accounts` and not the connector's user stream, so
// it can run without re-syncing; it fails PARTIALLY, which sync's
// all-or-nothing transaction cannot express; and it holds no transaction across
// its HTTP fan-out, which a phase inside runSync's `withTenant` would.
export const TOKEN_AUDIT_QUEUE = 'audit-tokens';

export type SyncJobData = { tenantId: string; saasAppId: string };
export type MatchJobData = { tenantId: string };
export type TokenAuditJobData = { tenantId: string; saasAppId: string };
export type SyncJobResult = { upserted: number; runId: string };
export type MatchJobResult = { links: number; runId: string };
/**
 * `scanned` and `failed` are both reported because a run that read 900 of 1000
 * accounts is neither a success nor a failure, and this is the first job in the
 * codebase that can be in that state.
 */
export type TokenAuditJobResult = {
  runId: string;
  scanned: number;
  failed: number;
  applications: number;
};

// jobId dedupes identical active jobs per C5 (concurrency 1 per queue per tenant).
export function syncJobId(tenantId: string, saasAppId: string): string {
  return `${SYNC_QUEUE}:${tenantId}:${saasAppId}`;
}
export function matchJobId(tenantId: string): string {
  return `${MATCH_QUEUE}:${tenantId}:`;
}
export function tokenAuditJobId(tenantId: string, saasAppId: string): string {
  return `${TOKEN_AUDIT_QUEUE}:${tenantId}:${saasAppId}`;
}
