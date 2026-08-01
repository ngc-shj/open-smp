import { describe, expect, it } from 'vitest';
import { LOCALES, MESSAGES, type MessageKey } from '../src/lib/i18n/messages';
import { DEFAULT_LOCALE, isLocale, missingMarker, translate, translator } from '../src/lib/i18n/translate';

// i18n/C1. The type system already refuses a key present in one dictionary and
// absent from the other — `ja` is a Record over `keyof typeof en` — so what is
// left to assert at runtime is what the types cannot see: values that exist and
// say nothing, a locale that arrives from a cookie, and the miss path that only
// untyped callers can reach.

describe('the dictionaries', () => {
  it('cover every locale', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort());
  });

  it.each(LOCALES)('%s has no empty message', (locale) => {
    // A key the type system is satisfied by and a reader is not: an empty
    // string renders as nothing and reads as a layout defect rather than a
    // missing translation.
    const empty = Object.entries(MESSAGES[locale])
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it('has the same key set in every locale', () => {
    // Compile-enforced by the Record type, and asserted anyway because the
    // enforcement lives in one `as const` — a dictionary later loaded from JSON
    // would keep the shape and lose the check, silently.
    const [first, ...rest] = LOCALES;
    const reference = Object.keys(MESSAGES[first!]).sort();

    expect(reference.length).toBeGreaterThan(0);
    for (const locale of rest) {
      expect(Object.keys(MESSAGES[locale]).sort(), locale).toEqual(reference);
    }
  });

  it('actually translates, rather than carrying the English through', () => {
    // Non-vacuity for everything above: two dictionaries with identical values
    // satisfy every assertion here and translate nothing. `nav.brand` is
    // deliberately excluded — a product name is not translated.
    const differing = Object.keys(MESSAGES.en).filter(
      (key) => MESSAGES.en[key as MessageKey] !== MESSAGES.ja[key as MessageKey],
    );

    expect(differing.length).toBeGreaterThan(0);
  });
});

describe('translate', () => {
  it('returns the message for the locale asked for', () => {
    expect(translate('en', 'nav.accounts')).toBe('Accounts');
    expect(translate('ja', 'nav.accounts')).toBe('アカウント');
  });

  it('marks an unresolvable key rather than rendering it', () => {
    // The miss path exists for callers the types do not cover — a key built
    // from data, or a dictionary that outlives the code that typed it.
    //
    // Returning the KEY is the common design and the one that fails quietly:
    // `nav.accounts` reads as a plausible label to anyone skimming, and it puts
    // an English key on a Japanese page with nothing looking wrong.
    const result = translate('ja', 'nav.nonexistent' as MessageKey);

    expect(result).toBe(missingMarker('nav.nonexistent'));
    expect(result).not.toBe('nav.nonexistent');
    // Assertable, and visibly a hole: the brackets appear in no message.
    expect(Object.values(MESSAGES.ja).some((m) => m.includes('⟨'))).toBe(false);
  });

  it('marks an empty message the same way it marks a missing one', () => {
    // Both are the same defect to a reader — a label that says nothing — so
    // they render the same rather than one of them rendering as blank.
    const sparse = { en: { 'nav.brand': '' }, ja: { 'nav.brand': '' } };
    const original = MESSAGES.en['nav.brand'];
    try {
      (MESSAGES.en as Record<string, string>)['nav.brand'] = sparse.en['nav.brand'];
      expect(translate('en', 'nav.brand')).toBe(missingMarker('nav.brand'));
    } finally {
      (MESSAGES.en as Record<string, string>)['nav.brand'] = original;
    }
  });

  it('curries to a locale', () => {
    expect(translator('ja')('nav.events')).toBe(MESSAGES.ja['nav.events']);
  });
});

describe('isLocale guards what arrives from a cookie', () => {
  it.each([...LOCALES])('accepts %s', (locale) => {
    expect(isLocale(locale)).toBe(true);
  });

  it.each([['de'], [''], ['EN'], ['en-US'], [undefined], [null], [42], [{}]])(
    'rejects %s',
    (value) => {
      // The cookie is user-supplied. A hand-edited one must fall back rather
      // than index MESSAGES with a key that is not there.
      expect(isLocale(value)).toBe(false);
    },
  );

  it('defaults to a locale that exists', () => {
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
  });
});
