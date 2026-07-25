import { test, expect, type Locator, type Page } from '@playwright/test';
import { SEEDED_ACCOUNTS } from '../fixtures/seed-facts.js';

// Conditional teardown (round-1 TEST-F-3): inspect the orphan row's label
// state before clearing so a spec failure before Save never cascades a
// teardown error that masks the original failure.
async function orphanRow(page: Page): Promise<Locator> {
  await page.goto('/accounts?status=orphan');
  return page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.orphan.email) });
}

function labelButton(row: Locator): Locator {
  return row.getByRole('button', { name: /Label|Service account|Known shared|External collaborator/ });
}

test.describe('labeling', () => {
  test.afterEach(async ({ page }) => {
    const row = await orphanRow(page);
    const button = await labelButton(row);
    const currentText = await button.textContent();
    if (currentText && currentText.trim() !== 'Label') {
      await button.click();
      await row.getByRole('button', { name: 'Clear' }).click();
      await expect(button).toHaveText('Label');
    }
  });

  test('set kind + note on the orphan row, chip appears, survives re-match, then clears', async ({ page }) => {
    const row = await orphanRow(page);
    const button = await labelButton(row);
    await expect(button).toHaveText('Label');

    await button.click();
    await row.getByRole('combobox').selectOption('service_account');
    await row.getByPlaceholder('Note (optional)').fill('E2E labeling spec note');
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(row.getByText('Service account', { exact: true }).first()).toBeVisible();

    // Survive re-matching (end-to-end C10 survival): run matching from
    // /import, then confirm the chip is still present back on /accounts.
    await page.goto('/import');
    await page.getByRole('button', { name: 'Run matching' }).click();
    await expect(page.getByText('Matching completed.')).toBeVisible();

    const rowAfterMatch = await orphanRow(page);
    await expect(rowAfterMatch.getByText('Service account', { exact: true }).first()).toBeVisible();

    // Clear.
    const buttonAfterMatch = await labelButton(rowAfterMatch);
    await buttonAfterMatch.click();
    await rowAfterMatch.getByRole('button', { name: 'Clear' }).click();
    await expect(buttonAfterMatch).toHaveText('Label');
  });

  test('edit-note case: reopening an already-set label and changing only the note updates it', async ({ page }) => {
    const row = await orphanRow(page);
    const button = await labelButton(row);

    // Set from scratch first.
    await button.click();
    await row.getByRole('combobox').selectOption('known_shared');
    await row.getByPlaceholder('Note (optional)').fill('original note');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Known shared', { exact: true }).first()).toBeVisible();

    // Reopen and change ONLY the note — this is a distinct branch from
    // set-from-scratch (the update path, manual ui-labeling step 4).
    await button.click();
    const noteInput = row.getByPlaceholder('Note (optional)');
    await expect(noteInput).toHaveValue('original note');
    await noteInput.fill('updated note');
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(row.getByText('Known shared', { exact: true }).first()).toBeVisible();

    // Reopen once more to confirm the note field shows the new text and the
    // kind is unchanged.
    await button.click();
    await expect(row.getByRole('combobox')).toHaveValue('known_shared');
    await expect(row.getByPlaceholder('Note (optional)')).toHaveValue('updated note');
    await row.getByRole('button', { name: 'Cancel' }).click();
  });

  test('CSV-injection note is neutralized with a leading quote in the export', async ({ page }) => {
    const row = await orphanRow(page);
    const button = await labelButton(row);

    await button.click();
    await row.getByRole('combobox').selectOption('external_collaborator');
    await row.getByPlaceholder('Note (optional)').fill('=2+5');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('External collaborator', { exact: true }).first()).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const csv = Buffer.concat(chunks).toString('utf-8');

    // neutralizeCell prefixes a leading single quote; quoteCsvCell then wraps
    // the whole field in double quotes (csv-export.ts) — the raw formula
    // string with no leading quote must NOT appear anywhere in the file.
    expect(csv).toContain("'=2+5");
    expect(csv).not.toMatch(/[^']=2\+5/);
  });
});
