'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { pollJob, SessionExpiredError } from '@/lib/polling';
import { NavBar } from '@/components/NavBar';
import type { HrImportResponse } from '@/lib/api-types';

// Keep in sync with apps/api/src/routes/hr-import.ts MAX_UPLOAD_BYTES. The
// value lives in apps/api, which apps/web cannot import from — moving it into
// @open-smp/api-types would fix that, and is SC37. (The older reason given here,
// "api-types is type-only", stopped being true when C29 added a value export.)
// Checked client-side because an over-limit upload aborted mid-stream by the
// server does not reliably deliver its 400 through the Next proxy.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Maps known API error strings (hr-import.ts) to friendlier copy; the raw
// string is always shown alongside in smaller print for support purposes.
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  'file is required': 'Please choose a CSV file to upload.',
  'file must be UTF-8 encoded': 'This file is not UTF-8 encoded. Save it as UTF-8 and try again.',
  'malformed CSV': 'This file could not be parsed as CSV.',
  'too many rows (max 20000)': 'This file has too many rows (max 20,000).',
  'file exceeds 10MB limit': 'This file is too large (max 10MB).',
};

type State =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'uploaded'; result: HrImportResponse }
  | { phase: 'upload-failed'; rawMessage: string }
  | { phase: 'matching' }
  | { phase: 'done' }
  | { phase: 'match-failed'; rawMessage: string }
  | { phase: 'match-timed-out' };

export default function ImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setState({ phase: 'upload-failed', rawMessage: 'file exceeds 10MB limit' });
      return;
    }

    setState({ phase: 'uploading' });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/hr-import', { method: 'POST', body: formData });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ phase: 'upload-failed', rawMessage: body?.error ?? `upload failed: ${res.status}` });
        return;
      }

      const result = (await res.json()) as HrImportResponse;
      setState({ phase: 'uploaded', result });
    } catch {
      setState({ phase: 'upload-failed', rawMessage: 'network error' });
    }
  }

  async function runMatching() {
    setState({ phase: 'matching' });

    try {
      const res = await fetch('/api/match', { method: 'POST' });

      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (!res.ok) {
        setState({ phase: 'match-failed', rawMessage: `match enqueue failed: ${res.status}` });
        return;
      }

      const { jobId } = (await res.json()) as { jobId: string };
      await pollJob(jobId);
      setState({ phase: 'done' });
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'match failed';
      if (message === 'job polling timed out') {
        setState({ phase: 'match-timed-out' });
        return;
      }
      setState({ phase: 'match-failed', rawMessage: message });
    }
  }

  const canRunMatching = state.phase === 'idle' || state.phase === 'uploaded' || state.phase === 'match-failed';
  const isMatching = state.phase === 'matching';
  const isUploading = state.phase === 'uploading';

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-lg font-semibold text-neutral-900">Import HR data</h1>

        <form onSubmit={handleUpload} className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Upload CSV</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              disabled={isUploading}
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

          {state.phase === 'upload-failed' && (
            <div className="mt-2 text-sm text-red-700">
              <p>{UPLOAD_ERROR_MESSAGES[state.rawMessage] ?? 'Upload failed. Please try again.'}</p>
              <p className="text-xs text-neutral-400">{state.rawMessage}</p>
            </div>
          )}
        </form>

        {state.phase === 'uploaded' && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-neutral-900">Import result</h2>
            <p className="text-sm text-neutral-700">
              {state.result.imported} imported, {state.result.skipped} skipped
            </p>

            {state.result.errors.length > 0 && (
              <IssueTable title="Errors" issues={state.result.errors} tone="text-red-700" />
            )}
            {state.result.warnings.length > 0 && (
              <IssueTable title="Warnings" issues={state.result.warnings} tone="text-amber-700" />
            )}
          </div>
        )}

        {canRunMatching && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-neutral-900">Matching</h2>
            <button
              type="button"
              onClick={runMatching}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Run matching
            </button>
          </div>
        )}

        {isMatching && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm text-neutral-500">Matching…</p>
          </div>
        )}

        {state.phase === 'done' && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm text-green-700">Matching completed.</p>
            <Link href="/accounts" className="text-sm font-medium text-neutral-900 underline">
              View accounts
            </Link>
          </div>
        )}

        {state.phase === 'match-timed-out' && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm text-red-700">
              Matching is taking longer than expected — check Events or retry
            </p>
            <button
              type="button"
              onClick={runMatching}
              className="mt-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Retry
            </button>
          </div>
        )}

        {state.phase === 'match-failed' && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm text-red-700">Matching failed. Please try again.</p>
            <p className="text-xs text-neutral-400">{state.rawMessage}</p>
          </div>
        )}
      </main>
    </>
  );
}

function IssueTable({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: { row: number; message: string }[];
  tone: string;
}) {
  return (
    <div className="mt-3">
      <h3 className={`mb-1 text-sm font-medium ${tone}`}>{title}</h3>
      <table className="min-w-full divide-y divide-neutral-200 text-sm">
        <thead className="bg-neutral-50">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium text-neutral-600">Row</th>
            <th className="px-3 py-1.5 text-left font-medium text-neutral-600">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {issues.map((issue, index) => (
            <tr key={`${issue.row}-${index}`}>
              <td className="px-3 py-1.5 text-neutral-700">{issue.row}</td>
              <td className="px-3 py-1.5 text-neutral-700">{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
