import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { SEEDED_ACCOUNTS } from '../fixtures/seed-facts.js';

/**
 * API-driven teardown, not UI-driven: it survives a mid-test UI failure, which
 * is exactly when a leaked label would otherwise poison the shared stack for
 * every later run. The specs work from emails, so ids are derived here — there
 * is no seeded-account-id fixture.
 *
 * The Origin header is mandatory: the API rejects every non-GET /api request
 * whose Origin does not match the app origin, and Playwright's request context
 * inherits cookies but sets no Origin. Without it this 403s silently.
 */
async function clearLabels(
  request: APIRequestContext,
  baseURL: string,
  emails: string[],
): Promise<void> {
  const res = await request.get(`${baseURL}/api/accounts`);
  expect(res.status()).toBe(200);
  const { items } = (await res.json()) as { items: { accountId: string; email: string | null }[] };

  for (const email of emails) {
    const account = items.find((item) => item.email === email);
    expect(account, `teardown could not resolve an accountId for ${email}`).toBeTruthy();

    const deleted = await request.delete(`${baseURL}/api/accounts/${account!.accountId}/label`, {
      headers: { Origin: baseURL },
    });
    // 204 when the account exists (label present or not); 404 only if the
    // account itself is gone. Asserting here makes a failed teardown name
    // itself at the point of damage rather than at the end of the run.
    expect([204, 404]).toContain(deleted.status());
  }
}

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

    // Armed BEFORE the click, and it is the PUT itself — not a rendered
    // consequence. The previous two attempts both waited for the "Known shared"
    // chip, which the FIRST save had already put on screen: it was true before
    // this save, after it, and against a stale server render, so it waited for
    // nothing. Re-navigating narrowed the window and left the race; review
    // measured that the replacement assertion was exactly as blind as the line
    // it replaced.
    //
    // LabelControl seeds its editor in openEditor() and nothing re-seeds it, so
    // reopening before the write lands reads the old note and no retry can
    // recover — which is why the wait has to be on the mutation.
    const saved = page.waitForResponse(
      (res) => /\/api\/accounts\/[^/]+\/label$/.test(new URL(res.url()).pathname) && res.request().method() === 'PUT',
    );
    await row.getByRole('button', { name: 'Save' }).click();
    expect((await saved).ok()).toBe(true);

    const reloaded = await orphanRow(page);
    const reloadedButton = labelButton(reloaded);

    await reloadedButton.click();
    await expect(reloaded.getByRole('combobox')).toHaveValue('known_shared');
    await expect(reloaded.getByPlaceholder('Note (optional)')).toHaveValue('updated note');
    await reloaded.getByRole('button', { name: 'Cancel' }).click();
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

  test('the label filter composes with the status tab rather than replacing it', async ({ page }) => {
    await page.goto('/accounts?status=orphan');

    await page.getByRole('link', { name: 'Unlabeled', exact: true }).click();

    await expect(page).toHaveURL(/\/accounts\?status=orphan&label=none/);
    // The orphan is unlabeled, so it must survive both predicates — this is
    // what distinguishes composition from the filter replacing the tab.
    await expect(
      page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.orphan.email) }),
    ).toBeVisible();
  });

  // Each seeded status tab holds exactly one account, and selection state is
  // client-side so it does not survive navigating between tabs. A genuine
  // multi-row selection is therefore not constructible against this seed — the
  // {updated: N} count for N > 1 is proven at the integration tier instead
  // (same structural limit SC23 records for pagination). What E2E proves here
  // is that the bar is wired: disabled with nothing selected, enabled by a
  // checkbox, and the applied label reaches the row.
  test('bulk label bar applies the selected kind to a checked row', async ({
    page,
    request,
    baseURL,
  }) => {
    try {
      await page.goto('/accounts?status=orphan');

      const apply = page.getByRole('button', { name: 'Apply to selected' });
      await expect(apply).toBeDisabled();

      const orphan = page.getByRole('row', { name: new RegExp(SEEDED_ACCOUNTS.orphan.email) });
      await orphan.getByRole('checkbox').check();
      await expect(page.getByText('1 selected')).toBeVisible();
      await expect(apply).toBeEnabled();

      await page.getByLabel('Bulk label kind').selectOption('service_account');
      await page.getByLabel('Bulk label note').fill('E2E bulk labeling');
      await apply.click();

      await expect(page.getByText('Labeled 1 account.')).toBeVisible();
      await expect(orphan.getByText('Service account', { exact: true }).first()).toBeVisible();
    } finally {
      // Records what it mutated and clears exactly those accounts (NFR5).
      await clearLabels(request, baseURL!, [SEEDED_ACCOUNTS.orphan.email]);
    }
  });

  test('a label mutation surfaces on the events page as a transition', async ({
    page,
    request,
    baseURL,
  }) => {
    try {
      const row = await orphanRow(page);
      const button = await labelButton(row);
      await button.click();
      await row.getByRole('combobox').selectOption('known_shared');
      await row.getByRole('button', { name: 'Save' }).click();
      await expect(row.getByText('Known shared', { exact: true }).first()).toBeVisible();

      await page.goto('/events?source=label');

      const auditRow = page.getByRole('row', { name: /label_set/ }).first();
      await expect(auditRow).toBeVisible();
      await expect(auditRow.getByText('none → Known shared')).toBeVisible();
    } finally {
      await clearLabels(request, baseURL!, [SEEDED_ACCOUNTS.orphan.email]);
    }
  });
});
