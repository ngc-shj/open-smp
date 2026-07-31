import { describe, expect, it } from 'vitest';
import { validateContractRow } from '../src/routes/contract-import.js';

// C2, unit tier. The per-value domains are decidable without a database, and
// this is where their EDGES live: the integration tier proves the derivation is
// complete (a value C1 rejects would cost the whole upload), which needs one
// case per constraint, not the boundary either side of every one of them.
//
// Both directions throughout. A validator that refuses everything satisfies
// every rejection assertion in this file and ships a route that imports
// nothing, so each rejection is paired with the nearest value that must still
// be accepted (RT10).

const ROW = 7;

function validate(cells: Record<string, string>) {
  return validateContractRow({ app_key: 'acme', ...cells }, ROW);
}

function accepted(cells: Record<string, string>) {
  const result = validate(cells);
  if ('error' in result) {
    throw new Error(`expected acceptance, got: ${result.error.message}`);
  }
  return result.row;
}

function rejection(cells: Record<string, string>): string {
  const result = validate(cells);
  if (!('error' in result)) {
    throw new Error(`expected rejection, got: ${JSON.stringify(result.row)}`);
  }
  expect(result.error.row).toBe(ROW);
  return result.error.message;
}

describe('C2: seats, against saas_contracts_seats_check', () => {
  it.each(['0', '1', '10000000'])('accepts %s', (seats) => {
    expect(accepted({ seats }).seats).toBe(Number(seats));
  });

  it('treats an absent cell as no figure rather than as zero', () => {
    // NULL and 0 are different answers: GET /licenses reports `purchased: null`
    // as "no contract figure" and 0 as "a contract for no seats".
    expect(accepted({}).seats).toBeNull();
    expect(accepted({ seats: '  ' }).seats).toBeNull();
  });

  it.each([
    ['above the ceiling', '10000001'],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['exponential', '1e3'],
    ['not a number', 'many'],
    ['padded with a sign', '+5'],
    // Beyond int4 entirely: reaching the column would be 22003, which aborts
    // the transaction exactly as a CHECK violation does.
    ['past int4', '99999999999'],
  ])('rejects a %s value', (_label, seats) => {
    expect(rejection({ seats })).toMatch(/seats/);
  });
});

describe('C2: unit_price, against saas_contracts_unit_price_check and numeric(14,2)', () => {
  it.each(['0', '0.00', '10.00', '999999999999.99', '5', '5.5'])('accepts %s', (unitPrice) => {
    // Carried as the file's own digits. Number() would route an exact decimal
    // through a double, which is the error numeric(14,2) exists to prevent.
    expect(accepted({ unit_price: unitPrice }).unitPrice).toBe(unitPrice);
  });

  it.each([
    // 'NaN'::numeric passes `>= 0` AND `= itself` in Postgres — numeric defines
    // NaN as equal to itself so the type can be sorted. C1's CHECK spells the
    // exclusion `<> 'NaN'::numeric`; this is the boundary version of it.
    ['NaN', 'NaN'],
    ['nan in lower case', 'nan'],
    ['Infinity', 'Infinity'],
    ['negative', '-1'],
    // numeric(14,2) does not reject excess scale — it ROUNDS it, silently, in a
    // money column. Refusing is the only way the stored figure is the file's.
    ['three decimal places', '10.005'],
    ['thirteen integer digits', '1000000000000'],
    ['exponential', '1e3'],
    ['a bare decimal point', '.5'],
    ['a trailing decimal point', '5.'],
    ['a thousands separator', '1,000'],
  ])('rejects %s', (_label, unitPrice) => {
    expect(rejection({ unit_price: unitPrice })).toMatch(/unit_price/);
  });
});

describe('C2: currency, against saas_contracts_currency_check', () => {
  it.each(['USD', 'JPY', 'EUR'])('accepts %s', (currency) => {
    expect(accepted({ currency }).currency).toBe(currency);
  });

  it('upper-cases a three-character code', () => {
    expect(accepted({ currency: 'usd' }).currency).toBe('USD');
  });

  it.each([
    ['four letters', 'USDX'],
    ['two letters', 'US'],
    ['digits', '840'],
    ['a symbol', '$'],
    // 'aß'.toUpperCase() is 'ASS' — three characters from two. Folding a cell
    // that was never a three-letter code into one would store a currency the
    // file does not contain.
    ['a code that only becomes three characters when folded', 'aß'],
  ])('rejects %s', (_label, currency) => {
    expect(rejection({ currency })).toMatch(/currency/);
  });
});

