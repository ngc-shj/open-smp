-- open-smp initial schema: enums, tables, constraints, RLS.
-- See docs/archive/review/mvp-account-matching-plan.md, contract C1.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE identity_status AS ENUM ('active', 'left');
CREATE TYPE link_status AS ENUM ('matched', 'orphan', 'ghost', 'ambiguous');
CREATE TYPE account_status AS ENUM ('active', 'suspended', 'archived');

-- Root table: no tenant_id, no RLS (protected by C7 authz instead).
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id text NOT NULL,
  primary_email text NOT NULL,
  secondary_emails text[] NOT NULL DEFAULT '{}',
  display_name text NOT NULL,
  status identity_status NOT NULL,
  left_at timestamptz,
  UNIQUE (tenant_id, employee_id),
  CHECK ((status = 'left') = (left_at IS NOT NULL))
);

CREATE TABLE saas_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  display_name text NOT NULL,
  credentials_enc bytea,
  credentials_key_version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, key)
);

CREATE TABLE saas_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  saas_app_id uuid NOT NULL REFERENCES saas_apps (id),
  external_id text NOT NULL,
  email text,
  display_name text,
  account_status account_status NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  last_activity_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, saas_app_id, external_id)
);

CREATE TABLE account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  saas_account_id uuid NOT NULL REFERENCES saas_accounts (id),
  identity_id uuid REFERENCES identities (id),
  status link_status NOT NULL,
  confidence numeric(3, 2) NOT NULL,
  rule_id text,
  evidence jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, saas_account_id),
  CHECK (confidence >= 0 AND confidence <= 1),
  CHECK ((status IN ('orphan', 'ambiguous')) = (identity_id IS NULL))
);

CREATE TABLE discovery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  tenant_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Row-level security: one tenant policy per tenant-scoped table.
-- Every policy defines BOTH USING and WITH CHECK so cross-tenant INSERT
-- cannot slip through a read-only predicate (C1 invariant).

ALTER TABLE identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON identities
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE saas_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_apps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_apps
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE saas_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_accounts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON account_links
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE discovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON discovery_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Application role: the app connects as this role, never as a superuser,
-- and it is never granted a RLS bypass. Password is a dev-only default;
-- production deployments MUST override it (e.g. via ALTER ROLE post-deploy
-- or a separately managed secret), never rely on this migration's value.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opensmp_app') THEN
    CREATE ROLE opensmp_app WITH LOGIN PASSWORD 'opensmp';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO opensmp_app;

GRANT SELECT, INSERT ON tenants TO opensmp_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  identities,
  saas_apps,
  saas_accounts,
  account_links,
  discovery_events,
  users,
  sessions
TO opensmp_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO opensmp_app;
