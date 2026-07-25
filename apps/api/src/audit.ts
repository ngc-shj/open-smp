import type { PoolClient } from 'pg';
import type { AccountLabelKind } from '@open-smp/api-types';

// A label moves an account out of the operator's "needs attention" set, so it
// is a review-suppression control: without a trail, a compromised session can
// hide accounts and leave nothing to find. `source` namespaces the audit family
// so GET /api/events?source=label selects all of it in one predicate, and stays
// correct when a future audit kind is added.
export const AUDIT_SOURCE = 'label';

export type LabelAuditKind = 'label_set' | 'label_cleared';

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
 * Records a label mutation on the caller's transaction (never a pool): the
 * event and the mutation commit together or roll back together. An audit row
 * for a mutation that rolled back is worse than none.
 */
export async function recordLabelAudit(
  tx: PoolClient,
  tenantId: string,
  kind: LabelAuditKind,
  payload: LabelAuditPayload,
): Promise<void> {
  await tx.query(
    `INSERT INTO discovery_events (tenant_id, source, kind, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [tenantId, AUDIT_SOURCE, kind, JSON.stringify(payload)],
  );
}
