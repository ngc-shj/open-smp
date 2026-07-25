import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, rm } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'files');

test.describe('import', () => {
  test('happy-path upload then re-upload asserts upsert-count semantics', async ({ page }) => {
    await page.goto('/import');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(join(FIXTURES_DIR, 'e2e-import.csv'));
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('3 imported, 0 skipped')).toBeVisible();

    // Re-upload the same file: `imported` counts processed valid rows, not
    // NEW rows (hr-import.ts upserts), so it stays "3 imported" rather than
    // dropping to 0 — round-1 TEST-F-4, stated so this is not coincidentally
    // green.
    await fileInput.setInputFiles(join(FIXTURES_DIR, 'e2e-import.csv'));
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('3 imported, 0 skipped')).toBeVisible();
  });

  test('bad CSV renders a row-numbered error table', async ({ page }) => {
    await page.goto('/import');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(join(FIXTURES_DIR, 'e2e-import-bad.csv'));
    await page.getByRole('button', { name: 'Upload' }).click();

    await expect(page.getByRole('heading', { name: 'Errors' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '2' })).toBeVisible();
    await expect(page.getByText(/unknown status/)).toBeVisible();
  });

  test('non-UTF-8 (Shift_JIS) file shows the mapped UTF-8 error', async ({ page }) => {
    await page.goto('/import');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(join(FIXTURES_DIR, 'e2e-import-sjis.csv'));
    await page.getByRole('button', { name: 'Upload' }).click();

    await expect(page.getByText('This file is not UTF-8 encoded. Save it as UTF-8 and try again.')).toBeVisible();
    await expect(page.getByText('file must be UTF-8 encoded')).toBeVisible();
  });

  test('oversized (~11MB) upload is rejected with the over-limit error', async ({ page }) => {
    // Generated at runtime into the OS temp dir — the manual script's own
    // one-liner proves generation is trivial (SC21 un-deferred, round-1
    // TEST-F-1). One Buffer write, cleaned up after the assertion.
    const header = 'employee_id,email,name,status,left_at\n';
    const row = 'E999,oversized-e2e@demo.example,E2E Oversized Row,active,\n';
    const targetBytes = 11 * 1024 * 1024;
    const rowsNeeded = Math.ceil((targetBytes - header.length) / row.length);
    const content = header + row.repeat(rowsNeeded);
    const filePath = join(tmpdir(), 'e2e-import-oversized.csv');
    await writeFile(filePath, content);

    try {
      await page.goto('/import');
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(filePath);
      await page.getByRole('button', { name: 'Upload' }).click();

      await expect(page.getByText('This file is too large (max 10MB).')).toBeVisible();
      await expect(page.getByText('file exceeds 10MB limit')).toBeVisible();
    } finally {
      await rm(filePath, { force: true });
    }
  });

  test('Run matching completes with a link to /accounts', async ({ page }) => {
    await page.goto('/import');
    await page.getByRole('button', { name: 'Run matching' }).click();

    await expect(page.getByText('Matching completed.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View accounts' })).toBeVisible();
  });
});
