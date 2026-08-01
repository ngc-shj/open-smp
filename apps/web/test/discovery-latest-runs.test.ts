import { describe, expect, it } from 'vitest';
import { latestRuns } from '../src/lib/discovery-runs';
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
