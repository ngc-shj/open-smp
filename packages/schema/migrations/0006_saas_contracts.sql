-- Contract and licence data per SaaS application (C1).
-- See docs/archive/review/saas-license-cost-plan.md.

CREATE TYPE billing_cycle AS ENUM ('monthly', 'annual');

-- The composite foreign key below needs this. `id` is already the primary key,
-- so the pair is trivially unique and the constraint cannot fail on existing
-- rows; it exists only to give the FK a target that carries `tenant_id`.
ALTER TABLE saas_apps ADD CONSTRAINT saas_apps_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE saas_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  saas_app_id uuid NOT NULL,
  plan_name text,
  seats int,
  unit_price numeric(14, 2),
  currency text,
  billing_cycle billing_cycle,
  term_start date,
  term_end date,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT saas_contracts_tenant_id_saas_app_id_key UNIQUE (tenant_id, saas_app_id),

  -- COMPOSITE, not a single-column reference to saas_apps (id). Referential
  -- integrity checks run as the referenced table's OWNER and bypass RLS, so a
  -- single-column FK accepts a contract pointing at another tenant's
  -- application: the row's own tenant_id satisfies WITH CHECK while the FK
  -- check sees a row the same transaction cannot SELECT. Measured on 16.13.
  -- ON DELETE CASCADE because DELETE /saas-apps/:saasAppId pre-checks only
  -- saas_accounts and narrows its catch to that one constraint name, so any
  -- other FK violation surfaces as a 500 on a contract-only application.
  CONSTRAINT saas_contracts_tenant_id_saas_app_id_fkey
    FOREIGN KEY (tenant_id, saas_app_id) REFERENCES saas_apps (tenant_id, id) ON DELETE CASCADE,

  CONSTRAINT saas_contracts_seats_check CHECK (seats >= 0 AND seats <= 10000000),

  -- `unit_price = unit_price` does NOT exclude NaN: Postgres defines NaN = NaN
  -- as true for `numeric` (unlike IEEE floats) so the type can be sorted and
  -- indexed, and 'NaN' >= 0 is also true. Measured: the self-equality form
  -- stores NaN. `<> 'NaN'::numeric` rejects it (23514) and accepts 0.00,
  -- 10.00 and 999999999999.99.
  CONSTRAINT saas_contracts_unit_price_check
    CHECK (unit_price >= 0 AND unit_price <> 'NaN'::numeric),

  -- Named explicitly. Postgres names a multi-column CHECK positionally
  -- (`saas_contracts_check`, then `_check1`), so an assertion on the generated
  -- name would move when an unrelated CHECK is added later.
  CONSTRAINT saas_contracts_term_order_check
    CHECK (term_end IS NULL OR term_start IS NULL OR term_end >= term_start),

  CONSTRAINT saas_contracts_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT saas_contracts_plan_name_check
    CHECK (plan_name IS NULL OR char_length(plan_name) <= 200),
  CONSTRAINT saas_contracts_note_check CHECK (note IS NULL OR char_length(note) <= 500)
);

ALTER TABLE saas_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_contracts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- DELETE is granted for consistency with every other mutable member table: the
-- RLS sweep classifies members as append-only or mutable and runs the
-- UPDATE/DELETE matrices over the latter, so withholding DELETE would need a
-- third category rather than saving a privilege. No contract issues a DELETE
-- today, and the ON DELETE CASCADE above needs no grant at all (RI actions run
-- as the table owner) — recorded so the next reader knows the privilege is
-- deliberate and unused rather than overlooked.
GRANT SELECT, INSERT, UPDATE, DELETE ON saas_contracts TO opensmp_app;
