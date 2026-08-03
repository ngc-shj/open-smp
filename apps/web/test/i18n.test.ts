import { describe, expect, it } from 'vitest';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeCookie } from '../src/lib/i18n/cookie';
import { MAX_UPLOAD_LABEL } from '../src/lib/api-types';
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
    // C1'S RATCHET, which C2 had and this did not.
    //
    // The first version asserted `differing.length > 0` under the name "actually
    // translates". Measured: 187 keys, 186 of them differ, and the floor was 1 —
    // so the dominant regression for a dictionary contract, a key added to both
    // locales with the English pasted into `ja`, was invisible. Every sibling
    // assertion is satisfied by that shape too: the key sets match, neither
    // value is empty, and identical strings carry identical placeholders. The
    // 185 other keys held the floor up.
    //
    // A named exemption set instead, so a copied value reds WITH THE KEY NAMED
    // and an intentional identity has to be argued in the diff that adds it.
    const INTENTIONALLY_IDENTICAL: ReadonlySet<MessageKey> = new Set<MessageKey>([
      // A product name, not translated.
      'nav.brand',
    ]);

    const identical = Object.keys(MESSAGES.en).filter(
      (key) => MESSAGES.en[key as MessageKey] === MESSAGES.ja[key as MessageKey],
    );

    // Non-vacuity: the dictionary is really populated, so an empty `identical`
    // is a translated dictionary rather than an empty comparison.
    expect(Object.keys(MESSAGES.en).length).toBeGreaterThan(100);
    expect(identical.sort(), 'a ja value is identical to its en value').toEqual(
      [...INTENTIONALLY_IDENTICAL].sort(),
    );
  });
});

