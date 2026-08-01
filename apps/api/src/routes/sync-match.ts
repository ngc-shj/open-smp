import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { syncJobId, matchJobId, tokenAuditJobId } from '@open-smp/queues';
import type { AppDeps } from '../deps.js';
import { MUTATION_RATE_LIMIT, LIST_RATE_LIMIT } from '../rate-limits.js';

const saasAppIdParamsSchema = z.object({ saasAppId: z.string().uuid() }).strict();
const jobIdParamsSchema = z.object({ jobId: z.string().min(1) }).strict();

export function registerSyncMatchRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/sync/:saasAppId',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const parsedParams = saasAppIdParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }
      const { saasAppId } = parsedParams.data;
      // tenantId comes exclusively from SessionContext — never from
      // req.body/query/headers (S7 enqueue trust boundary forbidden pattern).
      const { tenantId } = req.sessionContext;

      const jobId = syncJobId(tenantId, saasAppId);
      await deps.syncQueue.add('sync', { tenantId, saasAppId }, { jobId });

      return reply.code(202).send({ jobId });
    },
  );

  app.post(
    '/token-audit/:saasAppId',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const parsedParams = saasAppIdParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }
      const { saasAppId } = parsedParams.data;
      // tenantId comes exclusively from SessionContext — never from
      // req.body/query/headers (S7 enqueue trust boundary forbidden pattern).
      const { tenantId } = req.sessionContext;

      const jobId = tokenAuditJobId(tenantId, saasAppId);
      await deps.tokenAuditQueue.add('token-audit', { tenantId, saasAppId }, { jobId });

      return reply.code(202).send({ jobId });
    },
  );

  app.post(
    '/match',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const { tenantId } = req.sessionContext;

      const jobId = matchJobId(tenantId);
      await deps.matchQueue.add('match', { tenantId }, { jobId });

      return reply.code(202).send({ jobId });
    },
  );

  app.get(
    '/jobs/:jobId',
    { config: { rateLimit: LIST_RATE_LIMIT } },
    async (req, reply) => {
      const parsedParams = jobIdParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }
      const { jobId } = parsedParams.data;

      const job = await deps.getJob(jobId);
      if (!job) {
        return reply.code(404).send({ error: 'not_found' });
      }

      return reply.code(200).send(job);
    },
  );
}
