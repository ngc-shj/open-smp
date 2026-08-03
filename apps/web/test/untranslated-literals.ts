// i18n/C2's detector, exported so its own behaviour can be asserted rather than
// trusted.
//
// WHAT IT IS. A starting filter over JSX, not a decision procedure. Whether a
// literal is user-facing is a judgement — `"—"` is not copy, `"Accounts"` is,
// and both are strings between two angle brackets. The repository has recorded
// this class repeatedly (R47: surface-form adjudication where an interpreter
// defines the meaning), so this file states its residue instead of claiming
// completeness.
//
// WHAT IT CANNOT SEE, stated rather than discovered later:
//   - a literal inside a template expression: `{`Row ${n}`}`
//   - a literal passed as a prop to a component that renders it as copy
//   - a literal in a `const` above the JSX, which is where the two upload
//     error maps live
//   - a string assembled from parts
//   - JSX TEXT ADJACENT TO AN INTERPOLATION. `<p>Accounts for {name}</p>` is
//     reported as nothing: the text-node character class refuses to cross `{`,
//     so a run of real words beside an interpolated value is invisible.
//     Measured, and it is the cheapest way to add untranslated copy without
//     moving the number — which matters because it is also the shape this
//     contract's own placeholder design produces when a developer wraps the
//     value and leaves the words in English. NOT closed: widening the class to
//     `/>([^<>]*?)[<{]/g` surfaces the nine word-carrying runs that legitimately
//     sit before an interpolation today, and the budget entries that would take
//     are the ratchet slipping.
//   - a copy attribute whose name is not in COPY_ATTRIBUTES (`aria-description`,
//     `aria-placeholder`)
// Two bypasses found in review are CLOSED rather than listed: single-quoted
// copy attributes, and a `//` inside a string eating the rest of its line.
// The E2E marker assertion covers the opposite direction — a key that is wired
// and has no message — so the two together are wider than either.

/** Attributes whose string value reaches a person. */
const COPY_ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'];

/**
 * Literals that are not copy. Each needs a reason, because an allowlist without
 * one becomes the place findings go to be forgotten.
 */
export const NOT_COPY = new Set([
  // WORD-CARRYING ONLY. Eight entries used to sit here — `—` `-` `/` `,` `(`
  // `)` `·` `⟨` — and every one of them was unreachable: the scan skips any
  // text with no letter BEFORE it consults this set, so their membership could
  // never decide anything, and the test named for them was passing by the
  // letter rule. `audit-transition.ts` justified leaving `→` and `—` bare "on
  // the same ground the detector's allowlist uses", which pointed at code that
  // did not run. The letter rule is the real mechanism and says so; a Set entry
  // that cannot fire is worse than a comment, because it reads as a decision.
  'open-smp', // a product name
  'CSV', // an initialism that is not translated in either locale
  // An identifier an operator TYPES, not copy they read: `saasAppId` is the
  // field name the sync control's placeholder tells them to supply.
  //
  // `google-workspace` used to sit here for a hardcoded `<option>`. SC2/C3
  // replaced that with `{key}` rendered from CONNECTOR_APP_KEYS, which the
  // detector already ignores as an expression — so the entry outlived its
  // subject and silently permitted the literal anywhere in apps/web. Removed in
  // review; if it reds, a real hardcoded connector key has appeared.
  //
  // Exported and pinned by exact equality in untranslated-literals.test.ts. Once
  // the remainder reached zero this set could be widened at NO cost — every
  // addition left both the over-budget and the stale assertion untouched — and
  // it is keyed by text, so one entry exempts that string across all of
  // apps/web. That is how `google-workspace` survived its own subject.
  'saasAppId',
]);

export type Finding = { file: string; text: string };

function stripComments(source: string): string {
  // The `//` pass is deliberately anchored to a line whose first non-space
  // character starts the comment. Applied to raw source it also deleted the
  // remainder of any line containing `//` INSIDE a string — a docs link, a
  // support URL — and with it the `<` or `>` that would have bounded a real copy
  // literal, so the detector under-reported. No such string exists today; the
  // anchor is what keeps it that way.
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\S\n]*\/\/[^\n]*/gm, ' ');
}

/**
 * Text that a person reads, taken from JSX text nodes and copy attributes.
 *
 * A text node qualifies when it contains a letter and is not an expression. The
 * letter requirement is what keeps punctuation and layout glyphs out; the
 * expression exclusion is what keeps `{t('nav.accounts')}` out, which is the
 * shape this exists to leave alone.
 */
export function findUntranslatedLiterals(file: string, source: string): Finding[] {
  const code = stripComments(source);
  const findings: Finding[] = [];

  // THE TEXT-NODE SCAN IS JSX-ONLY, and this is what lets the attribute scan
  // reach `.ts`. `>` and `<` are also generics and comparisons, which is rare
  // enough in `.tsx` to budget and constant in `.ts` — widening the file set
  // without this split reported `(path: string): Promise` from api-server.ts on
  // the first run. A copy ATTRIBUTE is unambiguous in either.
  //
  // The file set matters because this contract MOVED user-facing English out of
  // three `.ts` modules, so `.ts` demonstrably holds copy and can again.
  const isJsx = file.endsWith('.tsx');

  for (const match of isJsx ? code.matchAll(/>([^<>{}]+)</g) : []) {
    const text = match[1]!.trim();
    if (text === '' || !/\p{L}/u.test(text)) continue;
    if (NOT_COPY.has(text)) continue;
    // `>` and `<` are also TypeScript generics and comparisons, so this regex
    // matches across `useState<Status>('idle')` and `a.n > 0 && a.n < 9`, and
    // reports the code between them as copy. Measured: both shapes on the
    // first two runs.
    //
    // The discriminator is deliberately ONE rule rather than a list of
    // operators to exclude. A list grows every time a new expression shape
    // appears between two angle brackets, and a filter whose exclusion list
    // keeps acquiring members is evidence the rule is at the wrong level —
    // which is a lesson this repository has already paid for once (SC60).
    //
    // The rule: copy contains a word. Code between comparisons is identifiers
    // and operators, and the identifiers that survive the slice are single
    // letters (`a.n` becomes `0 && a.n`). Anything a person reads has at least
    // one run of two or more letters, and "(1 left, 1 unknown)" — real copy
    // with punctuation — keeps qualifying.
    if (!/\p{L}{2,}/u.test(text)) continue;
    // The statement separator, kept because a multi-line slice can carry both
    // code and a two-letter identifier.
    if (/[;]|=>/.test(text)) continue;
    findings.push({ file, text });
  }

  for (const attribute of COPY_ATTRIBUTES) {
    // BOTH QUOTE FORMS. The double-quoted-only regex was a one-character
    // bypass: JSX permits single quotes and nothing in this repo enforces the
    // style — there is no Prettier config, and the eslint config carries
    // neither `jsx-quotes` nor the React plugin.
    for (const match of code.matchAll(new RegExp(`\\b${attribute}=(["'])([^"']+)\\1`, 'g'))) {
      const text = match[2]!.trim();
      if (text === '' || !/\p{L}/u.test(text)) continue;
      if (NOT_COPY.has(text)) continue;
      findings.push({ file, text });
    }
  }

  return findings;
}
