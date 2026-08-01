import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUntranslatedLiterals } from './untranslated-literals';

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
 */
const BUDGET: Record<string, number> = {
  'app/accounts/page.tsx': 16,
  'app/apps/page.tsx': 5,
  'app/discovery/page.tsx': 13,
  'app/events/page.tsx': 9,
  'app/identities/[identityId]/page.tsx': 15,
  'app/import/page.tsx': 17,
  'app/licenses/page.tsx': 13,
  'app/login/page.tsx': 4,
  'components/BulkLabelBar.tsx': 3,
  'components/ContractImportForm.tsx': 6,
  'components/LabelControl.tsx': 3,
  'components/SaasAppForm.tsx': 7,
  'components/SaasAppManager.tsx': 11,
  'components/SyncControl.tsx': 6,
};

async function tsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await tsxFiles(full)));
    else if (entry.name.endsWith('.tsx')) files.push(full);
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

  it('reports a copy attribute', () => {
    expect(findUntranslatedLiterals('f.tsx', '<input aria-label="Contract CSV" />')).toHaveLength(1);
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
