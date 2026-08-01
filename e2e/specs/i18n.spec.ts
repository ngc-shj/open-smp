import { test, expect } from '@playwright/test';
import { SEEDED_ACCOUNTS } from '../fixtures/seed-facts.js';

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

  test('the control switches the language, and the choice survives navigation', async ({ page, context }) => {
    // i18n/C3. Everything above sets the cookie from the test. This is the only
    // place the CONTROL is exercised, and without it the `ja` dictionary is
    // data no operator can reach.
    try {
      // The switch is exercised from a NESTED route deliberately. A cookie
      // written with no `path` defaults to the DIRECTORY of the document that
      // wrote it, and every top-level page here is one segment deep — so on
      // /accounts that default is already `/` and the attribute has no failing
      // state. Measured: dropping `path=/` survived this spec entirely until
      // the switch moved here, where the default becomes /identities.
      await page.goto('/accounts?status=matched');
      await page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.matched.email) }).getByRole('link').click();
      await expect(page).toHaveURL(/\/identities\/[0-9a-f-]{36}$/);

      const language = page.getByTestId('navbar').getByRole('combobox');
      await expect(language).toHaveValue('en');

      await language.selectOption('ja');

      await expect(page.getByTestId('navbar').getByRole('link', { name: 'アカウント' })).toBeVisible();
      // The switch is resolved by the root layout, so this is what proves the
      // refresh reached the layout and not merely the components below it.
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

      // Out of /identities/, which is the path the cookie would have been
      // scoped to.
      await page.goto('/licenses');
      await expect(page.getByTestId('navbar').getByRole('link', { name: 'ライセンス' })).toBeVisible();
      await expect(page.getByTestId('navbar').getByRole('combobox')).toHaveValue('ja');

      // Back, through the control. A switch that only moves one way passes
      // every assertion above.
      await page.getByTestId('navbar').getByRole('combobox').selectOption('en');
      await expect(page.getByTestId('navbar').getByRole('link', { name: 'Licences' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    } finally {
      // The storageState is shared by every spec in this suite; a leaked ja
      // cookie would flip the language under all of them.
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
