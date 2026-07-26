import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from '@open-smp/api-types';
import { accountsQuerySchema } from '../src/routes/accounts.js';

// C40 site 2. The accounts route validates ?status= with z.enum(LINK_STATUSES),
// and nothing else notices if that reverts to a hand-written union: the four
// members match today, so typecheck, lint and every behavioural test stay green
// while the single-source property is quietly gone.
//
// Behavioural assertions cannot catch that, and it is worth stating why rather
// than rediscovering it. z.enum snapshots its members at construction, so a
// re-inlined union with the same members produces a byte-identical validator —
// reading `.options` back gives the same array either way. The behavioural
// tests below are still worth having (they pin what the route accepts), but the
// derivation itself is only observable in the source text, so that is what the
// first assertion reads.

describe('C40: the accounts status filter derives from the domain', () => {
  it('builds its status enum from LINK_STATUSES, not a local literal', () => {
    const source = readFileSync(new URL('../src/routes/accounts.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/status:\s*z\.enum\(LINK_STATUSES\)/);
    // The failure this exists to catch: a re-inlined union. Any quoted status
    // literal in the file is one, since the domain is imported by name.
    expect(source).not.toMatch(/z\.enum\(\s*\[\s*'(matched|orphan|ghost|ambiguous)'/);
  });

  it('accepts exactly the domain, in the domain order', () => {
    expect([...accountsQuerySchema.shape.status.unwrap().options]).toEqual([...LINK_STATUSES]);
  });

  it('accepts every domain member', () => {
    for (const status of LINK_STATUSES) {
      expect(accountsQuerySchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects a status outside the domain', () => {
    expect(accountsQuerySchema.safeParse({ status: 'quarantined' }).success).toBe(false);
  });
});
