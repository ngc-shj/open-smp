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
 * Not handled: a regex literal containing `/*`, which would open a phantom
 * block comment. Unreachable in the scanned files — neither contains a regex
 * literal, and `/a/*b/` is not valid TypeScript anyway — but stated rather
 * than assumed, since the next regex added to a scanned file is what would
 * turn this note into a false green.
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
