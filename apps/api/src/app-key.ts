import { RESERVED_EVENT_SOURCES } from '@open-smp/api-types';

// `saas_apps.key` becomes `discovery_events.source` for every sync event that
// application produces, and GET /api/events filters on `source` alone. So a key
// equal to one of the product's own source values forges an audit family: rows
// carrying connector-supplied payloads would answer `?source=label` alongside
// the label trail, or `?source=contract` alongside the import trail.
//
// Until C2 the control was that `saas_apps.key` could only ever be the literal
// `google-workspace` (one zod field, pinned by saas-app-key-pin.test.ts). The
// contract import writes the catalog from a CSV cell, so that argument no
// longer holds for every write path, and this is what replaces it.
export const RESERVED_APP_KEYS: ReadonlySet<string> = new Set(RESERVED_EVENT_SOURCES);

export const APP_KEY_MAX_LENGTH = 64;

// The same domain GET /api/events accepts for `?source=`: a key outside it
// names events that cannot be selected, which is a silently unfilterable audit
// trail rather than a validation nicety.
export const APP_KEY_PATTERN = /^[a-z0-9_-]+$/;

export type AppKeyRejection = 'empty' | 'malformed' | 'reserved';

/**
 * Normalises a CSV-supplied application key, or says why it cannot be one.
 *
 * The order is trim → lowercase → shape → reserved, and the property that makes
 * it correct is not the order itself but its consequence: the reserved-set test
 * runs against the EXACT string that will be stored. Checking the raw cell
 * instead would accept ` LABEL `, which is stored as `label`.
 */
export function normalizeAppKey(raw: string): { key: string } | { rejected: AppKeyRejection } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { rejected: 'empty' };
  }

  // Length is measured after lowercasing, because case folding is not always
  // length-preserving (U+0130 folds to two code points).
  const lowered = trimmed.toLowerCase();
  if (lowered.length > APP_KEY_MAX_LENGTH || !APP_KEY_PATTERN.test(lowered)) {
    return { rejected: 'malformed' };
  }

  if (RESERVED_APP_KEYS.has(lowered)) {
    return { rejected: 'reserved' };
  }

  return { key: lowered };
}
