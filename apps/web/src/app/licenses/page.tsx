import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { LicenseListResponse, LicenseRollupItem } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';
import { ContractImportForm } from '@/components/ContractImportForm';
import { LicensesCsvExportButton } from '@/components/CsvExportButton';
import { formatMoney, unassignedTone } from '@/lib/licenses-format';

// C4. The consumer C3's shape had none — a response nobody renders is a shape
// nobody has validated in use.

async function fetchLicenses(): Promise<LicenseListResponse> {
  const res = await apiFetch('/api/licenses');

  if (res.status === 401) {
    redirect('/login');
  }
  if (!res.ok) {
    throw new Error(`failed to load licenses: ${res.status}`);
  }

  return (await res.json()) as LicenseListResponse;
}

const MATCH_STATE_COPY: Record<LicenseRollupItem['matchState'], string> = {
  'no-accounts': 'No accounts',
  'not-matched': 'Not matched',
  'partially-matched': 'Partly matched',
  matched: 'Matched',
};

function Unassigned({ value }: { value: number | null }) {
  switch (unassignedTone(value)) {
    case 'absent':
      return <span className="text-neutral-400">—</span>;
    case 'over-allocated':
      return <span className="font-medium text-red-700">{value} (over-allocated)</span>;
    default:
      return <span className="text-neutral-700">{value}</span>;
  }
}

export default async function LicensesPage() {
  const { items } = await fetchLicenses();

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-neutral-900">Licences</h1>
          <LicensesCsvExportButton items={items} />
        </div>

        <div className="mb-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Application</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Plan</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">Purchased</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">Assigned</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">Unassigned</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">Reclaimable</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">Needs review</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Unit price</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Reclaimable value</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Matching</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((item) => (
                <tr key={item.appKey} data-testid={`license-row-${item.appKey}`}>
                  <td className="px-3 py-2 text-neutral-700">
                    {item.appName}
                    <span className="ml-1 text-xs text-neutral-400">{item.appKey}</span>
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{item.planName ?? '—'}</td>
                  {/* Every figure cell is addressable by name. An E2E that
                      counts em dashes across a row, or matches a cell by its
                      text, passes for the wrong reason the moment a neighbour
                      renders the same characters. */}
                  <td data-testid="purchased" className="px-3 py-2 text-right text-neutral-700">
                    {item.purchased ?? '—'}
                  </td>
                  <td data-testid="assigned" className="px-3 py-2 text-right text-neutral-700">
                    {item.assigned}
                  </td>
                  <td data-testid="unassigned" className="px-3 py-2 text-right">
                    <Unassigned value={item.unassigned} />
                  </td>
                  <td data-testid="reclaimable" className="px-3 py-2 text-right text-neutral-700">
                    {item.reclaimable.total}
                    {item.reclaimable.total > 0 && (
                      <span className="ml-1 text-xs text-neutral-400">
                        ({item.reclaimable.ghost} left, {item.reclaimable.orphan} unknown)
                      </span>
                    )}
                  </td>
                  <td data-testid="needs-review" className="px-3 py-2 text-right text-neutral-700">
                    {item.needsReview}
                  </td>
                  <td data-testid="unit-price" className="px-3 py-2 text-neutral-700">
                    {formatMoney(item.unitPrice, item.currency)}
                    {item.billingCycle && (
                      <span className="ml-1 text-xs text-neutral-400">/ {item.billingCycle}</span>
                    )}
                  </td>
                  <td data-testid="reclaimable-value" className="px-3 py-2 text-neutral-700">
                    {formatMoney(item.reclaimableValue, item.currency)}
                    {/* The period travels with the figure. Two rows on
                        different cycles are not comparable and a column that
                        omits the period invites the sum that pretends they
                        are (SCL4). */}
                    {item.reclaimableValuePeriod && (
                      <span className="ml-1 text-xs text-neutral-400">
                        / {item.reclaimableValuePeriod}
                      </span>
                    )}
                  </td>
                  <td data-testid="match-state" className="px-3 py-2 text-neutral-500">
                    {MATCH_STATE_COPY[item.matchState]}
                    {!item.hasConnector && (
                      <span className="ml-1 text-xs text-neutral-400">(no connector)</span>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-neutral-400">
                    No applications yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ContractImportForm />
      </main>
    </>
  );
}
