-- SCL8. Moves the tenant identity out of a GUC the application's own role can
-- re-point, and into a table it holds no privilege on.
-- See docs/archive/review/tenant-context-pinning-plan.md.
--
-- WHY NOT KEEP THE GUC AND REVOKE IT. Measured on 16: Postgres does not gate
-- CUSTOMIZED (placeholder) options through GRANT SET ON PARAMETER. Both
-- `REVOKE SET ON PARAMETER app.tenant_id FROM opensmp_app` and the same
-- `FROM PUBLIC` are accepted and enforce nothing — the role still calls
-- set_config and every RLS predicate follows it, mid transaction, measured as
-- a visible row count going 2 -> 0. Table privileges ARE enforced, which is the
-- whole basis of this migration.

CREATE TABLE tenant_context (
  -- Keyed by backend, holding the transaction that claimed it. A row survives
  -- its transaction and is overwritten by the next one on the same backend;
  -- what makes it safe is that `xid` must match for the row to mean anything.
  pid int PRIMARY KEY,
  -- xid8, not xid: 64-bit and non-wrapping. A wrapped xid could make a stale
  -- row from a dead backend read as the current transaction's, which is a
  -- cross-tenant false accept — the one failure this table must not have.
  xid xid8 NOT NULL,
  tenant_id uuid NOT NULL
);

-- No grant to opensmp_app, ever. Nothing below adds one, and
-- rls.integration.test.ts asserts every one of INSERT/UPDATE/SELECT is denied.
-- The REVOKE is belt-and-braces — a new table grants PUBLIC nothing — and it is
-- here so the intent is stated where the next reader of this file will look.
REVOKE ALL ON tenant_context FROM PUBLIC;

/*
 * Claims the tenant for this transaction. Write-once: the ON CONFLICT arm
 * updates only when the stored xid belongs to a DIFFERENT transaction, so a
 * second call inside one transaction updates no row, `FOUND` is false, and the
 * call raises.
 *
 * That single predicate is the control this migration exists for. An injected
 * `SELECT set_tenant_context('<other tenant>')` cannot re-point the session,
 * and there is no other way in — the table is unreachable to the caller.
 *
 * SET search_path is not decoration. A SECURITY DEFINER function without it
 * resolves `tenant_context` through the CALLER's path, and pg_temp is searched
 * first when it is not named — so a caller could plant a temp table of that
 * name and have this function write there instead. pg_temp is named last.
 */
CREATE FUNCTION set_tenant_context(v uuid) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO tenant_context (pid, xid, tenant_id)
  VALUES (pg_backend_pid(), pg_current_xact_id(), v)
  ON CONFLICT (pid) DO UPDATE
    SET xid = EXCLUDED.xid, tenant_id = EXCLUDED.tenant_id
    WHERE tenant_context.xid <> pg_current_xact_id();

  IF NOT FOUND THEN
    -- 42501 (insufficient_privilege) rather than a generic error: this is a
    -- refusal, not a fault, and the caller that sees it is an injected
    -- statement rather than a route.
    RAISE EXCEPTION 'tenant context is already set for this transaction'
      USING ERRCODE = '42501';
  END IF;
END
$$;

/*
 * The tenant this transaction claimed, or NULL when it claimed none — which
 * every policy below compares as false, so an unclaimed transaction reads
 * nothing. That is the same fail-closed behaviour the GUC form had for a
 * missing setting, and the RLS sweep's no-context matrix still asserts it.
 *
 * STABLE, and it matters: an RLS predicate is evaluated per row, and a VOLATILE
 * reader would run this query once per row instead of once per statement.
 */
CREATE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT tenant_id FROM tenant_context
   WHERE pid = pg_backend_pid() AND xid = pg_current_xact_id()
$$;

REVOKE ALL ON FUNCTION set_tenant_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_tenant_context(uuid) TO opensmp_app;
GRANT EXECUTE ON FUNCTION current_tenant_id() TO opensmp_app;

-- Every tenant_isolation policy moves together, and the member set is DERIVED
-- from pg_policies rather than listed. A list is what leaves one table behind,
-- and a table left on the GUC is a table still re-pointable — invisible,
-- because the sweep's per-table matrices answer correctly under either
-- predicate for a well-behaved transaction. MEMBER_TABLES is hand-kept (SCL9),
-- so it cannot be the authority here.
DO $$
DECLARE
  policy record;
  moved int := 0;
BEGIN
  FOR policy IN
    SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'tenant_isolation'
  LOOP
    EXECUTE format(
      'ALTER POLICY tenant_isolation ON %I.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      policy.schemaname, policy.tablename);
    moved := moved + 1;
  END LOOP;

  -- Anti-vacuity. A loop over an empty set would leave every policy on the GUC
  -- and report success, which is the shape this repository has now recorded
  -- eighteen instances of.
  IF moved = 0 THEN
    RAISE EXCEPTION 'no tenant_isolation policy was found to move';
  END IF;
  RAISE NOTICE 'tenant_context: moved % tenant_isolation policies off the GUC', moved;
END
$$;

-- And the migration checks its own work, because the alternative is finding out
-- from a cross-tenant read.
DO $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining
    FROM pg_policies
   WHERE policyname = 'tenant_isolation'
     AND (coalesce(qual, '') LIKE '%current_setting%' OR coalesce(with_check, '') LIKE '%current_setting%');
  IF remaining <> 0 THEN
    RAISE EXCEPTION '% tenant_isolation policies still read app.tenant_id', remaining;
  END IF;
END
$$;
