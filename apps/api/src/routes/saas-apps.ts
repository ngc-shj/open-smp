import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encryptCredentials } from '@open-smp/crypto';
import { withTenant } from '@open-smp/schema';
import type { AppDeps } from '../deps.js';

const saasAppBodySchema = z
  .object({
    key: z.literal('google-workspace'),
    displayName: z.string().min(1),
    credentials: z.record(z.string(), z.string()),
  })
  .strict();

// GET response shape never includes `credentials_enc` / `credentials_key_version`
// raw bytes or any decrypted credential field — only these columns are selected.
type SaasAppListItem = { id: string; key: string; displayName: string };

export function registerSaasAppsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/saas-apps',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = saasAppBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const { key, displayName, credentials } = parsed.data;
      const { tenantId } = req.sessionContext;

      const plaintext = new TextEncoder().encode(JSON.stringify(credentials));

      const created = await withTenant(deps.pool, tenantId, async (tx) => {
        const insertResult = await tx.query<{ id: string }>(
          `INSERT INTO saas_apps (tenant_id, key, display_name)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [tenantId, key, displayName],
        );
        const saasAppId = insertResult.rows[0]?.id;
        if (!saasAppId) {
          throw new Error('saas-apps insert returned no row');
        }

        const { blob, keyVersion } = encryptCredentials(
          plaintext,
          { tenantId, saasAppId },
          deps.encryptionKeys,
        );

        await tx.query(
          `UPDATE saas_apps SET credentials_enc = $2, credentials_key_version = $3 WHERE id = $1`,
          [saasAppId, Buffer.from(blob), keyVersion],
        );

        return { id: saasAppId, key, displayName };
      });

      return reply.code(201).send(created);
    },
  );

  app.get(
    '/saas-apps',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { tenantId } = req.sessionContext;

      const items = await withTenant(deps.pool, tenantId, async (tx) => {
        const result = await tx.query<{ id: string; key: string; display_name: string }>(
          'SELECT id, key, display_name FROM saas_apps WHERE tenant_id = $1 ORDER BY display_name',
          [tenantId],
        );
        return result.rows.map(
          (row): SaasAppListItem => ({ id: row.id, key: row.key, displayName: row.display_name }),
        );
      });

      return reply.code(200).send({ items });
    },
  );
}
