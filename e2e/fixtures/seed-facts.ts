// Constants for the seeded demo dataset. Keep in sync with
// apps/api/src/seed.ts (canonical source) — these values are cross-checked,
// not re-derived, so a seed.ts edit must be mirrored here by hand.

export const SEEDED_ACCOUNTS = {
  matched: { email: 'alice.tanaka@demo.example', displayName: 'Alice Tanaka' },
  ghost: { email: 'bob.suzuki@demo.example', displayName: 'Bob Suzuki' },
  ambiguous: { email: 'shared.mailbox@demo.example', displayName: 'Shared Mailbox' },
  orphan: { email: 'unknown.contractor@demo.example', displayName: 'Unknown Contractor' },
} as const;

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
