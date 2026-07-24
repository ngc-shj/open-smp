import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { AccountLabelResponse } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { MUTATION_RATE_LIMIT } from '../rate-limits.js';

const LABEL_KINDS = ['known_shared', 'service_account', 'external_collaborator'] as const;

const paramsSchema = z
  .object({
    saasAccountId: z.string().uuid(),
  })
  .strict();

const putBodySchema = z
  .object({
    kind: z.enum(LABEL_KINDS),
    note: z.string().min(1).max(500).optional(),
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
      const { tenantId } = req.sessionContext;

      const found = await withTenant(deps.pool, tenantId, async (tx) => {
        const existing = await tx.query('SELECT id FROM saas_accounts WHERE id = $1', [saasAccountId]);
        if (existing.rows.length === 0) {
          return false;
        }

        await tx.query('DELETE FROM account_labels WHERE tenant_id = $1 AND saas_account_id = $2', [
          tenantId,
          saasAccountId,
        ]);
        return true;
      });

      if (!found) {
        return reply.code(404).send({ error: 'not_found' });
      }

      return reply.code(204).send();
    },
  );
}
