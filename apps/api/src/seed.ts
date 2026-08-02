// Idempotent demo seed for `docker compose up` (NFR1, C8 acceptance).
// Safe to re-run: every insert is `ON CONFLICT DO NOTHING` / existence-checked.
//
// Builds a small dataset, computes account_links via the real matcher
// (packages/matcher) so persisted link status/evidence match production
// logic exactly, then asserts the C8 acceptance bar (>=1 orphan AND >=1
// ghost in the resulting accounts list) before exiting 0.
import argon2 from 'argon2';
import { createPool, withTenant } from '@open-smp/schema';
import { encryptCredentials, parseEncryptionKeys } from '@open-smp/crypto';
import { defaultRules, matchAccounts, type AccountView, type IdentityView } from '@open-smp/matcher';
import { z } from 'zod';
import { TOKEN_AUDIT_EVENT_SOURCE } from '@open-smp/api-types';
import { ARGON2ID_OPTIONS } from './auth.js';
import { recordTokenAudit } from './audit.js';

// Demo credentials are duplicated as a raw curl payload in
// .github/workflows/ci.yml (compose-smoke) — YAML cannot import these
// constants, so keep both sites in sync when changing any of them. The
// e2e tier reads the same values via env vars with in-code defaults in
// e2e/fixtures/auth.ts (and re-states the facts in e2e/fixtures/seed-facts.ts);
// ci.yml also exports them as job-level env for both the curl step and the
// Playwright step — keep all these sites in sync too.
const TENANT_SLUG = 'demo';
const TENANT_NAME = 'Demo Corp';
const ADMIN_EMAIL = 'admin@demo.example';
const ADMIN_PASSWORD = 'demo-admin-password';
const SAAS_APP_KEY = 'google-workspace';
const SAAS_APP_DISPLAY_NAME = 'Google Workspace';

// SC2/C5. The second account-bearing application, which is what SCL16 said the
// demo was missing: it could show "accounts, and a contract" and "a contract,
// no accounts", and not "accounts, and no contract" — the state an operator is
// in the moment they connect a tool before anyone has entered what it costs.
//
// Deliberately WITHOUT a contract. `assert-seed-preserved.sh` asserts contract
// figures for exactly the two apps that have them, and seed-gate-agreement's
// licence check requires that set to match the fixture's two — so a third
// contract would move a control for a reason unrelated to what this app is for.
const SLACK_APP_KEY = 'slack';
const SLACK_APP_DISPLAY_NAME = 'Slack';

// Fake service-account JSON — demo credential only, never a real key (NFR4).
const FAKE_SERVICE_ACCOUNT_CREDENTIALS = {
  type: 'service_account',
  project_id: 'open-smp-demo',
  private_key_id: 'demo-key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\nDEMO-NOT-A-REAL-KEY\n-----END PRIVATE KEY-----\n',
  client_email: 'demo-sync@open-smp-demo.iam.gserviceaccount.com',
  client_id: '000000000000000000000',
  impersonate_admin_email: 'admin@demo.example',
};

type SeedIdentity = {
  employeeId: string;
  primaryEmail: string;
  secondaryEmails: string[];
  displayName: string;
  status: 'active' | 'left';
  leftAt: string | null;
};

type SeedAccount = {
  externalId: string;
  email: string;
  displayName: string;
  accountStatus: 'active' | 'suspended' | 'archived';
  isAdmin: boolean;
  lastActivityAt: string | null;
};

