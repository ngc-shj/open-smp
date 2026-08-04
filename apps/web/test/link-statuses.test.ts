import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from '../src/lib/api-types';
import {
  ACCOUNT_TABS,
  CHIP_CLASSES,
  CHIP_CLASS_FALLBACK,
  IDENTITY_STATUS_KEYS,
  LINK_STATUS_KEYS,
  identityStatusKeyFor,
  chipClassFor,
  linkStatusKeyFor,
} from '../src/lib/link-statuses';
import { translate } from '../src/lib/i18n/translate';

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
  // Comments stripped: a rule commented out but left in place renders exactly
  // as a deleted one does, and matching raw text would count it as present.
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('reads a non-empty stylesheet', () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).toContain('.status-chip');
  });

  // Requires a rule that actually applies something, not merely a selector
  // token that appears somewhere. Both shapes that render a colourless chip
  // now fail: a rule whose body has been emptied (the `@apply` requirement),
  // and a rule commented out but left in place (comments stripped above).
  it('defines a non-empty rule for each status-specific class', () => {
    const missing = Object.values(CHIP_CLASSES)
      .flatMap((className) => className.split(/\s+/))
      .filter((token) => token !== 'status-chip')
      .filter((token) => !new RegExp(`\\.${token}\\s*\\{[^}]*@apply[^}]*\\}`).test(css));
    expect(missing).toEqual([]);
  });
});

describe('i18n: the link-status vocabulary reaches the dictionary', () => {
  it('covers the whole domain and resolves through a real message', () => {
    // The twin of label-kinds' map, missing until review round 1. This
    // vocabulary reaches the reader in three places — the accounts tab strip and
    // two chips — and none went through the dictionary, so `/accounts` under
    // `ja` read a translated column heading over English values.
    expect(Object.keys(LINK_STATUS_KEYS).sort()).toEqual([...LINK_STATUSES].sort());

    for (const status of LINK_STATUSES) {
      const rendered = translate('ja', LINK_STATUS_KEYS[status]);
      // Resolves to a real message, not the marker — and to JAPANESE, which is
      // what makes this more than a key-existence check.
      expect(rendered, status).not.toContain('⟨');
      expect(rendered, status).not.toBe(translate('en', LINK_STATUS_KEYS[status]));
    }
  });

  it('returns null for a status outside the domain rather than reaching the prototype', () => {
    // `chipClassFor`'s lesson, applied to the sibling read: five inputs broke
    // that helper because a bare index is not nullish for a prototype member.
    for (const outside of ['constructor', 'toString', 'valueOf', 'unknown-status']) {
      expect(linkStatusKeyFor(outside), outside).toBeNull();
    }
    // The allow side, or a helper that returned null for everything would pass.
    expect(linkStatusKeyFor('matched')).toBe('linkStatus.matched');
  });
});

describe('i18n: the identity-status vocabulary reaches the dictionary', () => {
  it('covers both members and translates each', () => {
    // This was an inline ternary until review round 2. It was exhaustive, so
    // nothing was wrong — but inverting it to always-`left` reddened NOTHING,
    // and a page telling an operator an active employee has left is the failure
    // that direction produces. A Record makes a third member a compile error;
    // the loop makes an untranslated one a red.
    expect(Object.keys(IDENTITY_STATUS_KEYS).sort()).toEqual(['active', 'left']);

    for (const status of ['active', 'left'] as const) {
      const ja = translate('ja', IDENTITY_STATUS_KEYS[status]);
      expect(ja, status).not.toContain('⟨');
      expect(ja, status).not.toBe(translate('en', IDENTITY_STATUS_KEYS[status]));
    }
    // Distinct from each other, or one key mapped to both would satisfy the loop.
    expect(translate('en', IDENTITY_STATUS_KEYS.active)).not.toBe(
      translate('en', IDENTITY_STATUS_KEYS.left),
    );
  });

  it.each(['constructor', 'toString', 'valueOf', 'suspended'])(
    'returns null for the out-of-domain status %s rather than reaching the prototype',
    (outside) => {
      // The deny case its link-status twin has had since round 1 and this one
      // did not — so the guard added in round 3 was revertible to `?? null`,
      // which returns a FUNCTION for the first three, with every gate green.
      // `suspended` is the fourth: the pgEnum here is a hand-written second
      // declaration, so a migration adding a member reaches this read without
      // touching the union, and the page must render it rather than `⟨undefined⟩`.
      expect(identityStatusKeyFor(outside)).toBeNull();
    },
  );

  it('resolves a member of the domain', () => {
    // The allow side, or a helper returning null for everything would pass.
    expect(identityStatusKeyFor('left')).toBe('identityStatus.left');
  });
});

describe('i18n: the E2E chip fixture matches the dictionary it mirrors', () => {
  it('every seeded chip is the en copy for its status', async () => {
    // THE SECOND DECLARATION. `chip` in e2e/fixtures/seed-facts.ts is
    // apps/web's `en` copy, kept there because a spec cannot import the
    // dictionary — e2e/package.json declares only @playwright/test and @types/node. Duplicating
    // at the outermost tier is right (deriving the expectation from the same
    // dictionary the page renders from asserts nothing), but nothing bound the
    // two, so a copy change reddened only the E2E behind a full compose boot.
    //
    // Read as text, the way seed-gate-agreement.test.ts reads this same file for
    // its other fields.
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await readFile(
      path.join(import.meta.dirname, '..', '..', '..', 'e2e', 'fixtures', 'seed-facts.ts'),
      'utf8',
    );

    // `[^}]*` between the fields, the way seed-gate-agreement.test.ts parses this
    // same file — the first version required `chip` to be the IMMEDIATELY next
    // property, so inserting a field between them dropped that entry silently.
    // Measured (account-status branch, Phase 3 round 2): the span buys ONLY the
    // inserted-field case. Reordering the two, or switching to double quotes,
    // still drops the entry — this sentence used to claim all three. What makes
    // a drop loud rather than silent is the derived count below, not the span.
    //
    // `[^']*`, not `[^']+`, on both captures: with `+` an emptied `chip: ''`
    // produces NO match rather than an empty capture, so it surfaces as a count
    // mismatch instead of naming the entry. Measured — 4 pairs against 5
    // `chip:` either way, so nothing was vacuous; `*` only improves the
    // diagnosis. Carried over from account-statuses.test.ts, which made this
    // argument first.
    const pairs = [...source.matchAll(/status:\s*'([^']*)'[^}]*?chip:\s*'([^']*)'/g)];

    // DERIVED, not floored. `> 0` proved the parse was non-empty and nothing
    // else: four ordinary fixture edits left one pair matched and four entries
    // unchecked. The count comes from the file's own `chip:` occurrences, and
    // the statuses from the domain — so a fixture that stops covering a status
    // is loud rather than absent.
    expect(pairs.length, 'the parse missed a chip the fixture declares').toBe(
      [...source.matchAll(/chip:/g)].length,
    );
    expect(new Set(pairs.map(([, status]) => status)), 'the fixture stopped covering a status').toEqual(
      new Set(LINK_STATUSES),
    );

    for (const [, status, chip] of pairs) {
      const key = LINK_STATUS_KEYS[status as keyof typeof LINK_STATUS_KEYS];
      expect(key, `fixture status ${status} is not a link status`).toBeDefined();
      expect(chip, `fixture chip for ${status}`).toBe(translate('en', key));
    }
  });
});
