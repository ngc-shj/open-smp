/**
 * Strip TypeScript comments without touching string literals.
 *
 * Used by the source-text gates that assert a module derives its statuses from
 * the shared domain rather than re-spelling them. Those gates search for quoted
 * status literals, and a scan over raw source cannot tell a re-inlined union
 * from a comment that merely mentions `'orphan'` — so an ordinary explanatory
 * comment would red a file whose derivation is intact.
 *
 * String-literal awareness matters in both directions: a `//` inside a string
 * is not a comment, and treating it as one swallows real code and reds the gate
 * for a reason unrelated to what it asserts.
 *
 * Not handled: **regex literals are not recognised at all.** The scanner knows
 * quotes, backticks and comment openers and nothing else, so a `/…/` body is
 * scanned as code. One cause, three symptoms: an opener inside it starts a
 * phantom block comment; a `//` inside a character class starts a phantom line
 * comment; and an odd number of quote characters inside it flips string/code
 * phase for the rest of the file. All delete real code, which is the
 * false-GREEN direction for a negative check.
 *
 * A second, separate mechanism: a template literal whose `${…}` interpolation
 * nests a backtick ends the string region early, so the remainder of the real
 * string is scanned as code. THAT ONE IS THE LIVE HAZARD FOR THIS COPY —
 * the file it scans carries an interpolating template.
 *
 * Neither is reachable today; that is a measurement, not a property. The
 * earlier note here dismissed the class with `/a/*b/`, which is indeed invalid
 * TypeScript — but `/[//]/` is valid and reproduces it, so the dismissal rested
 * on the wrong example.
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
