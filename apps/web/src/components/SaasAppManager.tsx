'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SaasAppListItem } from '@/lib/api-types';

// Same deliberate anti-idiom as SaasAppForm.tsx: caught values are classified
// and discarded, never read for their text. A replaced service-account key
// pasted into this form must not reach a React error overlay or a support
// screenshot via an exception message. Do not "fix" this back to the codebase's
// narrow-and-read-message convention.
const ERROR_MESSAGES = {
  invalidJson: 'That does not look like valid JSON.',
  missingFields: 'Service account JSON must include client_email and private_key.',
  invalidBody: 'Please provide a value to update.',
  hasAccounts: 'Cannot delete — accounts are still attributed to this app.',
  notFound: 'This app no longer exists — refresh the page.',
  network: 'Could not reach the server. Please try again.',
  unknown: 'Something went wrong. Please try again.',
} as const;

type ManagerError = keyof typeof ERROR_MESSAGES | null;

function validateServiceAccountJson(raw: string): ManagerError {
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

export function SaasAppManager({ app }: { app: SaasAppListItem }) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'rename' | 'credentials'>('idle');
  const [displayName, setDisplayName] = useState(app.displayName);
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [impersonateAdminEmail, setImpersonateAdminEmail] = useState('');
  const [error, setError] = useState<ManagerError>(null);
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setMode('idle');
    setError(null);
    setAccountCount(null);
    setServiceAccountJson('');
    setImpersonateAdminEmail('');
    setDisplayName(app.displayName);
  }

  async function classifyFailure(res: Response): Promise<ManagerError> {
    if (res.status === 401) {
      router.push('/login');
      return null;
    }
    if (res.status === 404) return 'notFound';
    if (res.status === 400) return 'invalidBody';
    if (res.status === 409) {
      // accountCount is what makes the message actionable — "cannot delete" on
      // its own does not tell the operator what to clear first.
      try {
        const body = (await res.json()) as { accountCount?: number };
        if (typeof body.accountCount === 'number') setAccountCount(body.accountCount);
      } catch {
        // Body shape is advisory; the 409 itself is the answer.
      }
      return 'hasAccounts';
    }
    return 'unknown';
  }

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/saas-apps/${encodeURIComponent(app.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(await classifyFailure(res));
        return;
      }
      close();
      router.refresh();
    } catch {
      setError('network');
    } finally {
      setBusy(false);
    }
  }

  async function handleRename() {
    if (displayName.trim().length === 0) {
      setError('invalidBody');
      return;
    }
    await patch({ displayName: displayName.trim() });
  }

  async function handleReplaceCredentials() {
    const invalid = validateServiceAccountJson(serviceAccountJson);
    if (invalid) {
      setError(invalid);
      return;
    }
    await patch({
      credentials: {
        serviceAccountJson,
        impersonateAdminEmail,
      },
    });
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/saas-apps/${encodeURIComponent(app.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(await classifyFailure(res));
        return;
      }
      close();
      router.refresh();
    } catch {
      setError('network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode(mode === 'rename' ? 'idle' : 'rename')}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Rename
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode(mode === 'credentials' ? 'idle' : 'credentials')}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Replace credentials
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleDelete}
          className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {mode === 'rename' && (
        <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 bg-white p-2 text-xs">
          <label htmlFor={`rename-${app.id}`} className="font-medium text-neutral-700">
            Display name
          </label>
          <input
            id={`rename-${app.id}`}
            type="text"
            autoComplete="off"
            disabled={busy}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleRename}
              className="rounded-md bg-neutral-900 px-2 py-1 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="px-2 py-1 text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'credentials' && (
        <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 bg-white p-2 text-xs">
          <label htmlFor={`sa-json-${app.id}`} className="font-medium text-neutral-700">
            New service account JSON
          </label>
          <textarea
            id={`sa-json-${app.id}`}
            rows={6}
            autoComplete="off"
            disabled={busy}
            value={serviceAccountJson}
            onChange={(e) => setServiceAccountJson(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
          />
          <label htmlFor={`sa-admin-${app.id}`} className="font-medium text-neutral-700">
            Admin email to impersonate
          </label>
          <input
            id={`sa-admin-${app.id}`}
            type="email"
            autoComplete="off"
            disabled={busy}
            value={impersonateAdminEmail}
            onChange={(e) => setImpersonateAdminEmail(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleReplaceCredentials}
              className="rounded-md bg-neutral-900 px-2 py-1 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? 'Replacing…' : 'Replace'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="px-2 py-1 text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error === 'hasAccounts' && accountCount !== null
            ? `Cannot delete — ${accountCount} account${accountCount === 1 ? '' : 's'} still attributed to this app.`
            : ERROR_MESSAGES[error]}
        </p>
      )}
    </div>
  );
}