describe('the upload-cap round trip', () => {
  // THE ROUND TRIP, which nothing observed. `MAX_UPLOAD_LABEL` reaches eight
  // sites: two API errors, two client pre-checks, two map keys, two dictionary
  // messages. Review round 1 derived six and left the two PRODUCERS literal, so
  // the key moved with the constant and the message did not — they agreed only
  // while the cap was 10MB.
  //
  // Both web modules are `.tsx` and there is no jsdom project, so the map itself
  // cannot be imported here. Read as TEXT, the way connector-credentials.test.ts
  // reads the worker's factory, because nothing in the type system connects a
  // string a component emits to a string another component uses as a key.
  const SITES = [
    'apps/web/src/app/import/page.tsx',
    'apps/web/src/components/ContractImportForm.tsx',
  ];

  it.each(SITES)('%s derives both the pre-check message and the map key', async (site) => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await readFile(path.join(import.meta.dirname, '..', '..', '..', site), 'utf8');

    // Non-vacuity: the file really was read and really carries both halves.
    expect(source.length).toBeGreaterThan(0);
    expect(source, `${site} has no over-limit pre-check`).toContain('file exceeds');

    // Every mention of the over-limit string interpolates the constant. A
    // hand-written figure here is the desynchronisation, in either direction.
    for (const match of source.matchAll(/file exceeds ([^`'"]*) limit/g)) {
      expect(match[1], `${site} hand-writes the cap`).toBe('${MAX_UPLOAD_LABEL}');
    }
  });

  it('states the cap in whole units, so the sentence a reader sees stays short', () => {
    // A SHAPE GUARD on the shipped constant, and honest about what it is not.
    // `10 * 1000 * 1000` over 1024^2 is 9.5367431640625, which would land
    // verbatim in the copy and in the map key — but `Math.round`'s removal
    // cannot be observed by a mutation, because the current cap divides exactly
    // and the harness cuts one file at a time. What this DOES red on is the
    // shape: a label hand-written as `10 MB`, `10MiB`, or with the figure typed
    // out beside the constant.
    expect(MAX_UPLOAD_LABEL).toMatch(/^\d+MB$/);
  });
});

describe('translate', () => {
  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty'])(
    'marks the unsupplied placeholder {%s} instead of reaching the prototype',
    (name) => {
      // `in` reaches the prototype, so these four resolved to inherited members
      // and put `function toString() { [native code] }` into the sentence. The
      // same defect `chipClassFor` records as a paid-for lesson, in the helper
      // whose contract is "a placeholder nobody supplied is marked where it
      // stands".
      // The placeholder NAME has to be the prototype member — passing
      // `{toString: 'x'}` for a `{account}` message proves nothing, because
      // `'account' in {toString:'x'}` is false either way. Measured: the first
      // version of this cell survived its own mutation for exactly that reason.
      //
      // No dictionary key has such a placeholder and none should, so one is
      // injected the way the unresolvable-key cell below injects a key, and
      // restored in a `finally`.
      const dictionary = MESSAGES.en as unknown as Record<string, string>;
      const probeKey = 'test.prototypePlaceholder';
      dictionary[probeKey] = `value {${name}}`;
      try {
        const rendered = translate('en', probeKey as MessageKey, {});
        expect(rendered, name).toBe(`value ${missingMarker(name)}`);
      } finally {
        Reflect.deleteProperty(dictionary, probeKey);
      }
    },
  );

  it('still substitutes an own property', () => {
    // The allow side: a guard that marked everything would satisfy the cell
    // above and break every parameterised message.
    expect(translate('en', 'table.selectAccount', { account: 'a-1' })).toBe('Select a-1');
  });

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
    // here, so no unit test can render either one — but both ARE exercised end
    // to end, which the earlier wording ("untested") understated:
    // labeling.spec.ts pins the `.one` branch and apps.spec.ts the `.other`.
    // What is genuinely unobserved is the SECOND branch at each site — one axis
    // and one side each (RT10) — which is a narrower and more actionable
    // statement than one that points a future cycle at a jsdom project it does
    // not need.
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

  it('refuses a value outside the locale set rather than interpolating it', () => {
    // MEMBERSHIP AT BOTH ENDS. The reader decided by `LOCALES.includes`; the one
    // caller decided by an `as Locale` cast, and this function interpolated the
    // result straight into a cookie GRAMMAR. Closed by construction today, but
    // the module's obvious next step — negotiation from Accept-Language, or a
    // `?lang=` parameter — makes an attribute injection out of it.
    // `domain`, not `max-age`. Duplicate attributes resolve last-wins — in the
    // parser here AND in a browser per RFC 6265 §5.2 — so injecting an
    // attribute the writer also emits is overridden by the real one and proves
    // nothing. Measured: the first version of this cell survived its own
    // mutation. An attribute the writer never emits is the one that takes
    // effect, and rescoping the cookie to a parent domain is the reason to care.
    const attacked = localeCookie('en; domain=evil.example' as never);

    expect(attributes(attacked).get(LOCALE_COOKIE)).toBe(DEFAULT_LOCALE);
    expect(attributes(attacked).has('domain'), 'an injected attribute survived').toBe(false);
    // The allow side: a guard that rewrote everything to the default would
    // satisfy the assertions above and break the control.
    expect(attributes(localeCookie('ja')).get(LOCALE_COOKIE)).toBe('ja');
  });

  it('adds Secure on https and omits it on plain http', () => {
    // The first version declined `Secure` outright, reasoning the attribute
    // "would make the control silently stop working on any plain-HTTP
    // deployment". The session cookie in apps/api resolves the same constraint
    // conditionally, from the deployment's scheme — the conditional form was
    // already the house pattern, and this asserts both directions of it.
    const original = globalThis.location;
    try {
      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'https:' },
        configurable: true,
      });
      expect(attributes(localeCookie('ja')).has('secure')).toBe(true);

      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'http:' },
        configurable: true,
      });
      expect(attributes(localeCookie('ja')).has('secure')).toBe(false);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, 'location');
      } else {
        Object.defineProperty(globalThis, 'location', {
          value: original,
          configurable: true,
        });
      }
    }
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

    // The DICTIONARY IS EXCLUDED, and forgetting that is what made the first
    // version of this detector a tautology: every key appears in messages.ts as
    // a quoted literal, so `code.includes("'key'")` was true by construction and
    // `orphans` was always empty. Measured by all three reviewers — an injected
    // `'zzz.orphan'` left the suite green. It was written to close exactly the
    // class it then failed to detect.
    const DICTIONARY = path.join(SRC, 'lib', 'i18n', 'messages.ts');
    const scanned = await sources(SRC);
    // Asserted on the UNFILTERED set. `not.toContain` on the filtered one is
    // guaranteed by the filter and cannot fail — and it held equally when
    // DICTIONARY named no real file, which is the single failure it was
    // captioned for: a rename or split of messages.ts makes the filter a no-op
    // and the detector a tautology again. Measured.
    expect(scanned, 'the dictionary path no longer resolves').toContain(DICTIONARY);

    const files = scanned.filter((f) => f !== DICTIONARY);
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
