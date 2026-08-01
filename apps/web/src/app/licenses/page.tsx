import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { LicenseListResponse, LicenseRollupItem } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';
import { ContractImportForm } from '@/components/ContractImportForm';
import { LicensesCsvExportButton } from '@/components/CsvExportButton';
import { formatMoney, unassignedTone } from '@/lib/licenses-format';
import { getTranslator } from '@/lib/i18n/server';
import type { MessageKey } from '@/lib/i18n/messages';

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

const MATCH_STATE_KEYS: Record<LicenseRollupItem['matchState'], MessageKey> = {
  'no-accounts': 'licenses.matchState.noAccounts',
  'not-matched': 'licenses.matchState.notMatched',
  'partially-matched': 'licenses.matchState.partiallyMatched',
  matched: 'licenses.matchState.matched',
};

// Not async, so it cannot resolve the locale itself — the translator arrives
// from the page that already has one.
function Unassigned({
  value,
  t,
}: {
  value: number | null;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}) {
  switch (unassignedTone(value)) {
    case 'absent':
      return <span className="text-neutral-400">—</span>;
    case 'over-allocated':
      // Stringified here because `unassignedTone` reports the tone rather than
      // narrowing the value: null cannot reach this branch, but the type still
      // says it can, and `translate` would stringify it a line later anyway.
      return (
        <span className="font-medium text-red-700">
          {t('licenses.overAllocated', { value: String(value) })}
        </span>
      );
    default:
      return <span className="text-neutral-700">{value}</span>;
  }
}

export default async function LicensesPage() {
  const { items } = await fetchLicenses();
  const t = await getTranslator();

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-neutral-900">{t('licenses.title')}</h1>
          <LicensesCsvExportButton items={items} />
        </div>

        <div className="mb-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.application')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('licenses.plan')}</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">{t('licenses.purchased')}</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">{t('licenses.assigned')}</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">{t('licenses.unassigned')}</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">{t('licenses.reclaimable')}</th>
                <th className="px-3 py-2 text-right font-medium text-neutral-600">{t('licenses.needsReview')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('licenses.unitPrice')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('licenses.reclaimableValue')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('licenses.matching')}</th>
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
                    <Unassigned value={item.unassigned} t={t} />
                  </td>
                  <td data-testid="reclaimable" className="px-3 py-2 text-right text-neutral-700">
                    {item.reclaimable.total}
                    {item.reclaimable.total > 0 && (
                      <span className="ml-1 text-xs text-neutral-400">
                        {t('licenses.reclaimableBreakdown', {
                          ghost: item.reclaimable.ghost,
                          unknown: item.reclaimable.orphan,
                        })}
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
                    {t(MATCH_STATE_KEYS[item.matchState])}
                    {!item.hasConnector && (
                      <span className="ml-1 text-xs text-neutral-400">{t('licenses.noConnector')}</span>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-neutral-400">
                    {t('licenses.empty')}
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
