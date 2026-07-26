import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// C29/I29.5 control 3, and SC38's exit condition.
//
// C29's fail-closed argument rests on three app-enforced controls, not on the
// append-only migration (which revokes UPDATE and DELETE, necessarily not
// INSERT). Two of the three are gated elsewhere: the single insert site by
// audit-append-only.test.ts, and AUDIT_SOURCE by being one constant. The third
// — that `saas_apps.key` is pinned to a literal — was a single line in one
// route file with nothing watching it.
//
// It matters because `discovery_events.source` is `app.key` for sync events and
// 'label' for audit events. An operator who could register an app with
// key = 'label' would produce sync rows indistinguishable from audit records
// under ?source=label, and sync payloads carry connector-supplied content
// (apps/worker/src/sync.ts:157,178). SC38 defers a signal on the projection's
// reject branch on the grounds that the branch is unreachable; this is what
// makes "SC30 was lifted" observable rather than something a future cycle has
// to remember.
//
// Bound to the VALUE, not to the form. A gate written as "key: z.<not literal>"
// fires on z.enum and z.string but passes `z.literal('label')` — a one-token
// edit that defeats the whole argument — and passes a file move.
const PINNED_KEY = "key: z.literal('google-workspace')";
const SEEDED_KEY = 'google-workspace';

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('C29/I29.5 control 3: saas_apps.key stays pinned to one literal', () => {
  it('declares a zod `key` field exactly once, and it is the google-workspace literal', async () => {
    const srcDir = path.join(import.meta.dirname, '..', 'src');
    const files = await collectSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    // Every zod object field named `key`, wherever it lives. Scoped to the
    // whole of apps/api/src rather than to saas-apps.ts, so extracting the
    // schema to a shared module does not carry it out of the gate silently.
    const declarations: { file: string; text: string }[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/key:\s*z\.[^,\n]*/g)) {
        declarations.push({ file: path.relative(srcDir, file), text: match[0].trim() });
      }
    }

    // The count is the anti-file-move device: a second schema, or the same one
    // relocated and duplicated, fails here rather than escaping the glob.
    expect(
      declarations,
      `expected exactly one zod key declaration, found: ${JSON.stringify(declarations)}`,
    ).toHaveLength(1);
    expect(declarations[0]!.text).toBe(PINNED_KEY);
  });

  it('seeds the same key value the schema pins', async () => {
    // seed.ts writes saas_apps.key directly, with no schema in the path — so
    // the column has two authors and the control is about the column, not the
    // route.
    const seed = await readFile(path.join(import.meta.dirname, '..', 'src', 'seed.ts'), 'utf8');

    expect(seed).toContain(`'${SEEDED_KEY}'`);
  });
});
