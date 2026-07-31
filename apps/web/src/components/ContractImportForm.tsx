'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CONTRACT_IMPORT_MAX_ROWS,
  MAX_UPLOAD_BYTES,
  type ContractImportResponse,
  type ImportRowIssue,
} from '@/lib/api-types';

// Maps known API error strings (contract-import.ts) to friendlier copy; the raw
// string is always shown alongside in smaller print for support purposes. Kept
// separate from the HR import's map even where the text coincides: the two
// routes carry different row caps, so one shared map would have to lie about
// one of them.
//
// The row-cap entry is KEYED off the constant the route interpolates, not typed
// out. A hand-written key stops matching the moment the cap moves and this map
// silently falls through to the generic copy — in the one place that exists to
// explain a refusal. `en-US` is explicit because a default locale would make
// the rendered copy depend on where the browser runs (VE3).
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  'file is required': 'Please choose a CSV file to upload.',
  'file must be UTF-8 encoded': 'This file is not UTF-8 encoded. Save it as UTF-8 and try again.',
  'malformed CSV': 'This file could not be parsed as CSV.',
  [`too many rows (max ${CONTRACT_IMPORT_MAX_ROWS})`]: `This file has too many rows (max ${CONTRACT_IMPORT_MAX_ROWS.toLocaleString('en-US')}).`,
  'file exceeds 10MB limit': 'This file is too large (max 10MB).',
};

const COLUMNS =
  'app_key, app_name, plan_name, seats, unit_price, currency, billing_cycle, term_start, term_end, note';

type State =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'uploaded'; result: ContractImportResponse }
  | { phase: 'failed'; rawMessage: string };

function IssueTable({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: ImportRowIssue[];
  tone: string;
}) {
  return (
    <div className="mt-3">
      <h3 className={`text-xs font-semibold ${tone}`}>{title}</h3>
      <ul className="mt-1 space-y-0.5">
        {issues.map((issue) => (
          <li key={`${issue.row}-${issue.message}`} className="text-xs text-neutral-600">
            Row {issue.row}: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ContractImportForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    // Checked client-side because an over-limit upload aborted mid-stream by
    // the server does not reliably deliver its 400 through the Next proxy.
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({ phase: 'failed', rawMessage: 'file exceeds 10MB limit' });
      return;
    }

    setState({ phase: 'uploading' });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/contract-import', { method: 'POST', body: formData });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ phase: 'failed', rawMessage: body?.error ?? `upload failed: ${res.status}` });
        return;
      }

      const result = (await res.json()) as ContractImportResponse;
      setState({ phase: 'uploaded', result });
      // The table above this form is server-rendered from GET /licenses, so
      // without this the operator sees "3 imported" over the figures from
      // before the upload — the one screen where a stale number reads as a
      // reconciliation result.
      router.refresh();
    } catch {
      setState({ phase: 'failed', rawMessage: 'network error' });
    }
  }

  const isUploading = state.phase === 'uploading';

  return (
    <form onSubmit={handleUpload} className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900">Upload contracts</h2>
      <p className="mb-2 text-xs text-neutral-500">
        One row per application. Columns: {COLUMNS}. An application named here is created if it
        does not exist.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          disabled={isUploading}
          aria-label="Contract CSV"
          className="text-sm text-neutral-700"
        />
        <button
          type="submit"
          disabled={isUploading}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Upload
        </button>
      </div>

      {isUploading && <p className="mt-2 text-sm text-neutral-500">Uploading…</p>}

      {state.phase === 'failed' && (
        <div className="mt-2 text-sm text-red-700">
          <p>{UPLOAD_ERROR_MESSAGES[state.rawMessage] ?? 'Upload failed. Please try again.'}</p>
          <p className="text-xs text-neutral-400">{state.rawMessage}</p>
        </div>
      )}

      {state.phase === 'uploaded' && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="text-sm text-neutral-700">
            {state.result.imported} imported, {state.result.skipped} skipped
          </p>
          {state.result.createdApps.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              Applications created: {state.result.createdApps.join(', ')}
            </p>
          )}
          {state.result.errors.length > 0 && (
            <IssueTable title="Errors" issues={state.result.errors} tone="text-red-700" />
          )}
          {state.result.warnings.length > 0 && (
            <IssueTable title="Warnings" issues={state.result.warnings} tone="text-amber-700" />
          )}
        </div>
      )}
    </form>
  );
}
