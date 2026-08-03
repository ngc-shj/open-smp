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
      // The switch is exercised from a nested route reached by a HARD load, and
      // both halves of that were measured rather than assumed.
      //
      // A cookie written with no `path` takes the DIRECTORY of the document
      // that wrote it. Every top-level page here is one segment deep, so on
      // /accounts the default is already `/` — and a nested page reached
      // through <Link> is no better: the navigation is a pushState, and Chrome
      // still derives the default from the URL the document was LOADED at.
      // Dropping `path=/` survived this spec under both shapes.
      //
      // Loading /identities/<id> as a document is what makes the default
      // /identities, and then /licenses reverts to English. That is the real
      // user: someone who reloaded or bookmarked an identity page and switched
      // language there.
      await page.goto('/accounts?status=matched');
      await page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.matched.email) }).getByRole('link').click();
      await expect(page).toHaveURL(/\/identities\/[0-9a-f-]{36}$/);
      await page.goto(page.url());

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

  // Every page carrying copy, and one string from its BODY rather than its
  // chrome. The nav assertions above pass against an app whose pages are still
  // entirely English — which is exactly the state C2 left and this is the proof
  // it is over.
  const JAPANESE_BODY_COPY = [
    ['/accounts', 'アカウント状態'],
    ['/licenses', '回収可能額'],
    ['/apps', 'SaaS アプリを登録'],
    ['/discovery', '検出されたアプリケーション'],
    ['/events', 'ディスカバリイベント'],
    ['/import', '人事データのインポート'],
    ['/login', 'open-smp にサインイン'],
  ] as const;

  test('every page renders its own copy in Japanese, with no key left showing', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'locale', value: 'ja', url: 'http://localhost:3000' }]);
    try {
      for (const [path, japanese] of JAPANESE_BODY_COPY) {
        await page.goto(path);

        await expect(page.getByText(japanese).first(), path).toBeVisible();
        // The marker is what an unresolvable key renders as. Asserting its
        // absence alone would pass against a blank page, which is why it is
        // paired with the assertion above rather than standing on its own.
        await expect(page.locator('body'), path).not.toContainText('⟨');
      }
    } finally {
      await context.clearCookies({ name: 'locale' });
    }
  });

  test('the English is replaced rather than joined', async ({ page, context }) => {
    // A dictionary that fell back per key renders both languages at once and
    // satisfies every assertion above. These are the two headings the accounts
    // table would keep if any of its keys missed.
    await context.addCookies([{ name: 'locale', value: 'ja', url: 'http://localhost:3000' }]);
    try {
      await page.goto('/accounts');

      await expect(page.getByRole('columnheader', { name: 'Account status' })).toHaveCount(0);
      await expect(page.getByRole('columnheader', { name: 'Last activity' })).toHaveCount(0);
      await expect(page.getByRole('columnheader', { name: 'アカウント状態' })).toBeVisible();
    } finally {
      await context.clearCookies({ name: 'locale' });
    }
  });

  test('renders no untranslated-key marker under the DEFAULT locale', async ({ page }) => {
    // Repointed. This asserted the navbar under `ja`, which the body-copy loop
    // above already covers on the same page — the navbar is inside the body, so
    // no production edit could red it without redding that first. What nothing
    // asserted is the marker's absence under `en`: every other `⟨` assertion in
    // this suite runs with the ja cookie set, so an en-only key gap was
    // invisible at this tier.
    await page.context().clearCookies({ name: 'locale' });
    await page.goto('/accounts');

    await expect(page.locator('body')).not.toContainText('⟨');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
