import { describe, expect, it } from 'vitest';
import { latestRuns, latestUnauditable } from '../src/lib/discovery-runs';
import type { DiscoveryEventListItem } from '../src/lib/api-types';

// SC3/C4. `GET /events` is a log and there is no per-application current state
// anywhere (SCT3), so "what is true now" is a selection over that log — and
// every way of getting the selection wrong is silent, because each produces a
// plausible table.

function event(overrides: Partial<DiscoveryEventListItem> = {}): DiscoveryEventListItem {
  return {
    id: 'e1',
    source: 'token-audit',
    kind: 'token_audit_completed',
    createdAt: '2026-08-01T00:00:00.000Z',
    payload: { auditedAppKey: 'google-workspace', scanned: 4, failed: 0, applications: [] },
    ...overrides,
  };
}

describe('latestRuns picks what is true now', () => {
  it('keeps the newest run per application and drops the ones it superseded', () => {
    // The API returns newest first, so the first occurrence wins. Taking the
    // last would render an audit the operator has already replaced.
    const runs = latestRuns([
      event({ id: 'new', payload: { auditedAppKey: 'gws', scanned: 9 } }),
      event({ id: 'old', payload: { auditedAppKey: 'gws', scanned: 1 } }),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.scanned).toBe(9);
  });

  it('keeps one run for each application audited', () => {
    const runs = latestRuns([
      event({ payload: { auditedAppKey: 'gws' } }),
      event({ payload: { auditedAppKey: 'notion' } }),
    ]);

    expect(runs.map((r) => r.auditedAppKey)).toEqual(['gws', 'notion']);
  });

  it('does not let a failed run erase the last completed one', () => {
    // A failed attempt superseding a completed run would render "0
    // applications" over a finding that still stands — an erasure dressed as an
    // update.
    const runs = latestRuns([
      event({ id: 'failed', kind: 'token_audit_failed', payload: { auditedAppKey: 'gws' } }),
      event({ id: 'ok', payload: { auditedAppKey: 'gws', scanned: 7, applications: [] } }),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.scanned).toBe(7);
  });

  it('ignores a run that names no application', () => {
    // Pre-C4 events carry no auditedAppKey. Rendering them under a blank
    // heading would attribute findings to nothing.
    const runs = latestRuns([event({ payload: { scanned: 3 } })]);

    expect(runs).toEqual([]);
  });

  it('treats absent counts as zero rather than as undefined', () => {
    const runs = latestRuns([event({ payload: { auditedAppKey: 'gws' } })]);

    expect(runs[0]).toMatchObject({ scanned: 0, failed: 0, applications: [] });
  });

  it('returns nothing for a log with no completed audit', () => {
    expect(latestRuns([])).toEqual([]);
    expect(latestRuns([event({ kind: 'token_audit_failed' })])).toEqual([]);
  });
});

describe('SC2/C4: applications whose connector cannot be audited', () => {
  it('reports one per application, newest first', () => {
    const found = latestUnauditable([
      event({ id: 'new', kind: 'token_audit_unsupported', payload: { auditedAppKey: 'slack', capability: 'none' } }),
      event({ id: 'old', kind: 'token_audit_unsupported', payload: { auditedAppKey: 'slack', capability: 'none' } }),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ auditedAppKey: 'slack', capability: 'none' });
  });

  it('does not treat a failed audit as an unauditable connector', () => {
    // The distinction the new event kind exists for. A run that could not
    // authenticate is something to go and fix; a connector with no grant
    // concept is a permanent property of the integration, and reporting the
    // first as the second tells an operator to stop looking.
    expect(latestUnauditable([event({ kind: 'token_audit_failed', payload: { auditedAppKey: 'gws' } })])).toEqual([]);
    expect(latestUnauditable([event({ kind: 'token_audit_completed', payload: { auditedAppKey: 'gws' } })])).toEqual([]);
  });

  it('is disjoint from the completed runs the page renders beside it', () => {
    // Both readers walk the same list. An application in both would be one that
    // reported grants and then declared it could not — and the page would show
    // a table and a "cannot be audited" line for the same key.
    const items = [
      event({ id: 'a', kind: 'token_audit_completed', payload: { auditedAppKey: 'gws', applications: [] } }),
      event({ id: 'b', kind: 'token_audit_unsupported', payload: { auditedAppKey: 'slack', capability: 'none' } }),
    ];
    const runKeys = latestRuns(items).map((r) => r.auditedAppKey);
    const unauditableKeys = latestUnauditable(items).map((u) => u.auditedAppKey);

    expect(runKeys).toEqual(['gws']);
    expect(unauditableKeys).toEqual(['slack']);
    expect(runKeys.filter((k) => unauditableKeys.includes(k))).toEqual([]);
  });
});
