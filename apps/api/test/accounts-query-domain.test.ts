import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from '@open-smp/api-types';
import { accountsQuerySchema } from '../src/routes/accounts.js';
import { stripTsComments } from './strip-ts-comments.js';

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
    // Tolerant of anything a formatter does: whitespace between every token,
    // a broken `.enum(...).optional()` chain, and a trailing comma — prettier
    // emits one when it breaks the argument list, and the repo uses trailing
    // commas throughout, so omitting `,?` here was a red waiting to happen on
    // an intact derivation.
    expect(source).toMatch(/status:\s*z\s*\.\s*enum\(\s*LINK_STATUSES\s*,?\s*\)/);
    // The failure this exists to catch: a re-inlined union. Any quoted status
    // literal in the *code* is one, since the domain is imported by name — this
    // is broader than matching `z.enum([...])`, which a local `const` would slip
    // past. Comments are excluded: a note mentioning 'orphan' is not a copy of
    // the domain, and redding on one would be a false red on an intact file.
    expect(stripTsComments(source)).not.toMatch(/'(matched|orphan|ghost|ambiguous)'/);
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
