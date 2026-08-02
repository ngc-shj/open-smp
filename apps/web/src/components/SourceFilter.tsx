import { getTranslator } from '@/lib/i18n/server';
import type { MessageKey } from '@/lib/i18n/messages';
import { CONNECTOR_APP_KEYS } from '@/lib/api-types';
import Link from 'next/link';

// The audit family is namespaced by source (every label event carries
// source='label'), so one predicate selects all of it and stays correct when a
// future audit kind is added. Without a control the filter is reachable only by
// hand-editing the URL, which makes the audit trail written but not readable —
// the condition C20 added the filter to prevent.
// SC2/C6. The sync entries are DERIVED from the connector key set.
//
// A sync event's `source` is `saas_apps.key` (apps/worker/src/sync.ts), so a
// second connector produced events reachable only by hand-editing the URL —
// the exact condition this component's own history says C20 added it to
// prevent. It held one literal, which was correct while one connector existed
// and became wrong the moment C1 landed.
//
// The connector entries are labelled with the KEY rather than translated copy:
// it is the same identifier the apps table shows and the sync control accepts,
// and a translated label would name a different thing. `sourceFilter.sync` is
// gone with them — one word cannot distinguish two connectors' events.
const FILTERS: { value: string | null; labelKey?: MessageKey; label?: string }[] = [
  { value: null, labelKey: 'sourceFilter.all' },
  { value: 'label', labelKey: 'sourceFilter.labelAudit' },
  ...CONNECTOR_APP_KEYS.map((key) => ({ value: key, label: key })),
  { value: 'matcher', labelKey: 'sourceFilter.matching' },
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
            key={filter.value ?? 'all'}
            href={filter.value ? `/events?source=${filter.value}` : '/events'}
            className={`rounded-full border px-2.5 py-0.5 font-medium ${
              isActive
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            {filter.labelKey ? t(filter.labelKey) : filter.label}
          </Link>
        );
      })}
    </div>
  );
}
