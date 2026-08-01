import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs tool with no type declarations; what is under
// test is its behaviour, and a hand-written .d.ts would be a second declaration
// of the same thing with nothing keeping the two honest.
import { applyOnce } from '../../../scripts/mutate.mjs';

// The mutation harness's own failing state.
//
// A harness that reports every mutation as red is indistinguishable from a
// well-tested codebase, and its most important rule is the one that is silent
// when it breaks: an anchor matching NOTHING produces a run in which nothing was
// mutated and every test passed — which reads as "the mutation survived". Cycle
// 7 hit that class twice from the other direction (a fixture that did not
// contain the case its test named), and the anchor-count assertion is what keeps
// it from happening here.
//
// It lives under apps/api/test because that is a tree the unit project already
// discovers; the tool has no package of its own.

describe('applyOnce refuses to mutate what it cannot locate', () => {
  it('applies a mutation whose anchor occurs exactly once', () => {
    const result = applyOnce('const MAX = 10;\nconst OTHER = 20;\n', 'const MAX = 10;', 'const MAX = 99;');

    expect(result.error).toBeUndefined();
    expect(result.mutated).toBe('const MAX = 99;\nconst OTHER = 20;\n');
  });

  it('refuses an anchor that matches nothing', () => {
    // THE case. Silence here is a green run that reads as a surviving mutation.
    const result = applyOnce('const MAX = 10;', 'const MISSING = 1;', 'const MISSING = 2;');

    expect(result.mutated).toBeUndefined();
    expect(result.error).toMatch(/occurs 0 times/);
  });

  it('refuses an anchor that matches more than once', () => {
    // Two matches means `String.replace` cuts only the first, so the run
    // reports on a mutation half-applied — and which half is positional.
    const result = applyOnce('a();\nb();\na();\n', 'a();', 'c();');

    expect(result.mutated).toBeUndefined();
    expect(result.error).toMatch(/occurs 2 times/);
  });

  it('does not treat a substring of the anchor as a match', () => {
    const result = applyOnce('const MAXIMUM = 10;', 'const MAX = 10;', 'x');

    expect(result.error).toMatch(/occurs 0 times/);
  });

  it('changes nothing outside the anchor', () => {
    const source = 'before\nTARGET\nafter\n';

    expect(applyOnce(source, 'TARGET', 'REPLACED').mutated).toBe('before\nREPLACED\nafter\n');
  });

  it('accepts a multi-line anchor, which is what a real mutation cuts', () => {
    const source = 'if (guard) {\n  throw new Error("no");\n}\nrest();\n';
    const result = applyOnce(source, 'if (guard) {\n  throw new Error("no");\n}\n', '');

    expect(result.mutated).toBe('rest();\n');
  });
});
