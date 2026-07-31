import type { PoolClient } from 'pg';
import {
  CONTRACT_EVENT_SOURCE,
  LABEL_EVENT_SOURCE,
  type AccountLabelKind,
  type ContractAuditKind,
} from '@open-smp/api-types';

// A label moves an account out of the operator's "needs attention" set, so it
// is a review-suppression control: without a trail, a compromised session can
// hide accounts and leave nothing to find. `source` namespaces the audit family
// so GET /api/events?source=label selects all of it in one predicate, and stays
// correct when a future audit kind is added.
//
// The value is no longer a literal here: it is one member of the reserved
// source set in @open-smp/api-types, which is what the contract import refuses
// as a `saas_apps.key`. A second literal spelling of it would make that
// refusal a copy rather than a derivation.
export const AUDIT_SOURCE = LABEL_EVENT_SOURCE;

// Re-exported from @open-smp/api-types so this module's importers are
// unchanged. The list moved there because apps/web needs it too: the events
// page must distinguish "a sync event has no audit fields" from "this audit
// event's fields were withheld as corrupt", and only the kind separates them.
// A separate value/type import as well as the re-export: `export … from` does
// not bind the name locally, and the signatures below use it.
import type { LabelAuditKind } from '@open-smp/api-types';

export { LABEL_AUDIT_KINDS, type LabelAuditKind } from '@open-smp/api-types';

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
  await insertAuditRows(tx, tenantId, AUDIT_SOURCE, kind, payloads);
}

/**
 * The one audit INSERT in apps/api (C28/I28.1), now serving two families. The
 * source is a parameter rather than a second statement for the same reason the
 * bulk label route stopped carrying its own copy: a change to the audit row's
 * shape must not be able to land on one family and miss the other.
 *
 * audit-append-only.test.ts asserts this file holds the only occurrence.
 */
async function insertAuditRows(
  tx: PoolClient,
  tenantId: string,
  source: string,
  kind: string,
  payloads: readonly object[],
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
    [tenantId, source, kind, payloads.map((payload) => JSON.stringify(payload))],
  );
}

export type ContractImportAuditPayload = {
  actorUserId: string;
  imported: number;
  skipped: number;
  /** The saas_apps rows this upload created — bounded by the per-tenant ceiling. */
  createdAppKeys: readonly string[];
};

/**
 * Records one row per contract upload, on the caller's transaction. It commits
 * with the import or not at all: an audit row for an upload that rolled back
 * would name catalog rows that do not exist.
 *
 * Its own source, not the label family's: `?source=contract` must select
 * exactly the uploads, and a shared source would mix two payload shapes under
 * one filter.
 */
export async function recordContractImportAudit(
  tx: PoolClient,
  tenantId: string,
  kind: ContractAuditKind,
  payload: ContractImportAuditPayload,
): Promise<void> {
  await insertAuditRows(tx, tenantId, CONTRACT_EVENT_SOURCE, kind, [payload]);
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
