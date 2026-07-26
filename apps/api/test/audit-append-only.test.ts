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
//
// The source is normalised before matching — comments stripped, whitespace
// collapsed — so the window measures SQL distance rather than source
// formatting. A fixed character window against raw text is defeated by an
// ordinary multi-line statement or an interposed comment, which is a guard
// that reads as protection while providing none.
const MUTATION_PATTERN = /(UPDATE|DELETE)(?:(?!;)[\s\S]){0,200}?discovery_events/i;

function normalizeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');
}

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
      const source = normalizeSource(await readFile(file, 'utf8'));
      expect(source, `${path.relative(srcDir, file)} must not mutate discovery_events`).not.toMatch(
        MUTATION_PATTERN,
      );
    }
  });

  // The detector must be shown able to fire, and on the shapes a real edit
  // would take — not only the one-line form. A guard that passes its own
  // happy path while missing the realistic spelling is the failure mode this
  // review has hit repeatedly.
  it.each([
    ['single line', `await tx.query('UPDATE discovery_events SET kind = $1', [k]);`],
    [
      'multi-line with an interposed comment',
      `await tx.query(\`DELETE
         /* drop audit rows past the retention horizon */
         FROM discovery_events WHERE created_at < now()\`);`,
    ],
    [
      // This is the row that makes normalizeSource load-bearing. The two above
      // keep the DELETE→table gap inside the raw 200-char window, so they match
      // with or without normalization — they prove the pattern fires, not that
      // stripping does anything. Here the commentary pushes the raw gap past the
      // window and only the normalized form is within it.
      'a statement buried under comment prose',
      `await tx.query(\`DELETE
         /* Retention sweep. Audit rows are append-only by database privilege
            (migration 0005 revokes UPDATE/DELETE from opensmp_app), so this
            statement can only run as the migration owner. It exists for the
            operator-invoked purge described in the runbook, not for any API
            path, and must never be reachable from a request handler. */
         FROM discovery_events WHERE created_at < now()\`);`,
    ],
  ])('detects a mutation written as %s', (_label, snippet) => {
    expect(normalizeSource(snippet)).toMatch(MUTATION_PATTERN);
  });

  it('does not fire on the INSERT and SELECT paths the audit trail depends on', () => {
    const insert = `await tx.query(\`INSERT INTO discovery_events (tenant_id, source, kind, payload)
       VALUES ($1, $2, $3, $4::jsonb)\`);`;
    const select = `await tx.query('SELECT id, kind FROM discovery_events WHERE tenant_id = $1');`;
    expect(normalizeSource(insert)).not.toMatch(MUTATION_PATTERN);
    expect(normalizeSource(select)).not.toMatch(MUTATION_PATTERN);
  });
});
