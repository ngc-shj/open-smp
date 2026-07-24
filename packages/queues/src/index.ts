export const SYNC_QUEUE = 'sync-saas';
export const MATCH_QUEUE = 'match-links';

export type SyncJobData = { tenantId: string; saasAppId: string };
export type MatchJobData = { tenantId: string };
export type SyncJobResult = { upserted: number; runId: string };
export type MatchJobResult = { links: number; runId: string };

// jobId dedupes identical active jobs per C5 (concurrency 1 per queue per tenant).
export function syncJobId(tenantId: string, saasAppId: string): string {
  return `${SYNC_QUEUE}:${tenantId}:${saasAppId}`;
}
export function matchJobId(tenantId: string): string {
  return `${MATCH_QUEUE}:${tenantId}:`;
}
