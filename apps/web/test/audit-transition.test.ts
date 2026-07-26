import { describe, expect, it } from 'vitest';
import { auditTransition, labelSide } from '../src/lib/audit-transition';
import type { DiscoveryEventPayload } from '../src/lib/api-types';

// The events page is the only surface an operator reviews the audit trail from,
// so what it renders IS the trail as far as review is concerned. C29 makes the
// API omit a snapshot whose kind is outside the domain rather than serve it —
// and these tests exist because the first version of this renderer put the
// forgery straight back by coalescing the omitted field to null, which renders
// as "none", the same string a genuine unlabelled account produces.

const SET: DiscoveryEventPayload = {
  actorUserId: 'u1',
  saasAccountId: 'a1',
  before: null,
  after: { kind: 'known_shared', note: null },
};

describe('labelSide distinguishes absent from null', () => {
  it('renders a genuine absent label as none', () => {
    expect(labelSide(null)).toBe('none');
  });

  // The red proof for the round-1 fix: deleting the `undefined` guard makes
  // this return 'none' and the forgery is back, with everything else green.
  it('renders a withheld (corrupt) snapshot as unavailable, not none', () => {
    expect(labelSide(undefined)).toBe('unavailable');
    expect(labelSide(undefined)).not.toBe(labelSide(null));
  });

  it('renders a label with its note', () => {
    expect(labelSide({ kind: 'service_account', note: 'ci runner' })).toBe(
      'Service account (ci runner)',
    );
  });

  it('renders a label without a note', () => {
    expect(labelSide({ kind: 'external_collaborator', note: null })).toBe('External collaborator');
  });
});

describe('auditTransition decides from the event kind, not from field absence', () => {
  it('renders a genuine first-time labelling', () => {
    expect(auditTransition('label_set', SET)).toBe('none → Known shared');
  });

  it('renders a clear', () => {
    expect(
      auditTransition('label_cleared', {
        ...SET,
        before: { kind: 'known_shared', note: null },
        after: null,
      }),
    ).toBe('Known shared → none');
  });

  it('marks a one-sided corrupt payload rather than forging the missing side', () => {
    const corrupt: DiscoveryEventPayload = {
      actorUserId: 'u1',
      saasAccountId: 'a1',
      after: { kind: 'known_shared', note: null },
    };

    expect(auditTransition('label_set', corrupt)).toBe('unavailable → Known shared');
  });

  // The round-2 finding. A wholly corrupt audit payload projects to the same
  // shape as a sync event — both fields absent — so deciding from the payload
  // alone rendered a tampered label event as '—', i.e. "nothing to show". Only
  // the kind separates them, and it comes from a column no API path can rewrite.
  it('marks a wholly corrupt audit payload rather than rendering it as a sync event', () => {
    const wholly: DiscoveryEventPayload = { actorUserId: 'u1', saasAccountId: 'a1' };

    expect(auditTransition('label_set', wholly)).toBe('unavailable → unavailable');
  });

  it('renders a sync event as a dash', () => {
    expect(auditTransition('sync_completed', { counts: { upserted: 3 }, runId: 'r1' })).toBe('—');
    expect(auditTransition('match_completed', { counts: { links: 2 } })).toBe('—');
  });
});
