// The ONLY file under e2e/** allowed to contain SA-JSON-shaped strings
// (BEGIN PRIVATE KEY / iam.gserviceaccount.com / private_key_id — grep-
// enforced everywhere else). Mirrors apps/api/src/seed.ts's
// FAKE_SERVICE_ACCOUNT_CREDENTIALS shape, including the DEMO-NOT-A-REAL-KEY
// marker. Every spec needing fake SA JSON imports from here — no ad-hoc
// hand-typed SA JSON anywhere else in the e2e tier (RS4, round-1 SEC-E2).
export const FAKE_SERVICE_ACCOUNT_CREDENTIALS = {
  type: 'service_account',
  project_id: 'open-smp-demo',
  private_key_id: 'demo-key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\nDEMO-NOT-A-REAL-KEY\n-----END PRIVATE KEY-----\n',
  client_email: 'demo-sync@open-smp-demo.iam.gserviceaccount.com',
  client_id: '000000000000000000000',
  impersonate_admin_email: 'admin@demo.example',
};

export const FAKE_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_SERVICE_ACCOUNT_CREDENTIALS);

// Well-formed JSON but missing `private_key` — exercises the
// validateServiceAccountJson `missingFields` branch (SaasAppForm.tsx).
export const FAKE_SERVICE_ACCOUNT_JSON_MISSING_PRIVATE_KEY = JSON.stringify({
  client_email: FAKE_SERVICE_ACCOUNT_CREDENTIALS.client_email,
});
