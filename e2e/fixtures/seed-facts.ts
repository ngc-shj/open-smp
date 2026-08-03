// Constants for the seeded demo dataset. Keep in sync with
// apps/api/src/seed.ts (canonical source) — these values are cross-checked,
// not re-derived, so a seed.ts edit must be mirrored here by hand.

// SC2/C5: each entry now states its link status as a FIELD.
//
// The key used to be the status, which worked while the demo had one account
// per status and stopped working the moment a second account-bearing
// application arrived — two orphans cannot both be keyed `orphan`, and the
// second would have silently overwritten the first in
// seed-gate-agreement.test.ts's parser. The key is now a name and the status is
// data, so the gate's parser reads the claim instead of inferring it.
// `status` is the DOMAIN value — it goes into `?status=` and into the seed —
// and `chip` is what a reader sees. They were the same string until the i18n
// review routed the link-status vocabulary through the dictionary, and three
// specs asserted the domain value as rendered text. Kept apart here so the next
// copy change moves one field and not four call sites.
export const SEEDED_ACCOUNTS = {
  matched: {
    email: 'alice.tanaka@demo.example',
    displayName: 'Alice Tanaka',
    status: 'matched',
    chip: 'Matched',
  },
  ghost: {
    email: 'bob.suzuki@demo.example',
    displayName: 'Bob Suzuki',
    status: 'ghost',
    chip: 'Ghost',
  },
  ambiguous: {
    email: 'shared.mailbox@demo.example',
    displayName: 'Shared Mailbox',
    status: 'ambiguous',
    chip: 'Ambiguous',
  },
  orphan: {
    email: 'unknown.contractor@demo.example',
    displayName: 'Unknown Contractor',
    status: 'orphan',
    chip: 'Orphan',
  },
  slackOrphan: {
    email: 'chris.wong@demo.example',
    displayName: 'Chris Wong',
    status: 'orphan',
    chip: 'Orphan',
  },
} as const;

/**
 * Every seeded account the orphan filter must show, by name.
 *
 * `accounts.spec.ts` asserted `toHaveCount(1)`. A second orphan makes that a
 * number to bump, and a bumped number asserts nothing — it says "as many rows
 * as the seed happens to produce". Derived from the statuses above, so an
 * account added to the seed joins this set rather than breaking a count.
 */
export const SEEDED_ORPHAN_EMAILS = Object.values(SEEDED_ACCOUNTS)
  .filter((a) => a.status === 'orphan')
  .map((a) => a.email);

export const SAAS_APP_KEY = 'google-workspace';
export const SAAS_APP_DISPLAY_NAME = 'Google Workspace';

// C6. The seed writes CONTRACTS and no new accounts, which is what makes the
// licences cases reachable at all: every constraint behind round 2's
// "not jointly reachable" finding is about accounts (this app's count is pinned
// at 4 by apps.spec.ts, and a new unmatched account reds the tenant-scoped
// orphan count in accounts.spec.ts). Nothing pins the number of applications.
//
// Three seats against four assigned, so the demo opens on an over-allocation —
// and two of those four seats are reclaimable, so it is actionable from the
// same row.
export const SEEDED_CONTRACT_SEATS = 3;
export const SEEDED_CONTRACT_UNIT_PRICE = '12.00';
export const SEEDED_CONTRACT_CURRENCY = 'USD';

// C4. The two grants the seeded audit reports. The second is the finding: an
// application Google does not recognise, holding a mail scope, that nobody
// registered here.
export const SEEDED_DISCOVERED_KNOWN_CLIENT_ID = '407408718192.apps.googleusercontent.com';
export const SEEDED_DISCOVERED_ANONYMOUS_CLIENT_ID = 'shadow-it-client.example.com';
export const SEEDED_DISCOVERED_UNSTATED_CLIENT_ID = 'unstated-client.example.com';

// The application the connectors do not sync: no credentials, no accounts, and
// an ANNUAL cycle where the other is monthly, so the two rows are visibly not
// comparable (SCL4).
// SC2/C5. Accounts, a connector, and no contract — the third of SCL16's four
// states, and the one the demo could not reach with a single synced app.
export const SLACK_APP_KEY = 'slack';
// No SLACK_APP_DISPLAY_NAME here. Its Google twin exists because
// seed-gate-agreement.test.ts compares it against the shell gate; a Slack copy
// with no such comparison would be a second hand-synced literal with nothing
// checking it — the exact class the C38 gate was written for.

export const CONTRACT_ONLY_APP_KEY = 'notion';
export const CONTRACT_ONLY_APP_DISPLAY_NAME = 'Notion';
export const CONTRACT_ONLY_SEATS = 25;

// Import fixture display names ("E2E Import Row *" — see
// e2e/fixtures/files/e2e-import.csv) are deliberately distinct from every
// seeded identity/account displayName above. packages/matcher/src/rules.ts's
// nameDomainRule matches on displayName + email DOMAIN alone (ignoring the
// local part), so a fixture row sharing a seeded displayName would spuriously
// match a seeded account even with a novel email address. Same @demo.example
// domain, disjoint display names => zero match under any of the matcher's
// four rules (round-1 FN-F2).
