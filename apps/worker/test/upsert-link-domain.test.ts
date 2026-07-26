import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from '@open-smp/api-types';
import type { UpsertLinkInput } from '../src/match.js';

// C42/I42.4, site 8. `upsertLink` writes account_links.status, so its parameter
// type is the last type-level checkpoint before a status reaches the enum
// column.
//
// The failure to catch is a re-inlined union with the SAME four members, and it
// is only visible in the source text — the same reason site 2's gate reads its
// route's source (see accounts-query-domain.test.ts). A structural assertion
// cannot see it: the re-inlined type is assignable both ways, so every runtime
// witness and the whole typecheck stay green. The first version of this test
// was exactly such a witness and was a false green, proven by executing the
// revert.

describe('C42: the worker write path derives its status from the domain', () => {
  it('derives its input type from LinkResult, not a re-spelled union', () => {
    const source = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/UpsertLinkInput\s*=\s*Pick<\s*\n?\s*LinkResult/);
    // Any quoted status literal in this module is a re-inlined union: the
    // production code reaches the domain only through LinkResult.
    expect(source).not.toMatch(/'(matched|orphan|ghost|ambiguous)'/);
  });

  // Kept alongside the source assertion: it pins that the derived type actually
  // admits the whole domain, which is what makes the derivation useful rather
  // than merely present.
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
