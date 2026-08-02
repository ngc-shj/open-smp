'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslator } from '@/lib/i18n/locale-context';
import type { MessageKey } from '@/lib/i18n/messages';
import { CONNECTOR_APP_KEYS, type ConnectorAppKey } from '@/lib/api-types';
import {
  credentialFieldsFor,
  DEFAULT_CONNECTOR_APP_KEY,
  rejectCredentials,
  type CredentialField,
} from '@/lib/connector-credentials';

type FieldError =
  | 'invalidJson'
  | 'missingFields'
  | 'invalidToken'
  | 'invalidEmail'
  | 'invalidBody'
  | 'duplicate'
  | 'catalogFull'
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
//
// SC2/C3 extends this to a second credential shape rather than relaxing it. A
// Slack bot token is a directly replayable bearer credential, so the rule it
// was written for applies more sharply, not less — the classification itself
// now lives in lib/connector-credentials.ts, which returns symbols and reads no
// caught value either.
const ERROR_KEYS: Record<FieldError & string, MessageKey> = {
  invalidJson: 'saasapp.invalidJson',
  missingFields: 'saasapp.missingFields',
  invalidToken: 'saasapp.invalidToken',
  invalidEmail: 'saasapp.invalidEmail',
  invalidBody: 'saasapp.invalidBodyRegister',
  duplicate: 'saasapp.duplicate',
  // NOT registerFailed. That says "please try again", and retrying at the
  // ceiling can never succeed — the discriminant was read and then discarded,
  // which review pointed out defeats the reason C3 read it.
  catalogFull: 'saasapp.catalogFull',
  network: 'error.network',
  unknown: 'saasapp.registerFailed',
};

const FIELD_CLASS =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none';

function CredentialInput({
  field,
  value,
  onChange,
  label,
}: {
  field: CredentialField;
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  // The DOM id is the credential's own name, so `getByLabel('Service account
  // JSON')` keeps resolving to the same element it always did — which is what
  // lets three E2E specs stand unchanged as the proof that nothing moved.
  const common = {
    id: field.name,
    // `aria-required`, matching the manager. `required` inside this real
    // `<form>` made the browser adjudicate blankness before `handleSubmit` ran,
    // while the manager's identical field was adjudicated by
    // `rejectCredentials` — the same split the `type` attribute had, on the same
    // element, left behind by the fix that claimed to have removed it.
    'aria-required': field.required,
    autoComplete: 'off' as const,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
  };

  return (
    <div>
      <label htmlFor={field.name} className="mb-1 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      {field.kind === 'multiline' ? (
        <textarea {...common} rows={8} className={`${FIELD_CLASS} font-mono text-xs`} />
      ) : (
        <input
          {...common}
          // ONE ADJUDICATOR, and it is `rejectAdminEmail`. `type="email"` inside
          // this real `<form>` ran the browser's stricter WHATWG check FIRST and
          // blocked submit before `handleSubmit`, so the regex never saw the
          // value here — while the manager's inputs sit outside any form and
          // only the regex applies there. Same field, same product, two verdicts
          // decided by which panel the operator opened: `admin@corp_internal`
          // was accepted when replacing credentials and rejected when
          // registering. `rejectAdminEmail` is now the browser's own production
          // applied on both surfaces, so `type="email"` would be a second engine
          // deciding the same predicate (R48). The earlier version of this
          // comment justified the choice by the regex being the LOOSER of the
          // two — true when it was written, false since the predicate was
          // tightened in the same commit that left this sentence behind.
          type={field.kind === 'secret' ? 'password' : 'text'}
          inputMode={field.kind === 'email' ? 'email' : undefined}
          className={FIELD_CLASS}
        />
      )}
    </div>
  );
}

export function SaasAppForm() {
  const t = useTranslator();
  const router = useRouter();
  const [appKey, setAppKey] = useState<ConnectorAppKey>(DEFAULT_CONNECTOR_APP_KEY);
  const [displayName, setDisplayName] = useState('');
  // Keyed by credential name rather than one state hook per field, because the
  // field set is now per connector and a fixed set of hooks would have to know
  // the union of every connector's fields.
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<FieldError>(null);
  const [submitting, setSubmitting] = useState(false);

  // Through the shared accessor, like the manager. `appKey` is a
  // `ConnectorAppKey` from a bounded `<select>` here, so a bare index would be
  // safe — but one accessor with no exceptions is what lets the source scan in
  // connector-credentials.test.ts stay a flat rule, and this class has already
  // produced two sibling lookups one round apart.
  const fields = credentialFieldsFor(appKey);

  function resetForm() {
    setDisplayName('');
    setValues({});
  }

  function selectConnector(next: ConnectorAppKey) {
    setAppKey(next);
    // Credentials do not survive the switch. Carrying them would post one
    // connector's secret under another's key, and the operator cannot see the
    // fields that are no longer rendered.
    setValues({});
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const rejection = rejectCredentials(appKey, values);
    if (rejection) {
      setError(rejection);
      return;
    }

    setSubmitting(true);

    try {
      // Only the fields this connector declares, and only the non-empty ones —
      // an optional field left blank is absent rather than an empty string the
      // worker would have to treat as a value.
      const credentials = Object.fromEntries(
        fields.map((field) => [field.name, values[field.name] ?? '']).filter(([, v]) => v !== ''),
      );

      const res = await fetch('/api/saas-apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: appKey, displayName, credentials }),
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
        // Two conflicts share this status now: the key is taken, or the catalog
        // is full (SC2/C2). Read the discriminant rather than reporting the
        // first as the second — "already registered" against a full catalog
        // sends the operator to delete an app they do not have.
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error === 'catalog_full' ? 'catalogFull' : 'duplicate');
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
            value={appKey}
            autoComplete="off"
            onChange={(e) => selectConnector(e.target.value as ConnectorAppKey)}
            className={FIELD_CLASS}
          >
            {CONNECTOR_APP_KEYS.map((key) => (
              // The key itself, not translated copy: it is the value the
              // operator sees in the apps table and types into the sync
              // control, so a translated label would name a different thing.
              <option key={key} value={key}>
                {key}
              </option>
            ))}
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
            className={FIELD_CLASS}
          />
        </div>

        {fields.map((field) => (
          <CredentialInput
            key={field.name}
            field={field}
            label={t(field.labelKey)}
            value={values[field.name] ?? ''}
            onChange={(next) => setValues((prev) => ({ ...prev, [field.name]: next }))}
          />
        ))}

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
