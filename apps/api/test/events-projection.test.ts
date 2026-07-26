import { describe, expect, it } from 'vitest';
import { ACCOUNT_LABEL_KINDS } from '@open-smp/api-types';
import { projectAuditPayload } from '../src/routes/events.js';

// C29: the audit read path must not serve a snapshot whose kind is outside the
// label-kind domain. Before C29 the check was `typeof kind === 'string'` plus a
// cast, so any string was asserted into the union and rendered as-is.

const ACTOR = '11111111-1111-1111-1111-111111111111';
const ACCOUNT = '22222222-2222-2222-2222-222222222222';

function auditRecord(before: unknown, after: unknown): Record<string, unknown> {
  return { actorUserId: ACTOR, saasAccountId: ACCOUNT, before, after };
}

describe('C29 acceptance: the projection validates the label-kind domain', () => {
  it.each(ACCOUNT_LABEL_KINDS)('preserves the in-domain kind %s', (kind) => {
    const projected = projectAuditPayload(auditRecord(null, { kind, note: 'why' }));

    expect(projected.after).toEqual({ kind, note: 'why' });
  });

  // The red proof for C29. Against the pre-C29 code this assertion fails: the
  // old guard passed the string through and the cast made it type-check.
  it('omits a snapshot whose kind is outside the domain', () => {
    const projected = projectAuditPayload(
      auditRecord({ kind: 'not_a_kind', note: 'planted' }, { kind: 'known_shared', note: null }),
    );

    expect(projected).not.toHaveProperty('before');
    // The valid side still projects — a corrupt `before` must not take the
    // whole payload down with it.
    expect(projected.after).toEqual({ kind: 'known_shared', note: null });
    expect(projected.actorUserId).toBe(ACTOR);
  });

  // I29.2, and the assertion that actually distinguishes corruption from a
  // genuine "no label": forging an omitted field as null would record a clear
  // event that never happened.
  //
  // It is stated separately from the pins below because of what falsifies it,
  // not because of what a single mutation does to the file. Reverting the
  // domain check alone fails this and the out-of-domain case while every pin
  // stays green (executed: 2 failed / 8 passed) — the pins cannot see that
  // regression at all. Emitting `null` from the reject branch instead of
  // omitting fails this one too, and takes the pins with it (6 failed / 4);
  // that is a coarser mutation, not evidence the split is unnecessary.
  it('distinguishes an omitted-because-corrupt field from a genuine null', () => {
    const corrupt = projectAuditPayload(auditRecord({ kind: 'not_a_kind', note: null }, null));
    const cleared = projectAuditPayload(auditRecord(null, null));

    // A real label_cleared carries before: null explicitly.
    expect(cleared.before).toBeNull();
    expect('before' in cleared).toBe(true);

    // Corruption carries no `before` key at all. Forging it as null would
    // record a clear event that never happened.
    expect('before' in corrupt).toBe(false);
  });

  // Regression pins, NOT red proofs: every case here is already rejected by
  // the pre-C29 `typeof kind === 'string'` guard, so none of them can fail
  // against the old code. They are retained to pin the behaviour, and are
  // labelled so nobody counts them as coverage of the domain check.
  it.each([
    ['null kind', null],
    ['numeric kind', 42],
    ['object kind', {}],
    ['missing kind', undefined],
  ])('omits a snapshot with a %s (green pre-C29 — regression pin only)', (_label, kind) => {
    const record = auditRecord(kind === undefined ? { note: 'x' } : { kind, note: 'x' }, null);

    expect(projectAuditPayload(record)).not.toHaveProperty('before');
  });

  it('leaves a non-object snapshot alone rather than throwing', () => {
    expect(() => projectAuditPayload(auditRecord('a string', 7))).not.toThrow();
    const projected = projectAuditPayload(auditRecord('a string', 7));
    expect(projected).not.toHaveProperty('before');
    expect(projected).not.toHaveProperty('after');
  });
});
