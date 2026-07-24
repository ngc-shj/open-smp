import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { DiscoveryEventListItem } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { LIST_RATE_LIMIT } from '../rate-limits.js';

const eventsQuerySchema = z.object({ cursor: z.string().uuid().optional() }).strict();

const PAGE_SIZE = 50;

type EventRow = {
  id: string;
  source: string;
  kind: string;
  payload: unknown;
  created_at: string;
};

// S5: payload is projected to {counts, runId} server-side regardless of
// DISCOVERY_STORE_RAW — raw per-account blobs are never serialized to any
// API response, even when they were persisted to the DB (forbidden pattern:
// passing `payload` unprojected to the serializer).
function projectPayload(payload: unknown): { counts?: object; runId?: string } {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const projected: { counts?: object; runId?: string } = {};
  if (typeof record.counts === 'object' && record.counts !== null) {
    projected.counts = record.counts as object;
  }
  if (typeof record.runId === 'string') {
    projected.runId = record.runId;
  }
  return projected;
}

function toListItem(row: EventRow): DiscoveryEventListItem {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    payload: projectPayload(row.payload),
    createdAt: row.created_at,
  };
}

export function registerEventsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    '/events',
    { config: { rateLimit: LIST_RATE_LIMIT } },
    async (req, reply) => {
      const parsedQuery = eventsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({ error: 'invalid_query' });
      }
      const { cursor } = parsedQuery.data;
      const { tenantId } = req.sessionContext;

      const conditions: string[] = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      if (cursor) {
        values.push(cursor);
        conditions.push(`id > $${values.length}`);
      }
      values.push(PAGE_SIZE + 1);
      const limitPlaceholder = `$${values.length}`;

      const rows = await withTenant(deps.pool, tenantId, async (tx) => {
        const result = await tx.query<EventRow>(
          `SELECT id, source, kind, payload, created_at
           FROM discovery_events
           WHERE ${conditions.join(' AND ')}
           ORDER BY id
           LIMIT ${limitPlaceholder}`,
          values,
        );
        return result.rows;
      });

      const hasMore = rows.length > PAGE_SIZE;
      const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
      const lastRow = pageRows.at(-1);
      const nextCursor = hasMore && lastRow ? lastRow.id : null;

      return reply.code(200).send({
        items: pageRows.map(toListItem),
        nextCursor,
      });
    },
  );
}
