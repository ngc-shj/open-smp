'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslator } from '@/lib/i18n/locale-context';
import type { MessageKey } from '@/lib/i18n/messages';

type LoginError = 'tooManyAttempts' | 'invalidCredentials' | 'failed' | 'network';

const LOGIN_ERROR_KEYS: Record<LoginError, MessageKey> = {
  tooManyAttempts: 'login.tooManyAttempts',
  invalidCredentials: 'login.invalidCredentials',
  failed: 'login.failed',
  network: 'error.network',
};

export default function LoginPage() {
  const t = useTranslator();
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The failure is held as a key, not as translated text: the locale can change
  // while the message is still on screen, and stored copy would not follow it.
  const [error, setError] = useState<LoginError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantSlug, email, password }),
      });

      if (res.ok) {
        router.push('/accounts');
        router.refresh();
        return;
      }

      if (res.status === 429) {
        setError('tooManyAttempts');
      } else if (res.status === 401 || res.status === 403) {
        setError('invalidCredentials');
      } else {
        setError('failed');
      }
    } catch {
      setError('network');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold text-neutral-900">{t('login.title')}</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="tenantSlug" className="mb-1 block text-sm font-medium text-neutral-700">
              {t('login.tenant')}
            </label>
            <input
              id="tenantSlug"
              name="tenantSlug"
              type="text"
              required
              autoComplete="organization"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-700">
              {t('table.email')}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700">
              {t('login.password')}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {t(LOGIN_ERROR_KEYS[error])}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {submitting ? t('action.signingIn') : t('action.signIn')}
          </button>
        </form>
      </div>
    </main>
  );
}
