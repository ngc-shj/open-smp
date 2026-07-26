import { describe, expect, it } from 'vitest';
import { buildEventsWhere } from '../src/routes/events.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CURSOR = { t: '2026-07-25T12:00:00.000Z', id: '22222222-2222-2222-2222-222222222222', s: null };

/**
 * True when the clause contains ` OR ` outside every parenthesised group.
 *
 * The invariant guarded here is that the cursor predicate never introduces a
 * top-level disjunction: `conditions.join(' AND ')` gives AND tighter binding,
 * so a bare `a < $1 OR (a = $1 AND b < $2)` term would leave the tenant
 * predicate applying to only the first branch. RLS still hides the rows, but
 * the clause would be wrong on its own terms.
 *
 * Asserting on the built clause rather than on the source text is deliberate:
 * a source scan binds to one authoring idiom and goes quiet as soon as the
 * predicate is hoisted into a variable, a helper, or a spread — the clause is
 * the same string either way.
 */
function hasTopLevelOr(clause: string): boolean {
  let depth = 0;
  for (let i = 0; i < clause.length; i++) {
    const char = clause[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && clause.startsWith(' OR ', i)) return true;
  }
  return false;
}

describe('C20 events WHERE clause', () => {
  it('the tenant-only clause is a single conjunct', () => {
    const { clause, values } = buildEventsWhere(TENANT, null, undefined);
    expect(clause).toBe('tenant_id = $1');
    expect(values).toEqual([TENANT]);
  });

  it('the source filter is parameterised, never interpolated', () => {
    const { clause, values } = buildEventsWhere(TENANT, null, 'label');
    expect(clause).toBe('tenant_id = $1 AND source = $2');
    expect(values).toEqual([TENANT, 'label']);
    expect(clause).not.toContain('label');
  });

  it('the cursor predicate is row-wise, so it carries no OR at all', () => {
    const { clause, values } = buildEventsWhere(TENANT, CURSOR, undefined);
    expect(clause).toBe('tenant_id = $1 AND (created_at, id) < ($2, $3)');
    expect(values).toEqual([TENANT, CURSOR.t, CURSOR.id]);
  });

  it('filter and cursor compose without renumbering the binds', () => {
    const { clause, values } = buildEventsWhere(TENANT, CURSOR, 'label');
    expect(clause).toBe('tenant_id = $1 AND source = $2 AND (created_at, id) < ($3, $4)');
    expect(values).toEqual([TENANT, 'label', CURSOR.t, CURSOR.id]);
  });

  it.each([
    ['tenant only', null, undefined],
    ['with source', null, 'label'],
    ['with cursor', CURSOR, undefined],
    ['with both', CURSOR, 'label'],
  ] as const)('no top-level OR: %s', (_label, cursor, source) => {
    expect(hasTopLevelOr(buildEventsWhere(TENANT, cursor, source).clause)).toBe(false);
  });

  // Proves the detector itself discriminates rather than always returning
  // false — without this the four assertions above would pass vacuously.
  it('the detector catches an unparenthesised disjunction and spares a wrapped one', () => {
    expect(hasTopLevelOr('tenant_id = $1 AND created_at < $2 OR (created_at = $2 AND id < $3)')).toBe(true);
    expect(hasTopLevelOr('tenant_id = $1 AND (created_at < $2 OR (created_at = $2 AND id < $3))')).toBe(false);
  });
});
