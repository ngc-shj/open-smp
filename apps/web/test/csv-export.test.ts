import { describe, expect, it } from 'vitest';
import { buildAccountsCsv, buildLicensesCsv, neutralizeCell } from '../src/lib/csv-export';
import type { AccountListItem, LicenseRollupItem } from '../src/lib/api-types';

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

  it('includes label and labelNote columns in the header', () => {
    const csv = buildAccountsCsv([]);
    const header = csv.split('\r\n')[0]!;
    expect(header).toContain('label');
    expect(header).toContain('labelNote');
  });

  it('emits empty label cells for an unlabeled item', () => {
    const csv = buildAccountsCsv([maliciousItem]);
    const dataLine = csv.split('\r\n')[1]!;
    const cells = dataLine.split(',');
    // label, labelNote are the last two columns.
    expect(cells.slice(-2)).toEqual(['""', '""']);
  });

  it('emits kind and note columns for a labeled item', () => {
    const labeledItem: AccountListItem = {
      ...maliciousItem,
      label: { kind: 'service_account', note: 'Jenkins deploy bot' },
    };

    const csv = buildAccountsCsv([labeledItem]);
    const dataLine = csv.split('\r\n')[1]!;

    expect(dataLine).toContain('"service_account"');
    expect(dataLine).toContain('"Jenkins deploy bot"');
  });

  it('neutralizes a label note starting with a dangerous character', () => {
    const labeledItem: AccountListItem = {
      ...maliciousItem,
      label: { kind: 'known_shared', note: '=HYPERLINK("http://evil.example")' },
    };

    const csv = buildAccountsCsv([labeledItem]);
    const dataLine = csv.split('\r\n')[1]!;

    expect(dataLine).toContain("'=HYPERLINK");
  });
});

