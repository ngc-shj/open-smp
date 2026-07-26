import Link from 'next/link';
import { LABEL_FILTER_OPTIONS, type LabelFilterValue } from '@/lib/label-filters';

export type { LabelFilterValue };

/**
 * Server-rendered links rather than a client control: the filter is a URL
 * parameter, so navigation is the whole interaction. Each href carries the
 * current status tab forward — the filter composes with it rather than
 * replacing it.
 */
export function LabelFilter({ status, active }: { status: string; active: LabelFilterValue | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-500">Label:</span>
      {LABEL_FILTER_OPTIONS.map((filter) => {
        const href = filter.value
          ? `/accounts?status=${status}&label=${filter.value}`
          : `/accounts?status=${status}`;
        const isActive = filter.value === active;
        return (
          <Link
            key={filter.label}
            href={href}
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
