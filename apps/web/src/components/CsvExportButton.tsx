'use client';

import { buildAccountsCsv } from '@/lib/csv-export';
import type { AccountListItem } from '@/lib/api-types';

export function CsvExportButton({ items, status }: { items: AccountListItem[]; status: string }) {
  function handleExport() {
    const csv = buildAccountsCsv(items);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `accounts-${status}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={items.length === 0}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
    >
      Export CSV
    </button>
  );
}
