import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// C38. `e2e/scripts/assert-seed-preserved.sh` hardcodes the seeded values it
// asserts; `e2e/fixtures/seed-facts.ts` holds the same values for the Playwright
// specs. They are two copies with nothing comparing them, so a seed change
// mirrored into one and not the other passes every gate — and the shell gate's
// own failure surfaces at the very end of the most expensive CI job, after a
// full stack boot and the E2E suite.
//
// This is a static text comparison, so it runs here, in the `checks` job, in
// milliseconds. The shell gate stays where it is: it is a live-HTTP check that
// logs in, and the E2E login budget is 5/5 per minute with no headroom.
//
// Reading both files as text rather than importing them: the fixture is an
// e2e-tsconfig module and the gate is bash, so neither is importable from here.

const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'e2e', 'scripts', 'assert-seed-preserved.sh');
const FIXTURE = path.join(REPO_ROOT, 'e2e', 'fixtures', 'seed-facts.ts');

// Anchored to end-of-line and using a symmetric quote back-reference. An
// earlier attempt at this shape (cycle 3) let an optional trailing group's \s+
// cross a newline under /gm, so a call swallowed the next line and the
// extractor returned 6 pairs while looking correct. The anchor is what stops
// that, at the cost of not matching a trailing comment — recorded below.
const GATE_CALL = /^\s*assert_(status|label_null)\s+(["'])([^"']+)\2(?:\s+(["'])([a-z_]+)\4)?\s*$/gm;

type GateCall = { fn: string; email: string; status: string | null };

function parseGate(source: string): GateCall[] {
  return [...source.matchAll(GATE_CALL)].map((m) => ({
    fn: m[1]!,
    email: m[3]!,
    status: m[5] ?? null,
  }));
}

/**
 * `slackOrphan: { email: '...', displayName: '...', status: 'orphan' }`
 * → [{ email, status }].
 *
 * SC2/C5 changed the shape this reads. The status used to be the KEY, and a
 * Map keyed by it silently held one account per status — which was true of the
 * demo until a second account-bearing application arrived and produced a second
 * orphan. Under the old parser the two would have collapsed into one entry, the
 * derived count would have matched a gate asserting only one of them, and the
 * other account would have lost both its assertions with everything green.
 *
 * A LIST, therefore, and the status read from the field. An entry without a
 * `status:` does not match at all, so it shrinks the list and reds the derived
 * count rather than being silently exempt.
 */
