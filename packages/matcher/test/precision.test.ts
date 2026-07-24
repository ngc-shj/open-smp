import { describe, expect, it } from 'vitest';
import { matchAccounts } from '../src/match.js';
import { defaultRules } from '../src/rules.js';
import { corpus, knownGapCount, knownGapRatio } from './corpus.js';

type FlatCase = {
  caseName: string;
  saasAccountId: string;
  expectedStatus: string;
  knownGap: boolean;
};

function flattenExpectations(): FlatCase[] {
  return corpus.flatMap((testCase) =>
    testCase.expected.map((expectation) => ({
      caseName: testCase.name,
      saasAccountId: expectation.saasAccountId,
      expectedStatus: expectation.status,
      knownGap: testCase.knownGap === true,
    })),
  );
}

describe('golden corpus precision gate', () => {
  it(`has at least 40 cases and known-gap cases capped at 25% (actual: ${knownGapCount}/${corpus.length})`, () => {
    expect(corpus.length).toBeGreaterThanOrEqual(40);
    expect(knownGapRatio).toBeLessThanOrEqual(0.25);
  });

  it('meets the 0.95 precision gate overall, and 0.95 on the non-known-gap subset', () => {
    const expectations = flattenExpectations();
    const actualByAccountId = new Map<string, string>();

    for (const testCase of corpus) {
      const results = matchAccounts(testCase.identities, testCase.accounts, defaultRules);
      for (const result of results) {
        actualByAccountId.set(result.saasAccountId, result.status);
      }
    }

    let correct = 0;
    let nonGapTotal = 0;
    let nonGapCorrect = 0;

    for (const expectation of expectations) {
      const actual = actualByAccountId.get(expectation.saasAccountId);
      const isCorrect = actual === expectation.expectedStatus;
      if (isCorrect) {
        correct += 1;
      }
      if (!expectation.knownGap) {
        nonGapTotal += 1;
        if (isCorrect) {
          nonGapCorrect += 1;
        }
      }
    }

    const precision = correct / expectations.length;
    const nonGapPrecision = nonGapTotal === 0 ? 1 : nonGapCorrect / nonGapTotal;

    console.info(
      `[precision] overall: ${correct}/${expectations.length} = ${precision.toFixed(4)}; ` +
        `non-known-gap: ${nonGapCorrect}/${nonGapTotal} = ${nonGapPrecision.toFixed(4)}`,
    );

    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(nonGapPrecision).toBeGreaterThanOrEqual(0.95);
  });
});
