import { test, expect } from '@playwright/test';

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
});
