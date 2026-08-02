import { test, expect } from '@playwright/test';
import {
  FAKE_SERVICE_ACCOUNT_JSON,
  FAKE_SERVICE_ACCOUNT_JSON_MISSING_PRIVATE_KEY,
  FAKE_SERVICE_ACCOUNT_CREDENTIALS,
} from '../fixtures/fake-service-account.js';
import {
  CONTRACT_ONLY_APP_KEY,
  SAAS_APP_DISPLAY_NAME,
  SAAS_APP_KEY,
} from '../fixtures/seed-facts.js';

test.describe('apps', () => {
  test('list shows the seeded Google Workspace app', async ({ page }) => {
    await page.goto('/apps');
    await expect(page.getByRole('cell', { name: SAAS_APP_DISPLAY_NAME, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'google-workspace', exact: true })).toBeVisible();
  });

  test('duplicate registration (seeded key) returns the 409 message', async ({ page }) => {
    await page.goto('/apps');

    await page.getByLabel('Display name', { exact: true }).fill('E2E Duplicate Attempt');
    await page.getByLabel('Service account JSON', { exact: true }).fill(FAKE_SERVICE_ACCOUNT_JSON);
    await page.getByLabel('Admin email to impersonate', { exact: true }).fill(FAKE_SERVICE_ACCOUNT_CREDENTIALS.impersonate_admin_email);
    await page.getByRole('button', { name: 'Register' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'This app is already registered for your tenant.' }),
    ).toBeVisible();
  });

  // SC2/C3. The form asks for what the SELECTED connector needs. Neither of
  // these registers anything: the seed state after the suite is asserted by
  // e2e/scripts/assert-seed-preserved.sh, and a spec that created an app would
  // have to delete it again on every path including the failing ones.
  test('choosing a connector swaps the credential fields it asks for', async ({ page }) => {
    await page.goto('/apps');

    // `exact: true` throughout. getByLabel's string form is a case-insensitive
    // SUBSTRING match, and the manager's replace-flow labels are "New service
    // account JSON" and "New bot token" — both contain the text searched for
    // here. The toHaveCount(0) assertions were green only because every manager
    // panel happens to be closed on load, which makes them state-dependent on
    // any spec that opens one. Found in review.
    await expect(page.getByLabel('Service account JSON', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Bot token', { exact: true })).toHaveCount(0);

    await page.getByLabel('Key', { exact: true }).selectOption('slack');

    await expect(page.getByLabel('Bot token', { exact: true })).toBeVisible();
    // Gone, not merely joined: a form that rendered both would post a service
    // account under `key: 'slack'`.
    await expect(page.getByLabel('Service account JSON', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Admin email to impersonate', { exact: true })).toHaveCount(0);
  });

  test('a bot token with stray whitespace is refused without leaving the page', async ({ page }) => {
    await page.goto('/apps');

    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/saas-apps')) requests.push(req.url());
    });

    await page.getByLabel('Key', { exact: true }).selectOption('slack');
    await page.getByLabel('Display name', { exact: true }).fill('E2E Slack Bad Paste');
    // The realistic error: a paste that carried the newline after it.
    await page.getByLabel('Bot token', { exact: true }).fill('xoxb-000-111-abc def');
    await page.getByRole('button', { name: 'Register' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'That does not look like a bot token.' }),
    ).toBeVisible();
    // The property the whole client-side classifier exists for: credential
    // material that never leaves the page cannot be logged by anything between
    // here and the database.
    expect(requests).toHaveLength(0);
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

    await page.getByLabel('Display name', { exact: true }).fill('E2E Invalid JSON');
    await page.getByLabel('Service account JSON', { exact: true }).fill('{"client_email":');
    await page.getByLabel('Admin email to impersonate', { exact: true }).fill('admin@example.com');
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

    await page.getByLabel('Display name', { exact: true }).fill('E2E Missing Field');
    await page.getByLabel('Service account JSON', { exact: true }).fill(FAKE_SERVICE_ACCOUNT_JSON_MISSING_PRIVATE_KEY);
    await page.getByLabel('Admin email to impersonate', { exact: true }).fill('admin@example.com');
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
    await page.getByLabel('Display name', { exact: true }).fill('E2E Leak Check A');
    await page.getByLabel('Service account JSON', { exact: true }).fill('{"client_email":');
    await page.getByLabel('Admin email to impersonate', { exact: true }).fill('admin@example.com');
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();

    // Failure path 2: missing private_key.
    await page.getByLabel('Service account JSON', { exact: true }).fill(FAKE_SERVICE_ACCOUNT_JSON_MISSING_PRIVATE_KEY);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();

    // Fill the full fake SA JSON (private_key included) but do not submit —
    // the value must stay confined to the textarea itself.
    await page.getByLabel('Service account JSON', { exact: true }).fill(FAKE_SERVICE_ACCOUNT_JSON);

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

test.describe('apps management (C22)', () => {
  // The seeded app is shared mutable state: this suite renames it and must put
  // the name back even when a test fails mid-flight, or every later run — and
  // assert-seed-preserved.sh — sees the wrong name. The seeder does NOT repair
  // it (ensureSaasApp returns early on an existing (tenant_id, key)), so a leak
  // here is permanent until someone edits the database by hand.
  // API-driven, not UI-driven: a restore that navigates and clicks fails
  // exactly when the page or session is already broken — which is the case
  // where the leak actually happens. Origin is mandatory on non-GET /api
  // requests, and Playwright's request context does not set it.
  test.afterEach(async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/saas-apps`);
    expect(res.status()).toBe(200);
    const { items } = (await res.json()) as { items: { id: string; key: string; displayName: string }[] };

    const app = items.find((item) => item.key === SAAS_APP_KEY);
    expect(app, 'teardown could not resolve the seeded app').toBeTruthy();
    if (app!.displayName === SAAS_APP_DISPLAY_NAME) return;

    const restored = await request.patch(`${baseURL}/api/saas-apps/${app!.id}`, {
      headers: { Origin: baseURL! },
      data: { displayName: SAAS_APP_DISPLAY_NAME },
    });
    expect(restored.status()).toBe(200);
  });

  test('renaming the seeded app updates the listed name', async ({ page }) => {
    await page.goto('/apps');
    const row = page.getByRole('row', { name: new RegExp(SAAS_APP_KEY) });

    await row.getByRole('button', { name: 'Rename' }).click();
    await row.getByLabel('Display name', { exact: true }).fill('E2E Renamed Workspace');
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('cell', { name: 'E2E Renamed Workspace' })).toBeVisible();
  });

  test('deleting an app that still has accounts is refused with its account count', async ({ page }) => {
    await page.goto('/apps');
    const row = page.getByRole('row', { name: new RegExp(SAAS_APP_KEY) });

    // Delete opens a confirmation panel rather than acting on the first click,
    // matching its two sibling actions; the second click is the real request.
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(row.getByText(/This cannot be undone/)).toBeVisible();
    await row.getByRole('button', { name: 'Delete', exact: true }).last().click();

    // The seeded app carries the four demo accounts, so the refusal must name
    // how many — "cannot delete" alone does not tell the operator what to
    // clear first.
    await expect(
      page.getByRole('alert').filter({ hasText: /Cannot delete — 4 accounts still attributed/ }),
    ).toBeVisible();

    // And the app must still be there. `exact` because the actions cell's
    // accessible name concatenates its button labels, which can otherwise
    // contain the display name as a substring.
    await expect(page.getByRole('cell', { name: SAAS_APP_DISPLAY_NAME, exact: true })).toBeVisible();
  });

  // SC2 review round 2. Both of these controls shipped with no test on any
  // tier — the same shape as the untested ceiling Round 1 found, on Round 1's
  // own fix. Neither mutates: one reads a row, the other is refused before any
  // request leaves the page.
  test('offers no credential replacement for an application with no connector', async ({ page }) => {
    await page.goto('/apps');

    const managed = page.getByRole('row', { name: new RegExp(SAAS_APP_KEY) });
    await expect(managed.getByRole('button', { name: 'Replace credentials' })).toBeVisible();

    // The contract-only application declares no credential fields, so the panel
    // would render zero inputs and Save would report a bot-token error. The
    // control is hidden instead.
    const contractOnly = page.getByRole('row', { name: new RegExp(CONTRACT_ONLY_APP_KEY) });
    await expect(contractOnly).toBeVisible();
    await expect(contractOnly.getByRole('button', { name: 'Replace credentials' })).toHaveCount(0);
  });

  test('refuses an empty replacement without sending anything', async ({ page }) => {
    await page.goto('/apps');

    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/saas-apps')) requests.push(req.method());
    });

    const row = page.getByRole('row', { name: new RegExp(SAAS_APP_KEY) });
    await row.getByRole('button', { name: 'Replace credentials' }).click();
    // What this pins, named honestly after review measured it: the panel opens
    // empty and Save is refused BEFORE any request. It does NOT single out the
    // required-blank guard — the classifier rejects an empty service account
    // first, and a spec claiming otherwise was satisfied by that.
    await row.getByRole('button', { name: 'Replace', exact: true }).click();

    await expect(row.getByRole('alert')).toBeVisible();
    expect(requests.filter((m) => m === 'PATCH')).toHaveLength(0);
  });
});
