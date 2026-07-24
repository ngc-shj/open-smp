import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { LOGIN_ACCOUNT_BUCKET_MAX, LOGIN_ACCOUNT_BUCKET_WINDOW_MS } from './rate-limits.js';

// S12 login account-bucket limiter, implemented independently of
// @fastify/rate-limit. Reason (CS-fix): @fastify/rate-limit guards each
// request with a single shared `rateLimitRan` symbol per plugin instance, so
// a route that also carries the IP limiter (config.rateLimit) short-circuits
// the second limiter — the account bucket would never fire. A standalone
// fixed-window counter keyed on the raw submitted `tenantSlug:email` avoids
// that shared guard entirely.
//
// In-memory is acceptable for the MVP single-api-instance compose deployment
// (same posture as the IP limiter's default local store); a multi-instance
// deployment would move this to the shared Redis store — tracked with the
// rate-limit store note in app.ts.

const WINDOW_MS = LOGIN_ACCOUNT_BUCKET_WINDOW_MS;
const MAX = LOGIN_ACCOUNT_BUCKET_MAX;

type Bucket = { count: number; resetAt: number };

export type AccountBucketPreHandler = ((req: FastifyRequest, reply: FastifyReply) => Promise<void>) & {
  trackedKeyCount: () => number;
};

export function createAccountBucketLimiter(now: () => number = () => Date.now()): AccountBucketPreHandler {
  const buckets = new Map<string, Bucket>();

  function key(req: FastifyRequest): string {
    const body = req.body as { tenantSlug?: unknown; email?: unknown } | undefined;
    const tenantSlug = typeof body?.tenantSlug === 'string' ? body.tenantSlug : '';
    const email = typeof body?.email === 'string' ? body.email : '';
    // Keyed on RAW submitted input, never resolved ids (S12): accrual is
    // identical whether or not the slug/email exists, so it cannot become a
    // tenant/account existence oracle.
    return createHash('sha256').update(`${tenantSlug}:${email}`).digest('hex');
  }

  let lastSweep = now();

  // Drop expired buckets (CF7/CS7-A): without this the Map grows unboundedly —
  // an unauthenticated caller varying tenantSlug:email creates a permanent
  // entry per key, a memory-DoS. Sweeping is amortized to at most once per
  // window so the walk cost stays negligible under load.
  function sweep(t: number): void {
    if (t - lastSweep < WINDOW_MS) {
      return;
    }
    lastSweep = t;
    for (const [k, bucket] of buckets) {
      if (bucket.resetAt <= t) {
        buckets.delete(k);
      }
    }
  }

  const preHandler = (async function accountBucketPreHandler(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const t = now();
    sweep(t);
    const k = key(req);
    const existing = buckets.get(k);

    if (!existing || existing.resetAt <= t) {
      buckets.set(k, { count: 1, resetAt: t + WINDOW_MS });
      return;
    }

    existing.count += 1;
    if (existing.count > MAX) {
      await reply.code(429).send({ error: 'too_many_requests' });
    }
  } as AccountBucketPreHandler);

  // Exposed for the eviction test (CF7); not used by production callers.
  preHandler.trackedKeyCount = (): number => buckets.size;
  return preHandler;
}