describe('C2: billing_cycle, against the billing_cycle enum', () => {
  it.each(['monthly', 'annual', 'MONTHLY', 'Annual'])('accepts %s', (cycle) => {
    expect(accepted({ billing_cycle: cycle }).billingCycle).toBe(cycle.toLowerCase());
  });

  it.each(['yearly', 'quarterly', 'month', 'monthly '.repeat(2)])('rejects %s', (cycle) => {
    // An unknown label reaches the column as 22P02, which aborts the
    // transaction — the enum is not a CHECK, so C1's constraint list does not
    // mention it and the validator has to.
    expect(rejection({ billing_cycle: cycle })).toMatch(/billing_cycle/);
  });

  it('treats a blank cell as no cycle', () => {
    expect(accepted({ billing_cycle: '  ' }).billingCycle).toBeNull();
  });
});

describe('C2: term dates, against saas_contracts_term_order_check and the date type', () => {
  it('accepts a well-ordered term', () => {
    const row = accepted({ term_start: '2025-01-01', term_end: '2025-12-31' });
    expect([row.termStart, row.termEnd]).toEqual(['2025-01-01', '2025-12-31']);
  });

  it('accepts a term that starts and ends on the same day', () => {
    // The CHECK is `term_end >= term_start`, so the equal case is inside the
    // boundary. A `>` validator would refuse a legitimate single-day term.
    expect(accepted({ term_start: '2025-06-01', term_end: '2025-06-01' }).termEnd).toBe('2025-06-01');
  });

  it('accepts either end alone', () => {
    expect(accepted({ term_start: '2025-01-01' }).termEnd).toBeNull();
    expect(accepted({ term_end: '2025-01-01' }).termStart).toBeNull();
  });

  it('accepts a leap day in a leap year', () => {
    expect(accepted({ term_start: '2024-02-29' }).termStart).toBe('2024-02-29');
  });

  it.each([
    ['a day the month does not have', '2025-02-30'],
    ['a leap day in a common year', '2025-02-29'],
    ['month 13', '2025-13-01'],
    ['month 00', '2025-00-10'],
    ['day 00', '2025-01-00'],
    ['year zero', '0000-01-01'],
    ['a slash-separated date', '2025/01/01'],
    ['a two-digit year', '25-01-01'],
    ['a timestamp', '2025-01-01T00:00:00Z'],
    ['prose', 'today'],
  ])('rejects %s', (_label, date) => {
    expect(rejection({ term_start: date })).toMatch(/term_start/);
    expect(rejection({ term_end: date })).toMatch(/term_end/);
  });

  it('rejects a term that ends before it starts', () => {
    expect(rejection({ term_start: '2025-12-31', term_end: '2025-01-01' })).toMatch(/term_end/);
  });
});

describe('C2: text lengths, against the plan_name and note CHECKs', () => {
  it('accepts text at the limit', () => {
    const row = accepted({ plan_name: 'p'.repeat(200), note: 'n'.repeat(500) });
    expect([row.planName?.length, row.note?.length]).toEqual([200, 500]);
  });

  it('rejects text one character past it', () => {
    expect(rejection({ plan_name: 'p'.repeat(201) })).toMatch(/plan_name/);
    expect(rejection({ note: 'n'.repeat(501) })).toMatch(/note/);
  });

  it('measures the trimmed value, which is what is stored', () => {
    expect(accepted({ plan_name: `  ${'p'.repeat(200)}  ` }).planName).toHaveLength(200);
  });
});

describe('C2: app_key and app_name', () => {
  it('requires app_key', () => {
    expect(validateContractRow({ seats: '5' }, ROW)).toEqual({
      error: { row: ROW, message: 'app_key is required' },
    });
  });

  it('normalises the key it stores', () => {
    expect(accepted({ app_key: '  ACME-Corp_1 ' }).appKey).toBe('acme-corp_1');
  });

  it.each(['label', 'matcher', 'contract'])('refuses the reserved key %s', (key) => {
    expect(rejection({ app_key: key })).toMatch(/reserved/);
  });

  it.each(['acme corp', 'acme.corp', 'ACME!', 'a'.repeat(65)])('rejects the malformed key %s', (key) => {
    expect(rejection({ app_key: key })).toMatch(/app_key/);
  });

  it('defaults app_name to the key, so a row is not judged by database state', () => {
    // A row whose validity depended on whether the application already existed
    // would validate differently on its second upload — and the transaction
    // hazard this validator exists to prevent is precisely the one that shows
    // up only on some files.
    expect(accepted({ app_key: 'acme' }).appName).toBe('acme');
    expect(accepted({ app_name: 'Acme Corp' }).appName).toBe('Acme Corp');
  });

  it('rejects an over-long app_name', () => {
    expect(rejection({ app_name: 'n'.repeat(201) })).toMatch(/app_name/);
  });
});

describe('C2: error messages', () => {
  it('bounds the offending value it echoes', () => {
    // 100 errors, each free to quote a whole cell, is an attacker-chosen
    // response body. The identifying prefix is kept; the rest is not.
    const message = rejection({ currency: 'x'.repeat(500) });

    expect(message.length).toBeLessThan(200);
    expect(message).toContain('xxx');
  });
});
