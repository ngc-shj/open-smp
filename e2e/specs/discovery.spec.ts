import { test, expect } from '@playwright/test';
import {
  SAAS_APP_KEY,
  SEEDED_DISCOVERED_ANONYMOUS_CLIENT_ID,
  SEEDED_DISCOVERED_KNOWN_CLIENT_ID,
  SEEDED_DISCOVERED_UNSTATED_CLIENT_ID,
} from '../fixtures/seed-facts.js';

// SC3/C4 against the compose stack. Read-only throughout: the seeded audit is
// an append-only `discovery_events` row, so there is nothing here to leak into
// a later run and nothing to tear down.

test.describe('discovery', () => {
  test('shows the seeded audit, and marks the grant nobody registered', async ({ page }) => {
    await page.goto('/discovery');

    const audit = page.getByTestId(`audit-${SAAS_APP_KEY}`);
    await expect(audit).toBeVisible();
    // Four accounts read, none unreadable — the coverage the finding rests on.
    await expect(audit.getByTestId('coverage')).toHaveText('4 accounts read');

    const known = audit.getByTestId(`discovered-${SEEDED_DISCOVERED_KNOWN_CLIENT_ID}`);
    await expect(known.getByTestId('user-count')).toHaveText('4');
    await expect(known.getByTestId('registered')).toHaveText('yes');

    // The whole point of the page: an application Google does not recognise,
    // holding a mail scope, that nobody in this product ever registered.
    const shadow = audit.getByTestId(`discovered-${SEEDED_DISCOVERED_ANONYMOUS_CLIENT_ID}`);
    await expect(shadow.getByTestId('user-count')).toHaveText('2');
    await expect(shadow.getByTestId('registered')).toHaveText('no');
    await expect(shadow).toContainText('https://mail.google.com/');

    // The third state. "the provider did not say" must not render as "yes" —
    // vouching for an application on no evidence is the direction this whole
    // feature exists to avoid, and a two-state render is indistinguishable
    // from a correct one unless something carries a null.
    const unstated = audit.getByTestId(`discovered-${SEEDED_DISCOVERED_UNSTATED_CLIENT_ID}`);
    await expect(unstated.getByTestId('registered')).toHaveText('unknown');
    await expect(unstated).toContainText('unnamed');
  });

  test('does not present a discovered grant as a registered application', async ({ page }) => {
    // FR2. The discovered client ids must not appear on /apps, which lists what
    // the operator registered — conflating the two would turn evidence of a
    // grant into an inventory entry nobody created.
    await page.goto('/apps');

    await expect(page.getByText(SEEDED_DISCOVERED_ANONYMOUS_CLIENT_ID)).toHaveCount(0);
    await expect(page.getByText(SEEDED_DISCOVERED_KNOWN_CLIENT_ID)).toHaveCount(0);
  });
});
