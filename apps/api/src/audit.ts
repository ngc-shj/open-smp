import type { PoolClient } from 'pg';
import type { AccountLabelKind } from '@open-smp/api-types';

// A label moves an account out of the operator's "needs attention" set, so it
// is a review-suppression control: without a trail, a compromised session can
// hide accounts and leave nothing to find. `source` namespaces the audit family
// so GET /api/events?source=label selects all of it in one predicate, and stays
// correct when a future audit kind is added.
export const AUDIT_SOURCE = 'label';

// The kind list is the value; the type is derived from it rather than the other
// way round, so the events projection allowlist and this module cannot disagree
// about what counts as an audit event.
export const LABEL_AUDIT_KINDS = ['label_set', 'label_cleared'] as const;

export type LabelAuditKind = (typeof LABEL_AUDIT_KINDS)[number];

export type LabelAuditSnapshot = { kind: AccountLabelKind; note: string | null };

export type LabelAuditPayload = {
  // Stored as a jsonb value rather than a foreign key, so the trail survives
  // deletion of the user row (account_labels.created_by is ON DELETE SET NULL).
  actorUserId: string;
  saasAccountId: string;
  before: LabelAuditSnapshot | null;
  after: LabelAuditSnapshot | null;
};

/**
 * Records label mutations on the caller's transaction (never a pool): the
 * events and the mutation commit together or roll back together. An audit row
 * for a mutation that rolled back is worse than none.
 *
 * This is the only statement in apps/api that writes an audit row (C28/I28.1).
 * The bulk route used to carry its own copy, which meant a change to the audit
 * shape could land on one path and silently miss the highest-volume one.
 *
 * Set-based rather than one statement per payload: 100 accounts must stay one
 * INSERT, not 100 (NFR3).
 */
export async function recordLabelAuditBatch(
  tx: PoolClient,
  tenantId: string,
  kind: LabelAuditKind,
  payloads: readonly LabelAuditPayload[],
): Promise<void> {
  // No statement at all for an empty batch, so a caller that filters down to
  // nothing cannot emit a degenerate unnest (I28.2).
  if (payloads.length === 0) {
    return;
  }

  await tx.query(
    `INSERT INTO discovery_events (tenant_id, source, kind, payload)
     SELECT $1, $2, $3, payload::jsonb
     FROM unnest($4::text[]) AS payload`,
    [tenantId, AUDIT_SOURCE, kind, payloads.map((payload) => JSON.stringify(payload))],
  );
}

/**
 * Single-payload convenience over {@link recordLabelAuditBatch}. Delegation
 * rather than a second statement is the point: there is one audit INSERT in
 * the tree, so the two label routes cannot drift apart (C28/FR1).
 */
export async function recordLabelAudit(
  tx: PoolClient,
  tenantId: string,
  kind: LabelAuditKind,
  payload: LabelAuditPayload,
): Promise<void> {
  await recordLabelAuditBatch(tx, tenantId, kind, [payload]);
}
