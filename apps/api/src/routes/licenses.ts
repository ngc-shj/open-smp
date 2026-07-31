import type { FastifyInstance } from 'fastify';
import { withTenant } from '@open-smp/schema';
import type { LicenseRollupItem } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { LIST_RATE_LIMIT } from '../rate-limits.js';

// The reconciliation, as one query, with ONE seat population that every term
// restricts. Revision 2 of the plan defined `assigned` with a sync watermark
// and left the reclaimable counts unfiltered; executed against the seeded
// tenant, that reports `assigned = 2` with `reclaimable = 2` and
// `needsReview = 1` — every assigned seat claimed reclaimable, and both
// reclaimable accounts ones the watermark had just declared gone. The counts
// are now `FILTER`s over the same CTE, so the partition holds by construction
// rather than by agreement between four subqueries.
//
// Why the watermark exists at all: `sync` is upsert-only and never reaps
// (apps/worker/src/sync.ts), so an account deleted upstream keeps
// `account_status = 'active'` forever. Without the clause `assigned`
// overcounts permanently, and it overcounts in the direction that HIDES
// waste, which is the one direction this feature must not be wrong in.
//
// `purchased`, `unit_price` and every other contract column are nullable: an
// application with accounts and no contract is the ordinary state on day one,
// and hiding it behind an INNER JOIN would hide the only application that has
// accounts until someone uploads a CSV row for it.
export const ROLLUP_SQL = `
  WITH seat AS (
    SELECT
      sa.saas_app_id,
      COALESCE(al.status::text, 'unlinked') AS link
    FROM saas_accounts sa
    LEFT JOIN account_links al ON al.saas_account_id = sa.id
    WHERE sa.account_status = 'active'
      AND sa.last_synced_at >= (
        SELECT max(x.last_synced_at) FROM saas_accounts x WHERE x.saas_app_id = sa.saas_app_id
      )
  )
  SELECT
    sap.key                                                     AS app_key,
    sap.display_name                                            AS app_name,
    (sap.credentials_enc IS NOT NULL)                           AS has_connector,
    c.plan_name,
    c.seats                                                     AS purchased,
    c.unit_price,
    c.currency,
    c.billing_cycle,
    c.term_start,
    c.term_end,
    count(seat.*)                                               AS assigned,
    count(seat.*) FILTER (WHERE seat.link = 'ghost')            AS ghost,
    count(seat.*) FILTER (WHERE seat.link = 'orphan')           AS orphan,
    count(seat.*) FILTER (WHERE seat.link = 'ambiguous')        AS needs_review,
    count(seat.*) FILTER (WHERE seat.link = 'unlinked')         AS unlinked,
    -- ::int is load-bearing. count() is bigint, int - bigint is bigint, and pg
    -- returns bigint as a STRING to avoid the precision loss a JS number would
    -- introduce -- so without the cast this field arrives as the string '-2'
    -- and RollupRow's declared number type is a lie the query generic cannot
    -- catch, because that generic is an unchecked assertion. The value is
    -- bounded by saas_contracts_seats_check, so int cannot overflow.
    CASE WHEN c.seats IS NULL THEN NULL ELSE (c.seats - count(seat.*))::int END AS unassigned,
    -- Computed in SQL as numeric. Doing it in JavaScript would re-introduce the
    -- float error numeric(14,2) exists to avoid, because pg hands the value
    -- over as a string.
    CASE WHEN c.unit_price IS NULL THEN NULL ELSE
      c.unit_price * count(seat.*) FILTER (WHERE seat.link IN ('ghost', 'orphan'))
    END                                                         AS reclaimable_value
  FROM saas_apps sap
  LEFT JOIN saas_contracts c ON c.saas_app_id = sap.id
  LEFT JOIN seat ON seat.saas_app_id = sap.id
  GROUP BY sap.id, sap.key, sap.display_name, sap.credentials_enc, c.plan_name, c.seats,
           c.unit_price, c.currency, c.billing_cycle, c.term_start, c.term_end
  ORDER BY sap.key
`;

type RollupRow = {
  app_key: string;
  app_name: string;
  has_connector: boolean;
  plan_name: string | null;
  purchased: number | null;
  // numeric arrives as a STRING from pg; passed through unchanged, because a
  // JSON number is an IEEE 754 double and would round it silently.
  unit_price: string | null;
  currency: string | null;
  billing_cycle: 'monthly' | 'annual' | null;
  term_start: string | null;
  term_end: string | null;
  assigned: string;
  ghost: string;
  orphan: string;
  needs_review: string;
  unlinked: string;
  unassigned: number | null;
  reclaimable_value: string | null;
};

export function toItem(row: RollupRow): LicenseRollupItem {
  const assigned = Number(row.assigned);
  const unlinked = Number(row.unlinked);
  const ghost = Number(row.ghost);
  const orphan = Number(row.orphan);
  // Three states, not a boolean. `assigned === 0` is NOT "not matched": an
  // application with no accounts has nothing to reclaim, and reporting it as
  // unmatched would suppress a correct zero. An application whose accounts are
  // only partly linked is the ordinary steady state, because sync and match are
  // separate jobs, and a per-account gap is invisible in a per-application flag.
  const matchState =
    assigned === 0 ? 'no-accounts' : unlinked === assigned ? 'not-matched' : unlinked > 0 ? 'partially-matched' : 'matched';

  return {
    appKey: row.app_key,
    appName: row.app_name,
    hasConnector: row.has_connector,
    matchState,
    planName: row.plan_name,
    unitPrice: row.unit_price,
    currency: row.currency,
    billingCycle: row.billing_cycle,
    termStart: row.term_start,
    termEnd: row.term_end,
    purchased: row.purchased,
    assigned,
    unassigned: row.unassigned,
    needsReview: Number(row.needs_review),
    unlinked,
    reclaimable: { ghost, orphan, total: ghost + orphan },
    reclaimableValue: row.reclaimable_value,
    reclaimableValuePeriod: row.reclaimable_value === null ? null : row.billing_cycle,
  };
}

export function registerLicensesRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get('/licenses', { config: { rateLimit: LIST_RATE_LIMIT } }, async (req, reply) => {
    const { tenantId } = req.sessionContext;
    const rows = await withTenant(deps.pool, tenantId, async (tx) => {
      const result = await tx.query<RollupRow>(ROLLUP_SQL);
      return result.rows;
    });
    // No cross-currency and no cross-cycle total. Adding 1000 JPY to 10 USD, or
    // a monthly figure to an annual one, is worse than a missing number because
    // it looks like an answer.
    return reply.code(200).send({ items: rows.map(toItem) });
  });
}
