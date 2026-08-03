import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOT_COPY, findUntranslatedLiterals } from './untranslated-literals';

// i18n/C2. The plan named the hard part, and it is not the string count: it is
// that a PARTIAL migration looks finished. A page half-extracted renders
// correctly in English and reads correctly to whoever wrote it, so nothing
// about it says "unfinished".
//
// This makes the remainder a number in the repository, and RATCHETS it. The
// budget below may only go down. That is weaker than "no literal remains" and
// it is what can actually be asserted today — the detector is a starting filter
// over JSX, not a decision procedure, and its residue is stated in its own
// file.

const SRC = path.join(import.meta.dirname, '..', 'src');

/**
 * How many user-facing literals are not yet translated, per file.
 *
 * Measured, not chosen. Every entry is work C2 has not finished; an entry
 * reaching zero should be deleted rather than left at 0, so the map shrinks in
 * both dimensions.
 *
 * C2 drained it. The one entry left is NOT untranslated copy — it is the
 * detector's own residue, kept as a budget rather than silenced in the
 * allowlist because the allowlist is keyed by TEXT and this text is a fragment
 * of one file's source. Keeping it here means a real literal added to that file
 * still reds (2 > 1); moving it to the allowlist would have exempted the string
 * everywhere.
 */
const BUDGET: Record<string, number> = {
  // `) : app.anonymous ? (` — the middle of a three-way ternary, sitting
  // between a `</span>` and a `<span`, with two identifiers long enough to
  // satisfy the word rule. The discriminator is deliberately one rule and this
  // is what that costs (SC60): the alternative is an exclusion list that grows
  // with every expression shape.
  'app/discovery/page.tsx': 1,
};

async function tsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await tsxFiles(full)));
    // `.ts` as well as `.tsx`: this contract MOVED user-facing English out of
    // three `.ts` modules (label-kinds, label-filters, audit-transition), so a
    // `.ts` file under apps/web/src demonstrably holds copy and can again. The
    // attribute scan then also covers a `.ts` file that builds one.
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe('i18n/C2: the untranslated remainder only shrinks', () => {
  it('no file carries more untranslated copy than its budget, and none is missing from it', async () => {
    const files = await tsxFiles(SRC);
    expect(files.length).toBeGreaterThan(0);

    const overBudget: string[] = [];
    const stale: string[] = [];

    for (const file of files) {
      const rel = path.relative(SRC, file);
      const found = findUntranslatedLiterals(rel, await readFile(file, 'utf8'));
      const budget = BUDGET[rel] ?? 0;

      if (found.length > budget) {
        overBudget.push(`${rel}: ${found.length} > ${budget} — ${found.map((f) => JSON.stringify(f.text)).join(', ')}`);
      }
      // A budget that is now too generous is the ratchet slipping: the entry
      // stops resisting the next literal added to that file.
      if (found.length < budget) {
        stale.push(`${rel}: ${found.length} < ${budget}, lower or delete the entry`);
      }
    }

    expect(overBudget, 'untranslated copy added').toEqual([]);
    expect(stale, 'budget no longer tight').toEqual([]);
  });

  it('the not-copy allowlist is exactly what review agreed to', () => {
    // T3: once the remainder reached zero, adding ANY string to `NOT_COPY` left
    // both assertions above untouched — the allowlist became a free widening of
    // the gate, keyed by text so one entry exempts that string across all of
    // apps/web. That is how `google-workspace` outlived its own subject and had
    // to be removed by hand a contract later.
    //
    // Pinned by exact equality, the way CONTROL_FILES is pinned in
    // package-test-parity.test.ts, so an addition reds and has to carry its
    // reason in the diff that makes it. That is what the set's own docstring —
    // "each needs a reason" — is trying to buy.
    expect([...NOT_COPY].sort(), 'the not-copy allowlist changed').toEqual(
      ['CSV', 'open-smp', 'saasAppId'].sort(),
    );
  });

  it('every budgeted file still exists', async () => {
    // A file renamed or deleted leaves its budget behind, and the leftover
    // entry then silently permits that many literals somewhere else the day
    // the name is reused.
    const files = new Set((await tsxFiles(SRC)).map((f) => path.relative(SRC, f)));

    expect(Object.keys(BUDGET).filter((f) => !files.has(f))).toEqual([]);
  });
});

