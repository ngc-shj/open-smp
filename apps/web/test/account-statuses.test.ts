import { describe, expect, it } from 'vitest';
import { ACCOUNT_STATUSES } from '../src/lib/api-types';
import { ACCOUNT_STATUS_KEYS, accountStatusKeyFor } from '../src/lib/account-statuses';
import { translate } from '../src/lib/i18n/translate';

// C3/C6. Modelled on link-statuses.test.ts, which covers the sibling
// vocabulary.
//
// The domain comes through ../src/lib/api-types — the web barrel — and the
// reason is NOT the `@/` alias. A relative import reaches either module, and
// label-filters.test.ts:2 already imports the barrel exactly this way, so the
// alias rules out a shape nobody proposed. The reason is that C1 adds
// ACCOUNT_STATUSES to that barrel's value block on a stated policy ("a shared
// value crosses at this one place"), and nothing else in apps/web reads it —
// so without this import the re-export has no observer at all and deleting it
// would red nothing.

describe('I6.2: the account-status vocabulary covers the domain exactly', () => {
  it('has a key for every member and no key that is not one', () => {
    // SORTED, deliberately, and matching link-statuses.test.ts:118. Unsorted,
    // a cosmetic reorder of three map lines would red with no defect — and the
    // map's insertion order has no relationship to migrations/0001_init.sql:8
    // anyway. Declaration ORDER is I6.1's and I6.4's to own; this cell owns the
    // member SET.
    expect(Object.keys(ACCOUNT_STATUS_KEYS).sort()).toEqual([...ACCOUNT_STATUSES].sort());
  });

  it('resolves every key to a real Japanese message, distinct from the English', () => {
    for (const status of ACCOUNT_STATUSES) {
      const ja = translate('ja', ACCOUNT_STATUS_KEYS[status]);
      // The marker an unresolvable key renders as. Absence alone would pass
      // against an empty string, which is why it is paired with the inequality.
      expect(ja, status).not.toContain('⟨');
      expect(ja, status).not.toBe(translate('en', ACCOUNT_STATUS_KEYS[status]));
    }
  });
});

describe('I6.3: the guarded read denies everything outside the domain and allows exactly the domain', () => {
  // The deny side. The prototype keys are the load-bearing inputs: they are
  // what a `?? null` read gets silently wrong, because ACCOUNT_STATUS_KEYS
  // ['constructor'] is a FUNCTION and therefore not nullish, so the fallback
  // never fires and a non-string reaches the render. `''` and 'not_a_status'
  // survive that degradation, so they are the cheap half of this list, not the
  // discriminating half.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', '', 'not_a_status'])(
    'returns null for %j',
    (outside) => {
      expect(accountStatusKeyFor(outside)).toBeNull();
    },
  );

  // The allow side, or a helper that returned null for everything would pass
  // every case above. The expected key is written as a LITERAL per member.
  // `toBe(ACCOUNT_STATUS_KEYS[status])` in a loop would be circular — it reads
  // the same map the function reads, so a map re-pointed at another
  // vocabulary's keys (`'linkStatus.matched'`) would satisfy it.
  it('returns the account-status key for a domain member', () => {
    expect(accountStatusKeyFor('active')).toBe('accountStatus.active');
    expect(accountStatusKeyFor('suspended')).toBe('accountStatus.suspended');
    expect(accountStatusKeyFor('archived')).toBe('accountStatus.archived');
  });
});

describe('I6.11: the E2E account-status fixture matches the dictionary it mirrors', () => {
  it('every seeded accountStatusText is the ja copy for its accountStatus', async () => {
    // THE SECOND DECLARATION, the same shape link-statuses.test.ts:179-220
    // binds for `chip`. e2e/fixtures/seed-facts.ts restates apps/web's copy
    // because a Playwright spec cannot import the dictionary — e2e/package.json
    // declares only @playwright/test and @types/node. Duplicating at the outermost tier is
    // right; leaving the two unbound is not, because a copy change would then
    // red only behind a full compose boot.
    //
    // Read as text, the way seed-gate-agreement.test.ts reads this same file.
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await readFile(
      path.join(import.meta.dirname, '..', '..', '..', 'e2e', 'fixtures', 'seed-facts.ts'),
      'utf8',
    );

    // `[^}]*?` between the fields rather than requiring adjacency, so inserting
    // a field between them or reordering them does not drop an entry silently.
    const pairs = [...source.matchAll(/accountStatus:\s*'([^']+)'[^}]*?accountStatusText:\s*'([^']*)'/g)];

    // FLOORED AGAINST THE FIXTURE'S OWN ENTRY COUNT. The model derives its
    // count from `chip:` occurrences and then asserts set-coverage of the whole
    // domain; the second leg is deliberately NOT carried over here, because per
    // VE6 the seed only ever writes `active` — a three-member set comparison
    // would red on arrival and stay red. `email:` is the denominator instead:
    // it occurs exactly once per seeded account and nowhere else in the file,
    // so it is a faithful entry count.
    //
    // The case this closes is PARTIAL deletion, not total. Removing the fields
    // from every entry gives 0 pairs, which the `> 0` guard below reds on its
    // own; removing them from four of five gives 1 pair against 5 `email:`,
    // which `> 0` PASSES and only this equality reds. That is the case the
    // model records having paid for (link-statuses.test.ts:203-210 — "four
    // ordinary fixture edits left one pair matched and four entries
    // unchecked").
    // Non-empty on its own account too: a denominator that itself went to zero
    // would make the equality above pass with nothing parsed.
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.length, 'the parse missed an account status the fixture declares').toBe(
      [...source.matchAll(/email:/g)].length,
    );

    for (const [, status, display] of pairs) {
      expect(ACCOUNT_STATUSES, `fixture accountStatus ${status} is not a domain member`).toContain(
        status,
      );
      // Reachable: the display capture is `[^']*`, not `[^']+`, deliberately —
      // with `+` an emptied `accountStatusText: ''` produces NO match rather
      // than an empty capture, so this line could never red and the emptied
      // field would surface only as a count mismatch. `*` turns it into a
      // named diagnosis.
      expect(display, `fixture accountStatusText for ${status}`).not.toBe('');
      // `ja`, not `en`. The fixture's display copy is Japanese because the two
      // specs that consume it assert under the ja cookie — see the RT9 note in
      // seed-facts.ts.
      expect(display, `fixture accountStatusText for ${status}`).toBe(
        translate('ja', ACCOUNT_STATUS_KEYS[status as keyof typeof ACCOUNT_STATUS_KEYS]),
      );
    }
  });
});
