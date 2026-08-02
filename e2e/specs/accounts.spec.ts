import { test, expect } from '@playwright/test';
import { SEEDED_ACCOUNTS, SEEDED_ORPHAN_EMAILS } from '../fixtures/seed-facts.js';

const COLUMN_HEADERS = [
  'App',
  'Email',
  'Name',
  'Account status',
  'Admin',
  'Last activity',
  'Link',
  'Identity',
  'Confidence',
  'Evidence',
  'Label',
];

test.describe('accounts', () => {
  test('each seeded status tab shows its account with the right chip', async ({ page }) => {
    for (const account of Object.values(SEEDED_ACCOUNTS)) {
      const status = account.status;
      await page.goto(`/accounts?status=${status}`);
      const row = page.getByRole('row', { name: new RegExp(account.email) });
      await expect(row).toBeVisible();
      await expect(row.getByText(status, { exact: true })).toBeVisible();
    }
  });

  test('column headers match the shipped column set and freshness text renders', async ({ page }) => {
    await page.goto('/accounts?status=matched');

    for (const header of COLUMN_HEADERS) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }

    await expect(page.getByText(/Data as of|No sync data yet/)).toBeVisible();
  });

  test('ghost row evidence popover shows rule id and matched value', async ({ page }) => {
    await page.goto('/accounts?status=ghost');
    const row = page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.ghost.email) });

    await row.locator('details summary').click();
    const popover = row.locator('details');
    await expect(popover.getByText(/rule:/)).toBeVisible();
    await expect(popover.getByText(/matched:/)).toBeVisible();
  });

  test('ambiguous row shows candidate list and no single identity name', async ({ page }) => {
    await page.goto('/accounts?status=ambiguous');
    const row = page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.ambiguous.email) });

    await row.locator('details summary').click();
    const popover = row.locator('details');
    await expect(popover.getByText('candidates:')).toBeVisible();
    // The Name column cell for an ambiguous account link is the ACCOUNT's
    // displayName ("Shared Mailbox"), not an identity name — evidence never
    // resolves to a single identityName for ambiguous links (C1 invariant).
    await expect(popover.getByText(/^matched:/)).toHaveCount(0);
  });

  test('?status=orphan filter shows exactly the orphan accounts, by name', async ({ page }) => {
    // SC2/C5. This asserted `toHaveCount(1)`, and a second account-bearing
    // application makes that a number to bump — which asserts nothing, because
    // "as many rows as the seed happens to produce" is true of any seed. The
    // set is named instead, so one row too many and one row missing both red
    // and both say WHICH.
    await page.goto('/accounts?status=orphan');

    for (const email of SEEDED_ORPHAN_EMAILS) {
      await expect(page.getByRole('row', { name: new RegExp(email) })).toBeVisible();
    }
    await expect(page.locator('tbody tr')).toHaveCount(SEEDED_ORPHAN_EMAILS.length);
    // The count above is derived from the same list, so on its own it cannot
    // see a row that is neither. This is what does.
    const emails = await page.locator('tbody tr').allInnerTexts();
    const unexpected = emails.filter((row) => !SEEDED_ORPHAN_EMAILS.some((e) => row.includes(e)));
    expect(unexpected, 'orphan rows the fixture does not name').toEqual([]);
  });

  test('a malformed cursor falls back to the first page instead of erroring', async ({ page }) => {
    // Pre-existing on both list pages: any cursor the API rejects threw and
    // rendered an error screen rather than degrading.
    await page.goto('/accounts?status=orphan&cursor=not-a-real-cursor');

    await expect(page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.orphan.email) })).toBeVisible();
  });

  test('CSV export contains the expected header and every seeded email', async ({ page }) => {
    await page.goto('/accounts?status=matched');

    // Only "matched" has a row by default; switch to a filter with all
    // seeded rows visible isn't possible (accounts page is single-status at
    // a time) — export per-tab and assert header + presence + status only,
    // never label VALUES (label state is transient across specs, round-1
    // FN-F5). Exporting the matched tab is enough to validate header shape;
    // presence of every seeded email is checked by iterating each account's own
    // tab. Two accounts now share the `orphan` tab (SC2/C5), so this visits it
    // twice and asserts each email in turn rather than assuming one per tab.
    for (const account of Object.values(SEEDED_ACCOUNTS)) {
      const status = account.status;
      await page.goto(`/accounts?status=${status}`);
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export CSV' }).click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const csv = Buffer.concat(chunks).toString('utf-8');
      const [headerLine, ...dataLines] = csv.split('\r\n');

      // Exact header cells: `toContain('label')` would also match 'labelNote',
      // so a dropped `label` column could pass unnoticed.
      expect(headerLine).toContain('"label"');
      expect(headerLine).toContain('"labelNote"');

      // The account's own row must carry its link status — asserting the
      // status appears somewhere in the file would also match the header or
      // an unrelated row.
      const accountRow = dataLines.find((line) => line.includes(account.email));
      expect(accountRow, `${account.email} row missing from the ${status} export`).toBeDefined();
      expect(accountRow).toContain(`"${status}"`);
    }
  });
});
