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
 * Not handled: a regex literal containing `/*`, which would open a phantom
 * block comment. Unreachable in tables.ts today — it contains no regex literal
 * — but stated rather than assumed, since the next regex added to the scanned
 * file is what would turn this note into a false green.
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
