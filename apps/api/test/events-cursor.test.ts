import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, CURSOR_MAX_LENGTH } from '../src/routes/events-cursor.js';

const VALID = { t: '2026-07-25T12:00:00.000Z', id: '11111111-2222-3333-4444-555555555555', s: null };

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('C20 events cursor', () => {
  it('round-trips a well-formed cursor', () => {
    expect(decodeCursor(encodeCursor(VALID))).toEqual(VALID);
  });

  // The route mints `t` at microsecond precision (timestamptz holds
  // microseconds; a JS Date does not), so the decoder must accept that form or
  // every second page 400s.
  it('round-trips a microsecond-precision timestamp', () => {
    const micro = { ...VALID, t: '2026-07-25T12:00:00.500900Z' };
    expect(decodeCursor(encodeCursor(micro))).toEqual(micro);
  });

  // The calendar check must not over-reject: a real leap day is a legitimate
  // position, and rejecting it would 400 a cursor the API itself minted.
  it('round-trips a leap day', () => {
    const leap = { ...VALID, t: '2024-02-29T12:00:00.000000Z' };
    expect(decodeCursor(encodeCursor(leap))).toEqual(leap);
  });

  it('round-trips a cursor carrying a source filter', () => {
    const withSource = { ...VALID, s: 'label' };
    expect(decodeCursor(encodeCursor(withSource))).toEqual(withSource);
  });

  // decodeCursor is total: every rejection below must return null rather than
  // throw, or a hostile cursor becomes a 500 instead of a 400.
  describe('rejects malformed input without throwing', () => {
    it.each([
      ['not base64url of anything meaningful', 'not-a-cursor'],
      ['valid base64url of non-JSON', Buffer.from('plain text').toString('base64url')],
      ['JSON that is not an object', b64('a string')],
      ['a JSON array', b64([1, 2, 3])],
      ['missing id', b64({ t: VALID.t, s: null })],
      ['missing s', b64({ t: VALID.t, id: VALID.id })],
      ['missing t', b64({ id: VALID.id, s: null })],
      ['an extra key beyond {t,id,s}', b64({ ...VALID, extra: 'x' })],
      ['id that is not a uuid', b64({ ...VALID, id: 'nope' })],
      ['t that is not a date', b64({ ...VALID, t: 'not-a-date' })],
      // Date.parse accepts all four of these; Postgres rejects them as
      // timestamptz. Without a format check they reach the query as bind values
      // and surface as a 500 carrying a database error, breaking the totality
      // this decoder exists to provide (I20.2).
      ['t that Date.parse accepts but timestamptz rejects', b64({ ...VALID, t: '0' })],
      ['t as a bare year-ish number', b64({ ...VALID, t: '1' })],
      ['t in RFC-1123 form', b64({ ...VALID, t: 'Sat, 01 Jan 2000 00:00:00 GMT' })],
      ['t with an out-of-range expanded year', b64({ ...VALID, t: '+275760-09-13T00:00:00.000Z' })],
      // Shape-only validation is not enough: these match the ISO pattern and
      // Date.parse rolls them forward rather than failing, but Postgres rejects
      // them — so a spelling check alone still lets a 22008 reach the client.
      ['t naming a day the month does not have', b64({ ...VALID, t: '2026-02-30T00:00:00Z' })],
      ['t naming Feb 29 in a non-leap year', b64({ ...VALID, t: '2026-02-29T00:00:00Z' })],
      ['t with a month past 12', b64({ ...VALID, t: '2026-13-01T00:00:00Z' })],
      ['t with an hour past 23', b64({ ...VALID, t: '2026-01-01T25:00:00Z' })],
      // Year zero survives the field round-trip: JS numbers years
      // astronomically and reports 0 back unchanged, so only an explicit lower
      // bound catches it. Postgres has no year 0 and raises 22008.
      ['t in astronomical year zero', b64({ ...VALID, t: '0000-01-01T00:00:00Z' })],
      ['t at the end of year zero', b64({ ...VALID, t: '0000-12-31T23:59:59Z' })],
      ['s that is not a string or null', b64({ ...VALID, s: 42 })],
      ['s longer than the slug cap', b64({ ...VALID, s: 'a'.repeat(65) })],
    ])('%s', (_label, raw) => {
      expect(decodeCursor(raw)).toBeNull();
    });

    it('a value longer than the length cap is rejected before any parsing', () => {
      expect(decodeCursor('a'.repeat(CURSOR_MAX_LENGTH + 1))).toBeNull();
    });
  });

  // The cap is derived from the validator's domain rather than sampled: source
  // is slug-constrained at the query boundary, so the worst case is ASCII.
  it('a maximal slug-source cursor fits well inside the cap', () => {
    const maximal = encodeCursor({ ...VALID, s: 'a'.repeat(64) });
    expect(maximal.length).toBeLessThan(CURSOR_MAX_LENGTH);
  });
});
