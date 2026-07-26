import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from '@open-smp/api-types';
import {
  ACCOUNT_TABS,
  CHIP_CLASSES,
  CHIP_CLASS_FALLBACK,
  chipClassFor,
} from '../src/lib/link-statuses';

// C40 acceptance criteria 2-4. These assert against the same module StatusChip
// and the accounts page render from — not a transcription — which is why the
// map had to leave StatusChip.tsx: vitest cannot transform .tsx, and the map
// was not exported.

describe('C40/I40.3: the accounts tab order is pinned and differs from the domain', () => {
  it('renders the four tabs in triage-first order', () => {
    expect([...ACCOUNT_TABS]).toEqual(['orphan', 'ghost', 'ambiguous', 'matched']);
  });

  // The reason the tab list is hand-written rather than derived. If these ever
  // became equal, deriving the tabs would look safe and would silently reorder
  // a shipped UI the next time the migration order mattered.
  it('is deliberately not the domain order', () => {
    expect([...ACCOUNT_TABS]).not.toEqual([...LINK_STATUSES]);
  });

  it('covers every status in the domain exactly once', () => {
    expect([...ACCOUNT_TABS].sort()).toEqual([...LINK_STATUSES].sort());
  });
});

describe('C40/I40.5: chip classes are domain-keyed but read permissively', () => {
  it('maps every domain status to a distinct class', () => {
    const classes = LINK_STATUSES.map((status) => CHIP_CLASSES[status]);
    expect(classes).toEqual([
      'status-chip status-chip-matched',
      'status-chip status-chip-orphan',
      'status-chip status-chip-ghost',
      'status-chip status-chip-ambiguous',
    ]);
    expect(new Set(classes).size).toBe(LINK_STATUSES.length);
  });

  it('renders a domain status with its own class', () => {
    for (const status of LINK_STATUSES) {
      expect(chipClassFor(status)).toBe(CHIP_CLASSES[status]);
    }
  });

  // The permissive direction. The wire type is a bare `string` (AccountLink.status
  // and IdentityAccountItem.linkStatus are both string), so an unexpected value
  // must render a neutral chip rather than crash the page.
  it('falls back for a value outside the domain', () => {
    expect(chipClassFor('not_a_status')).toBe(CHIP_CLASS_FALLBACK);
    expect(chipClassFor('')).toBe(CHIP_CLASS_FALLBACK);
  });

  // Prototype keys are the case a `?? fallback` read silently gets wrong:
  // `CHIP_CLASSES['constructor']` is a function, which is not nullish, so the
  // fallback never fires and a non-string reaches className. The first draft of
  // chipClassFor had exactly that bug and these two inputs were what caught it.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'falls back for the prototype key %s',
    (key) => {
      expect(chipClassFor(key)).toBe(CHIP_CLASS_FALLBACK);
    },
  );

  // Guards against a fallback that accidentally becomes a real chip class:
  // then an out-of-domain value would render as though it were a known status.
  it('uses a fallback that is not any status class', () => {
    expect(Object.values(CHIP_CLASSES)).not.toContain(CHIP_CLASS_FALLBACK);
  });
});

describe('C40/I40.6: every chip class has a rule in globals.css', () => {
  // Site 9 is the one member of this class that cannot be derived — Tailwind's
  // `@apply` needs literal class names — so the agreement is gated instead. A
  // class name with no rule is neither a compile error nor a render error: the
  // chip loses its colour and nothing fails.
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

  it('reads a non-empty stylesheet', () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).toContain('.status-chip');
  });

  it('defines a rule for each status-specific class', () => {
    const missing = Object.values(CHIP_CLASSES)
      .flatMap((className) => className.split(/\s+/))
      .filter((token) => token !== 'status-chip')
      .filter((token) => !new RegExp(`\\.${token}\\s*\\{`).test(css));
    expect(missing).toEqual([]);
  });
});
