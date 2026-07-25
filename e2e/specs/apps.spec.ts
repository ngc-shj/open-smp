import { test, expect } from '@playwright/test';
import {
  FAKE_SERVICE_ACCOUNT_JSON,
  FAKE_SERVICE_ACCOUNT_JSON_MISSING_PRIVATE_KEY,
  FAKE_SERVICE_ACCOUNT_CREDENTIALS,
} from '../fixtures/fake-service-account.js';
import { SAAS_APP_DISPLAY_NAME } from '../fixtures/seed-facts.js';

test.describe('apps', () => {
  test('list shows the seeded Google Workspace app', async ({ page }) => {
    await page.goto('/apps');
    await expect(page.getByRole('cell', { name: SAAS_APP_DISPLAY_NAME })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'google-workspace' })).toBeVisible();
  });

  test('duplicate registration (seeded key) returns the 409 message', async ({ page }) => {
    await page.goto('/apps');

    await page.getByLabel('Display name').fill('E2E Duplicate Attempt');
    await page.getByLabel('Service account JSON').fill(FAKE_SERVICE_ACCOUNT_JSON);
    await page.getByLabel('Admin email to impersonate').fill(FAKE_SERVICE_ACCOUNT_CREDENTIALS.impersonate_admin_email);
    await page.getByRole('button', { name: 'Register' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'This app is already registered for your tenant.' }),
    ).toBeVisible();
  });

  test('unparseable JSON shows an inline error with zero requests to /api/saas-apps', async ({ page }) => {
    await page.goto('/apps');

    // Listener attached BEFORE interaction (round-1 FN-F4): the captured
    // request list is asserted only after the visible error settles (web-
    // first assertion), never against a timer — no disguised sleep.
    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/saas-apps')) requests.push(req.url());
    });

    await page.getByLabel('Display name').fill('E2E Invalid JSON');
    await page.getByLabel('Service account JSON').fill('{"client_email":');
    await page.getByLabel('Admin email to impersonate').fill('admin@example.com');
    await page.getByRole('button', { name: 'Register' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'That does not look like valid JSON.' }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
  });

  test('well-formed JSON missing private_key shows an inline error with zero requests', async ({ page }) => {
    await page.goto('/apps');

    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/saas-apps')) requests.push(req.url());
    });

    await page.getByLabel('Display name').fill('E2E Missing Field');
    await page.getByLabel('Service account JSON').fill(FAKE_SERVICE_ACCOUNT_JSON_MISSING_PRIVATE_KEY);
    await page.getByLabel('Admin email to impersonate').fill('admin@example.com');
    await page.getByRole('button', { name: 'Register' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'Service account JSON must include client_email and private_key.' }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
  });

  test('credential material never leaks into page text or console outside the textarea', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    await page.goto('/apps');

    // Failure path 1: invalid JSON.
    await page.getByLabel('Display name').fill('E2E Leak Check A');
    await page.getByLabel('Service account JSON').fill('{"client_email":');
    await page.getByLabel('Admin email to impersonate').fill('admin@example.com');
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();

    // Failure path 2: missing private_key.
    await page.getByLabel('Service account JSON').fill(FAKE_SERVICE_ACCOUNT_JSON_MISSING_PRIVATE_KEY);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();

    // Fill the full fake SA JSON (private_key included) but do not submit —
    // the value must stay confined to the textarea itself.
    await page.getByLabel('Service account JSON').fill(FAKE_SERVICE_ACCOUNT_JSON);

    const bodyTextOutsideTextarea = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('textarea').forEach((el) => el.remove());
      return clone.textContent ?? '';
    });

    // Markers are derived from the fixture's private_key, never hand-typed —
    // SA-JSON-shaped substrings are structurally confined to
    // fake-service-account.ts (RS4, round-1 SEC-E2).
    const privateKeyMarker = FAKE_SERVICE_ACCOUNT_CREDENTIALS.private_key.split('\n')[1];
    expect(privateKeyMarker).toBeTruthy();
    expect(bodyTextOutsideTextarea).not.toContain(privateKeyMarker);
    for (const message of consoleMessages) {
      expect(message).not.toContain(privateKeyMarker);
    }
  });
});