// Deliberately crafted so matchAccounts() yields >=1 of every link status:
// - alice: active identity, exact-email hit -> matched
// - bob: left identity + still-active account, exact-email hit -> ghost
// - shared-mailbox: two identities with the SAME primary_email both hit
//   exact-email for the one account with that email -> ambiguous
// - unknown-contractor: no identity matches any rule -> orphan
const IDENTITIES: SeedIdentity[] = [
  {
    employeeId: 'E001',
    primaryEmail: 'alice.tanaka@demo.example',
    secondaryEmails: [],
    displayName: 'Alice Tanaka',
    status: 'active',
    leftAt: null,
  },
  {
    employeeId: 'E002',
    primaryEmail: 'bob.suzuki@demo.example',
    secondaryEmails: [],
    displayName: 'Bob Suzuki',
    status: 'left',
    leftAt: '2024-03-31T00:00:00.000Z',
  },
  {
    employeeId: 'E003',
    primaryEmail: 'shared.mailbox@demo.example',
    secondaryEmails: [],
    displayName: 'Carol Ito',
    status: 'active',
    leftAt: null,
  },
  {
    employeeId: 'E004',
    primaryEmail: 'shared.mailbox@demo.example',
    secondaryEmails: [],
    displayName: 'Dai Yamamoto',
    status: 'active',
    leftAt: null,
  },
];

// C6. Keep in sync with e2e/fixtures/seed-facts.ts, which
// seed-gate-agreement.test.ts cross-checks against the shell gate.
const CONTRACT_ONLY_APP_KEY = 'notion';
const CONTRACT_ONLY_APP_DISPLAY_NAME = 'Notion';

type SeedContract = {
  planName: string;
  seats: number;
  /** A string, never a number: `numeric(14,2)` is exact and a double is not. */
  unitPrice: string;
  currency: string;
  billingCycle: 'monthly' | 'annual';
  termStart: string;
  termEnd: string;
  note: string;
};

/**
 * Three seats against four assigned, so the demo opens ON the number the
 * screen exists to make loud: `unassigned` is -1, unclamped. And two of those
 * four seats are reclaimable — one held by someone who left, one by nobody —
 * so the over-allocation is not just visible, it is ACTIONABLE from the same
 * row. That pairing is the product's whole argument in one line.
 */
const SEEDED_CONTRACT: SeedContract = {
  planName: 'Business Standard',
  seats: 3,
  unitPrice: '12.00',
  currency: 'USD',
  billingCycle: 'monthly',
  termStart: '2026-01-01',
  termEnd: '2026-12-31',
  note: 'Demo contract for the seeded workspace.',
};

/**
 * Deliberately ANNUAL where the other is monthly. The two rows are then not
 * comparable, and the page and the export both carry the period beside the
 * figure so nobody sums them — SCL4 made visible rather than merely written
 * down.
 */
const CONTRACT_ONLY_CONTRACT: SeedContract = {
  planName: 'Team',
  seats: 25,
  unitPrice: '96.00',
  currency: 'USD',
  billingCycle: 'annual',
  termStart: '2026-04-01',
  termEnd: '2027-03-31',
  note: 'Bought by finance, connected to nothing.',
};

// C4. One grant everybody made to a tool IT knows about, and one that nobody
// registered — `anonymous: true` is the discovery signal, and the demo exists to
// put those two side by side.
const SEEDED_UNSUPPORTED_RUN_ID = '00000000-0000-4000-8000-0000000000a2';
const SEEDED_AUDIT_RUN_ID = '00000000-0000-4000-8000-00000000a0d1';
const SEEDED_DISCOVERED_APPLICATIONS = [
  {
    clientId: '407408718192.apps.googleusercontent.com',
    displayName: 'Approved Analytics',
    userCount: 4,
    anonymous: false,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  },
  {
    clientId: 'shadow-it-client.example.com',
    displayName: 'Unreviewed Mail Plugin',
    userCount: 2,
    anonymous: true,
    scopes: ['https://mail.google.com/', 'https://www.googleapis.com/auth/contacts.readonly'],
  },
  {
    // The third state, seeded so something renders it. `anonymous: null` is
    // "the provider did not say", and a demo carrying only true and false
    // leaves the branch that distinguishes them observed by nothing.
    clientId: 'unstated-client.example.com',
    displayName: null,
    userCount: 1,
    anonymous: null,
    scopes: [],
  },
];

