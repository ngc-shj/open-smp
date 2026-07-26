import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// C32/I32.4. Whether a pinned SHA RESOLVES needs CI; whether every `uses:` line
// IS SHA-pinned is a static property of a text file, so it belongs in the
// cheapest job. Without this the control decays on the first `uses:` line a
// later cycle adds: nothing fails, and CI stays green, because a tag-pinned
// action works perfectly well.
//
// An allowlist, not a denylist. Enumerating the bad forms (@v5, @main, ...)
// misses short SHAs, non-v tags, sub-path actions (owner/repo/path@ref), and
// docker:// refs. Matching only the good form rejects all of them by
// construction.
//
// The trailing "# vN" is mandatory: it is what makes a Dependabot bump
// reviewable and lets a reader see what is pinned. The version pattern is
// [\w.-]+ rather than \d+ because Dependabot writes the resolved tag, which is
// commonly dotted (# v5.0.1) — requiring bare digits would have failed the gate
// on every bump PR, i.e. broken the update path this pin depends on.
const PINNED = /^[ \t]*(-[ \t]+)?uses:[ \t]*[\w.-]+\/[\w.-]+(\/[\w.-]+)*@[0-9a-f]{40}[ \t]+#[ \t]*v[\w.-]+[ \t]*$/;

async function workflowFiles(): Promise<string[]> {
  const dir = path.join(import.meta.dirname, '..', '..', '..', '.github', 'workflows');
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).map((name) => path.join(dir, name));
}

describe('C32 acceptance: every GitHub Action is pinned to a commit SHA', () => {
  it('every uses: line in .github/workflows matches the pinned form', async () => {
    const files = await workflowFiles();
    expect(files.length).toBeGreaterThan(0);

    const usesLines: { file: string; line: string }[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const line of source.split('\n')) {
        if (/^[ \t]*(-[ \t]+)?uses:/.test(line)) {
          usesLines.push({ file: path.basename(file), line });
        }
      }
    }

    // Anti-vacuity: a glob that stops matching, or a workflow file moved, would
    // otherwise leave a passing state indistinguishable from a working one. A
    // non-zero check rather than an exact count — the exact number would be a
    // hand-synced constant of the kind this cycle exists to remove.
    expect(usesLines.length).toBeGreaterThan(0);

    const unpinned = usesLines.filter(({ line }) => !PINNED.test(line));
    expect(unpinned, `unpinned action references: ${JSON.stringify(unpinned)}`).toEqual([]);
  });

  // The gate must be shown able to fire, and on the forms a real regression
  // would take — not only the one-line happy path.
  it.each([
    ['a mutable major tag', '      - uses: actions/checkout@v5'],
    ['a branch ref', '      - uses: actions/checkout@main'],
    ['a non-main branch', '      - uses: actions/checkout@develop'],
    ['a short SHA', '      - uses: actions/checkout@fbc6f39 # v5'],
    ['a non-v tag', '      - uses: actions/checkout@4.0.0'],
    ['a docker ref', '      - uses: docker://alpine:3.19'],
    ['a local composite action', '      - uses: ./.github/actions/local'],
    [
      'a SHA with no version comment',
      '      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
    ],
    [
      'a SHA with a non-version comment',
      '      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # pinned',
    ],
    [
      'uppercase hex',
      '      - uses: actions/checkout@FBC6F3992D24B796D5A048FF273F7FCC4A7B6C09 # v5',
    ],
  ])('rejects %s', (_label, line) => {
    expect(PINNED.test(line)).toBe(false);
  });

  it.each([
    ['a pinned action', '      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5'],
    [
      'a Dependabot-bumped dotted version',
      '      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.0.1',
    ],
    [
      'a sub-path action',
      '      - uses: owner/repo/sub/path@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v4',
    ],
    [
      'a step-level uses (no leading dash)',
      '        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4',
    ],
  ])('accepts %s', (_label, line) => {
    expect(PINNED.test(line)).toBe(true);
  });
});
