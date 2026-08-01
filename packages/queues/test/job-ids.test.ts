import { describe, expect, it } from 'vitest';
import {
  MATCH_QUEUE,
  SYNC_QUEUE,
  TOKEN_AUDIT_QUEUE,
  matchJobId,
  syncJobId,
  tokenAuditJobId,
} from '../src/index.js';

// SC47. This package had zero coverage, and its `test` script was REMOVED
// rather than left minted-and-failing so the gap would be visible. The trigger
// was "the next cycle touching queue code"; cycle 8 added a third queue, its
// job data and its id function, so this is that cycle.
//
// What is worth asserting is not that the strings are these strings. It is
// that a job id is a DEDUPE KEY: BullMQ treats two adds with the same jobId as
// one job, so a collision between two tenants silently merges their work, and
// a non-deterministic id defeats the deduplication entirely (C5's concurrency-1
// guarantee is built on it).

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const APP_1 = '33333333-3333-3333-3333-333333333333';
const APP_2 = '44444444-4444-4444-4444-444444444444';

describe('queue names', () => {
  it('are distinct', () => {
    // Two queues sharing a name is not a typo that surfaces later — it is two
    // workers consuming one stream, each seeing a fraction of its own jobs.
    const names = [SYNC_QUEUE, MATCH_QUEUE, TOKEN_AUDIT_QUEUE];

    expect(new Set(names).size).toBe(names.length);
  });
});

describe('job ids are dedupe keys', () => {
  it('are deterministic, which is what makes a repeat enqueue a no-op', () => {
    expect(syncJobId(TENANT_A, APP_1)).toBe(syncJobId(TENANT_A, APP_1));
    expect(matchJobId(TENANT_A)).toBe(matchJobId(TENANT_A));
    expect(tokenAuditJobId(TENANT_A, APP_1)).toBe(tokenAuditJobId(TENANT_A, APP_1));
  });

  it('separate tenants', () => {
    // The one that matters most. A collision here dedupes one tenant's job
    // into another's, so the second tenant's work silently never runs.
    expect(syncJobId(TENANT_A, APP_1)).not.toBe(syncJobId(TENANT_B, APP_1));
    expect(matchJobId(TENANT_A)).not.toBe(matchJobId(TENANT_B));
    expect(tokenAuditJobId(TENANT_A, APP_1)).not.toBe(tokenAuditJobId(TENANT_B, APP_1));
  });

  it('separate applications within one tenant', () => {
    expect(syncJobId(TENANT_A, APP_1)).not.toBe(syncJobId(TENANT_A, APP_2));
    expect(tokenAuditJobId(TENANT_A, APP_1)).not.toBe(tokenAuditJobId(TENANT_A, APP_2));
  });

  it('separate the queues, so no two ids collide across all three', () => {
    // Each id carries its own queue name. BullMQ scopes ids per queue anyway,
    // so this is not load-bearing today — it is what keeps a future lookup that
    // searches several queues by id (apps/api's getJob does exactly that) from
    // resolving one id to two jobs.
    const ids = [
      syncJobId(TENANT_A, APP_1),
      matchJobId(TENANT_A),
      tokenAuditJobId(TENANT_A, APP_1),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each begins with its own queue name', () => {
    expect(syncJobId(TENANT_A, APP_1).startsWith(`${SYNC_QUEUE}:`)).toBe(true);
    expect(matchJobId(TENANT_A).startsWith(`${MATCH_QUEUE}:`)).toBe(true);
    expect(tokenAuditJobId(TENANT_A, APP_1).startsWith(`${TOKEN_AUDIT_QUEUE}:`)).toBe(true);
  });

  it('carries the tenant and the application verbatim', () => {
    // Pinned as a whole string rather than by prefix: an id built from a HASH
    // would satisfy every assertion above while making a stuck job impossible
    // to attribute from Redis, which is where an operator looks.
    expect(syncJobId(TENANT_A, APP_1)).toBe(`${SYNC_QUEUE}:${TENANT_A}:${APP_1}`);
    expect(tokenAuditJobId(TENANT_A, APP_1)).toBe(`${TOKEN_AUDIT_QUEUE}:${TENANT_A}:${APP_1}`);
  });

  it('keeps the match id trailing separator it shipped with', () => {
    // `match-links:<tenant>:` — the trailing colon is asymmetric with the other
    // two and is not a mistake worth correcting: the id is a live dedupe key,
    // so changing its format orphans every in-flight job at deploy. Pinned so
    // the asymmetry is deliberate rather than rediscovered.
    expect(matchJobId(TENANT_A)).toBe(`${MATCH_QUEUE}:${TENANT_A}:`);
  });
});
