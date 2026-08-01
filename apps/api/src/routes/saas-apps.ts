import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encryptCredentials } from '@open-smp/crypto';
import { withTenant } from '@open-smp/schema';
import { CONNECTOR_APP_KEYS } from '@open-smp/api-types';
import type { SaasAppListItem, SaasAppCreateResponse } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { countTenantApps, lockTenantAppCatalog } from '../app-catalog.js';
import { MAX_SAAS_APPS_PER_TENANT } from '../import-limits.js';
import { MUTATION_RATE_LIMIT, LIST_RATE_LIMIT } from '../rate-limits.js';

/** The catalog is full. Thrown inside the transaction so the ceiling is read under the lock. */
class CatalogFullError extends Error {}

// SC2/C2. `z.enum` over a NAMED constant, not an inline array — and not only
// for the usual reason. saas-app-key-pin.test.ts locates this declaration with
// a regex that stops at the first comma, so an inline `z.enum(['a', 'b'])`
// truncates and the control compares a fragment.
//
// Exported so that same file can assert what this schema ACCEPTS rather than
// how it is spelled. A source scan cannot tell `z.enum(CONNECTOR_APP_KEYS)`
// from a field that was quietly widened to `z.string()`.
export const saasAppBodySchema = z
  .object({
    key: z.enum(CONNECTOR_APP_KEYS),
    displayName: z.string().min(1),
    credentials: z.record(z.string(), z.string()),
  })
  .strict();

const saasAppParamsSchema = z.object({ saasAppId: z.string().uuid() }).strict();

// Both fields optional, but a body supplying neither is rejected below rather
// than silently returning 200 on a no-op.
const saasAppPatchSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    credentials: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export function registerSaasAppsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/saas-apps',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const parsed = saasAppBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const { key, displayName, credentials } = parsed.data;
      const { tenantId } = req.sessionContext;

      const plaintext = new TextEncoder().encode(JSON.stringify(credentials));

      let created: SaasAppCreateResponse;
      try {
        created = await withTenant(deps.pool, tenantId, async (tx) => {
          // SCL11's trigger, closed. Until C2 this route had NO ceiling at all:
          // `MAX_SAAS_APPS_PER_TENANT` was counted only by the contract import,
          // and what bounded this path was `UNIQUE (tenant_id, key)` against a
          // one-literal field — an accident of the schema doing a limit's job.
          // Widening the field to the connector set moves that bound from 1 to
          // |CONNECTOR_APP_KEYS| rather than removing it, so this is not yet a
          // reachable overrun; it is the control the route was asserted to have
          // and did not.
          //
          // Under the lock, because `SELECT count(*)` takes none at READ
          // COMMITTED and two concurrent creates would otherwise both read the
          // same pre-insert count.
          await lockTenantAppCatalog(tx, tenantId);
          if ((await countTenantApps(tx, tenantId)) >= MAX_SAAS_APPS_PER_TENANT) {
            throw new CatalogFullError();
          }

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
      } catch (err: unknown) {
        if (err instanceof CatalogFullError) {
          return reply.code(409).send({ error: 'catalog_full' });
        }
        // Scoped to this insert's known unique constraint only — any other
        // error (or a future unique constraint added to this same path)
        // rethrows rather than being mismapped to duplicate_key.
        const isDuplicateKey =
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          err.code === '23505' &&
          'constraint' in err &&
          err.constraint === 'saas_apps_tenant_id_key_key';
        if (isDuplicateKey) {
          return reply.code(409).send({ error: 'duplicate_key' });
        }
        throw err;
      }

      return reply.code(201).send(created);
    },
  );

  app.get(
    '/saas-apps',
    { config: { rateLimit: LIST_RATE_LIMIT } },
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

  app.patch(
    '/saas-apps/:saasAppId',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const parsedParams = saasAppParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }
      const parsedBody = saasAppPatchSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const { saasAppId } = parsedParams.data;
      const { displayName, credentials } = parsedBody.data;
      if (displayName === undefined && credentials === undefined) {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const { tenantId } = req.sessionContext;

      const updated = await withTenant(deps.pool, tenantId, async (tx) => {
        const existing = await tx.query<{ id: string; key: string; display_name: string }>(
          'SELECT id, key, display_name FROM saas_apps WHERE id = $1',
          [saasAppId],
        );
        const row = existing.rows[0];
        if (!row) {
          return null;
        }

        if (displayName !== undefined) {
          await tx.query('UPDATE saas_apps SET display_name = $2 WHERE id = $1', [
            saasAppId,
            displayName,
          ]);
        }

        if (credentials !== undefined) {
          const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
          const { blob, keyVersion } = encryptCredentials(
            plaintext,
            { tenantId, saasAppId },
            deps.encryptionKeys,
          );
          // The version column travels with the ciphertext in one statement.
          // encryptCredentials always picks the max key version, so a
          // replacement performed after a key rollout lands on the new one —
          // writing credentials_enc alone would pair new-version ciphertext
          // with a stale version, and the AAD (which binds keyVersion) would
          // then fail the GCM tag check on every later read.
          await tx.query(
            'UPDATE saas_apps SET credentials_enc = $2, credentials_key_version = $3 WHERE id = $1',
            [saasAppId, Buffer.from(blob), keyVersion],
          );
        }

        return {
          id: row.id,
          key: row.key,
          displayName: displayName ?? row.display_name,
        } satisfies SaasAppListItem;
      });

      if (!updated) {
        return reply.code(404).send({ error: 'not_found' });
      }

      return reply.code(200).send(updated);
    },
  );

  app.delete(
    '/saas-apps/:saasAppId',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const parsedParams = saasAppParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }
      const { saasAppId } = parsedParams.data;
      const { tenantId } = req.sessionContext;

      let outcome: 'deleted' | 'not_found' | { accountCount: number };
      try {
        outcome = await withTenant(deps.pool, tenantId, async (tx) => {
          const existing = await tx.query('SELECT id FROM saas_apps WHERE id = $1', [saasAppId]);
          if (existing.rows.length === 0) {
            return 'not_found' as const;
          }

          // Counted inside the same transaction as the delete: a sync landing
          // between a separate count and the delete would turn a "0 accounts,
          // safe" decision into a foreign-key violation.
          const counted = await tx.query<{ n: string }>(
            'SELECT count(*) AS n FROM saas_accounts WHERE saas_app_id = $1',
            [saasAppId],
          );
          const accountCount = Number(counted.rows[0]!.n);
          if (accountCount > 0) {
            return { accountCount };
          }

          await tx.query('DELETE FROM saas_apps WHERE id = $1', [saasAppId]);
          return 'deleted' as const;
        });
      } catch (err: unknown) {
        // Defense in depth only — the in-transaction count above should make
        // this unreachable. Scoped to the one constraint that can fire here so
        // any other integrity error still surfaces rather than being mapped to
        // a misleading 409.
        const isAccountsFk =
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          err.code === '23503' &&
          'constraint' in err &&
          err.constraint === 'saas_accounts_saas_app_id_fkey';
        if (isAccountsFk) {
          return reply.code(409).send({ error: 'app_has_accounts' });
        }
        throw err;
      }

      if (outcome === 'not_found') {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (outcome !== 'deleted') {
        return reply.code(409).send({ error: 'app_has_accounts', accountCount: outcome.accountCount });
      }

      return reply.code(204).send();
    },
  );
}
