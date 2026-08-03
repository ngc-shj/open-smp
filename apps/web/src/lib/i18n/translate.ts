import { DEFAULT_LOCALE, LOCALES, MESSAGES, type Locale, type MessageKey } from './messages';

// i18n/C1. The lookup, kept free of `next/headers` so it can be tested without
// a request — resolving the locale from a cookie is a separate module for
// exactly that reason.

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The marker an unresolvable key renders as.
 *
 * NOT the key itself, which is the common design and the one that fails
 * quietly: `nav.accounts` reads as a plausible label to anyone skimming, and it
 * ships an English key into a Japanese page without anything looking wrong.
 * The brackets are not in any message, so a human sees a hole and a test can
 * assert one.
 *
 * Not a throw, either. A missing string is a copy defect, and taking the page
 * down over one turns a cosmetic fault into an outage — on a screen whose
 * purpose is to show an operator what is wrong elsewhere.
 */
export function missingMarker(key: string): string {
  return `⟨${key}⟩`;
}

export type MessageParams = Record<string, string | number>;

/** `{name}` — the placeholder form, kept in one place because two readers exist. */
const PLACEHOLDER = /\{(\w+)\}/g;

/** Every placeholder name a message carries, in source order. */
export function placeholders(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

/**
 * Looks up one message, substituting `{name}` placeholders.
 *
 * INTERPOLATION RATHER THAN CONCATENATION, and the reason is the second locale.
 * `t('bulk.selected') + n` reads correctly in English and puts the number in
 * the wrong place in Japanese, where the counter and the noun do not sit where
 * English's do. Assembling copy from fragments is the shape that cannot be
 * translated at all, so the whole sentence is one message and the values go
 * into it.
 *
 * Typed callers cannot pass an unknown key — that is what `MessageKey` is for —
 * so the miss path exists for the ones that are not: a key built from data, or
 * a dictionary that outlives the code that typed it.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const message = MESSAGES[locale][key];
  if (typeof message !== 'string' || message === '') {
    return missingMarker(key);
  }
  // A placeholder with no value is marked where it stands rather than taking
  // the whole message down with it: the rest of the sentence is still worth
  // reading, and the hole is where the reader needs to see it.
  return message.replace(PLACEHOLDER, (whole, name: string) =>
    // `Object.hasOwn`, not `in`: `in` reaches the prototype, so `{toString}`,
    // `{constructor}` and `{valueOf}` resolved to inherited members and put
    // `function toString() { [native code] }` into the sentence instead of the
    // marker. Unreachable from today's dictionary — placeholder names are
    // authored — but this is the same defect `chipClassFor` in link-statuses.ts
    // records as a paid-for lesson, and the contract here is the same shape: a
    // placeholder nobody supplied is marked where it stands.
    params && Object.hasOwn(params, name) ? String(params[name]) : missingMarker(name),
  );
}

/** Curried for a render pass that has already resolved its locale. */
export function translator(locale: Locale): (key: MessageKey, params?: MessageParams) => string {
  return (key, params) => translate(locale, key, params);
}

export { DEFAULT_LOCALE, LOCALES, type Locale, type MessageKey };
