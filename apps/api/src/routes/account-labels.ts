import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { AccountLabelResponse } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { MUTATION_RATE_LIMIT } from '../rate-limits.js';
import { noteSchema } from '../label-note.js';
import { LABEL_KINDS } from '../label-kinds.js';
import { recordLabelAudit, type LabelAuditSnapshot } from '../audit.js';


const paramsSchema = z
  .object({
    saasAccountId: z.string().uuid(),
  })
  .strict();

const putBodySchema = z
  .object({
    kind: z.enum(LABEL_KINDS),
    note: noteSchema,
  })
  .strict();

export function registerAccountLabelsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.put(
    '/accounts/:saasAccountId/label',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const parsedParams = paramsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }
      const parsedBody = putBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const { saasAccountId } = parsedParams.data;
      const { kind, note } = parsedBody.data;
      const { tenantId, userId } = req.sessionContext;

      const result = await withTenant(deps.pool, tenantId, async (tx) => {
        const existing = await tx.query('SELECT id FROM saas_accounts WHERE id = $1', [saasAccountId]);
        if (existing.rows.length === 0) {
          return null;
        }

        // The upsert below RETURNs the post-update values, so the prior state
        // has to be read first — and inside this same transaction, or a
        // concurrent relabel would race the audit's `before` (C19/I19.2).
        const prior = await tx.query<{ kind: string; note: string | null }>(
          'SELECT kind, note FROM account_labels WHERE tenant_id = $1 AND saas_account_id = $2',
          [tenantId, saasAccountId],
        );
        const priorRow = prior.rows[0];

        // created_by is deliberately absent from DO UPDATE SET: it preserves
        // the original setter's attribution; only updated_at tracks edits.
        const upserted = await tx.query<{ kind: string; note: string | null }>(
          `INSERT INTO account_labels (tenant_id, saas_account_id, kind, note, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, saas_account_id)
           DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note, updated_at = now()
           RETURNING kind, note`,
          [tenantId, saasAccountId, kind, note ?? null, userId],
        );
        const row = upserted.rows[0];
        if (!row) {
          throw new Error('account_labels upsert returned no row');
        }

        await recordLabelAudit(tx, tenantId, 'label_set', {
          actorUserId: userId,
          saasAccountId,
          before: priorRow
            ? { kind: priorRow.kind as LabelAuditSnapshot['kind'], note: priorRow.note }
            : null,
          after: { kind: row.kind as LabelAuditSnapshot['kind'], note: row.note },
        });

        return row;
      });

      if (!result) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const body: AccountLabelResponse = {
        accountId: saasAccountId,
        kind: result.kind as AccountLabelResponse['kind'],
        note: result.note,
      };
      return reply.code(200).send(body);
    },
  );

  app.delete(
    '/accounts/:saasAccountId/label',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const parsedParams = paramsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }
      const { saasAccountId } = parsedParams.data;
      const { tenantId, userId } = req.sessionContext;

      const found = await withTenant(deps.pool, tenantId, async (tx) => {
        const existing = await tx.query('SELECT id FROM saas_accounts WHERE id = $1', [saasAccountId]);
        if (existing.rows.length === 0) {
          return false;
        }

        // RETURNING supplies the audit's `before` — the only content a clear
        // record carries — and rowCount distinguishes a real clear from the
        // idempotent no-op. Emitting on a no-op would record a suppression
        // that never happened (C19/I19.2).
        const deleted = await tx.query<{ kind: string; note: string | null }>(
          `DELETE FROM account_labels
           WHERE tenant_id = $1 AND saas_account_id = $2
           RETURNING kind, note`,
          [tenantId, saasAccountId],
        );

        const removed = deleted.rows[0];
        if (removed) {
          await recordLabelAudit(tx, tenantId, 'label_cleared', {
            actorUserId: userId,
            saasAccountId,
            before: { kind: removed.kind as LabelAuditSnapshot['kind'], note: removed.note },
            after: null,
          });
        }

        return true;
      });

      if (!found) {
        return reply.code(404).send({ error: 'not_found' });
      }

      return reply.code(204).send();
    },
  );
}