const ACCOUNTS: SeedAccount[] = [
  {
    externalId: 'gws-user-001',
    email: 'alice.tanaka@demo.example',
    displayName: 'Alice Tanaka',
    accountStatus: 'active',
    isAdmin: false,
    lastActivityAt: '2026-07-20T09:00:00.000Z',
  },
  {
    externalId: 'gws-user-002',
    email: 'bob.suzuki@demo.example',
    displayName: 'Bob Suzuki',
    accountStatus: 'active',
    isAdmin: false,
    lastActivityAt: '2024-03-01T09:00:00.000Z',
  },
  {
    externalId: 'gws-user-003',
    email: 'shared.mailbox@demo.example',
    displayName: 'Shared Mailbox',
    accountStatus: 'active',
    isAdmin: false,
    lastActivityAt: '2026-07-01T09:00:00.000Z',
  },
  {
    externalId: 'gws-user-004',
    email: 'unknown.contractor@demo.example',
    displayName: 'Unknown Contractor',
    accountStatus: 'active',
    isAdmin: false,
    lastActivityAt: '2026-06-15T09:00:00.000Z',
  },
];

// SC2/C5. Slack's account, and it is deliberately ONE.
//
// The email and display name are disjoint from every seeded identity, so the
// matcher produces `orphan` under all four of its rules — which is the point:
// this is what a newly-connected tool looks like before anyone has reconciled
// it, and it is the second member of the orphan set `accounts.spec.ts` now
// asserts by NAME rather than by count.
//
// Not a bot, though C1 decided bots are synced. A seeded bot would be an orphan
// too and would make the demo's orphan list read as noise on the one screen
// that exists to make orphans actionable — the residue C1 recorded, kept out of
// the demo rather than shipped into it.
const SLACK_ACCOUNTS: SeedAccount[] = [
  {
    externalId: 'U0DEMO00001',
    email: 'chris.wong@demo.example',
    displayName: 'Chris Wong',
    accountStatus: 'active',
    isAdmin: false,
    // Slack reports no activity timestamp at all (SC2/C1), so the demo says so
    // rather than inventing one the connector could never produce.
    lastActivityAt: null,
  },
];


async function ensureTenant(pool: ReturnType<typeof createPool>): Promise<string> {
  await pool.query(
    `INSERT INTO tenants (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO NOTHING`,
    [TENANT_SLUG, TENANT_NAME],
  );
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [
    TENANT_SLUG,
  ]);
  const tenant = rows[0];
  if (!tenant) {
    throw new Error('seed: tenant insert/lookup returned no row');
  }
  return tenant.id;
}

async function ensureAdminUser(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
): Promise<void> {
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, {
    type: argon2.argon2id,
    ...ARGON2ID_OPTIONS,
  });
  await withTenant(pool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [tenantId, ADMIN_EMAIL, passwordHash],
    );
  });
}

async function ensureSaasApp(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
  encryptionKeys: Map<number, Buffer>,
): Promise<string> {
  const existing = await withTenant(pool, tenantId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM saas_apps WHERE tenant_id = $1 AND key = $2',
      [tenantId, SAAS_APP_KEY],
    );
    return rows[0]?.id ?? null;
  });
  if (existing) {
    return existing;
  }

  return withTenant(pool, tenantId, async (tx) => {
    const insertResult = await tx.query<{ id: string }>(
      `INSERT INTO saas_apps (tenant_id, key, display_name) VALUES ($1, $2, $3)
       RETURNING id`,
      [tenantId, SAAS_APP_KEY, SAAS_APP_DISPLAY_NAME],
    );
    const saasAppId = insertResult.rows[0]?.id;
    if (!saasAppId) {
      throw new Error('seed: saas_apps insert returned no row');
    }

    const plaintext = new TextEncoder().encode(JSON.stringify(FAKE_SERVICE_ACCOUNT_CREDENTIALS));
    const { blob, keyVersion } = encryptCredentials(
      plaintext,
      { tenantId, saasAppId },
      encryptionKeys,
    );
    await tx.query(
      `UPDATE saas_apps SET credentials_enc = $2, credentials_key_version = $3 WHERE id = $1`,
      [saasAppId, Buffer.from(blob), keyVersion],
    );

    return saasAppId;
  });
}

