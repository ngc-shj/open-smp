// Relative rather than the `@/` alias: the root vitest project does not resolve
// that alias, and this module is unit-tested. csv-export.ts — the other
// unit-tested lib module — uses the same form for the same reason.
import { isLabelAuditKind, type DiscoveryEventPayload } from './api-types';
import { LABEL_KIND_NAMES } from './label-kinds';

/**
 * Renders one side of a label transition.
 *
 * `undefined` and `null` mean different things here and must not be collapsed.
 * `null` is a real state — the account carried no label, which is what a
 * genuine `label_set` on an unlabelled account records. `undefined` means the
 * API declined to serve the field because the stored kind was outside the
 * domain (C29), and rendering that as "none" would put back exactly the forgery
 * the API refused to emit, on the one surface an operator reviews the trail
 * from.
 */
export function labelSide(snapshot: DiscoveryEventPayload['before'] | undefined): string {
  if (snapshot === undefined) return 'unavailable';
  if (!snapshot) return 'none';
  return snapshot.note
    ? `${LABEL_KIND_NAMES[snapshot.kind]} (${snapshot.note})`
    : LABEL_KIND_NAMES[snapshot.kind];
}

/**
 * The audit column answers "what changed", which for a label is the transition
 * rather than either end of it: a `label_set` on an already-labelled account is
 * a different act from one on an unlabelled account, and only the pair shows it.
 *
 * Keyed on the event kind, not on field absence. Both fields absent is
 * ambiguous by itself — it is what a sync event looks like, and also what a
 * WHOLLY corrupt audit payload projects to. Deciding from the payload alone
 * renders the second as the first, so a tampered label event would read as
 * "nothing to show here" on the audit surface. The kind is what tells them
 * apart, and it comes from a column no API path can rewrite.
 *
 * `isLabelAuditKind` is imported rather than re-listed: a second copy of the
 * kind list on this side would silently render '—' for a real audit event until
 * someone remembered to update it.
 */
export function auditTransition(kind: string, payload: DiscoveryEventPayload): string {
  if (!isLabelAuditKind(kind)) return '—';
  return `${labelSide(payload.before)} → ${labelSide(payload.after)}`;
}
