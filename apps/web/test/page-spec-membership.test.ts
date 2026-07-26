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
    const specSources = await Promise.all(
      specFiles.map(async (file) => readFile(path.join(SPEC_DIR, file), 'utf8')),
    );

    const uncovered = pageDirs.filter((dir) => {
      if (EXEMPT.has(dir)) return false;
      // The first segment is the route; a dynamic segment below it
      // (identities/[identityId]) is reached through the same prefix.
      const route = dir.split(path.sep)[0]!;
      // goto('/route'), goto('/route?…'), goto('/route/…') all count; goto('/routes')
      // must not, hence the boundary.
      const visits = new RegExp(`goto\\(\`?['\`]?/${route}(?![a-z0-9-])`, 'i');
      return !specSources.some((source) => visits.test(source));
    });

    expect(uncovered, `pages no E2E spec navigates to: ${uncovered.join(', ')}`).toEqual([]);
  });
});