function parseFixture(source: string): { email: string; status: string }[] {
  return [
    ...source.matchAll(/\w+:\s*\{\s*email:\s*'([^']+)'[^}]*status:\s*'([^']+)'/g),
  ].map((m) => ({ email: m[1]!, status: m[2]! }));
}

function fixtureConst(source: string, name: string): string | undefined {
  return source.match(new RegExp(`export const ${name} = '([^']+)'`))?.[1];
}

function fixtureNumber(source: string, name: string): number | undefined {
  const raw = source.match(new RegExp(`export const ${name} = (\\d+)`))?.[1];
  return raw === undefined ? undefined : Number(raw);
}

// `assert_license <app_key> <field> <expected>`, end-anchored for the same
// reason GATE_CALL is: an unanchored trailing group crosses a newline under /gm
// and swallows the next call. The expected value admits a leading `-`, because
// the figure the demo exists for is negative.
const LICENSE_CALL = /^\s*assert_license\s+(["'])([^"']+)\1\s+(["'])([a-zA-Z]+)\3\s+(["'])(-?[a-zA-Z0-9.]+)\5\s*$/gm;

describe('C38 acceptance: the seed gate and the e2e fixture assert the same facts', () => {
  it('agrees on every seeded email and its link status, in both directions', async () => {
    const [gateSource, fixtureSource] = await Promise.all([
      readFile(GATE, 'utf8'),
      readFile(FIXTURE, 'utf8'),
    ]);

    const calls = parseGate(gateSource);
    const fixture = parseFixture(fixtureSource);

    // Anti-vacuity, derived rather than written as a literal: one assert_status
    // and one assert_label_null per seeded account. A literal here would be a
    // new hand-synced constant inside the test that removes one.
    expect(fixture.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(fixture.length * 2);
    // Two accounts may now share a status, so the emails are what must be
    // unique — the property the old Map key provided by accident.
    expect(new Set(fixture.map((a) => a.email)).size, 'the fixture repeats an email').toBe(
      fixture.length,
    );

    // Per function, not over the union. A union check passes when one email is
    // duplicated and another dropped — the count is conserved, the set is
    // equal, and one account silently loses its label assertion. That is
    // exactly the leak the gate's own comment at :54-57 exists to prevent.
    for (const fn of ['status', 'label_null'] as const) {
      const emails = calls.filter((c) => c.fn === fn).map((c) => c.email);

      expect(new Set(emails).size, `${fn}: duplicate emails ${emails.join(', ')}`).toBe(
        emails.length,
      );
      expect([...emails].sort()).toEqual(fixture.map((a) => a.email).sort());
    }

    // The status each account is asserted to hold must match the key it sits
    // under in the fixture. Set equality alone cannot see a swap.
    for (const { email, status } of fixture) {
      const call = calls.find((c) => c.fn === 'status' && c.email === email);
      expect(call?.status, `${email} should be asserted as ${status}`).toBe(status);
    }
  });

  it('agrees on the seeded app key and display name', async () => {
    const [gateSource, fixtureSource] = await Promise.all([
      readFile(GATE, 'utf8'),
      readFile(FIXTURE, 'utf8'),
    ]);

    const gateKey = gateSource.match(/select\(\.key == "([^"]+)"\)/)?.[1];
    const gateName = gateSource.match(/app_display_name" != "([^"]+)"/)?.[1];

    expect(gateKey).toBeDefined();
    expect(gateName).toBeDefined();
    expect(gateKey).toBe(fixtureConst(fixtureSource, 'SAAS_APP_KEY'));
    expect(gateName).toBe(fixtureConst(fixtureSource, 'SAAS_APP_DISPLAY_NAME'));
  });

  // C6's contracts. Same hazard as the account facts above, one table over: the
  // gate hardcodes the figures it asserts and the fixture holds them for the
  // specs, so a seed change mirrored into one and not the other passes every
  // gate. The licences spec is the first e2e path that can write these rows,
  // which is what made them worth asserting in the first place.
  it('agrees on every seeded contract figure it asserts', async () => {
    const [gateSource, fixtureSource] = await Promise.all([
      readFile(GATE, 'utf8'),
      readFile(FIXTURE, 'utf8'),
    ]);

    const calls = [...gateSource.matchAll(LICENSE_CALL)].map((m) => ({
      appKey: m[2]!,
      field: m[4]!,
      expected: m[6]!,
    }));

    // Anti-vacuity: an extractor that matches nothing satisfies every
    // per-field assertion below by iterating an empty list.
    expect(calls.length, 'no assert_license calls extracted from the gate').toBeGreaterThan(0);

    const seatsFor = new Map([
      [fixtureConst(fixtureSource, 'SAAS_APP_KEY'), fixtureNumber(fixtureSource, 'SEEDED_CONTRACT_SEATS')],
      [
        fixtureConst(fixtureSource, 'CONTRACT_ONLY_APP_KEY'),
        fixtureNumber(fixtureSource, 'CONTRACT_ONLY_SEATS'),
      ],
    ]);

    // Every app the gate names must be one the fixture knows, or the two are
    // describing different seeds.
    for (const call of calls) {
      expect(seatsFor.has(call.appKey), `gate asserts an app the fixture does not know: ${call.appKey}`).toBe(
        true,
      );
    }
    // And both fixture apps must appear, or half the seed goes unguarded.
    expect([...new Set(calls.map((c) => c.appKey))].sort()).toEqual([...seatsFor.keys()].sort());

    for (const call of calls.filter((c) => c.field === 'purchased')) {
      expect(Number(call.expected), `${call.appKey} purchased`).toBe(seatsFor.get(call.appKey));
    }

    const unitPrice = calls.find((c) => c.appKey === fixtureConst(fixtureSource, 'SAAS_APP_KEY') && c.field === 'unitPrice');
    expect(unitPrice?.expected).toBe(fixtureConst(fixtureSource, 'SEEDED_CONTRACT_UNIT_PRICE'));

    // The demo's argument: purchased must be BELOW assigned, or the licences
    // page opens on a row with nothing to say. Read from the gate's own two
    // assertions rather than from either file's prose.
    const purchased = calls.find(
      (c) => c.appKey === fixtureConst(fixtureSource, 'SAAS_APP_KEY') && c.field === 'purchased',
    );
    const assigned = calls.find(
      (c) => c.appKey === fixtureConst(fixtureSource, 'SAAS_APP_KEY') && c.field === 'assigned',
    );
    expect(purchased, 'the gate must assert purchased').toBeDefined();
    expect(assigned, 'the gate must assert assigned').toBeDefined();
    expect(Number(purchased!.expected)).toBeLessThan(Number(assigned!.expected));
  });

  it.each([
    ["assert_license 'notion' 'purchased' '25'", { appKey: 'notion', field: 'purchased', expected: '25' }],
    [
      `assert_license 'google-workspace' 'unassigned' '-1'`,
      { appKey: 'google-workspace', field: 'unassigned', expected: '-1' },
    ],
  ])('extracts %s', (line, expected) => {
    // The extractor's own allow side. Without it, a rewritten gate that this
    // regex stops matching would fail the count assertion above with no
    // indication of which spelling broke it.
    expect([...line.matchAll(LICENSE_CALL)].map((m) => ({
      appKey: m[2],
      field: m[4],
      expected: m[6],
    }))).toEqual([expected]);
  });

  // What the extractor does NOT match, recorded rather than claimed complete.
  // Cycle 3's version of this listed two limitations and a reviewer found five
  // more, so the honest guarantee is the weaker, provable one: the derived
  // count detects any reformat the extractor misses, because every unmatched
  // form extracts fewer than expected and fails the length assertion above.
  it.each([
    ['a trailing comment', "assert_status 'a@x' 'matched' # note"],
    ['a trailing semicolon', "assert_status 'a@x' 'matched';"],
    ['an unquoted status', "assert_status 'a@x' matched"],
    ['an unquoted email', 'assert_status a@x'],
    ['a loop over emails', 'for e in a@x b@x; do assert_status "$e" matched; done'],
    ['a line continuation', "assert_status 'a@x' \\\n  'matched'"],
  ])('does not extract %s — a known miss, caught by the derived count', (_label, line) => {
    expect(parseGate(line)).toEqual([]);
  });

  it.each([
    ['single quotes', "assert_status 'a@x' 'matched'"],
    ['double quotes', 'assert_status "a@x" "matched"'],
    ['leading indentation', "    assert_status 'a@x' 'matched'"],
    ['a label_null call', "assert_label_null 'a@x'"],
  ])('extracts %s', (_label, line) => {
    expect(parseGate(line)).toHaveLength(1);
  });

  it('does not mistake the function definitions for calls', () => {
    expect(parseGate('assert_status() {\nassert_label_null() {')).toEqual([]);
  });
});
