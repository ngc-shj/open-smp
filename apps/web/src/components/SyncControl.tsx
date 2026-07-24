'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { pollJob } from '@/lib/polling';

type Phase = 'idle' | 'syncing' | 'matching' | 'done' | 'error';

// C8 F6: match is enqueued only after the sync job it triggered reports
// state = completed — never fired concurrently with an in-flight sync.
export function SyncControl({ appKeys }: { appKeys: string[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [customAppId, setCustomAppId] = useState('');

  async function runSyncThenMatch(saasAppId: string) {
    setError(null);
    setPhase('syncing');

    try {
      const syncRes = await fetch(`/api/sync/${encodeURIComponent(saasAppId)}`, { method: 'POST' });
      if (!syncRes.ok) throw new Error(`sync enqueue failed: ${syncRes.status}`);
      const { jobId } = (await syncRes.json()) as { jobId: string };

      await pollJob(jobId);

      setPhase('matching');
      const matchRes = await fetch('/api/match', { method: 'POST' });
      if (!matchRes.ok) throw new Error(`match enqueue failed: ${matchRes.status}`);
      const { jobId: matchJobId } = (await matchRes.json()) as { jobId: string };

      await pollJob(matchJobId);

      setPhase('done');
      router.refresh();
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'sync failed');
    }
  }

  const isBusy = phase === 'syncing' || phase === 'matching';

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-neutral-900">Sync</h2>
      <div className="flex flex-wrap items-center gap-2">
        {appKeys.map((appKey) => (
          <button
            key={appKey}
            type="button"
            disabled={isBusy}
            onClick={() => runSyncThenMatch(appKey)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Sync {appKey}
          </button>
        ))}

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (customAppId.trim()) runSyncThenMatch(customAppId.trim());
          }}
        >
          <input
            type="text"
            placeholder="saasAppId"
            value={customAppId}
            onChange={(e) => setCustomAppId(e.target.value)}
            disabled={isBusy}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isBusy || !customAppId.trim()}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Sync by ID
          </button>
        </form>
      </div>

      {phase === 'syncing' && <p className="mt-2 text-sm text-neutral-500">Syncing…</p>}
      {phase === 'matching' && <p className="mt-2 text-sm text-neutral-500">Matching…</p>}
      {phase === 'done' && <p className="mt-2 text-sm text-green-700">Sync and match completed.</p>}
      {phase === 'error' && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
