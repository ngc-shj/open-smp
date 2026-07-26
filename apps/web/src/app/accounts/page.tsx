import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { AccountListItem, AccountListResponse, LinkStatus } from '@/lib/api-types';
import { StatusChip } from '@/components/StatusChip';
import { EvidencePopover } from '@/components/EvidencePopover';
import { CsvExportButton } from '@/components/CsvExportButton';
import { SyncControl } from '@/components/SyncControl';
import { NavBar } from '@/components/NavBar';
import { LabelControl } from '@/components/LabelControl';
import { LABEL_KIND_NAMES } from '@/lib/label-kinds';
import { LabelFilter } from '@/components/LabelFilter';
import { LABEL_FILTER_VALUES, type LabelFilterValue } from '@/lib/label-filters';
import { AccountSelectCheckbox, AccountSelectionProvider } from '@/components/AccountSelection';

const TABS: LinkStatus[] = ['orphan', 'ghost', 'ambiguous', 'matched'];


async function fetchAccounts(
  status: string,
  label: LabelFilterValue | null,
  cursor: string | undefined,
): Promise<AccountListResponse> {
  const params = new URLSearchParams({ status });
  if (label) params.set('label', label);
  if (cursor) params.set('cursor', cursor);

  const res = await apiFetch(`/api/accounts?${params.toString()}`);

  if (res.status === 401) {
    redirect('/login');
  }
  // Same as the events page: a rejected cursor is an unusable position, not a
  // broken page, so it falls back to the first page instead of an error screen.
  if (res.status === 400 && cursor) {
    return fetchAccounts(status, label, undefined);
  }
  if (!res.ok) {
    throw new Error(`failed to load accounts: ${res.status}`);
  }

  return (await res.json()) as AccountListResponse;
}

function latestSync(items: AccountListItem[]): string | null {
  let latest: string | null = null;
  for (const item of items) {
    if (!latest || item.lastSyncedAt > latest) latest = item.lastSyncedAt;
  }
  return latest;
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; label?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const status = TABS.includes(params.status as LinkStatus) ? (params.status as LinkStatus) : 'orphan';
  const label = LABEL_FILTER_VALUES.includes(params.label as LabelFilterValue)
    ? (params.label as LabelFilterValue)
    : null;
  const cursor = params.cursor;

  const { items, nextCursor } = await fetchAccounts(status, label, cursor);
  const appKeys = [...new Set(items.map((item) => item.appKey))];
  const freshness = latestSync(items);

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-neutral-900">Accounts</h1>
          <CsvExportButton items={items} status={status} />
        </div>

        <div className="mb-6">
          <SyncControl appKeys={appKeys} />
        </div>

        <nav className="mb-4 flex gap-1 border-b border-neutral-200">
          {TABS.map((tab) => (
            <Link
              key={tab}
              // Switching tabs keeps the label filter, the same way the filter
              // links keep the tab — the two compose in both directions.
              href={label ? `/accounts?status=${tab}&label=${label}` : `/accounts?status=${tab}`}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                tab === status
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800'
              }`}
            >
              {tab}
            </Link>
          ))}
        </nav>

        <div className="mb-4">
          <LabelFilter status={status} active={label} />
        </div>

        <AccountSelectionProvider>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">App</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Email</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Account status</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Admin</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Last activity</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Link</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Identity</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Confidence</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Evidence</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600">Label</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item) => (
                  <tr key={item.accountId}>
                    <td className="px-3 py-2">
                      <AccountSelectCheckbox accountId={item.accountId} />
                    </td>
                    <td className="px-3 py-2 text-neutral-700">{item.appName}</td>
                    <td className="px-3 py-2 text-neutral-700">{item.email ?? '—'}</td>
                    <td className="px-3 py-2 text-neutral-700">{item.displayName ?? '—'}</td>
                    <td className="px-3 py-2 text-neutral-700">{item.accountStatus}</td>
                    <td className="px-3 py-2">
                      {item.isAdmin && (
                        <span className="status-chip bg-neutral-200 text-neutral-700">admin</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{item.lastActivityAt ?? '—'}</td>
                    <td className="px-3 py-2">
                      {item.link ? <StatusChip status={item.link.status} /> : <StatusChip status="orphan" />}
                    </td>
                    <td className="px-3 py-2">
                      {item.link?.identityId ? (
                        <Link
                          href={`/identities/${encodeURIComponent(item.link.identityId)}`}
                          className="text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
                        >
                          {item.link.identityName ?? item.link.identityId}
                        </Link>
                      ) : (
                        // orphan / ambiguous links carry identity_id IS NULL by
                        // schema check, so there is nothing to navigate to.
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">
                      {item.link ? item.link.confidence.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <EvidencePopover link={item.link} />
                    </td>
                    <td className="px-3 py-2">
                      {item.label && (
                        <span className="status-chip bg-neutral-200 text-neutral-700">
                          {LABEL_KIND_NAMES[item.label.kind]}
                        </span>
                      )}
                      <div className="mt-1">
                        <LabelControl accountId={item.accountId} label={item.label} />
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-neutral-400">
                      No accounts in this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AccountSelectionProvider>

        <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
          <span>{freshness ? `Data as of ${freshness}` : 'No sync data yet'}</span>
          {nextCursor && (
            <Link
              // The API pages the filtered set, so page 2 must be requested
              // under the same filter or the cursor walks a different query.
              href={
                label
                  ? `/accounts?status=${status}&label=${label}&cursor=${encodeURIComponent(nextCursor)}`
                  : `/accounts?status=${status}&cursor=${encodeURIComponent(nextCursor)}`
              }
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Load more
            </Link>
          )}
        </div>
      </main>
    </>
  );
}