/**
 * The application the connectors do not sync (C6, FR1's demo case).
 *
 * No credentials, so `GET /licenses` reports `hasConnector: false`, and no
 * accounts, so it reports `matchState: 'no-accounts'` — the state a contract
 * uploaded for a tool nobody has connected produces, and the one the licences
 * screen would otherwise never show.
 */
/**
 * The application with accounts and no contract (SC2/C5, SCL16).
 *
 * Credentials are seeded so `GET /licenses` reports `hasConnector: true` — the
 * distinction from the contract-only app is the presence of a connector, not
 * just of accounts. The token is fake, exactly as the Google service account
 * is: nothing in this repository can reach a real workspace (NFR4).
 */
async function ensureSlackApp(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
  encryptionKeys: ReturnType<typeof parseEncryptionKeys>,
): Promise<string> {
  return withTenant(pool, tenantId, async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO saas_apps (tenant_id, key, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, key) DO NOTHING
       RETURNING id`,
      [tenantId, SLACK_APP_KEY, SLACK_APP_DISPLAY_NAME],
    );
    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM saas_apps WHERE tenant_id = $1 AND key = $2',
      [tenantId, SLACK_APP_KEY],
    );
    const saasAppId = inserted.rows[0]?.id ?? rows[0]?.id;
    if (!saasAppId) {
      throw new Error('seed: slack app neither inserted nor found');
    }

    const { blob, keyVersion } = encryptCredentials(
      new TextEncoder().encode(JSON.stringify({ botToken: 'xoxb-demo-not-a-real-token' })),
      { tenantId, saasAppId },
      encryptionKeys,
    );
    await tx.query(
      'UPDATE saas_apps SET credentials_enc = $2, credentials_key_version = $3 WHERE id = $1',
      [saasAppId, Buffer.from(blob), keyVersion],
    );

    return saasAppId;
  });
}

async function ensureContractOnlyApp(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
): Promise<string> {
  return withTenant(pool, tenantId, async (tx) => {
    // Idempotent by the same rule as ensureSaasApp: the seeder runs on every
    // `docker compose up`, and a second row would violate UNIQUE (tenant_id,
    // key) and take the whole seed down.
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO saas_apps (tenant_id, key, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, key) DO NOTHING
       RETURNING id`,
      [tenantId, CONTRACT_ONLY_APP_KEY, CONTRACT_ONLY_APP_DISPLAY_NAME],
    );
    const insertedId = inserted.rows[0]?.id;
    if (insertedId) {
      return insertedId;
    }

    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM saas_apps WHERE tenant_id = $1 AND key = $2',
      [tenantId, CONTRACT_ONLY_APP_KEY],
    );
    const existingId = rows[0]?.id;
    if (!existingId) {
      throw new Error('seed: contract-only app neither inserted nor found');
    }
    return existingId;
  });
}

/**
 * Writes a contract for one application.
 *
 * The seed adds CONTRACTS and not accounts, which is what makes C6 possible at
 * all. Round 2 established that the licences cases were not jointly reachable,
 * and every constraint behind that finding is about accounts: the seeded
 * application's count is pinned at 4 by `e2e/specs/apps.spec.ts`, and any new
 * unmatched account reds the tenant-scoped orphan count in
 * `e2e/specs/accounts.spec.ts`. Measured: no test pins the number of
 * applications, and none pins contract state except the licences spec, which
 * changes in this same contract.
 *
 * DO UPDATE rather than DO NOTHING: a figure edited here must reach a stack
 * whose volume already carries the previous seed, or the demo silently keeps
 * showing the old one.
 */
