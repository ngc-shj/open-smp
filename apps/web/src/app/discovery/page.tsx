import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { DiscoveryEventListResponse } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';
import { latestRuns } from '@/lib/discovery-runs';
import { getTranslator } from '@/lib/i18n/server';

// SC3/C4. The reader the shape needed — and building it is what found that the
// audit event named no application (C3 amended in the same PR).

async function fetchAudits(): Promise<DiscoveryEventListResponse> {
  const res = await apiFetch('/api/events?source=token-audit');

  if (res.status === 401) {
    redirect('/login');
  }
  if (!res.ok) {
    throw new Error(`failed to load token audits: ${res.status}`);
  }

  return (await res.json()) as DiscoveryEventListResponse;
}

export default async function DiscoveryPage() {
  const { items } = await fetchAudits();
  const runs = latestRuns(items);
  const t = await getTranslator();

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-1 text-lg font-semibold text-neutral-900">{t('discovery.title')}</h1>
        <p className="mb-6 text-sm text-neutral-500">{t('discovery.intro')}</p>

        {runs.length === 0 && (
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-6 text-center text-sm text-neutral-400">
            {t('discovery.noAudit')}
          </p>
        )}

        {runs.map((run) => (
          <section key={run.auditedAppKey} className="mb-6" data-testid={`audit-${run.auditedAppKey}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-neutral-900">{run.auditedAppKey}</h2>
              <span className="text-xs text-neutral-500" data-testid="coverage">
                {/* A partial run says so. "3 applications found" over a run that
                    could not read half the accounts is a floor presented as a
                    total. */}
                {run.failed > 0
                  ? t('discovery.scannedWithFailures', { scanned: run.scanned, failed: run.failed })
                  : t('discovery.scanned', { scanned: run.scanned })}
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.application')}</th>
                    <th className="px-3 py-2 text-right font-medium text-neutral-600">{t('discovery.users')}</th>
                    <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('discovery.registered')}</th>
                    <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('discovery.scopes')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {run.applications.map((app) => (
                    <tr key={app.clientId} data-testid={`discovered-${app.clientId}`}>
                      <td className="px-3 py-2 text-neutral-700">
                        {app.displayName ?? <span className="text-neutral-400">{t('discovery.unnamed')}</span>}
                        <span className="ml-1 block text-xs text-neutral-400">{app.clientId}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-700" data-testid="user-count">
                        {app.userCount}
                      </td>
                      <td className="px-3 py-2" data-testid="registered">
                        {/* Three states rendered as three. `anonymous === null`
                            means the provider did not say, and showing that as
                            "yes" would vouch for an application on no evidence —
                            the direction the whole feature exists to avoid. */}
                        {app.anonymous === null ? (
                          <span className="text-neutral-400">{t('discovery.unknown')}</span>
                        ) : app.anonymous ? (
                          <span className="font-medium text-red-700">{t('discovery.no')}</span>
                        ) : (
                          <span className="text-neutral-500">{t('discovery.yes')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-500">
                        {app.scopes.length === 0 ? '—' : app.scopes.join(', ')}
                      </td>
                    </tr>
                  ))}
                  {run.applications.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">
                        {t('discovery.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
