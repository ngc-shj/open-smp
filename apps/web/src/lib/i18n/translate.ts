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

/**
 * Looks up one message.
 *
 * Typed callers cannot pass an unknown key — that is what `MessageKey` is for —
 * so the miss path exists for the ones that are not: a key built from data, or
 * a dictionary that outlives the code that typed it.
 */
export function translate(locale: Locale, key: MessageKey): string {
  const message = MESSAGES[locale][key];
  if (typeof message !== 'string' || message === '') {
    return missingMarker(key);
  }
  return message;
}

/** Curried for a render pass that has already resolved its locale. */
export function translator(locale: Locale): (key: MessageKey) => string {
  return (key) => translate(locale, key);
}

export { DEFAULT_LOCALE, LOCALES, type Locale, type MessageKey };
