import type { AccountListItem } from './api-types';

// Cell values beginning with these characters are interpreted as formulas by
// spreadsheet applications (CSV injection). Prefixing with a leading single
// quote neutralizes them without altering the visible/parsed text value.
// '\n' belongs here alongside its '\r' twin. It is not reachable today — the
// newline strip below turns a leading '\n' into a space before any spreadsheet
// sees it — but that makes neutralization depend on the strip running, and the
// two defences are meant to be independent.
const DANGEROUS_FIRST_CHARS = ['=', '+', '-', '@', '\t', '\r', '\n'];

export function neutralizeCell(value: string): string {
  if (DANGEROUS_FIRST_CHARS.includes(value[0] ?? '')) {
    return `'${value}`;
  }
  return value;
}

function quoteCsvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

// Rows are joined with \r\n, so an embedded \r\n inside a cell splits the
// record in two for any line-oriented consumer — the E2E CSV assertions and
// csv-export's own tests among them. RFC 4180 permits newlines inside a quoted
// field, so this is not a quoting bug; it is a mismatch with the
// one-record-per-line contract everything downstream relies on.
//
// This runs at the export boundary rather than at the API boundary because the
// exposed columns are provider- and HR-supplied: display names arrive verbatim
// from the connector (apps/worker/src/sync.ts) and from HR CSV imports, and
// refusing a sync over a control character in data the operator does not
// control would break ingestion. The operator-authored `note` IS rejected at
// the API, where a newline is always a mistake.
function stripNewlines(value: string): string {
  return value.replace(/[\r\n]/g, ' ');
}

// Order is load-bearing: neutralizeCell inspects position 0, so it must see the
// original leading character. Stripping first would turn a leading \r into a
// space, neutralizeCell would find nothing dangerous, and the formula-injection
// defence would silently stop applying to \r-led cells. Quoting stays last
// (I24.3) — nothing may run on quoteCsvCell's output.
function csvField(value: string): string {
  return quoteCsvCell(stripNewlines(neutralizeCell(value)));
}

const CSV_HEADER = [
  'app',
  'email',
  'name',
  'accountStatus',
  'isAdmin',
  'lastActivityAt',
  'lastSyncedAt',
  'linkStatus',
  'confidence',
  'ruleId',
  'matchedValue',
  'candidates',
  'label',
  'labelNote',
];

// Applies neutralizeCell to every attacker-influenced field (email,
// displayName, appName, evidence.matchedValue, evidence.candidates) per C8's
// CSV export neutralization requirement (S4/T11). Non-attacker-influenced
// fields (status enums, booleans, timestamps, numeric confidence) are still
// run through the same csvField() path — a single sanitizer applied
// uniformly is safer than trying to selectively skip "safe" columns.
export function buildAccountsCsv(items: AccountListItem[]): string {
  const rows = [CSV_HEADER.map(csvField).join(',')];

  for (const item of items) {
    const candidates =
      item.link?.evidence?.candidates?.map((c) => neutralizeCell(c.displayName)).join('; ') ?? '';
    const fields = [
      item.appName,
      item.email ?? '',
      item.displayName ?? '',
      item.accountStatus,
      String(item.isAdmin),
      item.lastActivityAt ?? '',
      item.lastSyncedAt,
      item.link?.status ?? '',
      item.link ? String(item.link.confidence) : '',
      item.link?.ruleId ?? '',
      item.link?.evidence?.matchedValue ?? '',
      candidates,
      item.label?.kind ?? '',
      item.label?.note ?? '',
    ];
    rows.push(fields.map(csvField).join(','));
  }

  return rows.join('\r\n');
}
