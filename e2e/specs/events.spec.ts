import { test, expect } from '@playwright/test';

test.describe('events', () => {
  test('/events renders the table skeleton or the empty state', async ({ page }) => {
    await page.goto('/events');

    await expect(page.getByRole('heading', { name: 'Discovery events' })).toBeVisible();
    // Content-agnostic smoke (no count assertion): either the table headers
    // or the "No events yet." empty state must be present.
    const hasHeaders = await page.getByRole('columnheader', { name: 'Source' }).isVisible().catch(() => false);
    const hasEmptyState = await page.getByText('No events yet.').isVisible().catch(() => false);
    expect(hasHeaders || hasEmptyState).toBe(true);
  });
});
