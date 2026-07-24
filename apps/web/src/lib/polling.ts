import type { JobState } from '@/lib/api-types';

export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 120_000;

export async function pollJob(jobId: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error(`job status request failed: ${res.status}`);
    const job = (await res.json()) as JobState;

    if (job.state === 'completed') return;
    if (job.state === 'failed') throw new Error('job failed');

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('job polling timed out');
}
