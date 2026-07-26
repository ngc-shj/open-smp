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
// Deliberately anchored to the block-sequence form. A YAML flow mapping
// (`- {uses: ...}`) is detected by the collector above but cannot satisfy this,
// even when correctly pinned — so the gate demands block form. That is
// fail-closed and intentional: `#` inside a flow mapping is not a comment (YAML
// 1.2 §6.6 requires preceding whitespace, and `}` would end up inside the
// scalar), so there is no way to carry the mandatory version comment in that
// form. Forcing the one shape the comment can live in is the point.
const PINNED = /^[ \t]*(-[ \t]+)?uses:[ \t]*[\w.-]+\/[\w.-]+(\/[\w.-]+)*@[0-9a-f]{40}[ \t]+#[ \t]*v[\w.-]+[ \t]*$/;

// What counts as a line to check. Kept separate from PINNED because the two
// fail differently: a line PINNED rejects fails loudly, a line this misses is
// never examined at all.
const USES_LINE = /(^|[\s{,])uses[ \t]*:/;

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
        // Any `uses:` key, wherever it sits on the line — not only the
        // block-sequence form. YAML flow mappings are valid GitHub Actions
        // syntax (`- {uses: actions/checkout@v5}`), and an anchored detector
        // never collects them, so such a step would escape the allowlist
        // entirely rather than failing it. The non-zero count guard does not
        // help: the ten block-form lines keep it satisfied.
        if (USES_LINE.test(line)) {
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
    // Flow-mapping steps are valid Actions syntax. An anchored detector never
    // collected them, so one would have escaped the allowlist entirely rather
    // than failing it.
    ['a flow-mapping step', '      - {uses: actions/checkout@v5}'],
    ['a flow mapping with more keys', '      - { uses: actions/checkout@v5, with: {ref: main} }'],
  ])('rejects %s', (_label, line) => {
    expect(PINNED.test(line)).toBe(false);
  });

  // The detector is half the control: a line it does not collect is never
  // checked against PINNED at all, and the non-zero count guard stays satisfied
  // by the block-form lines around it.
  it.each([
    ['a block-form step', '      - uses: actions/checkout@v5'],
    ['a flow-mapping step', '      - {uses: actions/checkout@v5}'],
    ['a flow mapping with more keys', '      - { uses: actions/checkout@v5, with: {ref: main} }'],
    ['a step-level uses', '        uses: actions/upload-artifact@v4'],
  ])('collects %s so it cannot escape the allowlist unseen', (_label, line) => {
    expect(USES_LINE.test(line)).toBe(true);
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