describe('C24: newline stripping keeps one record per line', () => {
  function itemWith(overrides: Partial<AccountListItem>): AccountListItem {
    return {
      accountId: 'acct-nl',
      appKey: 'google-workspace',
      appName: 'Google Workspace',
      email: 'ok@example.com',
      displayName: 'Ok Person',
      accountStatus: 'active',
      isAdmin: false,
      lastActivityAt: null,
      lastSyncedAt: '2026-01-02T00:00:00.000Z',
      link: null,
      label: null,
      ...overrides,
    };
  }

  // The columns that actually carry hostile input: display names arrive
  // verbatim from the connector and from HR CSV imports, and the evidence
  // fields derive from them. The operator-authored note is guarded at the API
  // instead, so it cannot reach the exporter with a newline in it.
  it('a provider-supplied displayName containing CRLF stays on one record', () => {
    const csv = buildAccountsCsv([itemWith({ displayName: 'Ev\r\nil' })]);

    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"Ev  il"');
  });

  it('a matched value containing CRLF stays on one record', () => {
    const csv = buildAccountsCsv([
      itemWith({
        link: {
          status: 'matched',
          confidence: 1,
          ruleId: 'exact-email',
          identityId: 'id-1',
          identityName: 'Someone',
          evidence: { rule: 'exact-email', matchedValue: 'a\r\nb', candidates: [] },
        },
      }),
    ]);

    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('a candidate display name containing CRLF stays on one record', () => {
    const csv = buildAccountsCsv([
      itemWith({
        link: {
          status: 'ambiguous',
          confidence: 0.5,
          ruleId: 'name-domain',
          identityId: null,
          identityName: null,
          evidence: {
            rule: 'name-domain',
            matchedValue: 'x',
            candidates: [{ identityId: 'id-1', displayName: 'c\r\nd' }],
          },
        },
      }),
    ]);

    expect(csv.split('\r\n')).toHaveLength(2);
  });

  // Pins the measured behaviour of all four line-break shapes. Together they
  // characterise WHY the export is safe: the third row's leading quote is what
  // fails if \r is dropped from DANGEROUS_FIRST_CHARS, and the first row's two
  // spaces are what fails if the strip is changed to deletion.
  it.each([
    ['a\r\nb', '"a  b"'],
    ['a\nb', '"a b"'],
    ['\rlead', `"' lead"`],
    ['a\rb', '"a b"'],
  ])('note %j exports as %s on a single record', (note, expectedCell) => {
    const csv = buildAccountsCsv([
      itemWith({ label: { kind: 'known_shared', note: note as string } }),
    ]);

    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain(expectedCell);
  });

  // Ordering guard (I24.3): stripping before neutralizeCell would leave a
  // \r-led formula cell unquoted, silently disabling the CSV-injection defence
  // for exactly the inputs it exists to catch.
  it('a \\r-led formula is still neutralized after stripping', () => {
    const csv = buildAccountsCsv([itemWith({ displayName: '\r=cmd|calc' })]);

    expect(csv).toContain(`"' =cmd|calc"`);
  });

  // The \n twin. The strip alone already prevents the formula from firing (the
  // newline becomes a leading space), so this pins that neutralization does not
  // depend on the strip: both defences must hold on their own.
  it('a \\n-led formula is neutralized the same way as its \\r twin', () => {
    const csv = buildAccountsCsv([itemWith({ displayName: '\n=cmd|calc' })]);

    expect(csv).toContain(`"' =cmd|calc"`);
  });
});

describe('buildLicensesCsv', () => {
  function licenseWith(overrides: Partial<LicenseRollupItem> = {}): LicenseRollupItem {
    return {
      appKey: 'acme',
      appName: 'Acme',
      hasConnector: false,
      matchState: 'matched',
      planName: 'Business',
      unitPrice: '12.50',
      currency: 'USD',
      billingCycle: 'monthly',
      termStart: '2025-01-01',
      termEnd: '2025-12-31',
      purchased: 10,
      assigned: 8,
      unassigned: 2,
      needsReview: 0,
      unlinked: 0,
      reclaimable: { ghost: 1, orphan: 0, total: 1 },
      reclaimableValue: '12.50',
      reclaimableValuePeriod: 'monthly',
      ...overrides,
    };
  }

  // C5's whole reason for existing. `-` is in DANGEROUS_FIRST_CHARS, so the
  // sanitizing path turns -2 into '-2 — text, in a spreadsheet, for the one
  // number this feature exists to make loud. Every zero-waste row exported as a
  // number and every over-allocated one did not.
  it('exports an over-allocation as a number, not as apostrophe-prefixed text', () => {
    const csv = buildLicensesCsv([licenseWith({ purchased: 10, assigned: 12, unassigned: -2 })]);

    expect(csv).toContain('"-2"');
    expect(csv).not.toContain(`"'-2"`);
  });

  // The paired direction. An exemption wide enough to pass the case above by
  // skipping neutralization for the whole row would pass it, so the boundary is
  // asserted from the other side too (RT10).
  it('still neutralizes an operator-authored name that looks like a formula', () => {
    const csv = buildLicensesCsv([licenseWith({ appName: '=cmd|calc' })]);

    expect(csv).toContain(`"'=cmd|calc"`);
  });

  it('carries the money columns as the exact strings pg returned', () => {
    // Not through Number(): 1234567890.99 survives a double, 0.1 + 0.2 does
    // not, and nothing distinguishes them by reading the code.
    const csv = buildLicensesCsv([
      licenseWith({ unitPrice: '1234567890.99', reclaimableValue: '10.50' }),
    ]);

    expect(csv).toContain('"1234567890.99"');
    expect(csv).toContain('"10.50"');
  });

  /** The cell under a named column, located through the header rather than by index. */
  function cellFor(csv: string, column: string): string {
    const [header, record] = csv.split('\r\n');
    const index = header!.split(',').indexOf(`"${column}"`);
    expect(index, `no ${column} column in the header`).toBeGreaterThanOrEqual(0);
    return record!.split(',')[index]!;
  }

  it.each(['purchased', 'unassigned', 'unitPrice', 'reclaimableValue'])(
    'exports an absent %s as empty rather than as zero',
    (column) => {
      // `null` means "this application has no contract"; exporting 0 invents a
      // purchase of no seats, and the two sum differently in the spreadsheet
      // this export exists to feed.
      const absent = buildLicensesCsv([
        licenseWith({ purchased: null, unassigned: null, unitPrice: null, reclaimableValue: null }),
      ]);
      const zero = buildLicensesCsv([
        licenseWith({ purchased: 0, unassigned: 0, unitPrice: '0.00', reclaimableValue: '0.00' }),
      ]);

      expect(cellFor(absent, column)).toBe('""');
      expect(cellFor(absent, column)).not.toBe(cellFor(zero, column));
    },
  );

  it('carries the period beside the value, so two cycles are never summed silently', () => {
    // SCL4: a monthly figure and an annual one are not comparable, and a column
    // without the period is an invitation to add them.
    const csv = buildLicensesCsv([licenseWith({ reclaimableValuePeriod: 'annual' })]);

    expect(csv.split('\r\n')[0]).toContain('reclaimableValuePeriod');
    expect(csv).toContain('"annual"');
  });

  it('emits a header and one record per item', () => {
    const csv = buildLicensesCsv([licenseWith(), licenseWith({ appKey: 'globex' })]);

    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('emits the header alone for no items', () => {
    expect(buildLicensesCsv([]).split('\r\n')).toHaveLength(1);
  });
});
