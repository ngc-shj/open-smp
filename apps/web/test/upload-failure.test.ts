import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_LABEL } from '../src/lib/api-types';
import { CONTRACT_ROW_CAP, HR_ROW_CAP, uploadFailure } from '../src/lib/upload-failure';
import { translate } from '../src/lib/i18n/translate';

// i18n/C1, review round 2. The decision both import forms make about which
// message an upload failure renders, and with which cap.
//
// It lived twice — once per form — and only the HR copy had an E2E that could
// see it, so dropping the per-key `max` selection from the contract form would
// have shipped "This file is too large (max 2,000)" with every gate green. One
// implementation, tested directly, is what makes the second form's behaviour
// observable at all.

describe('uploadFailure', () => {
  it.each([HR_ROW_CAP, CONTRACT_ROW_CAP])(
    'gives the byte cap to the size message and the row cap to the row message (cap %i)',
    (rowCap) => {
      // THE PAIR, which is the whole point. Both messages take `{max}` and take
      // DIFFERENT caps; one value for both renders the row limit into the byte
      // message.
      const tooLarge = uploadFailure(`file exceeds ${MAX_UPLOAD_LABEL} limit`, rowCap);
      expect(tooLarge.key).toBe('upload.tooLarge');
      expect(tooLarge.max).toBe(MAX_UPLOAD_LABEL);

      const tooManyRows = uploadFailure(`too many rows (max ${rowCap})`, rowCap);
      expect(tooManyRows.key).toBe('upload.tooManyRows');
      expect(tooManyRows.max).toBe(rowCap.toLocaleString('en-US'));

      // And the rendered sentences differ, or a single `max` would satisfy both
      // assertions above while producing the same wrong string.
      expect(translate('en', tooLarge.key, { max: tooLarge.max! })).toContain(MAX_UPLOAD_LABEL);
      expect(translate('en', tooManyRows.key, { max: tooManyRows.max! })).not.toContain(
        MAX_UPLOAD_LABEL,
      );
    },
  );

  it('keys the size message off the constant, so a moved cap moves both ends', () => {
    // The regression review round 2 found: the map key derived from
    // MAX_UPLOAD_LABEL while the pre-check that PRODUCES the string stayed
    // literal, so they agreed only while the cap was 10MB.
    expect(uploadFailure('file exceeds 999MB limit', HR_ROW_CAP).key).toBe('upload.failed');
  });

  it.each(['constructor', 'toString', 'valueOf', '__proto__'])(
    'falls back for the prototype-derived key %s rather than returning a function',
    (rawMessage) => {
      // `rawMessage` is `body.error` verbatim — a key built from data — and a
      // bare index on an object literal returns a truthy function for these.
      expect(uploadFailure(rawMessage, HR_ROW_CAP)).toEqual({ key: 'upload.failed' });
    },
  );

  it.each([
    ['file is required', 'upload.fileRequired'],
    ['file must be UTF-8 encoded', 'upload.notUtf8'],
    ['malformed CSV', 'upload.malformedCsv'],
  ])('maps %s without a cap', (rawMessage, key) => {
    // The allow side for the messages that take no parameter: `max` must be
    // absent, or `translate` would be handed one the message has no slot for.
    expect(uploadFailure(rawMessage, HR_ROW_CAP)).toEqual({ key });
  });

  it('falls back to the generic message for an error it does not know', () => {
    expect(uploadFailure('something the API grew last week', HR_ROW_CAP)).toEqual({
      key: 'upload.failed',
    });
  });
});
