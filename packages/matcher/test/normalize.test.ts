import { describe, expect, it } from 'vitest';
import { lowerEmail, normalizeEmail } from '../src/normalize.js';

describe('normalizeEmail', () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    { name: 'lowercases the whole address', input: 'Alice@Example.com', expected: 'alice@example.com' },
    { name: 'strips +tag from local part (generic domain)', input: 'alice+work@example.com', expected: 'alice+work@example.com'.replace('+work', '') },
    { name: 'strips +tag from local part (gmail)', input: 'alice+news@gmail.com', expected: 'alice@gmail.com' },
    { name: 'strips dots in local part for gmail.com', input: 'a.l.i.c.e@gmail.com', expected: 'alice@gmail.com' },
    { name: 'strips dots in local part for googlemail.com', input: 'a.l.i.c.e@googlemail.com', expected: 'alice@googlemail.com' },
    { name: 'does NOT strip dots for non-gmail domains', input: 'a.l.i.c.e@example.com', expected: 'a.l.i.c.e@example.com' },
    { name: 'strips +tag and dots together for gmail', input: 'a.l.i.c.e+promo@gmail.com', expected: 'alice@gmail.com' },
    { name: 'is case-insensitive on the domain', input: 'bob@GMAIL.COM', expected: 'bob@gmail.com' },
    { name: 'is case-insensitive combined with dot-stripping', input: 'B.O.B@Gmail.Com', expected: 'bob@gmail.com' },
    { name: 'leaves an address with no + or . untouched apart from case', input: 'carol@example.com', expected: 'carol@example.com' },
    { name: 'handles a local part that is only a +tag suffix', input: 'dave+@example.com', expected: 'dave@example.com' },
    { name: 'handles multiple + signs by stripping from the first one', input: 'erin+a+b@example.com', expected: 'erin@example.com' },
    { name: 'leaves domain dots untouched (not local-part dots)', input: 'frank@sub.example.com', expected: 'frank@sub.example.com' },
    { name: 'strips dots only in local part even with dotted gmail subdomain-like domain', input: 'grace.h@gmail.com', expected: 'graceh@gmail.com' },
    { name: 'passes through a string with no @ unchanged apart from lowering', input: 'not-an-email', expected: 'not-an-email' },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = normalizeEmail('A.Lice+tag@GMAIL.com');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('lowerEmail', () => {
  it('lowercases without touching +tag or dots', () => {
    expect(lowerEmail('A.Lice+Tag@Example.COM')).toBe('a.lice+tag@example.com');
  });

  it('does not strip dots even for gmail domains', () => {
    expect(lowerEmail('A.B.C@GMAIL.COM')).toBe('a.b.c@gmail.com');
  });
});
