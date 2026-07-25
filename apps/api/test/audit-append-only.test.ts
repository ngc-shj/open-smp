import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// C19/I19.4: discovery_events is the audit trail, so no API path may rewrite
// it. Migration 0005 revokes UPDATE/DELETE from opensmp_app, which is the
// primary control — this test is the source-level companion, catching a
// would-be mutation at review time rather than at runtime. Same shape as
// no-rotation-route.test.ts, which is the established idiom here.
//
// Scope: statements naming the table literally, anywhere under apps/api/src.
// A dynamically-built table name would evade it; the database privilege is
// what backstops that case.
const MUTATION_PATTERN = /(UPDATE|DELETE)[\s\S]{0,40}discovery_events/i;

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

describe('C19/I19.4 acceptance: no apps/api source mutates discovery_events', () => {
  it('no file under apps/api/src/ issues UPDATE or DELETE against discovery_events', async () => {
    const srcDir = path.join(import.meta.dirname, '..', 'src');
    const files = await collectSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, `${path.relative(srcDir, file)} must not mutate discovery_events`).not.toMatch(
        MUTATION_PATTERN,
      );
    }
  });
});
