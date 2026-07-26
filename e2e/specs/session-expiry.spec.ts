import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { SEEDED_ACCOUNTS } from '../fixtures/seed-facts.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'files');

// Three 401-mid-flow cases: context loads the shared storageState, the
// session cookie is then cleared client-side (simulating expiry), and the
// mutating action must redirect to /login once the API returns 401. Each
// case covers a distinct import/page.tsx branch a single label-save case
// would miss (manual ui-import step 8).
test.describe('session-expiry', () => {
  test('label save redirects to /login on 401', async ({ page, context }) => {
    await page.goto('/accounts?status=orphan');
    const row = page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.orphan.email) });
    await row.getByRole('button', { name: /Label|Service account|Known shared|External collaborator/ }).click();

    await context.clearCookies();

    await row.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('CSV upload redirects to /login on 401', async ({ page, context }) => {
    await page.goto('/import');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(join(FIXTURES_DIR, 'e2e-import.csv'));

    await context.clearCookies();

    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('Run matching redirects to /login on 401', async ({ page, context }) => {
    await page.goto('/import');

    await context.clearCookies();

    await page.getByRole('button', { name: 'Run matching' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
