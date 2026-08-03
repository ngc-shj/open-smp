import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_LABEL } from '../src/lib/api-types';
import { contractUploadFailure, hrUploadFailure } from '../src/lib/upload-failure';
import { CONTRACT_IMPORT_MAX_ROWS, HR_IMPORT_MAX_ROWS } from '../src/lib/api-types';
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
  it.each([
    // PER ENTRY POINT, not per cap value. The first version looped the two cap
    // NUMBERS through one function, so both arms executed the identical path
    // with a different integer and neither touched the form it stood for. These
    // arms differ in the thing that was actually mis-wireable: which cap the
    // form's own entry point closes over.
    ['hr', hrUploadFailure, HR_IMPORT_MAX_ROWS] as const,
    ['contract', contractUploadFailure, CONTRACT_IMPORT_MAX_ROWS] as const,
  ])(
    'the %s entry point gives the byte cap to the size message and its own row cap to the row message',
    (_form, failureFor, rowCap) => {
      // THE PAIR, which is the whole point. Both messages take `{max}` and take
      // DIFFERENT caps; one value for both renders the row limit into the byte
      // message.
      const tooLarge = failureFor(`file exceeds ${MAX_UPLOAD_LABEL} limit`);
      expect(tooLarge.key).toBe('upload.tooLarge');
      expect(tooLarge.max).toBe(MAX_UPLOAD_LABEL);

      const tooManyRows = failureFor(`too many rows (max ${rowCap})`);
      expect(tooManyRows.key).toBe('upload.tooManyRows');
      expect(tooManyRows.max).toBe(rowCap.toLocaleString('en-US'));

      // And the rendered sentences differ, or a single `max` would satisfy both
      // assertions above while producing the same wrong string.
      expect(translate('en', tooLarge.key, { max: tooLarge.max! })).toContain(MAX_UPLOAD_LABEL);
      // POSITIVE. `not.toContain(MAX_UPLOAD_LABEL)` was satisfied by
      // `⟨upload.tooManyRows⟩` — every failure mode of the thing it renders.
      expect(translate('en', tooManyRows.key, { max: tooManyRows.max! })).toContain(
        rowCap.toLocaleString('en-US'),
      );
    },
  );

  it('keys the size message off the constant, so a moved cap moves both ends', () => {
    // The regression review round 2 found: the map key derived from
    // MAX_UPLOAD_LABEL while the pre-check that PRODUCES the string stayed
    // literal, so they agreed only while the cap was 10MB.
    expect(hrUploadFailure('file exceeds 999MB limit').key).toBe('upload.failed');
  });

  it.each(['constructor', 'toString', 'valueOf', '__proto__'])(
    'falls back for the prototype-derived key %s rather than returning a function',
    (rawMessage) => {
      // `rawMessage` is `body.error` verbatim — a key built from data — and a
      // bare index on an object literal returns a truthy function for these.
      expect(hrUploadFailure(rawMessage)).toEqual({ key: 'upload.failed' });
    },
  );

  it.each([
    ['file is required', 'upload.fileRequired'],
    ['file must be UTF-8 encoded', 'upload.notUtf8'],
    ['malformed CSV', 'upload.malformedCsv'],
  ])('maps %s without a cap', (rawMessage, key) => {
    // The allow side for the messages that take no parameter: `max` must be
    // absent, or `translate` would be handed one the message has no slot for.
    expect(hrUploadFailure(rawMessage)).toEqual({ key });
  });

  it('the two entry points do not share a row cap', () => {
    // The mis-wire the positional argument allowed: passing HR's cap from the
    // contract form typechecked, passed every test, and made that form fall
    // through to the generic copy on every row-cap refusal. Neither entry point
    // takes a cap now, and this pins that they close over different ones.
    const hr = hrUploadFailure(`too many rows (max ${HR_IMPORT_MAX_ROWS})`);
    const contract = contractUploadFailure(`too many rows (max ${CONTRACT_IMPORT_MAX_ROWS})`);

    expect(hr.max).not.toBe(contract.max);
    // And neither recognises the other's message, which is what falling through
    // to the generic copy looked like.
    expect(hrUploadFailure(`too many rows (max ${CONTRACT_IMPORT_MAX_ROWS})`).key).toBe(
      'upload.failed',
    );
  });

  it.each([
    // Inputs that COERCE to a real key, which is the only shape the type guard
    // changes: `undefined` and `{}` miss the map either way, so a cell built
    // from them was green with the guard removed. A one-element array
    // stringifies to its element.
    ['an array stringifying to a key', ['file is required']],
    ['an object whose toString is a key', { toString: (): string => 'malformed CSV' }],
  ])('falls back for %s rather than coercing it', (_label, rawMessage) => {
    // `rawMessage` is `body.error` with no runtime check. A non-string reaching
    // the raw-message line throws "Objects are not valid as a React child" and
    // takes down the panel that exists to explain the refusal.
    expect(hrUploadFailure(rawMessage as unknown as string)).toEqual({ key: 'upload.failed' });
  });

  it('falls back to the generic message for an error it does not know', () => {
    expect(hrUploadFailure('something the API grew last week')).toEqual({
      key: 'upload.failed',
    });
  });
});
