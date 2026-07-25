import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { DiscoveryEventListItem, DiscoveryEventPayload } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { LIST_RATE_LIMIT } from '../rate-limits.js';
import { PAGE_SIZE } from '../page-size.js';

const eventsQuerySchema = z.object({ cursor: z.string().uuid().optional() }).strict();

type EventRow = {
  id: string;
  source: string;
  kind: string;
  payload: unknown;
  created_at: string;
};

// S5: payload is projected server-side regardless of DISCOVERY_STORE_RAW —
// raw per-account blobs are never serialized to any API response, even when
// they were persisted to the DB (forbidden pattern: passing `payload`
// unprojected to the serializer).
//
// C21 makes the projection kind-aware so audit events can carry their own
// fields, WITHOUT widening what sync kinds may emit. The default is the
// restrictive sync shape, so an unknown kind — including a future one nobody
// added here — leaks nothing. Fail-closed by construction.
const AUDIT_KINDS = new Set(['label_set', 'label_cleared']);

function projectSyncPayload(record: Record<string, unknown>): DiscoveryEventPayload {
  const projected: DiscoveryEventPayload = {};
  if (typeof record.counts === 'object' && record.counts !== null) {
    projected.counts = record.counts as object;
  }
  if (typeof record.runId === 'string') {
    projected.runId = record.runId;
  }
  return projected;
}

function projectAuditPayload(record: Record<string, unknown>): DiscoveryEventPayload {
  const projected: DiscoveryEventPayload = {};
  if (typeof record.actorUserId === 'string') {
    projected.actorUserId = record.actorUserId;
  }
  if (typeof record.saasAccountId === 'string') {
    projected.saasAccountId = record.saasAccountId;
  }
  for (const field of ['before', 'after'] as const) {
    const value = record[field];
    if (value === null) {
      projected[field] = null;
    } else if (typeof value === 'object') {
      const snapshot = value as Record<string, unknown>;
      if (typeof snapshot.kind === 'string') {
        projected[field] = {
          kind: snapshot.kind as NonNullable<DiscoveryEventPayload['before']>['kind'],
          note: typeof snapshot.note === 'string' ? snapshot.note : null,
        };
      }
    }
  }
  return projected;
}

function projectPayload(kind: string, payload: unknown): DiscoveryEventPayload {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return AUDIT_KINDS.has(kind) ? projectAuditPayload(record) : projectSyncPayload(record);
}

function toListItem(row: EventRow): DiscoveryEventListItem {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    payload: projectPayload(row.kind, row.payload),
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
