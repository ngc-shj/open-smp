-- Manual account labeling: known_shared / service_account / external_collaborator.
-- See docs/archive/review/import-labeling-saasapp-ui-plan.md, contract C10.

CREATE TYPE account_label_kind AS ENUM ('known_shared', 'service_account', 'external_collaborator');

CREATE TABLE account_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  saas_account_id uuid NOT NULL REFERENCES saas_accounts (id) ON DELETE CASCADE,
  kind account_label_kind NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, saas_account_id)
);

ALTER TABLE account_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON account_labels
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON account_labels TO opensmp_app;
