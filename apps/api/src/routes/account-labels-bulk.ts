import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { AccountLabelKind } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { MUTATION_RATE_LIMIT } from '../rate-limits.js';
import { noteSchema } from '../label-note.js';
import { LABEL_KINDS } from '../label-kinds.js';
import { recordLabelAuditBatch, type LabelAuditPayload } from '../audit.js';


// 100 bounds the work per request; uniqueness at the schema level means the
// reported `updated` count can never disagree with the input length.
const MAX_BULK_ACCOUNTS = 100;

const bulkBodySchema = z
  .object({
    accountIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_BULK_ACCOUNTS)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'accountIds must be unique' }),
    kind: z.enum(LABEL_KINDS),
    note: noteSchema,
  })
  .strict();

export function registerAccountLabelsBulkRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/accounts/labels/bulk',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const parsed = bulkBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const { accountIds, kind, note } = parsed.data;
      const { tenantId, userId } = req.sessionContext;

      const outcome = await withTenant(deps.pool, tenantId, async (tx) => {
        // Verify ownership and existence in one statement. RLS scopes this to
        // the caller's tenant, so a foreign id is indistinguishable from an
        // absent one — deliberately, since distinguishing them would be a
        // cross-tenant probing oracle.
        const found = await tx.query<{ id: string }>(
          'SELECT id FROM saas_accounts WHERE id = ANY($1::uuid[])',
          [accountIds],
        );
        const foundIds = new Set(found.rows.map((row) => row.id));
        const missing = accountIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          // All-or-nothing: returning early inside the transaction means no
          // label and no audit row is written for the ids that did exist. A
          // partially applied bulk operation with a partial audit trail is the
          // failure this closes.
          return { missing };
        }

        // Set-based rather than a per-id loop: 100 ids would otherwise mean
        // ~300 statements per request at 60 req/min. The unnest form also makes
        // the all-or-nothing property structural instead of loop-preserved.
        const priorRows = await tx.query<{
          saas_account_id: string;
          kind: AccountLabelKind;
          note: string | null;
        }>(
          `SELECT saas_account_id, kind, note FROM account_labels
           WHERE tenant_id = $1 AND saas_account_id = ANY($2::uuid[])`,
          [tenantId, accountIds],
        );
        const prior = new Map(priorRows.rows.map((row) => [row.saas_account_id, row]));

        await tx.query(
          `INSERT INTO account_labels (tenant_id, saas_account_id, kind, note, created_by)
           SELECT $1, account_id, $3, $4, $5
           FROM unnest($2::uuid[]) AS account_id
           ON CONFLICT (tenant_id, saas_account_id)
           DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note, updated_at = now()`,
          [tenantId, accountIds, kind, note ?? null, userId],
        );

        // One audit row per account, not one per request: an operator
        // suppressing 50 accounts in a click must leave 50 traces, and a single
        // "bulk" record would erase every per-account before-state.
        const payloads: LabelAuditPayload[] = accountIds.map((accountId) => {
          const before = prior.get(accountId);
          return {
            actorUserId: userId,
            saasAccountId: accountId,
            before: before ? { kind: before.kind, note: before.note } : null,
            after: { kind, note: note ?? null },
          };
        });

        await recordLabelAuditBatch(tx, tenantId, 'label_set', payloads);

        return { updated: accountIds.length };
      });

      if ('missing' in outcome) {
        return reply.code(404).send({ error: 'not_found', missing: outcome.missing });
      }

      return reply.code(200).send({ updated: outcome.updated });
    },
  );
}
