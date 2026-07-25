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
