import { describe, expect, it } from 'vitest';
import { LOCALE_COOKIE, localeCookie } from '../src/lib/i18n/cookie';
import { LOCALE_LABELS, LOCALES, MESSAGES, type MessageKey } from '../src/lib/i18n/messages';
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

describe('i18n/C3: what the switch writes', () => {
  it.each(LOCALES)('writes a %s the reader will accept', (locale) => {
    // Writer bound to reader through the reader's OWN guard, not through a
    // second copy of the parse. The failure this catches is the switch and the
    // resolver disagreeing about the value's shape — under which the control
    // appears to do nothing and nothing anywhere errors.
    const cookie = localeCookie(locale);
    const [name, ...rest] = cookie.split(';')[0]!.split('=');

    expect(name).toBe(LOCALE_COOKIE);
    expect(isLocale(rest.join('='))).toBe(true);
    expect(rest.join('=')).toBe(locale);
  });

  it('scopes the choice to the whole site', () => {
    // Without `path=/` the browser defaults the cookie to the DIRECTORY of the
    // document that wrote it. Every top-level page here is one segment deep, so
    // that default is already `/` and the attribute changes nothing — which is
    // why dropping it survived the E2E until that spec moved its switch onto
    // /identities/<id>, where the default becomes /identities and the choice
    // stops applying anywhere else.
    expect(localeCookie('ja')).toContain('path=/');
  });

  it('outlives the browser session', () => {
    // A session cookie satisfies every other assertion here and loses the
    // choice the next time the browser opens, which reads as the control not
    // having worked.
    const maxAge = /max-age=(\d+)/.exec(localeCookie('ja'))?.[1];

    expect(maxAge, 'no max-age; the choice would not survive the session').toBeDefined();
    expect(Number(maxAge)).toBeGreaterThan(0);
  });

  it('writes a different cookie per locale', () => {
    // Non-vacuity for all three above: a function returning one constant string
    // satisfies every one of them.
    expect(new Set(LOCALES.map(localeCookie)).size).toBe(LOCALES.length);
  });
});

describe('i18n/C3: what the switch offers', () => {
  it('names every locale', () => {
    expect(Object.keys(LOCALE_LABELS).sort()).toEqual([...LOCALES].sort());
  });

  it('gives each locale a distinct name', () => {
    // A picker whose options read the same is unusable, and the type only
    // requires that both keys carry a string. The labels are endonyms rather
    // than message keys — a language picker names each language in that
    // language, because the reader who needs it is the one who cannot read the
    // language currently showing.
    expect(new Set(Object.values(LOCALE_LABELS)).size).toBe(LOCALES.length);
  });
});
