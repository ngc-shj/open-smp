import { test, expect } from '@playwright/test';
import { SEEDED_ACCOUNTS } from '../fixtures/seed-facts.js';

test.describe('identity detail', () => {
  test('the matched account row links to its identity page', async ({ page }) => {
    await page.goto('/accounts?status=matched');

    const row = page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.matched.email) });
    await expect(row).toBeVisible();

    // A real <a href>, not an onClick handler — reachable by keyboard and by
    // role, which is what makes this assertion meaningful rather than a
    // styling check.
    const link = row.getByRole('link');
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/identities\/[0-9a-f-]{36}$/);
  });

  test('the identity page shows the person and the account attributed to them', async ({ page }) => {
    await page.goto('/accounts?status=matched');
    await page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.matched.email) }).getByRole('link').click();

    await expect(page.getByRole('heading', { name: SEEDED_ACCOUNTS.matched.displayName })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'App', exact: true })).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.matched.email) }),
    ).toBeVisible();
  });

  test('a ghost account reaches an identity marked left', async ({ page }) => {
    await page.goto('/accounts?status=ghost');
    await page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.ghost.email) }).getByRole('link').click();

    // bob.suzuki's identity is seeded status=left with a leftAt date, so both
    // the status and the date cell must render — asserting only the heading
    // would pass against a page that dropped the whole detail block.
    await expect(page.getByText('left', { exact: true })).toBeVisible();
    await expect(page.getByText(/2024-03-31/)).toBeVisible();
  });

  test('orphan rows expose no identity link', async ({ page }) => {
    await page.goto('/accounts?status=orphan');

    const row = page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.orphan.email) });
    await expect(row).toBeVisible();
    // identity_id IS NULL for orphan links by schema check, so there is
    // nothing to navigate to and the cell must stay inert.
    await expect(row.getByRole('link')).toHaveCount(0);
  });

  test('an unknown identity id renders the not-found page, not a server error', async ({ page }) => {
    const res = await page.goto('/identities/00000000-0000-0000-0000-000000000000');
    expect(res?.status()).toBe(404);
  });
});
