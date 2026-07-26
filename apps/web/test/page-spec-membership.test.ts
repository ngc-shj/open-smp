import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// I26.6 / R42-B: every page under apps/web/src/app has an E2E spec. The class
// is derived from the filesystem rather than from a hand-kept list, so a page
// added without a spec fails here instead of silently shipping unexercised.
//
// The glob must recurse: a single-level scan does not reach a nested dynamic
// route like identities/[identityId]/page.tsx, which is exactly the shape the
// invariant is most likely to miss.
const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');
const APP_DIR = path.join(REPO_ROOT, 'apps', 'web', 'src', 'app');
const SPEC_DIR = path.join(REPO_ROOT, 'e2e', 'specs');

// Only the root page is exempt: it is a redirect shell with no content of its
// own, so there is no route for a spec to assert against. /login is NOT exempt —
// auth.spec.ts navigates to it, and matching on navigation rather than on spec
// filenames means it needs no special case.
const EXEMPT = new Map([['', 'root redirect, no content to assert']]);

/**
 * Removes the parts of a spec that do not run: comments, and the bodies of
 * `test.skip` / `test.fixme`. A route reached only from one of those is not
 * exercised, and counting it as coverage is how the guard reports green over a
 * page nothing visits.
 *
 * Skipped bodies are cut by brace matching from the call's opening paren, which
 * is enough for the one-test-per-call shape every spec here uses.
 */
export function executableSource(source: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  let result = '';
  let index = 0;
  const skipped = /\b(?:test|it|describe)\.(?:skip|fixme|todo)\s*\(/g;
  let match = skipped.exec(withoutComments);
  while (match) {
    result += withoutComments.slice(index, match.index);
    let depth = 1;
    let cursor = skipped.lastIndex;
    while (cursor < withoutComments.length && depth > 0) {
      if (withoutComments[cursor] === '(') depth += 1;
      else if (withoutComments[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    index = cursor;
    skipped.lastIndex = cursor;
    match = skipped.exec(withoutComments);
  }
  return result + withoutComments.slice(index);
}

async function findPageDirs(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...(await findPageDirs(path.join(dir, entry.name), path.join(prefix, entry.name))));
    } else if (entry.name === 'page.tsx') {
      found.push(prefix);
    }
  }
  return found;
}

describe('I26.6/R42-B acceptance: every web page has an E2E spec', () => {
  it('each page directory maps to a spec covering it', async () => {
    const pageDirs = await findPageDirs(APP_DIR);
    // Guards against a broken traversal reporting a vacuous pass.
    expect(pageDirs.length).toBeGreaterThan(4);

    const specFiles = (await readdir(SPEC_DIR)).filter((file) => file.endsWith('.spec.ts'));
    expect(specFiles.length).toBeGreaterThan(0);

    // Match on NAVIGATION, not on filenames. A name-based match passes as soon
    // as some spec happens to share the route's word — `sync.spec.ts` exists but
    // only ever visits /accounts, so a new /sync page would look covered while
    // nothing exercised it. What the invariant actually claims is "some spec
    // visits this route", so that is what gets asserted.
    //
    // Text matching cannot fully express "this route is exercised", so the two
    // ways it lies are handled explicitly rather than left implicit. Comments are
    // stripped and skipped tests are excised before matching: a spec commented
    // out while debugging, or parked behind test.skip, would otherwise keep
    // reporting its page as covered — the realistic path to a false green. What
    // remains unhandled is navigation through a helper or a link click; those
    // read as uncovered here, which is the safe direction.
    const specSources = await Promise.all(
      specFiles.map(async (file) => executableSource(await readFile(path.join(SPEC_DIR, file), 'utf8'))),
    );

    const uncovered = pageDirs.filter((dir) => {
      if (EXEMPT.has(dir)) return false;
      // The first segment is the route; a dynamic segment below it
      // (identities/[identityId]) is reached through the same prefix.
      const route = dir.split(path.sep)[0]!;
      // goto('/route'), goto("/route"), goto(`/route`), with or without leading
      // whitespace; goto('/routes') must not match, hence the boundary.
      const visits = new RegExp(`goto\\(\\s*['"\`]/${route}(?![a-z0-9-])`, 'i');
      return !specSources.some((source) => visits.test(source));
    });

    expect(uncovered, `pages no E2E spec navigates to: ${uncovered.join(', ')}`).toEqual([]);
  });

  // This guard has now missed the property twice under two different matching
  // strategies — first by filename, then by raw text — so the ways it can lie
  // are pinned directly rather than trusted.
  const visitsSync = /goto\(\s*['"`]\/sync(?![a-z0-9-])/i;

  it.each([
    ['a line-commented navigation', `// await page.goto('/sync')`],
    ['a block-commented navigation', `/* await page.goto('/sync') */`],
    ['a TODO mentioning the route', `// TODO: add page.goto('/sync') coverage`],
    ['a skipped test', `test.skip('x', async () => { await page.goto('/sync'); });`],
    ['a fixme test', `test.fixme('x', async () => { await page.goto('/sync'); });`],
  ])('does not count %s as coverage', (_label, snippet) => {
    expect(visitsSync.test(executableSource(snippet))).toBe(false);
  });

  it.each([
    ['single quotes', `await page.goto('/sync');`],
    ['double quotes', `await page.goto("/sync");`],
    ['backticks', 'await page.goto(`/sync`);'],
    ['leading whitespace', `await page.goto( '/sync' );`],
    ['a query string', `await page.goto('/sync?status=orphan');`],
  ])('counts a real navigation written with %s', (_label, snippet) => {
    expect(visitsSync.test(executableSource(snippet))).toBe(true);
  });

  it('does not let a longer route satisfy a shorter one', () => {
    expect(visitsSync.test(executableSource(`await page.goto('/sync-history');`))).toBe(false);
  });

  it('keeps a live test in the same file as a skipped one', () => {
    const source = `test.skip('a', async () => { await page.goto('/other'); });
       test('b', async () => { await page.goto('/sync'); });`;
    expect(visitsSync.test(executableSource(source))).toBe(true);
  });
});
