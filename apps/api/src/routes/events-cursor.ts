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

// The timestamp is pinned to the shape encodeCursor emits, NOT merely to what
// Date.parse tolerates. Date.parse accepts values Postgres rejects as
// timestamptz — `'0'` is the cheapest example, and it reaches the query as a
// bind value and raises 22008, i.e. a 500 carrying a database error message,
// which is precisely the totality this module promises not to break.
//
// Fractional digits are optional so a cursor minted before the microsecond fix
// (or by any ISO-8601 producer) still decodes.
const CURSOR_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/;

/**
 * Shape alone is not enough: `2026-02-30T00:00:00Z` matches the pattern AND
 * satisfies Date.parse (JS rolls it forward to March 2), while Postgres rejects
 * it outright. Anything that only checks the spelling therefore still lets a
 * 22008 through — the exact failure this validation exists to prevent.
 *
 * So the calendar fields are checked against the Date the runtime built from
 * them: a value that rolled over comes back with different fields than it went
 * in with, which catches every out-of-range component in one comparison rather
 * than enumerating month lengths and leap years.
 */
function isRealCalendarDate(value: string): boolean {
  const match = CURSOR_TIMESTAMP_RE.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  // Year zero needs its own check because the round-trip below cannot see it:
  // JS uses astronomical numbering and happily reports getUTCFullYear() === 0,
  // so the comparison agrees with itself. Postgres has no year 0 (1 BC is
  // followed by AD 1) and raises 22008. The producer only ever emits years far
  // above this, so >= 1 is the minimal bound that closes the gap.
  if (Number(year) < 1) return false;

  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day) &&
    parsed.getUTCHours() === Number(hour) &&
    parsed.getUTCMinutes() === Number(minute) &&
    parsed.getUTCSeconds() === Number(second)
  );
}

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
  if (typeof t !== 'string' || !isRealCalendarDate(t)) {
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
