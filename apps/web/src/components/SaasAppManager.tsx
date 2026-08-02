'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ConnectorAppKey, SaasAppListItem } from '@/lib/api-types';
import { useTranslator } from '@/lib/i18n/locale-context';
import type { MessageKey } from '@/lib/i18n/messages';
import { CREDENTIAL_FIELDS, rejectCredentials, type CredentialField } from '@/lib/connector-credentials';

type ManagerError =
  | 'invalidJson'
  | 'missingFields'
  | 'invalidToken'
  | 'invalidEmail'
  | 'invalidBody'
  | 'hasAccounts'
  | 'notFound'
  | 'network'
  | 'unknown'
  | null;

// Same deliberate anti-idiom as SaasAppForm.tsx: caught values are classified
// and discarded, never read for their text. A replaced service-account key
// pasted into this form must not reach a React error overlay or a support
// screenshot via an exception message. Do not "fix" this back to the codebase's
// narrow-and-read-message convention.
const ERROR_KEYS: Record<ManagerError & string, MessageKey> = {
  invalidJson: 'saasapp.invalidJson',
  missingFields: 'saasapp.missingFields',
  invalidToken: 'saasapp.invalidToken',
  invalidEmail: 'saasapp.invalidEmail',
  invalidBody: 'saasapp.invalidBodyUpdate',
  hasAccounts: 'saasapp.hasAccounts',
  notFound: 'saasapp.notFound',
  network: 'error.network',
  unknown: 'error.unknown',
};

export function SaasAppManager({ app }: { app: SaasAppListItem }) {
  const t = useTranslator();
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'rename' | 'credentials' | 'confirmDelete'>('idle');
  const [displayName, setDisplayName] = useState(app.displayName);
  // Keyed by credential name, like the registration form, because the field set
  // is the connector's rather than this component's.
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<ManagerError>(null);
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // The app's own key decides what "replace credentials" asks for. It is a
  // string on the wire, so a row written before a connector was removed from
  // the set would land here with no field list — the fallback is an empty one,
  // which renders no inputs rather than throwing on a page an operator opened
  // to fix exactly that.
  // `app.key` is arbitrary DB text: POST /contract-import writes it from a CSV
  // cell, and the seed ships `notion`. An application this product has no
  // connector for declares no credential fields, and the control that offers to
  // replace them is HIDDEN rather than rendering an empty panel whose Save
  // reported "That does not look like a bot token" — review found that reachable
  // with the shipped seed.
  const fields: readonly CredentialField[] = CREDENTIAL_FIELDS[app.key as ConnectorAppKey] ?? [];
  const canReplaceCredentials = fields.length > 0;

  function close() {
    setMode('idle');
    setError(null);
    setAccountCount(null);
    setValues({});
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
    // `required` is declared per field and was applied only by the registration
    // form. A replace SENDS every declared field including blanks, so a required
    // one left empty stored an unusable credential whose failure reached the
    // operator as an audit row.
    if (fields.some((field) => field.required && (values[field.name] ?? '').trim() === '')) {
      setError('invalidBody');
      return;
    }

    const rejection = rejectCredentials(app.key, values);
    if (rejection) {
      setError(rejection);
      return;
    }
    // Every field the connector declares, including the ones left blank: a
    // replacement REPLACES, so omitting an empty optional field would silently
    // keep the previous value under a form that showed it as cleared.
    await patch({
      credentials: Object.fromEntries(fields.map((f) => [f.name, values[f.name] ?? ''])),
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
          {t('saasapp.rename')}
        </button>
        {canReplaceCredentials && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode(mode === 'credentials' ? 'idle' : 'credentials')}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {t('saasapp.replaceCredentials')}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode(mode === 'confirmDelete' ? 'idle' : 'confirmDelete')}
          className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {t('action.delete')}
        </button>
      </div>

      {/* Deleting an app is irreversible — re-registering means pasting the
          service-account credentials again — and this button sits one position
          from Rename. Its two siblings both open a panel before acting, so a
          single click here was the one destructive path with no confirmation. */}
      {mode === 'confirmDelete' && (
        <div className="flex flex-col gap-1.5 rounded-md border border-red-200 bg-white p-2 text-xs">
          {/* The name loses its bold: an interpolated value cannot carry markup,
              and splitting the sentence to keep it is the fragment-concatenation
              shape the dictionary exists to avoid. */}
          <p className="text-neutral-700">{t('saasapp.confirmDelete', { name: app.displayName })}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleDelete}
              className="rounded-md bg-red-700 px-2 py-1 font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              {busy ? t('action.deleting') : t('action.delete')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="px-2 py-1 text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
            >
              {t('action.cancel')}
            </button>
          </div>
        </div>
      )}

      {mode === 'rename' && (
        <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 bg-white p-2 text-xs">
          <label htmlFor={`rename-${app.id}`} className="font-medium text-neutral-700">
            {t('field.displayName')}
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
              {busy ? t('action.saving') : t('action.save')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="px-2 py-1 text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
            >
              {t('action.cancel')}
            </button>
          </div>
        </div>
      )}

      {mode === 'credentials' && (
        <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 bg-white p-2 text-xs">
          {fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-1.5">
              <label htmlFor={`cred-${field.name}-${app.id}`} className="font-medium text-neutral-700">
                {t(field.replaceLabelKey ?? field.labelKey)}
              </label>
              {field.kind === 'multiline' ? (
                <textarea
                  id={`cred-${field.name}-${app.id}`}
                  required={field.required}
                  rows={6}
                  autoComplete="off"
                  disabled={busy}
                  value={values[field.name] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  className="rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
                />
              ) : (
                <input
                  id={`cred-${field.name}-${app.id}`}
                  required={field.required}
                  type={field.kind === 'email' ? 'email' : field.kind === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  disabled={busy}
                  value={values[field.name] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
                />
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleReplaceCredentials}
              className="rounded-md bg-neutral-900 px-2 py-1 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? t('action.replacing') : t('action.replace')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="px-2 py-1 text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
            >
              {t('action.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error === 'hasAccounts' && accountCount !== null
            ? t(accountCount === 1 ? 'saasapp.hasAccounts.one' : 'saasapp.hasAccounts.other', {
                count: accountCount,
              })
            : t(ERROR_KEYS[error])}
        </p>
      )}
    </div>
  );
}
