import { test, expect } from '@playwright/test';

test.describe('events', () => {
  test('/events renders the table skeleton or the empty state', async ({ page }) => {
    await page.goto('/events');

    await expect(page.getByRole('heading', { name: 'Discovery events' })).toBeVisible();

    // Content-agnostic smoke (no count assertion): either the table headers
    // or the "No events yet." empty state must be present. Uses an
    // or-locator so Playwright auto-waits for whichever renders — a bare
    // isVisible() pair races the render and can report false/false.
    const tableOrEmptyState = page
      .getByRole('columnheader', { name: 'Source' })
      .or(page.getByText('No events yet.'));
    await expect(tableOrEmptyState.first()).toBeVisible();
  });
});
