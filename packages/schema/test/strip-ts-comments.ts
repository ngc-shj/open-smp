/**
 * Strip TypeScript comments without touching string literals.
 *
 * A COPY of apps/api/test/strip-ts-comments.ts's body, not an import:
 * packages/schema does not depend on apps/api, so a cross-package test import
 * would either fail to resolve or drag a foreign path into this package's
 * typecheck program. The function is pure and import-free, which is what makes
 * copying it cheaper than the dependency edge.
 *
 * String-literal awareness matters in both directions: a `//` inside a string
 * is not a comment, and treating it as one swallows real code and reds the gate
 * for a reason unrelated to what it asserts.
 *
 * Not the two-regex form at apps/api/test/api-types-boundary.test.ts:35-37.
 * That form strips block comments first, so a block-comment OPENER inside a
 * string deletes everything up to the next terminator — the false-GREEN
 * direction for a negative literal check, and tables.ts is dense with sql`…`
 * templates.
 *
 * Not handled. Symptoms 1 and 2 delete real code, which for a NEGATIVE literal
 * check means the gate passes on a file that should red. Symptom 3 runs the
 * other way first — it leaves genuine comments unstripped, redding an intact
 * file — and reaches false green only via a second construct downstream. (Writing a block-comment terminator literally in this docstring
 * would close THIS comment, which is the same class one level up. It did once.)
 *
 *   1. **Regex literals are not recognised at all.** The scanner knows `'`,
 *      `"`, backtick, `//` and the block-comment opener, and nothing else, so a
 *      `/…/` body is scanned as code. One cause, three symptoms: an opener
 *      inside it starts a phantom block comment; a `//` inside a character
 *      class starts a phantom line comment (`/[//]/` is valid — an unescaped
 *      `/` is legal in a class, which is why the earlier note's `/a/*b/`
 *      dismissal was the wrong example); and an ODD number of quote characters
 *      inside it flips the string/code phase for the whole remainder of the
 *      file, after which an opener sitting in a genuine string is treated as
 *      real. The third has the widest blast radius.
 *   2. A template literal whose `${…}` interpolation nests a backtick ends the
 *      string region early, so the rest of the real string is scanned as code.
 *
 * The amplifier both share: the `'` and `"` scan is NOT newline-terminated —
 * it runs to the next matching quote anywhere in the file, or to EOF. TypeScript
 * forbids those strings spanning a newline, so a stray quote from any source
 * turns into a file-wide phase offset rather than a one-line one. That is the
 * property with the bounded fix (stop the scan at a newline), and it is why
 * symptom 3 has the widest blast radius.
 *
 * Both are unreachable in the file this copy scans: tables.ts carries eleven
 * `sql` templates, ten with interpolations, none nesting a backtick, and no
 * regex literal at all. That is a measurement, not a property.
 */
export function stripTsComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += source.slice(i, Math.min(j + 1, source.length));
      i = j + 1;
    } else if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}
