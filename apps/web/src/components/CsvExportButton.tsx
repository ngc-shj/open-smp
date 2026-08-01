'use client';

import { buildAccountsCsv, buildLicensesCsv } from '@/lib/csv-export';
import { useTranslator } from '@/lib/i18n/locale-context';
import type { AccountListItem, LicenseRollupItem } from '@/lib/api-types';

/**
 * The one download path in apps/web. The Blob / anchor / revokeObjectURL dance
 * is the part worth sharing: a second copy that forgets `revokeObjectURL` leaks
 * the blob for the life of the document, and nothing in a review distinguishes
 * the two copies by reading them.
 *
 * The CSV is built at click time by each caller rather than passed in as a
 * prepared string. These are client components rendered by server ones, so a
 * builder function cannot cross the boundary as a prop, and a prepared string
 * would ship every row twice — once in the RSC payload, once in the table.
 */
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const BUTTON_CLASS =
  'rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50';

export function CsvExportButton({ items, status }: { items: AccountListItem[]; status: string }) {
  const t = useTranslator();

  return (
    <button
      type="button"
      onClick={() => downloadCsv(buildAccountsCsv(items), `accounts-${status}.csv`)}
      disabled={items.length === 0}
      className={BUTTON_CLASS}
    >
      {t('export.csv')}
    </button>
  );
}

export function LicensesCsvExportButton({ items }: { items: LicenseRollupItem[] }) {
  const t = useTranslator();

  return (
    <button
      type="button"
      onClick={() => downloadCsv(buildLicensesCsv(items), 'licenses.csv')}
      disabled={items.length === 0}
      className={BUTTON_CLASS}
    >
      {t('export.csv')}
    </button>
  );
}