async function ensureContract(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
  saasAppId: string,
  contract: SeedContract,
): Promise<void> {
  await withTenant(pool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO saas_contracts
         (tenant_id, saas_app_id, plan_name, seats, unit_price, currency, billing_cycle,
          term_start, term_end, note)
       VALUES ($1, $2, $3, $4, $5::numeric, $6, $7::billing_cycle, $8::date, $9::date, $10)
       ON CONFLICT ON CONSTRAINT saas_contracts_tenant_id_saas_app_id_key DO UPDATE SET
         plan_name = EXCLUDED.plan_name,
         seats = EXCLUDED.seats,
         unit_price = EXCLUDED.unit_price,
         currency = EXCLUDED.currency,
         billing_cycle = EXCLUDED.billing_cycle,
         term_start = EXCLUDED.term_start,
         term_end = EXCLUDED.term_end,
         note = EXCLUDED.note,
         updated_at = now()`,
      [
        tenantId,
        saasAppId,
        contract.planName,
        contract.seats,
        contract.unitPrice,
        contract.currency,
        contract.billingCycle,
        contract.termStart,
        contract.termEnd,
        contract.note,
      ],
    );
  });
}

/**
 * Plants one completed token audit (SC3/C4).
 *
 * Fabricated, like every other seeded fact here: VE1 means no real Google
 * tenant exists, `sync` fails against the demo's fake credentials by design,
 * and an audit therefore cannot run end to end anywhere this repository can
 * reach. Without this the discovery page has only an empty state to show, and
 * SC5 recorded what shipping an unrendered shape costs.
 *
 * `discovery_events` is append-only by privilege (migration 0005 revokes UPDATE
 * and DELETE from opensmp_app), so there is no upsert to reach for: a re-seed
 * can only add a row or add nothing. It adds one when the seeded findings
 * differ from the newest run's, which is what makes an edit here reach a stack
 * that already carries one — and the page shows the newest run per
 * application, so the superseded row stays in the log where an audit trail
 * wants it.
 */
async function ensureTokenAudit(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
): Promise<void> {
  await withTenant(pool, tenantId, async (tx) => {
    // Guarded on the CONTENT, not on existence. An existence guard is the only
    // form available for an append-only table — and it means an edit to the
    // seeded findings never reaches a stack whose volume already carries a
    // run, which is SCL17's shape in a table where DO UPDATE is not merely
    // unused but revoked. Measured here: adding a third application produced a
    // green seed and an unchanged page.
    const { rows } = await tx.query(
      `SELECT 1 FROM discovery_events
       WHERE tenant_id = $1 AND source = $2 AND kind = 'token_audit_completed'
         AND payload -> 'applications' = $3::jsonb
       LIMIT 1`,
      [tenantId, TOKEN_AUDIT_EVENT_SOURCE, JSON.stringify(SEEDED_DISCOVERED_APPLICATIONS)],
    );
    if (rows.length === 0) {
      await recordTokenAudit(tx, tenantId, 'token_audit_completed', {
        runId: SEEDED_AUDIT_RUN_ID,
        auditedAppKey: SAAS_APP_KEY,
        scanned: ACCOUNTS.length,
        failed: 0,
        applications: SEEDED_DISCOVERED_APPLICATIONS,
      });
    }

    // SC2/C4. The other answer, so /discovery shows both in the demo: an
    // application that reported grants, and one whose connector has no
    // third-party grant concept at all. Without this the second state is
    // reachable only by auditing a real Slack workspace, and the vocabulary
    // would be a shape nothing renders.
    //
    // Guarded on its OWN content, and the early `return` above became an `if`
    // for that reason. Sharing the completed run's guard is SCL17 exactly —
    // measured here rather than reasoned about: the event never appeared on a
    // stack whose volume already carried the completed run, CI would have
    // passed on its fresh volume, and the seeder's own comment two lines up
    // warns about this shape.
    const unsupported = await tx.query(
      `SELECT 1 FROM discovery_events
       WHERE tenant_id = $1 AND source = $2 AND kind = 'token_audit_unsupported'
         AND payload ->> 'auditedAppKey' = $3
       LIMIT 1`,
      [tenantId, TOKEN_AUDIT_EVENT_SOURCE, SLACK_APP_KEY],
    );
    if (unsupported.rows.length === 0) {
      await recordTokenAudit(tx, tenantId, 'token_audit_unsupported', {
        runId: SEEDED_UNSUPPORTED_RUN_ID,
        auditedAppKey: SLACK_APP_KEY,
        capability: 'none',
      });
    }
  });
}

async function ensureIdentities(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
): Promise<Map<string, string>> {
  return withTenant(pool, tenantId, async (tx) => {
    const idByEmployeeId = new Map<string, string>();
    for (const identity of IDENTITIES) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO identities
           (tenant_id, employee_id, primary_email, secondary_emails, display_name, status, left_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
           primary_email = EXCLUDED.primary_email,
           secondary_emails = EXCLUDED.secondary_emails,
           display_name = EXCLUDED.display_name,
           status = EXCLUDED.status,
           left_at = EXCLUDED.left_at
         RETURNING id`,
        [
          tenantId,
          identity.employeeId,
          identity.primaryEmail,
          identity.secondaryEmails,
          identity.displayName,
          identity.status,
          identity.leftAt,
        ],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`seed: identities upsert returned no row for ${identity.employeeId}`);
      }
      idByEmployeeId.set(identity.employeeId, row.id);
    }
    return idByEmployeeId;
  });
}

