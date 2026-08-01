import type { DiscoveredApplication, DiscoveryEventListResponse } from './api-types';

// SC3/C4. The selection lives here rather than in the page for the reason
// licenses-format.ts does: a page module imports next/headers through
// api-server, so nothing in it can be unit-tested, and every way of getting
// this selection wrong is silent — each produces a plausible table.

type LatestRun = {
  auditedAppKey: string;
  createdAt: string;
  scanned: number;
  failed: number;
  applications: DiscoveredApplication[];
};

/**
 * The newest completed run per audited application.
 *
 * `GET /events` is a log ordered newest first, and there is no per-application
 * "current state" anywhere (`SCT3`) — so the current state IS the first event
 * each application appears in. Runs the operator has superseded are not shown,
 * and a failed run does not replace the last completed one: reporting "0
 * applications" because the most recent attempt could not authenticate would
 * erase a finding rather than update it.
 */
export function latestRuns(items: DiscoveryEventListResponse['items']): LatestRun[] {
  const byApp = new Map<string, LatestRun>();

  for (const item of items) {
    if (item.kind !== 'token_audit_completed') continue;
    const auditedAppKey = item.payload.auditedAppKey;
    if (typeof auditedAppKey !== 'string' || byApp.has(auditedAppKey)) continue;

    byApp.set(auditedAppKey, {
      auditedAppKey,
      createdAt: item.createdAt,
      scanned: item.payload.scanned ?? 0,
      failed: item.payload.failed ?? 0,
      applications: item.payload.applications ?? [],
    });
  }

  return [...byApp.values()];
}
