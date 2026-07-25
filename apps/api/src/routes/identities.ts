import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { IdentityDetailResponse, IdentityAccountItem } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { LIST_RATE_LIMIT } from '../rate-limits.js';
import { PAGE_SIZE } from '../page-size.js';

const paramsSchema = z.object({ identityId: z.string().uuid() }).strict();

type IdentityRow = {
  id: string;
  employee_id: string;
  primary_email: string;
  secondary_emails: string[];
  display_name: string;
  status: string;
  left_at: string | null;
};

type AccountRow = {
  account_id: string;
  app_key: string;
  app_name: string;
  email: string | null;
  display_name: string | null;
  account_status: string;
  is_admin: boolean;
  last_activity_at: string | null;
  link_status: string;
  // numeric(3,2) arrives from the pg driver as a STRING (it avoids float
  // precision loss), so this MUST be coerced before it reaches the API shape
  // or the UI's confidence.toFixed() throws — same hazard as accounts.ts.
  link_confidence: string;
  label_kind: string | null;
  label_note: string | null;
};

function toAccountItem(row: AccountRow): IdentityAccountItem {
  return {
    accountId: row.account_id,
    appKey: row.app_key,
    appName: row.app_name,
    email: row.email,
    displayName: row.display_name,
    accountStatus: row.account_status,
    isAdmin: row.is_admin,
    lastActivityAt: row.last_activity_at,
    linkStatus: row.link_status,
    confidence: Number(row.link_confidence),
    label:
      row.label_kind === null
        ? null
        : {
            kind: row.label_kind as NonNullable<IdentityAccountItem['label']>['kind'],
            note: row.label_note,
          },
  };
}

export function registerIdentitiesRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    '/identities/:identityId',
    { config: { rateLimit: LIST_RATE_LIMIT } },
    async (req, reply) => {
      const parsedParams = paramsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }
      const { identityId } = parsedParams.data;
      const { tenantId } = req.sessionContext;

      const result = await withTenant(deps.pool, tenantId, async (tx) => {
        const identity = await tx.query<IdentityRow>(
          `SELECT id, employee_id, primary_email, secondary_emails, display_name, status, left_at
           FROM identities
           WHERE id = $1`,
          [identityId],
        );
        const identityRow = identity.rows[0];
        if (!identityRow) {
          // RLS hides other tenants' rows, so a foreign uuid lands here too —
          // the handler must not distinguish "wrong tenant" from "absent".
          return null;
        }

        // Driven FROM account_links, not from saas_accounts with a LEFT JOIN
        // (the shape accounts.ts uses). That is what makes linkStatus and
        // confidence non-nullable in IdentityAccountItem: an account without a
        // link row simply is not attributed to this identity. Fetch one extra
        // row to detect truncation without a second count query.
        const accounts = await tx.query<AccountRow>(
          `SELECT
             sa.id AS account_id,
             sap.key AS app_key,
             sap.display_name AS app_name,
             sa.email,
             sa.display_name,
             sa.account_status,
             sa.is_admin,
             sa.last_activity_at,
             al.status AS link_status,
             al.confidence AS link_confidence,
             lbl.kind AS label_kind,
             lbl.note AS label_note
           FROM account_links al
           JOIN saas_accounts sa ON sa.id = al.saas_account_id
           JOIN saas_apps sap ON sap.id = sa.saas_app_id
           LEFT JOIN account_labels lbl ON lbl.saas_account_id = sa.id
           WHERE al.identity_id = $1
           ORDER BY sa.id
           LIMIT $2`,
          [identityId, PAGE_SIZE + 1],
        );

        return { identityRow, accountRows: accounts.rows };
      });

      if (!result) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const { identityRow, accountRows } = result;
      const accountsTruncated = accountRows.length > PAGE_SIZE;
      const pageRows = accountsTruncated ? accountRows.slice(0, PAGE_SIZE) : accountRows;

      const body: IdentityDetailResponse = {
        identityId: identityRow.id,
        employeeId: identityRow.employee_id,
        primaryEmail: identityRow.primary_email,
        secondaryEmails: identityRow.secondary_emails,
        displayName: identityRow.display_name,
        status: identityRow.status as IdentityDetailResponse['status'],
        leftAt: identityRow.left_at,
        accounts: pageRows.map(toAccountItem),
        accountsTruncated,
      };
      return reply.code(200).send(body);
    },
  );
}
