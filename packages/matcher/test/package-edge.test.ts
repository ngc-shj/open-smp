import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from '@open-smp/api-types';
import type { LinkResult } from '../src/index.js';

// C42/I42.3. The matcher imports @open-smp/api-types for LinkStatus, and pnpm
// resolves that import through workspace hoisting whether or not the manifest
// declares it. So an undeclared edge works — until an install topology changes
// and it does not. Nothing else in the suite would notice the manifest losing
// the entry, which is why this gate exists rather than a comment.

describe('C42: the api-types edge is declared, not merely resolved', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies?: Record<string, string> };

  it('declares @open-smp/api-types as a workspace dependency', () => {
    expect(manifest.dependencies?.['@open-smp/api-types']).toBe('workspace:*');
  });
});

describe('C42/I42.1: LinkResult.status is the shared domain', () => {
  // A type-level claim needs a runtime witness to be testable at all. Assigning
  // each domain member into the field is that witness: if LinkResult.status
  // were narrowed back to a hand-written subset, this stops compiling.
  it('accepts every domain status', () => {
    const results: LinkResult[] = LINK_STATUSES.map((status) => ({
      saasAccountId: 'a1',
      identityId: null,
      status,
      confidence: 0,
      ruleId: null,
      evidence: null,
    }));

    expect(results.map((r) => r.status)).toEqual([...LINK_STATUSES]);
  });
});
