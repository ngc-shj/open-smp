import type { Job, Queue } from 'bullmq';

/**
 * Reads one job's state across the queues, carrying the job's OWN tenant.
 *
 * HERE rather than inline in `main.ts`, because the inline version had a twin:
 * `api.integration.test.ts` reimplemented it in its `deps` fixture, and the two
 * drifted — the stub omitted `tenantId` until the route's new ownership check
 * made the compiler notice. Mutation then measured the other half: breaking the
 * production reader left the suite green, because the suite was exercising the
 * copy (RT9). One member, imported by both.
 *
 * `tenantId` travels with the state so the route can authorize. Every job this
 * API enqueues carries `data.tenantId`, taken from SessionContext and never from
 * a request field (S7), and discarding it here is what left `GET /jobs/:jobId`
 * with no ownership check at all (CWE-639).
 */
export interface JobStatus {
  state: string;
  result: unknown;
  tenantId: unknown;
}

export async function readJob(
  queues: readonly Queue[],
  jobId: string,
): Promise<JobStatus | null> {
  let job: Job | undefined;
  for (const queue of queues) {
    job = await queue.getJob(jobId);
    if (job) break;
  }
  if (!job) {
    return null;
  }

  const state = await job.getState();
  const data = job.data as { tenantId?: unknown } | undefined;
  return { state, result: job.returnvalue ?? null, tenantId: data?.tenantId };
}
