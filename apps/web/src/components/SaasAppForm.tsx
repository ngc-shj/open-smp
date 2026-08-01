'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslator } from '@/lib/i18n/locale-context';
import type { MessageKey } from '@/lib/i18n/messages';

type FieldError =
  | 'invalidJson'
  | 'missingFields'
  | 'invalidBody'
  | 'duplicate'
  | 'network'
  | 'unknown'
  | null;

// SEC-F2/SEC-F7 (plan C13): this file intentionally does NOT follow the
// codebase's convention of narrowing a caught error and reading its message
// property, used elsewhere (e.g. SyncControl.tsx). Every error surface here
// is a fixed string keyed by failure class/HTTP status. Caught values
// (including JSON.parse exceptions, which echo input snippets in their
// message text) are classified and discarded, never read for their text —
// a pasted service-account private key must never reach a React error
// overlay, console, or support screenshot. Do not "fix" this back to the
// codebase idiom.
const ERROR_KEYS: Record<FieldError & string, MessageKey> = {
  invalidJson: 'saasapp.invalidJson',
  missingFields: 'saasapp.missingFields',
  invalidBody: 'saasapp.invalidBodyRegister',
  duplicate: 'saasapp.duplicate',
  network: 'error.network',
  unknown: 'saasapp.registerFailed',
};

function validateServiceAccountJson(raw: string): FieldError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalidJson';
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return 'invalidJson';
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.client_email !== 'string' || typeof record.private_key !== 'string') {
    return 'missingFields';
  }
  return null;
}

export function SaasAppForm() {
  const t = useTranslator();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [impersonateAdminEmail, setImpersonateAdminEmail] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [error, setError] = useState<FieldError>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setDisplayName('');
    setServiceAccountJson('');
    setImpersonateAdminEmail('');
    setCustomerId('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const jsonError = validateServiceAccountJson(serviceAccountJson);
    if (jsonError) {
      setError(jsonError);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/saas-apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'google-workspace',
          displayName,
          credentials: {
            serviceAccountJson,
            impersonateAdminEmail,
            ...(customerId ? { customerId } : {}),
          },
        }),
      });

      if (res.status === 201) {
        resetForm();
        router.refresh();
        return;
      }
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (res.status === 409) {
        setError('duplicate');
        return;
      }
      if (res.status === 400) {
        setError('invalidBody');
        return;
      }
      setError('unknown');
    } catch {
      setError('network');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-4 text-sm font-semibold text-neutral-900">{t('saasapp.register')}</h2>

      <div className="space-y-4">
        <div>
          <label htmlFor="appKey" className="mb-1 block text-sm font-medium text-neutral-700">
            {t('field.key')}
          </label>
          <select
            id="appKey"
            disabled
            value="google-workspace"
            autoComplete="off"
            className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-500"
          >
            <option value="google-workspace">google-workspace</option>
          </select>
        </div>

        <div>
          <label htmlFor="displayName" className="mb-1 block text-sm font-medium text-neutral-700">
            {t('field.displayName')}
          </label>
          <input
            id="displayName"
            type="text"
            required
            autoComplete="off"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="serviceAccountJson" className="mb-1 block text-sm font-medium text-neutral-700">
            {t('field.serviceAccountJson')}
          </label>
          <textarea
            id="serviceAccountJson"
            required
            rows={8}
            autoComplete="off"
            value={serviceAccountJson}
            onChange={(e) => setServiceAccountJson(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-neutral-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="impersonateAdminEmail" className="mb-1 block text-sm font-medium text-neutral-700">
            {t('field.adminEmail')}
          </label>
          <input
            id="impersonateAdminEmail"
            type="email"
            required
            autoComplete="off"
            value={impersonateAdminEmail}
            onChange={(e) => setImpersonateAdminEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="customerId" className="mb-1 block text-sm font-medium text-neutral-700">
            {t('saasapp.customerId')}
          </label>
          <input
            id="customerId"
            type="text"
            autoComplete="off"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {t(ERROR_KEYS[error])}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {submitting ? t('action.registering') : t('action.register')}
        </button>
      </div>
    </form>
  );
}
