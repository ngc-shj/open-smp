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

// Import fixture display names ("E2E Import Row *" — see
// e2e/fixtures/files/e2e-import.csv) are deliberately distinct from every
// seeded identity/account displayName above. packages/matcher/src/rules.ts's
// nameDomainRule matches on displayName + email DOMAIN alone (ignoring the
// local part), so a fixture row sharing a seeded displayName would spuriously
// match a seeded account even with a novel email address. Same @demo.example
// domain, disjoint display names => zero match under any of the matcher's
// four rules (round-1 FN-F2).
