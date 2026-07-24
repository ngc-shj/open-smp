import type { AccountListItem } from './api-types';

// Cell values beginning with these characters are interpreted as formulas by
// spreadsheet applications (CSV injection). Prefixing with a leading single
// quote neutralizes them without altering the visible/parsed text value.
const DANGEROUS_FIRST_CHARS = ['=', '+', '-', '@', '\t', '\r'];

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

function csvField(value: string): string {
  return quoteCsvCell(neutralizeCell(value));
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
    const candidates = item.link?.evidence?.candidates?.join('; ') ?? '';
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
    ];
    rows.push(fields.map(csvField).join(','));
  }

  return rows.join('\r\n');
}
