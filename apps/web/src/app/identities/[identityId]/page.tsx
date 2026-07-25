import { notFound, redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { IdentityDetailResponse } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';
import { StatusChip } from '@/components/StatusChip';
import { LABEL_KIND_NAMES } from '@/components/LabelControl';

async function fetchIdentity(identityId: string): Promise<IdentityDetailResponse | null> {
  const res = await apiFetch(`/api/identities/${encodeURIComponent(identityId)}`);

  if (res.status === 401) {
    redirect('/login');
  }
  // A malformed or foreign id is a missing page, not a server error — the API
  // deliberately does not distinguish the two (RLS hides other tenants).
  if (res.status === 400 || res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`failed to load identity: ${res.status}`);
  }

  return (await res.json()) as IdentityDetailResponse;
}

export default async function IdentityDetailPage({
  params,
}: {
  params: Promise<{ identityId: string }>;
}) {
  const { identityId } = await params;
  const identity = await fetchIdentity(identityId);

  if (!identity) {
    notFound();
  }

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-1 text-lg font-semibold text-neutral-900">{identity.displayName}</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {identity.employeeId} · {identity.primaryEmail}
        </p>

        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-neutral-500">Status</dt>
            <dd className="text-neutral-900">{identity.status}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Left at</dt>
            <dd className="text-neutral-900">{identity.leftAt ?? '—'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-neutral-500">Secondary emails</dt>
            <dd className="text-neutral-900">
              {identity.secondaryEmails.length > 0 ? identity.secondaryEmails.join(', ') : '—'}
            </dd>
          </div>
        </dl>

        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Attributed accounts</h2>

        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">App</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Email</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Account status</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Admin</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Last activity</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Link</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Confidence</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {identity.accounts.map((account) => (
                <tr key={account.accountId}>
                  <td className="px-3 py-2 text-neutral-700">{account.appName}</td>
                  <td className="px-3 py-2 text-neutral-700">{account.email ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-700">{account.accountStatus}</td>
                  <td className="px-3 py-2">
                    {account.isAdmin && (
                      <span className="status-chip bg-neutral-200 text-neutral-700">admin</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{account.lastActivityAt ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusChip status={account.linkStatus} />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{account.confidence.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    {account.label ? (
                      <span className="status-chip bg-neutral-200 text-neutral-700">
                        {LABEL_KIND_NAMES[account.label.kind]}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {identity.accounts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                    No accounts attributed to this identity.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {identity.accountsTruncated && (
          <p className="mt-4 text-sm text-neutral-500">
            Showing the first 50 accounts attributed to this identity.
          </p>
        )}
      </main>
    </>
  );
}
