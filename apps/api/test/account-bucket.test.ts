import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createAccountBucketLimiter } from '../src/account-bucket.js';

// Unit-level proof of the S12 account bucket, independent of the full HTTP
// stack — the api integration test covers the wired path; this pins the
// limiter's own behavior deterministically via an injected clock so the
// 1-hour window doesn't need real time.

function req(tenantSlug: string, email: string): FastifyRequest {
  return { body: { tenantSlug, email } } as unknown as FastifyRequest;
}

async function run(limiter: ReturnType<typeof createAccountBucketLimiter>, r: FastifyRequest): Promise<number | null> {
  let status: number | null = null;
  const reply = {
    code(c: number) {
      status = c;
      return reply;
    },
    async send() {
      return reply;
    },
  } as unknown as FastifyReply;
  await limiter(r, reply);
  return status;
}

describe('S12 account-bucket limiter', () => {
  it('allows 20 attempts on one bucket, then 429s the 21st', async () => {
    const now = 1_000_000;
    const limiter = createAccountBucketLimiter(() => now);
    const r = req('acme', 'user@example.com');

    for (let i = 0; i < 20; i += 1) {
      expect(await run(limiter, r), `attempt ${i + 1} should be allowed`).toBeNull();
    }
    expect(await run(limiter, r)).toBe(429);
  });

  it('keeps buckets independent across different tenantSlug:email keys', async () => {
    const now = 1_000_000;
    const limiter = createAccountBucketLimiter(() => now);

    for (let i = 0; i < 20; i += 1) {
      await run(limiter, req('acme', 'a@example.com'));
    }
    // 21st on bucket A is limited...
    expect(await run(limiter, req('acme', 'a@example.com'))).toBe(429);
    // ...but a different bucket is unaffected.
    expect(await run(limiter, req('acme', 'b@example.com'))).toBeNull();
  });

  it('resets the window after the timeWindow elapses', async () => {
    let now = 1_000_000;
    const limiter = createAccountBucketLimiter(() => now);
    const r = req('acme', 'user@example.com');

    for (let i = 0; i < 20; i += 1) {
      await run(limiter, r);
    }
    expect(await run(limiter, r)).toBe(429);

    now += 60 * 60 * 1000 + 1; // advance past the 1-hour window
    expect(await run(limiter, r)).toBeNull();
  });

  it('evicts expired buckets so the tracked-key count does not grow unboundedly (CF7)', async () => {
    let now = 1_000_000;
    const limiter = createAccountBucketLimiter(() => now);

    // 100 distinct one-shot keys create 100 entries in one window.
    for (let i = 0; i < 100; i += 1) {
      await run(limiter, req('acme', `probe-${i}@example.com`));
    }
    expect(limiter.trackedKeyCount()).toBe(100);

    // Advance past the window; the next call triggers a sweep that drops all
    // 100 expired entries, leaving only the one key seen after the sweep.
    now += 60 * 60 * 1000 + 1;
    await run(limiter, req('acme', 'fresh@example.com'));
    expect(limiter.trackedKeyCount()).toBe(1);
  });
});
