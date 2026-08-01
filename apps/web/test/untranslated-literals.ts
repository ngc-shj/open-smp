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
// The E2E marker assertion covers the opposite direction — a key that is wired
// and has no message — so the two together are wider than either.

/** Attributes whose string value reaches a person. */
const COPY_ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'];

/**
 * Literals that are not copy. Each needs a reason, because an allowlist without
 * one becomes the place findings go to be forgotten.
 */
const NOT_COPY = new Set([
  '—', // an em dash standing for "no value"; the same glyph in every locale
  '-',
  '/',
  ',',
  '(',
  ')',
  '·',
  '⟨', // the untranslated-key marker itself
  'open-smp', // a product name
  'CSV', // an initialism that is not translated in either locale
]);

export type Finding = { file: string; text: string };

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
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

  for (const match of code.matchAll(/>([^<>{}]+)</g)) {
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
    for (const match of code.matchAll(new RegExp(`\\b${attribute}="([^"]+)"`, 'g'))) {
      const text = match[1]!.trim();
      if (text === '' || !/\p{L}/u.test(text)) continue;
      if (NOT_COPY.has(text)) continue;
      findings.push({ file, text });
    }
  }

  return findings;
}
