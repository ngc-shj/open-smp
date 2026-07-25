import { readdir } from 'node:fs/promises';
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

// The root page is a redirect shell with no content of its own, and /login is
// covered by auth.spec.ts under a name that does not match its directory.
const EXEMPT = new Map([
  ['', 'root redirect, no content to assert'],
  ['login', 'covered by auth.spec.ts'],
]);

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

    const specs = (await readdir(SPEC_DIR)).filter((file) => file.endsWith('.spec.ts'));
    expect(specs.length).toBeGreaterThan(0);

    const uncovered = pageDirs.filter((dir) => {
      if (EXEMPT.has(dir)) return false;
      // A dynamic segment names the feature, not the route: identities/[id] is
      // covered by identity.spec.ts. Accept either the directory name or its
      // singular form ("identities" -> "identity", "accounts" -> "account").
      const feature = dir.split(path.sep)[0]!;
      const singular = feature.replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
      return !specs.some(
        (spec) => spec.startsWith(`${feature}.`) || spec.startsWith(`${singular}.`),
      );
    });

    expect(uncovered, `pages without an E2E spec: ${uncovered.join(', ')}`).toEqual([]);
  });
});