async function ensureAccounts(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
  saasAppId: string,
  accounts: readonly SeedAccount[],
): Promise<Map<string, string>> {
  return withTenant(pool, tenantId, async (tx) => {
    const idByExternalId = new Map<string, string>();
    for (const account of accounts) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO saas_accounts
           (tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin, last_activity_at, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (tenant_id, saas_app_id, external_id) DO UPDATE SET
           email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           account_status = EXCLUDED.account_status,
           is_admin = EXCLUDED.is_admin,
           last_activity_at = EXCLUDED.last_activity_at,
           last_synced_at = now()
         RETURNING id`,
        [
          tenantId,
          saasAppId,
          account.externalId,
          account.email,
          account.displayName,
          account.accountStatus,
          account.isAdmin,
          account.lastActivityAt,
        ],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`seed: saas_accounts upsert returned no row for ${account.externalId}`);
      }
      idByExternalId.set(account.externalId, row.id);
    }
    return idByExternalId;
  });
}

async function computeAndPersistLinks(
  pool: ReturnType<typeof createPool>,
  tenantId: string,
  identityIdByEmployeeId: Map<string, string>,
  accountIdByExternalId: Map<string, string>,
  accounts: readonly SeedAccount[],
): Promise<{ orphan: number; ghost: number; matched: number; ambiguous: number }> {
  const identityViews: IdentityView[] = IDENTITIES.map((identity) => {
    const id = identityIdByEmployeeId.get(identity.employeeId);
    if (!id) {
      throw new Error(`seed: missing identity id for ${identity.employeeId}`);
    }
    return {
      id,
      primaryEmail: identity.primaryEmail,
      secondaryEmails: identity.secondaryEmails,
      displayName: identity.displayName,
      status: identity.status,
      leftAt: identity.leftAt,
    };
  });

  const accountViews: AccountView[] = accounts.map((account) => {
    const id = accountIdByExternalId.get(account.externalId);
    if (!id) {
      throw new Error(`seed: missing account id for ${account.externalId}`);
    }
    return {
      id,
      email: account.email,
      displayName: account.displayName,
      accountStatus: account.accountStatus,
    };
  });

  const links = matchAccounts(identityViews, accountViews, defaultRules);
  const computedAt = new Date();

  await withTenant(pool, tenantId, async (tx) => {
    for (const link of links) {
      await tx.query(
        `INSERT INTO account_links
           (tenant_id, saas_account_id, identity_id, status, confidence, rule_id, evidence, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, saas_account_id) DO UPDATE SET
           identity_id = EXCLUDED.identity_id,
           status = EXCLUDED.status,
           confidence = EXCLUDED.confidence,
           rule_id = EXCLUDED.rule_id,
           evidence = EXCLUDED.evidence,
           computed_at = EXCLUDED.computed_at`,
        [
          tenantId,
          link.saasAccountId,
          link.identityId,
          link.status,
          link.confidence,
          link.ruleId,
          link.evidence === null ? null : JSON.stringify(link.evidence),
          computedAt.toISOString(),
        ],
      );
    }
  });

  return {
    orphan: links.filter((link) => link.status === 'orphan').length,
    ghost: links.filter((link) => link.status === 'ghost').length,
    matched: links.filter((link) => link.status === 'matched').length,
    ambiguous: links.filter((link) => link.status === 'ambiguous').length,
  };
}

// The seed needs only DB access + encryption keys — not the API's full env
// (REDIS_URL, APP_ORIGIN, ...), so it parses its own minimal schema.
const seedEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEYS: z.string().min(1),
});

async function main(): Promise<void> {
  const env = seedEnvSchema.parse(process.env);
  const encryptionKeys = parseEncryptionKeys(env.ENCRYPTION_KEYS);
  const pool = createPool(env.DATABASE_URL);

  try {
    const tenantId = await ensureTenant(pool);
    await ensureAdminUser(pool, tenantId);
    const saasAppId = await ensureSaasApp(pool, tenantId, encryptionKeys);
    await ensureContract(pool, tenantId, saasAppId, SEEDED_CONTRACT);
    const contractOnlyAppId = await ensureContractOnlyApp(pool, tenantId);
    await ensureContract(pool, tenantId, contractOnlyAppId, CONTRACT_ONLY_CONTRACT);
    await ensureTokenAudit(pool, tenantId);
    const identityIdByEmployeeId = await ensureIdentities(pool, tenantId);
    const accountIdByExternalId = await ensureAccounts(pool, tenantId, saasAppId, ACCOUNTS);
    const counts = await computeAndPersistLinks(
      pool,
      tenantId,
      identityIdByEmployeeId,
      accountIdByExternalId,
      ACCOUNTS,
    );

    // The second account-bearing application. Its accounts run through the same
    // matcher against the same identities — they come out orphan because they
    // match nothing, not because anything special was done to them.
    const slackAppId = await ensureSlackApp(pool, tenantId, encryptionKeys);
    const slackAccountIds = await ensureAccounts(pool, tenantId, slackAppId, SLACK_ACCOUNTS);
    const slackCounts = await computeAndPersistLinks(
      pool,
      tenantId,
      identityIdByEmployeeId,
      slackAccountIds,
      SLACK_ACCOUNTS,
    );
    if (slackCounts.orphan !== SLACK_ACCOUNTS.length) {
      // Checked rather than assumed: the demo's claim is "a connected tool
      // nobody has reconciled", and a Slack account that MATCHED would make the
      // orphan set the specs assert by name silently smaller.
      throw new Error(
        `seed: expected every slack account to be an orphan, got ${JSON.stringify(slackCounts)}`,
      );
    }

    // C8 acceptance bar: the seeded demo must show >=1 orphan AND >=1 ghost.
    if (counts.orphan < 1 || counts.ghost < 1) {
      throw new Error(
        `seed: acceptance bar not met (orphan=${counts.orphan}, ghost=${counts.ghost}); ` +
          'expected >=1 of each',
      );
    }

    // C6's own bar, checked here rather than trusted: the demo exists to open
    // on an over-allocation, and `seats` is the only figure in this file that
    // can silently stop producing one. The account count is derived — a link
    // that stops resolving, or a fifth account, moves it without touching the
    // contract — so the comparison is made against the accounts that actually
    // landed rather than against the 4 this file expects.
    const assigned = accountIdByExternalId.size;
    if (SEEDED_CONTRACT.seats >= assigned) {
      throw new Error(
        `seed: acceptance bar not met (seats=${SEEDED_CONTRACT.seats}, assigned=${assigned}); ` +
          'the seeded contract must be over-allocated',
      );
    }

    console.log(
      `seed: tenant=${TENANT_SLUG} admin=${ADMIN_EMAIL} ` +
        `matched=${counts.matched} orphan=${counts.orphan} ghost=${counts.ghost} ambiguous=${counts.ambiguous} ` +
        `contracts=2 purchased=${SEEDED_CONTRACT.seats} assigned=${assigned}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed failed', error);
  process.exit(1);
});
