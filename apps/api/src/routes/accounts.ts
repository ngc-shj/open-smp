import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { AccountListItem } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { LIST_RATE_LIMIT } from '../rate-limits.js';
import { PAGE_SIZE } from '../page-size.js';
import { LABEL_FILTERS } from '../label-kinds.js';

const LINK_STATUSES = ['matched', 'orphan', 'ghost', 'ambiguous'] as const;

// 'none' and 'any' let an operator ask "what have I not triaged yet" without a
// second endpoint; both are predicates on the account_labels LEFT JOIN the
// query already performs, so neither costs an extra round trip.
const accountsQuerySchema = z
  .object({
    status: z.enum(LINK_STATUSES).optional(),
    app: z.string().min(1).optional(),
    label: z.enum(LABEL_FILTERS).optional(),
    cursor: z.string().uuid().optional(),
  })
  .strict();


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
  // Postgres returns numeric(3,2) as a STRING (the pg driver avoids float
  // precision loss), so this is a string at runtime, not a number — it MUST be
  // coerced with Number() before reaching the API shape, or the UI's
  // confidence.toFixed() throws.
  link_confidence: string | null;
  link_rule_id: string | null;
  link_identity_id: string | null;
  link_identity_name: string | null;
  link_evidence: unknown;
  label_kind: string | null;
  label_note: string | null;
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
            confidence: row.link_confidence === null ? 0 : Number(row.link_confidence),
            ruleId: row.link_rule_id,
            identityId: row.link_identity_id,
            // NULL whenever identity_id IS NULL (orphan/ambiguous), via the
            // LEFT JOIN to identities.display_name — C1 consumer-flow walkthrough.
            identityName: row.link_identity_name,
            evidence: (row.link_evidence as NonNullable<AccountListItem['link']>['evidence']) ?? null,
          },
    label:
      row.label_kind === null
        ? null
        : { kind: row.label_kind as NonNullable<AccountListItem['label']>['kind'], note: row.label_note },
  };
}

export function registerAccountsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    '/accounts',
    { config: { rateLimit: LIST_RATE_LIMIT } },
    async (req, reply) => {
      const parsedQuery = accountsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({ error: 'invalid_query' });
      }
      const { status, app: appKey, label, cursor } = parsedQuery.data;
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
      // Predicates over the account_labels LEFT JOIN the query already
      // performs, so filtering adds no round trip — and nextCursor is derived
      // from the filtered row set by construction rather than by care.
      if (label === 'none') {
        conditions.push('lbl.kind IS NULL');
      } else if (label === 'any') {
        conditions.push('lbl.kind IS NOT NULL');
      } else if (label !== undefined) {
        values.push(label);
        conditions.push(`lbl.kind = $${values.length}`);
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
             al.evidence AS link_evidence,
             lbl.kind AS label_kind,
             lbl.note AS label_note
           FROM saas_accounts sa
           JOIN saas_apps sap ON sap.id = sa.saas_app_id
           LEFT JOIN account_links al ON al.saas_account_id = sa.id
           LEFT JOIN identities ident ON ident.id = al.identity_id
           LEFT JOIN account_labels lbl ON lbl.saas_account_id = sa.id
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
