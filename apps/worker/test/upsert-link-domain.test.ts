import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from '@open-smp/api-types';
import type { UpsertLinkInput } from '../src/match.js';

// C42/I42.4, site 8. `upsertLink` writes account_links.status, so its parameter
// type is the last type-level checkpoint before a status reaches the enum
// column. Re-spelling the union inline there is invisible to typecheck, lint
// and every existing test, because the four members match today — this is what
// notices.
//
// A type-level claim needs a runtime witness to be a test at all. Assigning
// every domain member into the field is that witness: narrowing the field back
// to a hand-written subset stops this compiling.

describe('C42: the worker write path derives its status from the domain', () => {
  it('accepts every domain status', () => {
    const writes: UpsertLinkInput[] = LINK_STATUSES.map((status) => ({
      saasAccountId: '00000000-0000-0000-0000-000000000001',
      identityId: null,
      status,
      confidence: 0,
      ruleId: null,
      evidence: null,
    }));

    expect(writes.map((write) => write.status)).toEqual([...LINK_STATUSES]);
  });
});
