'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountLabel, AccountLabelKind } from '@/lib/api-types';
import { LABEL_KIND_NAMES, LABEL_KINDS } from '@/lib/label-kinds';

export function LabelControl({ accountId, label }: { accountId: string; label: AccountLabel | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<AccountLabelKind>(label?.kind ?? LABEL_KINDS[0]!);
  const [note, setNote] = useState(label?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    setKind(label?.kind ?? LABEL_KINDS[0]!);
    setNote(label?.note ?? '');
    setError(null);
    setEditing(true);
  }

  function closeEditor() {
    setEditing(false);
    setError(null);
  }

  async function handleResponse(res: Response): Promise<boolean> {
    if (res.status === 401) {
      router.push('/login');
      return false;
    }
    if (res.status === 404) {
      setError('Account no longer exists — refresh the page');
      return false;
    }
    if (!res.ok) {
      setError('Something went wrong. Please try again.');
      return false;
    }
    return true;
  }

  async function handleSave() {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/label`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...(note.trim() ? { note: note.trim() } : {}) }),
      });

      if (!(await handleResponse(res))) return;

      setEditing(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/label`, { method: 'DELETE' });

      if (!(await handleResponse(res))) return;

      setEditing(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={openEditor}
        className="rounded-full border border-neutral-300 bg-white px-2.5 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
      >
        {label ? LABEL_KIND_NAMES[label.kind] : 'Label'}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 bg-white p-2 text-xs">
      <select
        value={kind}
        disabled={busy}
        onChange={(e) => setKind(e.target.value as AccountLabelKind)}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      >
        {LABEL_KINDS.map((k) => (
          <option key={k} value={k}>
            {LABEL_KIND_NAMES[k]}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Note (optional)"
        maxLength={500}
        disabled={busy}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />

      {error && <p className="text-red-700">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleSave}
          className="rounded-md bg-neutral-900 px-2 py-1 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {label && (
          <button
            type="button"
            disabled={busy}
            onClick={handleClear}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={closeEditor}
          className="px-2 py-1 text-neutral-500 hover:text-neutral-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
