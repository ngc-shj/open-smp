import { describe, expect, it } from 'vitest';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeCookie } from '../src/lib/i18n/cookie';
import { LOCALE_LABELS, LOCALES, MESSAGES, type MessageKey } from '../src/lib/i18n/messages';
import {
  DEFAULT_LOCALE,
  isLocale,
  missingMarker,
  placeholders,
  translate,
  translator,
} from '../src/lib/i18n/translate';

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

describe('interpolation', () => {
  it('puts a value where the message says, in each locale', () => {
    // The whole reason placeholders exist rather than concatenation: the number
    // and the noun do not sit in the same order in the two locales, so a
    // caller assembling `t(...) + n` cannot be translated at all.
    //
    // The key is written literally rather than cast. An `as MessageKey` here
    // let this file name a key the dictionary never had, and the miss path did
    // exactly what it promises — returned the marker — so the failure surfaced
    // as an assertion about interpolation rather than as the typo it was.
    expect(translate('en', 'label.selected', { count: 3 })).toContain('3');
    expect(translate('ja', 'label.selected', { count: 3 })).toContain('3');
    expect(translate('en', 'label.selected', { count: 3 })).not.toBe(
      translate('ja', 'label.selected', { count: 3 }),
    );
  });

  it('marks a placeholder nobody supplied, and keeps the rest of the sentence', () => {
    const result = translate('en', 'label.selected', {});

    expect(result).toContain(missingMarker('count'));
    // The hole is local. Taking the whole message down for one missing value
    // would lose the part that still reads.
    expect(result).not.toBe(missingMarker('label.selected'));
  });

  it('leaves a message with no placeholders alone', () => {
    expect(translate('en', 'nav.accounts', { count: 3 })).toBe(MESSAGES.en['nav.accounts']);
  });

  it('distinguishes one from many where English does', () => {
    // English pluralises the noun and Japanese does not, so the COUNT selects
    // the message instead of an `s` being glued to the end of one. Two keys
    // carrying the same English would render "Labeled 1 accounts." with
    // everything else green.
    //
    // What this does NOT cover, stated rather than implied: the selection at
    // the call sites (BulkLabelBar, SaasAppManager). There is no jsdom project
    // here, so no unit test can render either one.
    expect(MESSAGES.en['label.applied.one']).not.toBe(MESSAGES.en['label.applied.other']);
    expect(translate('en', 'label.applied.one', { count: 1 })).toBe('Labeled 1 account.');
    expect(translate('en', 'label.applied.other', { count: 3 })).toBe('Labeled 3 accounts.');
    expect(MESSAGES.en['saasapp.hasAccounts.one']).not.toBe(MESSAGES.en['saasapp.hasAccounts.other']);
  });

  it('every locale carries the same placeholders for a key', () => {
    // The failure this catches is a translation that DROPS `{count}`: the type
    // system sees a string, the key-set test sees a key, and the number simply
    // never appears on the page. Runtime cannot see it either — a message with
    // no placeholder has nothing to substitute and nothing to mark.
    const [first, ...rest] = LOCALES;
    const mismatched: string[] = [];

    for (const key of Object.keys(MESSAGES[first!]) as MessageKey[]) {
      const reference = placeholders(MESSAGES[first!][key]).sort();
      for (const locale of rest) {
        const other = placeholders(MESSAGES[locale][key]).sort();
        if (reference.join(',') !== other.join(',')) {
          mismatched.push(`${key}: ${first}=[${reference}] ${locale}=[${other}]`);
        }
      }
    }

    expect(mismatched, 'placeholders differ between locales').toEqual([]);
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

/**
 * The pairs a browser would take out of the assignment.
 *
 * Deliberately a split rather than a `toContain`, because a substring cannot
 * tell an attribute's ABSENCE from its NARROWING: `toContain('path=/')` is
 * satisfied by `path=/identities`, which is precisely the value the whole
 * attribute exists to rule out. Measured — the narrowing mutant was green under
 * the substring form.
 */
function attributes(cookie: string): Map<string, string> {
  return new Map(
    cookie.split(';').map((part) => {
      const [key, ...value] = part.trim().split('=');
      return [key!.toLowerCase(), value.join('=')];
    }),
  );
}

describe('i18n/C3: what the switch writes', () => {
  it.each(LOCALES)('writes a %s under the name the reader reads', (locale) => {
    // The binding is the NAME: `getLocale` looks up LOCALE_COOKIE, and if the
    // writer spells it differently the control appears to do nothing with
    // nothing anywhere erroring. The value assertion is the other half.
    const attributes_ = attributes(localeCookie(locale));

    expect([...attributes_.keys()][0]).toBe(LOCALE_COOKIE);
    expect(attributes_.get(LOCALE_COOKIE)).toBe(locale);
  });

  it('scopes the choice to the whole site', () => {
    // Without `path=/` the cookie takes the DIRECTORY of the document that
    // wrote it. Every top-level page here is one segment deep, so that default
    // is already `/` — and so is a nested page reached through a <Link>, which
    // is a pushState Chrome does not re-derive the default from. Dropping the
    // attribute survived the E2E under both. The case that reaches it is a
    // document LOAD at /identities/<id>, which is where the spec now switches.
    expect(attributes(localeCookie('ja')).get('path')).toBe('/');
  });

  it('outlives the browser session', () => {
    // A session cookie satisfies every other assertion here and loses the
    // choice the next time the browser opens, which reads as the control not
    // having worked. Compared against the constant rather than to `> 0`, which
    // a `max-age=1` — expiring before the page finishes loading — satisfies.
    expect(attributes(localeCookie('ja')).get('max-age')).toBe(String(LOCALE_COOKIE_MAX_AGE));
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

describe('every message key has a reader', () => {
  it('finds no orphan', async () => {
    // Review found `saasapp.connector` shipped in both locales with no
    // consumer, and the fix was by hand — so the CLASS stayed open and
    // `saasapp.catalogFull` was added in the same round. This is the detector
    // the ratchet's opposite direction never had: untranslated-literals.ts
    // measures copy absent from the dictionary; nothing measured a dictionary
    // entry absent from the code.
    const { readdir, readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const SRC = path.join(import.meta.dirname, '..', 'src');

    async function sources(dir: string): Promise<string[]> {
      const out: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await sources(full)));
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
      return out;
    }

    const files = await sources(SRC);
    expect(files.length).toBeGreaterThan(0);
    const code = (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n');

    // A key is read when its literal appears anywhere outside the dictionary
    // itself — `t('x.y')`, a Record value, a labelKey. Deliberately a substring
    // scan: the alternative is enumerating the shapes a key can be referenced
    // through, which is the surface-form problem this repository keeps paying
    // for. The failure direction is safe — a key referenced by a computed
    // expression would red here and be added to the exemption below with a
    // reason.
    const orphans = (Object.keys(MESSAGES.en) as MessageKey[]).filter(
      (key) => !code.includes(`'${key}'`),
    );

    expect(orphans, 'message keys no source file names').toEqual([]);
  });
});
