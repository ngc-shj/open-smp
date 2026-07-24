import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { AppDeps } from '../deps.js';

const LINK_STATUSES = ['matched', 'orphan', 'ghost', 'ambiguous'] as const;

const accountsQuerySchema = z
  .object({
    status: z.enum(LINK_STATUSES).optional(),
    app: z.string().min(1).optional(),
    cursor: z.string().uuid().optional(),
  })
  .strict();

const PAGE_SIZE = 50;

type AccountRow = {
  account_id: string;
  app_key: string;
  app_name: string;
  email: string | null;
  display_name: string | null;
  account_status: string;
  is_admin: boolean;
  last_activity_at: string | null;
  last_synced_at: string;
  link_status: string | null;
  link_confidence: number | null;
  link_rule_id: string | null;
  link_identity_id: string | null;
  link_identity_name: string | null;
  link_evidence: unknown;
};

type AccountListItem = {
  accountId: string;
  appKey: string;
  appName: string;
  email: string | null;
  displayName: string | null;
  accountStatus: string;
  isAdmin: boolean;
  lastActivityAt: string | null;
  lastSyncedAt: string;
  link: {
    status: string;
    confidence: number;
    ruleId: string | null;
    identityId: string | null;
    identityName: string | null;
    evidence: object | null;
  } | null;
};

function toListItem(row: AccountRow): AccountListItem {
  return {
    accountId: row.account_id,
    appKey: row.app_key,
    appName: row.app_name,
    email: row.email,
    displayName: row.display_name,
    accountStatus: row.account_status,
    isAdmin: row.is_admin,
    lastActivityAt: row.last_activity_at,
    lastSyncedAt: row.last_synced_at,
    // No link row yet -> link: null (accounts not yet matched).
    link:
      row.link_status === null
        ? null
        : {
            status: row.link_status,
            confidence: row.link_confidence ?? 0,
            ruleId: row.link_rule_id,
            identityId: row.link_identity_id,
            // NULL whenever identity_id IS NULL (orphan/ambiguous), via the
            // LEFT JOIN to identities.display_name — C1 consumer-flow walkthrough.
            identityName: row.link_identity_name,
            evidence: (row.link_evidence as object | null) ?? null,
          },
  };
}

export function registerAccountsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    '/accounts',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsedQuery = accountsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({ error: 'invalid_query' });
      }
      const { status, app: appKey, cursor } = parsedQuery.data;
      const { tenantId } = req.sessionContext;

      const conditions: string[] = ['sa.tenant_id = $1'];
      const values: unknown[] = [tenantId];

      if (status) {
        values.push(status);
        conditions.push(`al.status = $${values.length}`);
      }
      if (appKey) {
        values.push(appKey);
        conditions.push(`sap.key = $${values.length}`);
      }
      if (cursor) {
        values.push(cursor);
        conditions.push(`sa.id > $${values.length}`);
      }

      values.push(PAGE_SIZE + 1);
      const limitPlaceholder = `$${values.length}`;

      const rows = await withTenant(deps.pool, tenantId, async (tx) => {
        const result = await tx.query<AccountRow>(
          `SELECT
             sa.id AS account_id,
             sap.key AS app_key,
             sap.display_name AS app_name,
             sa.email,
             sa.display_name,
             sa.account_status,
             sa.is_admin,
             sa.last_activity_at,
             sa.last_synced_at,
             al.status AS link_status,
             al.confidence AS link_confidence,
             al.rule_id AS link_rule_id,
             al.identity_id AS link_identity_id,
             ident.display_name AS link_identity_name,
             al.evidence AS link_evidence
           FROM saas_accounts sa
           JOIN saas_apps sap ON sap.id = sa.saas_app_id
           LEFT JOIN account_links al ON al.saas_account_id = sa.id
           LEFT JOIN identities ident ON ident.id = al.identity_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY sa.id
           LIMIT ${limitPlaceholder}`,
          values,
        );
        return result.rows;
      });

      const hasMore = rows.length > PAGE_SIZE;
      const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
      const lastRow = pageRows.at(-1);
      const nextCursor = hasMore && lastRow ? lastRow.account_id : null;

      return reply.code(200).send({
        items: pageRows.map(toListItem),
        nextCursor,
      });
    },
  );
}