describe('the detector itself', () => {
  it('reports a JSX text node a person reads', () => {
    expect(findUntranslatedLiterals('f.tsx', '<span>Accounts</span>')).toEqual([
      { file: 'f.tsx', text: 'Accounts' },
    ]);
  });

  it.each([
    ['double-quoted', '<input aria-label="Contract CSV" />', 'Contract CSV'],
    // The one-character bypass review round 1 closed. JSX permits single quotes
    // and nothing in this repo enforces the style — no Prettier config, and the
    // eslint config carries neither `jsx-quotes` nor the React plugin.
    ['single-quoted', "<input aria-label='Contract CSV' />", 'Contract CSV'],
    // The hole that CLOSING it opened, which is the larger of the two: the first
    // fix shared one body class between both quote forms, so an apostrophe — the
    // common case in English UI copy — went from found to missed.
    ['an apostrophe inside double quotes', `<input aria-label="Owner's name" />`, "Owner's name"],
    ['a double quote inside single quotes', `<input aria-label='He said "no"' />`, 'He said "no"'],
  ])('reports a %s copy attribute', (_label, source, expected) => {
    expect(findUntranslatedLiterals('f.tsx', source)).toEqual([{ file: 'f.tsx', text: expected }]);
  });

  it('scans copy attributes in a .ts module, where this contract found copy before', () => {
    // The widening's own subject, which nothing in `src` supplies today — so
    // reverting the file set to `.tsx` left the suite green and the change had
    // no observer at all.
    expect(findUntranslatedLiterals('lib/x.ts', '<input placeholder="Search apps" />')).toEqual([
      { file: 'lib/x.ts', text: 'Search apps' },
    ]);
  });

  it('does not run the JSX text scan on a .ts module', () => {
    // The other side of the same branch. Generics and comparisons are constant
    // in `.ts` and rare in `.tsx`, so running the text scan there reported
    // `(path: string): Promise` as copy on the first widened run.
    expect(findUntranslatedLiterals('lib/x.ts', 'function f(p: string): Promise<void> {}')).toEqual(
      [],
    );
    // The allow side: the same source in a .tsx file is still scanned.
    expect(findUntranslatedLiterals('f.tsx', '<span>Accounts</span>')).toHaveLength(1);
  });

  it.each([
    ['a trailing comment', 'const x = 1; // <span>Accounts</span>', 0],
    ['a whole-line comment', '  // <span>Accounts</span>', 0],
    // The bug the anchor was added for: a `//` inside a string used to delete the
    // rest of its line, taking the bounding `<` with it.
    ['a URL inside a string', `const u = 'http://x.example/docs';\n<span>Accounts</span>`, 1],
  ])('handles %s', (_label, source, expected) => {
    expect(findUntranslatedLiterals('f.tsx', source)).toHaveLength(expected);
  });

  it('leaves a translated node alone', () => {
    // The shape this exists not to flag. A detector that reported it would make
    // finishing the migration impossible.
    expect(findUntranslatedLiterals('f.tsx', "<span>{t('nav.accounts')}</span>")).toEqual([]);
  });

  it.each([
    ['a TypeScript generic', "const [s, set] = useState<Status>('idle');\nconst x = 1;"],
    ['an arrow between angle brackets', 'items.filter((a) => a.n > 0 && a.n < 9)'],
  ])('does not report %s as copy', (_label, source) => {
    // Measured on the first two runs: `>` and `<` are also generics and
    // comparisons, so the regex matched across code and reported it as a
    // label. The discriminator is ONE rule — copy contains a run of two or
    // more letters — rather than a list of operators to exclude, because a
    // list would grow with every new expression shape and a filter whose
    // exclusion list keeps acquiring members is at the wrong level (SC60).
    expect(findUntranslatedLiterals('f.tsx', source)).toEqual([]);
  });

  it('still reports copy that contains parentheses and commas', () => {
    // The paired direction: a discriminator wide enough to remove the false
    // positives above by excluding punctuation would drop this, which is real
    // copy on the licences page.
    expect(findUntranslatedLiterals('f.tsx', '<span>(1 left, 1 unknown)</span>')).toHaveLength(1);
  });

  it('ignores comments', () => {
    expect(findUntranslatedLiterals('f.tsx', '{/* <span>Accounts</span> */}')).toEqual([]);
  });

  it('does not report punctuation that is the same in every locale', () => {
    expect(findUntranslatedLiterals('f.tsx', '<td>—</td>')).toEqual([]);
  });
});
