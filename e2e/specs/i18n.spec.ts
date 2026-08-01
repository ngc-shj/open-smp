import { test, expect } from '@playwright/test';

// i18n/C1 against the compose stack. The unit tier proves the dictionary; this
// proves the RESOLUTION — that a cookie reaches the render and that `lang`
// follows it. Neither is visible without a running app.

test.describe('i18n', () => {
  test('defaults to English, and the document says so', async ({ page }) => {
    await page.goto('/accounts');

    await expect(page.getByTestId('navbar').getByRole('link', { name: 'Accounts' })).toBeVisible();
    // `lang` is a claim a screen reader acts on; it was hardcoded to "en"
    // before the locale existed, which would have made it a lie under ja.
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('renders Japanese chrome when the cookie says ja, and restores', async ({ page, context }) => {
    await context.addCookies([
      { name: 'locale', value: 'ja', url: 'http://localhost:3000' },
    ]);
    try {
      await page.goto('/accounts');

      await expect(page.getByTestId('navbar').getByRole('link', { name: 'アカウント' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
      // The English label is gone, not merely joined — a dictionary that fell
      // back per key would show both.
      await expect(page.getByTestId('navbar').getByRole('link', { name: 'Accounts' })).toHaveCount(0);
    } finally {
      // The storageState is shared by every spec in this suite; a leaked ja
      // cookie would flip the language under all of them.
      await context.clearCookies({ name: 'locale' });
    }
  });

  test('falls back rather than failing on a cookie nobody issued', async ({ page, context }) => {
    // The cookie is user-supplied. A hand-edited one must not 500 every page.
    await context.addCookies([
      { name: 'locale', value: 'not-a-locale', url: 'http://localhost:3000' },
    ]);
    try {
      const response = await page.goto('/accounts');

      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    } finally {
      await context.clearCookies({ name: 'locale' });
    }
  });

  test('renders no untranslated-key marker anywhere in the chrome', async ({ page, context }) => {
    // The marker is what an unresolvable key renders as. Its presence on a real
    // page is the defect this whole design exists to make visible, so its
    // ABSENCE is worth asserting on the surface that is actually wired.
    await context.addCookies([{ name: 'locale', value: 'ja', url: 'http://localhost:3000' }]);
    try {
      await page.goto('/accounts');

      await expect(page.getByTestId('navbar')).not.toContainText('⟨');
    } finally {
      await context.clearCookies({ name: 'locale' });
    }
  });
});
