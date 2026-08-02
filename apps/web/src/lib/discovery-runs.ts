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

export type UnauditableApp = {
  auditedAppKey: string;
  createdAt: string;
  capability: string;
};

/**
 * Kinds that ANSWER "can this application be audited".
 *
 * `token_audit_failed` is deliberately not one: a run that could not
 * authenticate says nothing about the connector's capability, and letting it
 * decide would erase a finding rather than update it.
 */
const DECISIVE_KINDS = new Set(['token_audit_completed', 'token_audit_unsupported']);

type EventItem = DiscoveryEventListResponse['items'][number];

/**
 * The newest decisive token-audit event per application.
 *
 * ONE primitive, and both readers below derive from it — which is what makes
 * them disjoint rather than merely asserted to be.
 *
 * An earlier form filtered the event list twice, independently. `discovery_events`
 * has UPDATE and DELETE REVOKEd, so an application that once reported
 * `unsupported` and later completed a run satisfied both filters FOREVER, and
 * `/discovery` would have rendered a results table and "cannot be audited" for
 * the same key. Its docstring claimed the two were disjoint by kind; the test
 * meant to check that used two different application keys, so it could not fail.
 * Both are review findings, and the fix is structural rather than another
 * assertion.
 *
 * `GET /events` is a log ordered newest first, so the first decisive event an
 * application appears in IS its current answer — there is no per-application
 * state anywhere else (`SCT3`).
 */
function newestDecisive(items: DiscoveryEventListResponse['items']): EventItem[] {
  const byApp = new Map<string, EventItem>();

  for (const item of items) {
    if (!DECISIVE_KINDS.has(item.kind)) continue;
    const auditedAppKey = item.payload.auditedAppKey;
    if (typeof auditedAppKey !== 'string' || byApp.has(auditedAppKey)) continue;
    byApp.set(auditedAppKey, item);
  }

  return [...byApp.values()];
}

/**
 * The newest completed run per audited application.
 *
 * Runs the operator has superseded are not shown, and a FAILED run does not
 * replace the last completed one. An `unsupported` event does, because that is
 * a statement about the connector rather than about a run.
 */
export function latestRuns(items: DiscoveryEventListResponse['items']): LatestRun[] {
  return newestDecisive(items)
    .filter((item) => item.kind === 'token_audit_completed')
    .map((item) => ({
      auditedAppKey: item.payload.auditedAppKey as string,
      createdAt: item.createdAt,
      scanned: item.payload.scanned ?? 0,
      failed: item.payload.failed ?? 0,
      applications: item.payload.applications ?? [],
    }));
}

/**
 * Applications whose connector cannot report third-party grants (SC2/C4).
 *
 * Separate from `latestRuns` rather than folded into it: these have no
 * applications, no scanned count and no failure to investigate, so a caller
 * that treated them as a run with zeroes would render "0 applications found" —
 * the claim this exists to avoid making. The page says the question was not
 * asked, and WHICH question, because the two members of this state differ.
 */
export function latestUnauditable(items: DiscoveryEventListResponse['items']): UnauditableApp[] {
  return newestDecisive(items)
    .filter((item) => item.kind === 'token_audit_unsupported')
    .map((item) => ({
      auditedAppKey: item.payload.auditedAppKey as string,
      createdAt: item.createdAt,
      // Falls back to the NARROWER claim. `none` says the provider has no
      // third-party application concept this product can read; saying that of a
      // `workspace-apps` provider is wrong in the direction that hides a
      // capability, which is the safer of the two.
      capability: typeof item.payload.capability === 'string' ? item.payload.capability : 'none',
    }));
}
