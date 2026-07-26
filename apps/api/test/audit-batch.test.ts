import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_SOURCE,
  recordLabelAudit,
  recordLabelAuditBatch,
  type LabelAuditPayload,
} from '../src/audit.js';

// A capturing stand-in for the transaction. The fake is a system boundary (the
// pg driver), not the unit under test — what the real behaviour costs is proven
// at the integration tier against Postgres, where the row cardinality and the
// stored payload are asserted. What this file pins is the shape the single
// path delegates to, which no integration test can see.
type CapturedQuery = { text: string; values: unknown[] };

function fakeTx(): { tx: PoolClient; calls: CapturedQuery[] } {
  const calls: CapturedQuery[] = [];
  const tx = {
    query: (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

function payload(saasAccountId: string): LabelAuditPayload {
  return {
    actorUserId: '11111111-1111-1111-1111-111111111111',
    saasAccountId,
    before: null,
    after: { kind: 'known_shared', note: null },
  };
}

const TENANT = '22222222-2222-2222-2222-222222222222';

describe('C28 acceptance: one audit writer for both label routes', () => {
  // The falsifiable property is DELEGATION, not SQL-text identity: asserting
  // that recordLabelAudit and its own delegate emit the same statement would
  // compare a function to itself and pass by construction. Re-introducing a
  // second, independently written INSERT in audit.ts makes this fail.
  it('recordLabelAudit issues one batch statement with a one-element binding', async () => {
    const { tx, calls } = fakeTx();

    await recordLabelAudit(tx, TENANT, 'label_set', payload('33333333-3333-3333-3333-333333333333'));

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.text).toMatch(/unnest\(\$4::text\[\]\)/);
    expect(call.values[0]).toBe(TENANT);
    expect(call.values[1]).toBe(AUDIT_SOURCE);
    expect(call.values[2]).toBe('label_set');
    expect(call.values[3]).toEqual([
      JSON.stringify(payload('33333333-3333-3333-3333-333333333333')),
    ]);
  });

  it('writes one payload per account, in order, for a batch', async () => {
    const { tx, calls } = fakeTx();
    const ids = [
      '44444444-4444-4444-4444-444444444444',
      '55555555-5555-5555-5555-555555555555',
      '66666666-6666-6666-6666-666666666666',
    ];

    await recordLabelAuditBatch(tx, TENANT, 'label_set', ids.map(payload));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.values[3]).toEqual(ids.map((id) => JSON.stringify(payload(id))));
  });

  // I28.2 — non-vacuous: it pins an early return that did not exist before C28.
  // Without it an empty batch would emit `unnest('{}')`, a statement with no
  // rows and no purpose.
  it('issues no statement at all for an empty batch', async () => {
    const { tx, calls } = fakeTx();

    await recordLabelAuditBatch(tx, TENANT, 'label_cleared', []);

    expect(calls).toEqual([]);
  });

  it('binds the kind rather than embedding it in the statement', async () => {
    const { tx, calls } = fakeTx();

    await recordLabelAuditBatch(tx, TENANT, 'label_cleared', [
      payload('77777777-7777-7777-7777-777777777777'),
    ]);

    // The bulk route used to hardcode 'label_set' in its SQL, which is why its
    // kind was never checked against LabelAuditKind.
    expect(calls[0]!.text).not.toMatch(/'label_(set|cleared)'/);
    expect(calls[0]!.values[2]).toBe('label_cleared');
  });
});
