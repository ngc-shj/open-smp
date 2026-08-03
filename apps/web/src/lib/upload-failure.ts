import { HR_IMPORT_MAX_ROWS, MAX_UPLOAD_LABEL, CONTRACT_IMPORT_MAX_ROWS } from './api-types';
import type { MessageKey } from './i18n/messages';

/**
 * The upload failure a form shows, from the raw error the API (or its own
 * pre-check) produced.
 *
 * ONE implementation, because there were two. Both import forms carried the
 * same `UPLOAD_ERROR_KEYS` map and the same per-key `max` ternary, and only the
 * HR one had an E2E that could see it — so dropping the ternary from the
 * contract form would have shipped "This file is too large (max 2,000)".
 *
 * The `max` selection is per KEY because two messages take `{max}` and take
 * different caps: a single value renders the row limit into the byte message.
 *
 * `Object.hasOwn`: `rawMessage` is a key built from DATA — `body.error`
 * verbatim — and a bare index on an object literal returns a truthy function
 * for `constructor` and `toString`, which a `key ? …` guard admits.
 */
const UPLOAD_ERROR_KEYS: Record<string, MessageKey> = {
  'file is required': 'upload.fileRequired',
  'file must be UTF-8 encoded': 'upload.notUtf8',
  'malformed CSV': 'upload.malformedCsv',
  [`file exceeds ${MAX_UPLOAD_LABEL} limit`]: 'upload.tooLarge',
};

export type UploadFailure = { key: MessageKey; max?: string };

function uploadFailure(rawMessage: string, rowCap: number): UploadFailure {
  // The TYPE axis as well as the prototype one. `rawMessage` is `body.error`
  // from `res.json()` with no runtime check, so a misbehaving API or an
  // intermediary rewriting the body hands this an object — which `Object.hasOwn`
  // would coerce, and which the raw-message line renders, throwing "Objects are
  // not valid as a React child" and taking down the panel that exists to explain
  // the refusal.
  if (typeof rawMessage !== 'string') {
    return { key: 'upload.failed' };
  }

  const rowKey = `too many rows (max ${rowCap})`;
  const key = rawMessage === rowKey
    ? 'upload.tooManyRows'
    : Object.hasOwn(UPLOAD_ERROR_KEYS, rawMessage)
      ? UPLOAD_ERROR_KEYS[rawMessage]
      : undefined;

  if (!key) {
    return { key: 'upload.failed' };
  }
  // ONLY the two keys that take a cap get one. The first version handed `max`
  // to every message, including the three with no slot for it — harmless,
  // because `translate` ignores an unused parameter, but a contract that says
  // "here is a cap" for a message that has none is the kind of thing a later
  // reader builds on.
  //
  // `en-US` stays pinned so the rendered cap does not depend on where the
  // browser runs (VE3). Making it follow the locale is a separate change,
  // because formatMoney's tests pin the same decision.
  if (key === 'upload.tooLarge') {
    return { key, max: MAX_UPLOAD_LABEL };
  }
  if (key === 'upload.tooManyRows') {
    return { key, max: rowCap.toLocaleString('en-US') };
  }
  return { key };
}

/**
 * One entry point per form, each closing over its own cap.
 *
 * The first version of this extraction took the cap as a positional `number`,
 * and review measured what that cost: `uploadFailure(raw, HR_ROW_CAP)` in the
 * contract form typechecks, passes every test, and makes that form fall through
 * to the generic copy on a row-cap refusal — the exact asymmetry the extraction
 * was made to remove, relocated from the map to the argument. Before the
 * extraction each form named its own constant inside its own file, so a
 * mis-wire meant editing a template literal that named the wrong one.
 *
 * A caller cannot supply the wrong cap to these, because it does not supply one.
 */
export function hrUploadFailure(rawMessage: string): UploadFailure {
  return uploadFailure(rawMessage, HR_IMPORT_MAX_ROWS);
}

export function contractUploadFailure(rawMessage: string): UploadFailure {
  return uploadFailure(rawMessage, CONTRACT_IMPORT_MAX_ROWS);
}
