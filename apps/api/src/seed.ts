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
import { parseEnv } from './env.js';
import { ARGON2ID_OPTIONS } from './auth.js';

// Demo credentials are duplicated as a raw curl payload in
// .github/workflows/ci.yml (compose-smoke) — YAML cannot import these
// constants, so keep both sites in sync when changing any of them.
const TENANT_SLUG = 'demo';
const TENANT_NAME = 'Demo Corp';
const ADMIN_EMAIL = 'admin@demo.example';
const ADMIN_PASSWORD = 'demo-admin-password';
const SAAS_APP_KEY = 'google-workspace';
const SAAS_APP_DISPLAY_NAME = 'Google Workspace';

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
): Promise<Map<string, string>> {
  return withTenant(pool, tenantId, async (tx) => {
    const idByExternalId = new Map<string, string>();
    for (const account of ACCOUNTS) {
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

  const accountViews: AccountView[] = ACCOUNTS.map((account) => {
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

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const encryptionKeys = parseEncryptionKeys(env.ENCRYPTION_KEYS);
  const pool = createPool(env.DATABASE_URL);

  try {
    const tenantId = await ensureTenant(pool);
    await ensureAdminUser(pool, tenantId);
    const saasAppId = await ensureSaasApp(pool, tenantId, encryptionKeys);
    const identityIdByEmployeeId = await ensureIdentities(pool, tenantId);
    const accountIdByExternalId = await ensureAccounts(pool, tenantId, saasAppId);
    const counts = await computeAndPersistLinks(
      pool,
      tenantId,
      identityIdByEmployeeId,
      accountIdByExternalId,
    );

    // C8 acceptance bar: the seeded demo must show >=1 orphan AND >=1 ghost.
    if (counts.orphan < 1 || counts.ghost < 1) {
      throw new Error(
        `seed: acceptance bar not met (orphan=${counts.orphan}, ghost=${counts.ghost}); ` +
          'expected >=1 of each',
      );
    }

    console.log(
      `seed: tenant=${TENANT_SLUG} admin=${ADMIN_EMAIL} ` +
        `matched=${counts.matched} orphan=${counts.orphan} ghost=${counts.ghost} ambiguous=${counts.ambiguous}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed failed', error);
  process.exit(1);
});
