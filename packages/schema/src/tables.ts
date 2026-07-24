// Drizzle table definitions mirroring migrations/0001_init.sql (query building only;
// constraints/RLS/grants are the SQL migration's responsibility, not Drizzle's).
import {
  boolean,
  check,
  customType,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});

export const identityStatusEnum = pgEnum('identity_status', ['active', 'left']);
export const linkStatusEnum = pgEnum('link_status', [
  'matched',
  'orphan',
  'ghost',
  'ambiguous',
]);
export const accountStatusEnum = pgEnum('account_status', [
  'active',
  'suspended',
  'archived',
]);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const identities = pgTable(
  'identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: text('employee_id').notNull(),
    primaryEmail: text('primary_email').notNull(),
    secondaryEmails: text('secondary_emails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    displayName: text('display_name').notNull(),
    status: identityStatusEnum('status').notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    unique('identities_tenant_id_employee_id_key').on(table.tenantId, table.employeeId),
    check(
      'identities_status_left_at_check',
      sql`(${table.status} = 'left') = (${table.leftAt} IS NOT NULL)`,
    ),
  ],
);

export const saasApps = pgTable(
  'saas_apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    credentialsEnc: bytea('credentials_enc'),
    credentialsKeyVersion: integer('credentials_key_version').notNull().default(1),
  },
  (table) => [unique('saas_apps_tenant_id_key_key').on(table.tenantId, table.key)],
);

export const saasAccounts = pgTable(
  'saas_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    saasAppId: uuid('saas_app_id')
      .notNull()
      .references(() => saasApps.id),
    externalId: text('external_id').notNull(),
    email: text('email'),
    displayName: text('display_name'),
    accountStatus: accountStatusEnum('account_status').notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('saas_accounts_tenant_id_saas_app_id_external_id_key').on(
      table.tenantId,
      table.saasAppId,
      table.externalId,
    ),
  ],
);

export const accountLinks = pgTable(
  'account_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    saasAccountId: uuid('saas_account_id')
      .notNull()
      .references(() => saasAccounts.id),
    identityId: uuid('identity_id').references(() => identities.id),
    status: linkStatusEnum('status').notNull(),
    confidence: numeric('confidence', { mode: 'number', precision: 3, scale: 2 }).notNull(),
    ruleId: text('rule_id'),
    evidence: jsonb('evidence'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('account_links_tenant_id_saas_account_id_key').on(
      table.tenantId,
      table.saasAccountId,
    ),
    check('account_links_confidence_check', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check(
      'account_links_status_identity_id_check',
      sql`(${table.status} IN ('orphan', 'ambiguous')) = (${table.identityId} IS NULL)`,
    ),
  ],
);

export const discoveryEvents = pgTable('discovery_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  source: text('source').notNull(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('users_tenant_id_email_key').on(table.tenantId, table.email)],
);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tenantId: uuid('tenant_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Tenant-scoped tables subject to RLS (the 7-table member set from C1; excludes `tenants`). */
export const tenantScopedTables = {
  identities,
  saasApps,
  saasAccounts,
  accountLinks,
  discoveryEvents,
  users,
  sessions,
} as const;
