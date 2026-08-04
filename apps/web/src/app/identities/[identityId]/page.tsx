import { notFound, redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { IdentityDetailResponse } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';
import { StatusChip } from '@/components/StatusChip';
import { LABEL_KIND_KEYS } from '@/lib/label-kinds';
import { getTranslator } from '@/lib/i18n/server';
import { identityStatusKeyFor, linkStatusKeyFor } from '@/lib/link-statuses';
import { accountStatusKeyFor } from '@/lib/account-statuses';

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

// The API truncates at this many (apps/api/src/page-size.ts, PAGE_SIZE). That
// module is not reachable from apps/web, so this is a hand-synced copy rather
// than a derivation — named here so the figure is not buried in a sentence.
const IDENTITY_ACCOUNTS_SHOWN = 50;

export default async function IdentityDetailPage({
  params,
}: {
  params: Promise<{ identityId: string }>;
}) {
  const { identityId } = await params;
  const identity = await fetchIdentity(identityId);
  const t = await getTranslator();

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
            <dt className="text-neutral-500">{t('identity.status')}</dt>
            <dd className="text-neutral-900">
              {(() => {
                const key = identityStatusKeyFor(identity.status);
                return key ? t(key) : identity.status;
              })()}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">{t('identity.leftAt')}</dt>
            <dd className="text-neutral-900">{identity.leftAt ?? '—'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-neutral-500">{t('identity.secondaryEmails')}</dt>
            <dd className="text-neutral-900">
              {identity.secondaryEmails.length > 0 ? identity.secondaryEmails.join(', ') : '—'}
            </dd>
          </div>
        </dl>

        <h2 className="mb-2 text-sm font-semibold text-neutral-900">{t('identity.attributedAccounts')}</h2>

        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.app')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.email')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.accountStatus')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.admin')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.lastActivity')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.link')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.confidence')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('table.label')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {identity.accounts.map((account) => (
                <tr key={account.accountId}>
                  <td className="px-3 py-2 text-neutral-700">{account.appName}</td>
                  <td className="px-3 py-2 text-neutral-700">{account.email ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-700">
                    {(() => {
                      const key = accountStatusKeyFor(account.accountStatus);
                      return key ? t(key) : account.accountStatus;
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    {account.isAdmin && (
                      <span className="status-chip bg-neutral-200 text-neutral-700">{t('value.admin')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{account.lastActivityAt ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusChip
                      status={account.linkStatus}
                      label={(() => {
                        const key = linkStatusKeyFor(account.linkStatus);
                        return key ? t(key) : undefined;
                      })()}
                    />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{account.confidence.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    {account.label ? (
                      <span className="status-chip bg-neutral-200 text-neutral-700">
                        {t(LABEL_KIND_KEYS[account.label.kind])}
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
                    {t('identity.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {identity.accountsTruncated && (
          <p className="mt-4 text-sm text-neutral-500">
            {t('identity.truncated', { count: IDENTITY_ACCOUNTS_SHOWN })}
          </p>
        )}
      </main>
    </>
  );
}
