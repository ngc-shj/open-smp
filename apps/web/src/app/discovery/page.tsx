import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { DiscoveryEventListResponse } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';
import { latestRuns } from '@/lib/discovery-runs';

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

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-1 text-lg font-semibold text-neutral-900">Discovered applications</h1>
        <p className="mb-6 text-sm text-neutral-500">
          Third-party applications your people have granted access to. This is evidence of a
          grant, not an application the product manages — nothing here has been registered.
        </p>

        {runs.length === 0 && (
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-6 text-center text-sm text-neutral-400">
            No token audit has completed yet.
          </p>
        )}

        {runs.map((run) => (
          <section key={run.auditedAppKey} className="mb-6" data-testid={`audit-${run.auditedAppKey}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-neutral-900">{run.auditedAppKey}</h2>
              <span className="text-xs text-neutral-500" data-testid="coverage">
                {run.scanned} accounts read
                {/* A partial run says so. "3 applications found" over a run that
                    could not read half the accounts is a floor presented as a
                    total. */}
                {run.failed > 0 && `, ${run.failed} could not be read`}
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-neutral-600">Application</th>
                    <th className="px-3 py-2 text-right font-medium text-neutral-600">Users</th>
                    <th className="px-3 py-2 text-left font-medium text-neutral-600">Registered</th>
                    <th className="px-3 py-2 text-left font-medium text-neutral-600">Scopes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {run.applications.map((app) => (
                    <tr key={app.clientId} data-testid={`discovered-${app.clientId}`}>
                      <td className="px-3 py-2 text-neutral-700">
                        {app.displayName ?? <span className="text-neutral-400">unnamed</span>}
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
                          <span className="text-neutral-400">unknown</span>
                        ) : app.anonymous ? (
                          <span className="font-medium text-red-700">no</span>
                        ) : (
                          <span className="text-neutral-500">yes</span>
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
                        No third-party grants found.
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
