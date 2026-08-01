import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { SaasAppListResponse } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';
import { SaasAppForm } from '@/components/SaasAppForm';
import { SaasAppManager } from '@/components/SaasAppManager';
import { getTranslator } from '@/lib/i18n/server';

async function fetchSaasApps(): Promise<SaasAppListResponse> {
  const res = await apiFetch('/api/saas-apps');

  if (res.status === 401) {
    redirect('/login');
  }
  if (!res.ok) {
    throw new Error(`failed to load saas apps: ${res.status}`);
  }

  return (await res.json()) as SaasAppListResponse;
}

export default async function AppsPage() {
  const { items } = await fetchSaasApps();
  const t = await getTranslator();

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-lg font-semibold text-neutral-900">{t('apps.title')}</h1>

        <div className="mb-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('field.displayName')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('field.key')}</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">{t('apps.manage')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 text-neutral-700">{item.displayName}</td>
                  <td className="px-3 py-2 text-neutral-500">{item.key}</td>
                  <td className="px-3 py-2">
                    <SaasAppManager app={item} />
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-neutral-400">
                    {t('apps.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <SaasAppForm />
      </main>
    </>
  );
}
