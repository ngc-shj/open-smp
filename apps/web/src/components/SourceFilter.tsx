import { getTranslator } from '@/lib/i18n/server';
import Link from 'next/link';

// The audit family is namespaced by source (every label event carries
// source='label'), so one predicate selects all of it and stays correct when a
// future audit kind is added. Without a control the filter is reachable only by
// hand-editing the URL, which makes the audit trail written but not readable —
// the condition C20 added the filter to prevent.
const FILTERS: { value: string | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'label', label: 'Label audit' },
  { value: 'google-workspace', label: 'Sync' },
  { value: 'matcher', label: 'Matching' },
];

/**
 * Server-rendered links rather than a client control: the filter is a URL
 * parameter, so navigation is the whole interaction. No cursor is carried
 * forward — a cursor is bound to the filter it was minted under, so changing
 * the filter necessarily restarts paging from the first page.
 */
export async function SourceFilter({ active }: { active: string | undefined }) {
  const t = await getTranslator();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-500">{t('filter.source')}</span>
      {FILTERS.map((filter) => {
        const isActive = filter.value === (active ?? null);
        return (
          <Link
            key={filter.label}
            href={filter.value ? `/events?source=${filter.value}` : '/events'}
            className={`rounded-full border px-2.5 py-0.5 font-medium ${
              isActive
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            {filter.label}
          </Link>
        );
      })}
    </div>
  );
}
