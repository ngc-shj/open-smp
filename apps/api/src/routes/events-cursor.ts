// Keyset cursor for the events list (C20).
//
// The list orders by (created_at DESC, id DESC), so a bare uuid cannot express
// a stable position: timestamps tie, and id alone says nothing about where the
// scan is in time. The cursor therefore carries both, plus the `source` filter
// it was minted under — see decodeCursor's contract below for why.

export type EventCursor = { t: string; id: string; s: string | null };

// Bounds decode work before any parsing runs. 512 rather than a tighter figure
// because the value is derived from the validator's domain, not from a sample
// of it: `source` is slug-constrained at the query boundary, so a maximal
// cursor encodes to ~196 characters and the headroom is permanent.
export const CURSOR_MAX_LENGTH = 512;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * Total: returns null for anything that is not a well-formed cursor, so a
 * hostile value produces a 400 rather than a 500. Requires EXACTLY the keys
 * {t, id, s} — not merely their presence — which is what keeps the decoded
 * object out of any merge sink.
 */
export function decodeCursor(raw: string): EventCursor | null {
  if (raw.length > CURSOR_MAX_LENGTH) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3 || !keys.includes('t') || !keys.includes('id') || !keys.includes('s')) {
    return null;
  }

  const { t, id, s } = record;
  if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) {
    return null;
  }
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return null;
  }
  if (s !== null && (typeof s !== 'string' || s.length > 64)) {
    return null;
  }

  return { t, id, s };
}
