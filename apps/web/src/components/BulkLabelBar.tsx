'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountLabelKind } from '@/lib/api-types';
import { LABEL_KIND_KEYS, LABEL_KINDS } from '@/lib/label-kinds';
import { useTranslator } from '@/lib/i18n/locale-context';
import type { MessageKey } from '@/lib/i18n/messages';

// Mirrors the API cap. Enforced here too so an operator who selects more than
// the endpoint accepts gets a comprehensible message instead of a raw 400.
const MAX_SELECTION = 100;

type BulkError = 'tooMany' | 'stale' | 'invalid' | 'network' | 'unknown' | null;

const ERROR_KEYS: Record<BulkError & string, MessageKey> = {
  tooMany: 'label.tooMany',
  stale: 'label.stale',
  invalid: 'label.invalid',
  network: 'error.network',
  unknown: 'error.unknown',
};

export function BulkLabelBar({
  selectedIds,
  onApplied,
}: {
  selectedIds: string[];
  onApplied: () => void;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [kind, setKind] = useState<AccountLabelKind>(LABEL_KINDS[0]!);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BulkError>(null);
  const [applied, setApplied] = useState<number | null>(null);

  const disabled = busy || selectedIds.length === 0;

  async function handleApply() {
    if (selectedIds.length > MAX_SELECTION) {
      setError('tooMany');
      return;
    }

    setBusy(true);
    setError(null);
    setApplied(null);

    try {
      const res = await fetch('/api/accounts/labels/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountIds: selectedIds,
          kind,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (res.status === 404) {
        // The realistic cause is a concurrent re-sync. Naming the count is what
        // makes it actionable — a bare 404 tells the operator nothing.
        setError('stale');
        return;
      }
      if (res.status === 400) {
        setError('invalid');
        return;
      }
      if (!res.ok) {
        setError('unknown');
        return;
      }

      const body = (await res.json()) as { updated: number };
      setApplied(body.updated);
      setNote('');
      onApplied();
      router.refresh();
    } catch {
      setError('network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs">
      <span className="font-medium text-neutral-700">
        {t('label.selected', { count: selectedIds.length })}
      </span>

      <select
        aria-label={t('label.bulkKind')}
        value={kind}
        disabled={disabled}
        onChange={(e) => setKind(e.target.value as AccountLabelKind)}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      >
        {LABEL_KINDS.map((value) => (
          <option key={value} value={value}>
            {t(LABEL_KIND_KEYS[value])}
          </option>
        ))}
      </select>

      <input
        type="text"
        aria-label={t('label.bulkNote')}
        placeholder={t('field.note')}
        maxLength={500}
        value={note}
        disabled={disabled}
        onChange={(e) => setNote(e.target.value)}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />

      <button
        type="button"
        disabled={disabled}
        onClick={handleApply}
        className="rounded-md bg-neutral-900 px-2.5 py-1 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? t('action.applying') : t('action.apply')}
      </button>

      {error && (
        <span role="alert" className="text-red-700">
          {t(ERROR_KEYS[error], { max: MAX_SELECTION })}
        </span>
      )}
      {applied !== null && !error && (
        <span role="status" className="text-neutral-600">
          {/* The count selects the message because English pluralises and Japanese does not. */}
          {t(applied === 1 ? 'label.applied.one' : 'label.applied.other', { count: applied })}
        </span>
      )}
    </div>
  );
}
