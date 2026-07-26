import { test, expect, type Page } from '@playwright/test';
import { SEEDED_ACCOUNTS } from '../fixtures/seed-facts.js';

test.describe('events', () => {
  test('/events renders the heading, the full column set, and a populated tbody', async ({ page }) => {
    await page.goto('/events');

    await expect(page.getByRole('heading', { name: 'Discovery events' })).toBeVisible();

    // The <thead> is unconditional, so assert it directly — an .or() against
    // the empty-state text would always resolve via the header and never
    // falsify the empty branch (round-2 TEST-R2-F1).
    // The full shipped set, not a subset: 'Label change' and 'Actor' are the
    // audit column C19/C25 exist to surface, and a subset assertion stays green
    // if either is deleted.
    for (const header of ['Source', 'Kind', 'Counts', 'Label change', 'Actor', 'Created at']) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }

    // Content-agnostic body check (no count assertion — event volume varies
    // with whatever specs ran before): the tbody always renders at least one
    // row, either a real event row or the empty-state cell. Both branches
    // live in <tbody>, so this discriminates a rendered body from a broken
    // one without pinning a count.
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  test('the source filter narrows the list by clicking, not only by URL', async ({
    page,
    request,
    baseURL,
  }) => {
    // Produce one audit event so the assertion below is not vacuous, then clear
    // the label in `finally` — a leaked label poisons assert-seed-preserved.sh
    // for every later run.
    const accounts = await request.get(`${baseURL}/api/accounts`);
    expect(accounts.status()).toBe(200);
    const { items } = (await accounts.json()) as { items: { accountId: string; email: string | null }[] };
    const target = items.find((item) => item.email === SEEDED_ACCOUNTS.orphan.email);
    expect(target, 'could not resolve the orphan account').toBeTruthy();

    const labelled = await request.put(`${baseURL}/api/accounts/${target!.accountId}/label`, {
      headers: { Origin: baseURL! },
      data: { kind: 'known_shared', note: 'events source filter spec' },
    });
    expect(labelled.status()).toBe(200);

    try {
      await runFilterAssertions(page);
    } finally {
      const cleared = await request.delete(`${baseURL}/api/accounts/${target!.accountId}/label`, {
        headers: { Origin: baseURL! },
      });
      expect([204, 404]).toContain(cleared.status());
    }
  });

  async function runFilterAssertions(page: Page): Promise<void> {
    await page.goto('/events');

    // Clicking is the point: the filter existed as a URL parameter before this
    // control, so reaching /events?source=label by navigation would pass with
    // no control on the page at all.
    await page.getByRole('link', { name: 'Label audit', exact: true }).click();

    await expect(page).toHaveURL(/\/events\?source=label/);

    const sources = await page.locator('tbody tr td:first-child').allTextContents();
    // Non-empty matters: an empty page would satisfy "every row is a label row"
    // vacuously. The audit row is produced below rather than borrowed from
    // whichever spec ran first — the seeder writes no discovery_events.
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(['label']));
  }

  test('a non-audit row renders no label transition', async ({ page }) => {
    // Run matching first rather than relying on a matcher event left behind by
    // an earlier spec: the seeder writes no discovery_events, so depending on
    // one would make this pass or fail on spec order.
    await page.goto('/import');
    await page.getByRole('button', { name: 'Run matching' }).click();
    await expect(page.getByText('Matching completed.')).toBeVisible();

    await page.goto('/events?source=matcher');

    // The Label change column keys off the projected payload rather than a copy
    // of the audit-kind list. A matcher event carries neither before nor after,
    // so it must render the dash — the negative half of the transition
    // rendering that labeling.spec.ts asserts positively.
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow.locator('td').nth(0)).toHaveText('matcher');
    await expect(firstRow.locator('td').nth(3)).toHaveText('—');
  });

  test('an invalid source falls back to the unfiltered list instead of erroring', async ({ page }) => {
    // The API rejects a non-slug source with 400, and a non-ok response throws
    // in the page — so an unvalidated param would render an error screen for
    // what is only a URL typo.
    await page.goto('/events?source=<script>');

    await expect(page.getByRole('heading', { name: 'Discovery events' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });
});
