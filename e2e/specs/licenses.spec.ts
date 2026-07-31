import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { SAAS_APP_KEY } from '../fixtures/seed-facts.js';

// C4 / C5 acceptance against the compose stack.
//
// The seeded application is asserted READ-ONLY. Writing a contract against it
// would persist for the life of the volume — seed.ts looks up (tenant_id, key)
// and returns the existing row without re-applying anything, so nothing repairs
// it — and assert-seed-preserved.sh does not inspect contracts, which means the
// leak would be invisible rather than caught. Every mutation here goes to a
// disposable application instead.

const CONTRACT_APP_KEY = 'e2e-contract-app';
const CONTRACT_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'files',
  'e2e-contracts.csv',
);

// APIRequestContext sends no Origin of its own, and every non-GET under /api is
// refused without one matching APP_ORIGIN (S9). The browser sets it; this does
// not.
const APP_ORIGIN = process.env.E2E_APP_ORIGIN ?? 'http://localhost:3000';

/**
 * Removes the disposable application if it exists, taking its contract with it
 * (saas_contracts cascades on the composite FK).
 *
 * Run BEFORE each test as well as after: an afterEach does not run when a spec
 * crashes mid-test, and this suite shares a stack with every later run. Cleanup
 * that only runs on the happy path leaves the next run asserting against a row
 * it did not create.
 */
async function removeContractApp(request: APIRequestContext): Promise<void> {
  const res = await request.get('/api/saas-apps');
  expect(res.ok(), 'could not list applications for cleanup').toBe(true);
  const { items } = (await res.json()) as { items: { id: string; key: string }[] };
  for (const app of items.filter((item) => item.key === CONTRACT_APP_KEY)) {
    const deleted = await request.delete(`/api/saas-apps/${app.id}`, {
      headers: { origin: APP_ORIGIN },
    });
    expect(deleted.status(), 'cleanup delete did not succeed').toBe(204);
  }
}

test.describe('licences', () => {
  test.beforeEach(async ({ request }) => {
    await removeContractApp(request);
  });

  test.afterEach(async ({ request }) => {
    await removeContractApp(request);
  });

  test('reports the seeded application without inventing contract figures', async ({ page }) => {
    await page.goto('/licenses');

    const row = page.getByTestId(`license-row-${SAAS_APP_KEY}`);
    await expect(row).toBeVisible();

    // Four seeded accounts, all active, all written in ONE transaction — so
    // they share a `last_synced_at` and the sync watermark admits all four.
    // Asserted on the named cell, not on the row's text: several cells here
    // render the same digits, and a row-wide match would pass on any of them.
    await expect(row.getByTestId('assigned')).toHaveText('4');

    // One ghost (left the company) and one orphan (nobody owns it) are
    // reclaimable. The ambiguous account is NOT — the matcher could not decide
    // whose it is, and reclaiming it is the wrong action — so it appears under
    // needs-review instead.
    await expect(row.getByTestId('reclaimable')).toContainText('2');
    await expect(row.getByTestId('reclaimable')).toContainText('(1 left, 1 unknown)');
    await expect(row.getByTestId('needs-review')).toHaveText('1');

    // No contract, so no figures — an em dash in each, never a zero. A zero
    // here would report a licence nobody bought and spare seats nobody has.
    for (const cell of ['purchased', 'unassigned', 'unit-price', 'reclaimable-value']) {
      await expect(row.getByTestId(cell), `${cell} must not invent a figure`).toHaveText('—');
    }
  });

  test('an upload creates the application, applies the contract, and reports the rejected row', async ({
    page,
  }) => {
    await page.goto('/licenses');
    await expect(page.getByTestId(`license-row-${CONTRACT_APP_KEY}`)).toHaveCount(0);

    await page.getByLabel('Contract CSV').setInputFiles(CONTRACT_FIXTURE);
    await page.getByRole('button', { name: 'Upload' }).click();

    // FR2 through the UI: the fixture's second row has no app_key, and the
    // first row is applied anyway. A validator that let the bad value reach the
    // transaction would report 0 imported, or a 500.
    await expect(page.getByText('1 imported, 1 skipped')).toBeVisible();
    await expect(page.getByText(`Applications created: ${CONTRACT_APP_KEY}`)).toBeVisible();
    await expect(page.getByText('Row 3: app_key is required')).toBeVisible();

    // The table is server-rendered, so this also proves the form refreshed it.
    const row = page.getByTestId(`license-row-${CONTRACT_APP_KEY}`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Business')).toBeVisible();
    // The price as the digits the file carried: 9.99, not 9.99000000000001 and
    // not 10.
    await expect(row.getByTestId('unit-price')).toContainText('9.99 USD');
    await expect(row.getByTestId('unit-price')).toContainText('/ monthly');
    // 25 purchased and nobody assigned — a contract-only application has no
    // accounts, which is exactly the case FR1 exists for.
    await expect(row.getByTestId('purchased')).toHaveText('25');
    await expect(row.getByTestId('assigned')).toHaveText('0');
    await expect(row.getByTestId('unassigned')).toHaveText('25');
    await expect(row.getByTestId('match-state')).toContainText('No accounts');
    await expect(row.getByTestId('match-state')).toContainText('(no connector)');
  });

  test('exports every row it displays', async ({ page }) => {
    await page.goto('/licenses');
    await page.getByLabel('Contract CSV').setInputFiles(CONTRACT_FIXTURE);
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByTestId(`license-row-${CONTRACT_APP_KEY}`)).toBeVisible();

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]).then(([event]) => event);

    expect(download.suggestedFilename()).toBe('licenses.csv');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');

    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('"reclaimableValuePeriod"');
    // Both applications, not just the one the upload created — the export
    // takes the rendered set, so a filter applied to one and not the other
    // would show here.
    expect(csv).toContain(`"${CONTRACT_APP_KEY}"`);
    expect(csv).toContain(`"${SAAS_APP_KEY}"`);
    // The money column carries the file's own digits through the export too.
    expect(csv).toContain('"9.99"');
  });
});
