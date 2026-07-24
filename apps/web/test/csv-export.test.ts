import { describe, expect, it } from 'vitest';
import { buildAccountsCsv, neutralizeCell } from '../src/lib/csv-export';
import type { AccountListItem } from '../src/lib/api-types';

describe('neutralizeCell', () => {
  const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];

  for (const char of dangerousChars) {
    it(`prefixes a cell starting with ${JSON.stringify(char)} with a single quote`, () => {
      const value = `${char}cmd|'/bin/calc'!A0`;

      const result = neutralizeCell(value);

      expect(result).toBe(`'${value}`);
    });
  }

  it('leaves a safe cell unchanged', () => {
    const value = 'taro.yamada@corp.example';

    const result = neutralizeCell(value);

    expect(result).toBe(value);
  });

  it('leaves an empty cell unchanged', () => {
    expect(neutralizeCell('')).toBe('');
  });
});

describe('buildAccountsCsv wiring', () => {
  // Fixture where EVERY attacker-influenced field starts with a dangerous
  // character (T11 wiring test) — exercises the actual export function, not
  // just the sanitizer helper, so a future column added to the export
  // cannot silently bypass neutralization.
  const maliciousItem: AccountListItem = {
    accountId: 'acct-1',
    appKey: 'google-workspace',
    appName: '=HYPERLINK("http://evil.example")',
    email: '+1234@evil.example',
    displayName: '-2+3+cmd|/bin/calc',
    accountStatus: 'active',
    isAdmin: false,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    lastSyncedAt: '2026-01-02T00:00:00.000Z',
    link: {
      status: 'ambiguous',
      confidence: 0.5,
      ruleId: 'name-domain',
      identityId: null,
      identityName: null,
      evidence: {
        rule: 'name-domain',
        matchedValue: '@SUM(1+1)',
        candidates: [
          { identityId: 'id-1', displayName: '=cmd1' },
          { identityId: 'id-2', displayName: '+cmd2' },
          { identityId: 'id-3', displayName: '-cmd3' },
          { identityId: 'id-4', displayName: '@cmd4' },
          { identityId: 'id-5', displayName: '\tcmd5' },
          { identityId: 'id-6', displayName: '\rcmd6' },
        ],
      },
    },
    label: null,
  };

  it('neutralizes every unquoted cell in the generated CSV, no dangerous cell survives unescaped', () => {
    const csv = buildAccountsCsv([maliciousItem]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);

    const dataLine = lines[1]!;
    // Every quoted CSV cell in the data row.
    const cells = dataLine.match(/"(?:[^"]|"")*"/g) ?? [];
    expect(cells.length).toBeGreaterThan(0);

    const dangerousFirstChars = ['=', '+', '-', '@', '\t', '\r'];
    for (const cell of cells) {
      const inner = cell.slice(1, -1).replace(/""/g, '"');
      if (inner.length === 0) continue;
      const firstChar = inner[0];
      // A neutralized cell is prefixed with a literal single quote, so its
      // first character can never be one of the dangerous formula triggers.
      expect(dangerousFirstChars).not.toContain(firstChar);
    }
  });

  it('preserves the underlying value (minus the neutralization prefix) for round-trip fidelity', () => {
    const csv = buildAccountsCsv([maliciousItem]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1234@evil.example");
    expect(csv).toContain("'-2+3+cmd");
    expect(csv).toContain("'@SUM(1+1)");
  });

  it('emits a header row followed by one row per item', () => {
    const csv = buildAccountsCsv([maliciousItem, { ...maliciousItem, accountId: 'acct-2' }]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('app');
  });

  it('returns just the header for an empty item list', () => {
    const csv = buildAccountsCsv([]);
    expect(csv.split('\r\n')).toHaveLength(1);
  });
});
