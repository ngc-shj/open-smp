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

/** `matched: { email: '...', ... }` → Map(status → email). */
function parseFixture(source: string): Map<string, string> {
  const accounts = new Map<string, string>();
  for (const m of source.matchAll(/(\w+):\s*\{\s*email:\s*'([^']+)'/g)) {
    accounts.set(m[1]!, m[2]!);
  }
  return accounts;
}

function fixtureConst(source: string, name: string): string | undefined {
  return source.match(new RegExp(`export const ${name} = '([^']+)'`))?.[1];
}

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
    expect(fixture.size).toBeGreaterThan(0);
    expect(calls).toHaveLength(fixture.size * 2);

    // Per function, not over the union. A union check passes when one email is
    // duplicated and another dropped — the count is conserved, the set is
    // equal, and one account silently loses its label assertion. That is
    // exactly the leak the gate's own comment at :54-57 exists to prevent.
    for (const fn of ['status', 'label_null'] as const) {
      const emails = calls.filter((c) => c.fn === fn).map((c) => c.email);

      expect(new Set(emails).size, `${fn}: duplicate emails ${emails.join(', ')}`).toBe(
        emails.length,
      );
      expect([...emails].sort()).toEqual([...fixture.values()].sort());
    }

    // The status each account is asserted to hold must match the key it sits
    // under in the fixture. Set equality alone cannot see a swap.
    for (const [status, email] of fixture) {
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
