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

export type UnauditableApp = {
  auditedAppKey: string;
  createdAt: string;
  capability: string;
};

/**
 * Applications whose connector cannot report third-party grants (SC2/C4).
 *
 * Separate from `latestRuns` rather than folded into it: these have no
 * applications, no scanned count and no failure to investigate, so a caller
 * that treated them as a run with zeroes would render "0 applications found"
 * — which is the claim this exists to avoid making. The page states that the
 * question was not asked.
 *
 * Same newest-first selection as `latestRuns`, and the two are disjoint by
 * event kind, so an application appearing in both would mean a connector that
 * reported grants and then declared it could not.
 */
export function latestUnauditable(items: DiscoveryEventListResponse['items']): UnauditableApp[] {
  const byApp = new Map<string, UnauditableApp>();

  for (const item of items) {
    if (item.kind !== 'token_audit_unsupported') continue;
    const auditedAppKey = item.payload.auditedAppKey;
    if (typeof auditedAppKey !== 'string' || byApp.has(auditedAppKey)) continue;

    byApp.set(auditedAppKey, {
      auditedAppKey,
      createdAt: item.createdAt,
      capability: typeof item.payload.capability === 'string' ? item.payload.capability : 'none',
    });
  }

  return [...byApp.values()];
}
