import { test, expect } from '@playwright/test';
import { DEMO_TENANT_SLUG, DEMO_EMAIL, DEMO_PASSWORD } from '../fixtures/auth.js';

// The ONLY spec performing real form logins (2 POSTs: valid + invalid).
// Every other spec rides the storageState saved by global-setup — see the
// plan's login-budget arithmetic (1 setup + 2 here = 3 POSTs/run).
test.describe('auth', () => {
  test('valid login lands on /accounts with nav visible', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tenant').fill(DEMO_TENANT_SLUG);
    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/accounts/);
    await expect(page.getByRole('link', { name: 'Accounts' })).toBeVisible();
  });

  test('the language control on /login switches the sign-in page itself', async ({ page }) => {
    // /login is the one page NavBar does not mount, so the control that lives in
    // NavBar never reached it — a first-time visitor with no locale cookie got
    // DEFAULT_LOCALE and no way out. Review round 1 mounted it here; nothing
    // observed that, and deleting it left every gate green.
    //
    // In auth.spec.ts rather than i18n.spec.ts because this is the one file that
    // loads /login WITHOUT the storageState cookie, which is the state a
    // first-time visitor is in.
    await page.context().clearCookies({ name: 'locale' });
    try {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Sign in to open-smp' })).toBeVisible();

      await page.getByRole('combobox').selectOption('ja');

      await expect(page.getByRole('heading', { name: 'open-smp にサインイン' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    } finally {
      await page.context().clearCookies({ name: 'locale' });
    }
  });

  test('invalid password shows the login error and stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tenant').fill(DEMO_TENANT_SLUG);
    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // .filter disambiguates from Next.js's route announcer, which also
    // carries role="alert" (empty text) and trips strict mode.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Invalid tenant, email, or password.' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('auth (logged out)', () => {
  // browser.newContext() in @playwright/test inherits the config's context
  // options INCLUDING storageState, so a "fresh context" is still logged in.
  // Overriding storageState with an empty state is the supported way to get
  // a genuinely unauthenticated page.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated direct GET /accounts redirects to /login', async ({ page }) => {
    await page.goto('/accounts');
    await expect(page).toHaveURL(/\/login/);
  });
});
