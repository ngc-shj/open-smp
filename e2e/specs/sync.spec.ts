import { test, expect } from '@playwright/test';
import { SAAS_APP_KEY, SEEDED_ACCOUNTS } from '../fixtures/seed-facts.js';

test.describe('sync', () => {
  test('sync fails against fake seed credentials, match never fires, chips unchanged', async ({ page }) => {
    await page.goto('/accounts?status=matched');

    // Listener attached BEFORE the sync click — captures every /api/match
    // request so "match never triggered" is provable, not assumed (same
    // technique as apps.spec's zero-request proof).
    const matchRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/match')) matchRequests.push(req.url());
    });

    await page.getByRole('button', { name: `Sync ${SAAS_APP_KEY}` }).click();

    // VE1: seeded credentials are fake, so the sync job fails against the
    // real Google API call — this is the locally-testable failure path.
    await expect(page.getByText(/sync (enqueue )?failed/i)).toBeVisible();

    // C8 F6 gating: match only fires after sync completes; a failed sync
    // must never have triggered it.
    expect(matchRequests).toHaveLength(0);

    // Seeded chips are unchanged — a failed sync must not corrupt links.
    for (const [status, account] of Object.entries(SEEDED_ACCOUNTS)) {
      await page.goto(`/accounts?status=${status}`);
      const row = page.getByRole('row', { name: new RegExp(account.email) });
      await expect(row.getByText(status, { exact: true })).toBeVisible();
    }
  });
});
