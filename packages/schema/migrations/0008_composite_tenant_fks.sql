-- SCL10. Referential-integrity checks run as the REFERENCED table's owner and
-- bypass RLS, so a single-column foreign key accepts a child row pointing at
-- another tenant's parent: the row's own tenant_id satisfies WITH CHECK while
-- the RI check sees a row the same transaction cannot SELECT. Measured on 16.
--
-- C1 closed this for saas_contracts by declaring its FK composite against a
-- UNIQUE (tenant_id, id) on the parent. This does the same for every other one.
--
-- THE MEMBER SET IS DERIVED, and deriving it is what found the recorded list was
-- short. SCL10 named four FKs and said "derive the member set from pg_constraint,
-- not from this list"; the catalog returns SIX. The two the list omitted are
-- both on account_labels, added a cycle after the entry was written — which is
-- the whole reason the entry said not to trust itself.

-- Parents need a key the composite FK can reference. saas_apps already carries
-- one (migration 0006). `id` is already the primary key in each case, so the
-- pair is trivially unique and cannot fail on existing rows; the constraint
-- exists only to give the FK a target that carries tenant_id.
ALTER TABLE users ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE identities ADD CONSTRAINT identities_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE saas_accounts ADD CONSTRAINT saas_accounts_tenant_id_id_key UNIQUE (tenant_id, id);

-- Each FK is re-declared explicitly rather than regenerated in a loop, because
-- the ON DELETE actions differ and one of them needs a column list. Preserving
-- them exactly is the point: this migration changes WHICH rows may be
-- referenced, and nothing about what happens when a parent goes away.
--
-- MATCH SIMPLE (the default) is what makes a nullable reference still work: a
-- composite key with any NULL column is not checked, so account_links rows with
-- identity_id IS NULL — every orphan and ambiguous link — behave as before.

ALTER TABLE saas_accounts DROP CONSTRAINT saas_accounts_saas_app_id_fkey;
ALTER TABLE saas_accounts ADD CONSTRAINT saas_accounts_saas_app_id_fkey
  FOREIGN KEY (tenant_id, saas_app_id) REFERENCES saas_apps (tenant_id, id);

ALTER TABLE account_links DROP CONSTRAINT account_links_saas_account_id_fkey;
ALTER TABLE account_links ADD CONSTRAINT account_links_saas_account_id_fkey
  FOREIGN KEY (tenant_id, saas_account_id) REFERENCES saas_accounts (tenant_id, id);

ALTER TABLE account_links DROP CONSTRAINT account_links_identity_id_fkey;
ALTER TABLE account_links ADD CONSTRAINT account_links_identity_id_fkey
  FOREIGN KEY (tenant_id, identity_id) REFERENCES identities (tenant_id, id);

ALTER TABLE sessions DROP CONSTRAINT sessions_user_id_fkey;
ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_fkey
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id);

ALTER TABLE account_labels DROP CONSTRAINT account_labels_saas_account_id_fkey;
ALTER TABLE account_labels ADD CONSTRAINT account_labels_saas_account_id_fkey
  FOREIGN KEY (tenant_id, saas_account_id) REFERENCES saas_accounts (tenant_id, id)
  ON DELETE CASCADE;

-- The one that needs the column list. A plain ON DELETE SET NULL would try to
-- null tenant_id as well, which is NOT NULL — so the composite form is only
-- possible because PostgreSQL 15 added `SET NULL (column)`. Measured on 16.13:
-- deleting the parent nulls created_by and leaves tenant_id standing.
ALTER TABLE account_labels DROP CONSTRAINT account_labels_created_by_fkey;
ALTER TABLE account_labels ADD CONSTRAINT account_labels_created_by_fkey
  FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id)
  ON DELETE SET NULL (created_by);

-- The migration checks its own work, from the catalog, because the list above
-- is a list and this is the part that cannot be. A foreign key between two
-- tenant-scoped tables that does not carry tenant_id into the reference is one
-- the RI check can satisfy across tenants.
DO $$
DECLARE remaining text;
BEGIN
  SELECT string_agg(c.conname, ', ') INTO remaining
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
   WHERE c.contype = 'f'
     AND src.relnamespace = 'public'::regnamespace
     AND cardinality(c.conkey) = 1
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attname = 'tenant_id' AND a.attnum > 0)
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.confrelid AND a.attname = 'tenant_id' AND a.attnum > 0);

  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'single-column foreign keys still accept cross-tenant references: %', remaining;
  END IF;
END
$$;
