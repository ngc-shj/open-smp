import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@open-smp/schema';
import type { DiscoveryEventListItem, DiscoveryEventPayload } from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { LIST_RATE_LIMIT } from '../rate-limits.js';
import { PAGE_SIZE } from '../page-size.js';
import {
  CURSOR_MAX_LENGTH,
  decodeCursor,
  encodeCursor,
  type EventCursor,
} from './events-cursor.js';

const eventsQuerySchema = z
  .object({
    cursor: z.string().max(CURSOR_MAX_LENGTH).optional(),
    // Slug-constrained rather than free text: every real source value is a
    // slug (an app key, 'matcher', 'label'), and constraining the domain is
    // what keeps the encoded cursor's length bound derivable rather than
    // sampled. It also narrows the surface for a future widened app-key schema.
    source: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_-]+$/)
      .optional(),
  })
  .strict();

/**
 * Builds the WHERE clause and its bind values. Exported so a test can assert
 * on the clause itself rather than on the source text that produced it: the
 * invariant is "no top-level OR", and a guard bound to one authoring idiom
 * goes silent the moment the predicate is hoisted into a variable or a helper.
 *
 * The cursor predicate is row-wise — `(created_at, id) < ($n, $m)` — precisely
 * so it contains no OR at all. The expanded disjunction would need parentheses
 * to survive `conditions.join(' AND ')`, and without them the tenant predicate
 * stops applying to one branch.
 */
export function buildEventsWhere(
  tenantId: string,
  cursor: EventCursor | null,
  source: string | undefined,
): { clause: string; values: unknown[] } {
  const conditions: string[] = ['tenant_id = $1'];
  const values: unknown[] = [tenantId];

  if (source !== undefined) {
    values.push(source);
    conditions.push(`source = $${values.length}`);
  }

  if (cursor) {
    values.push(cursor.t, cursor.id);
    conditions.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`);
  }

  return { clause: conditions.join(' AND '), values };
}

type EventRow = {
  id: string;
  source: string;
  kind: string;
  payload: unknown;
  // timestamptz arrives from the pg driver as a Date, not a string. It has
  // always serialised correctly on the way out (JSON.stringify calls
  // toISOString), which is why the previous `string` annotation went unnoticed
  // — but the cursor reads this value directly, so the type has to be honest.
  created_at: Date;
};

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

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
    createdAt: toIsoTimestamp(row.created_at),
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
      const { cursor: rawCursor, source } = parsedQuery.data;
      const { tenantId } = req.sessionContext;

      // An empty string is falsy and has always meant "no cursor" here; keep
      // that rather than routing it through the decoder as malformed.
      let cursor: EventCursor | null = null;
      if (rawCursor) {
        cursor = decodeCursor(rawCursor);
        if (!cursor) {
          return reply.code(400).send({ error: 'invalid_query' });
        }
        // The cursor encodes a position within one filtered set. Replaying it
        // under a different filter would silently skip every row the original
        // filter excluded — no error, no empty page, just missing rows in an
        // audit view whose whole purpose is completeness. Binding the filter
        // into the cursor makes the API correct regardless of whether a caller
        // remembers to carry the query param.
        if (cursor.s !== (source ?? null)) {
          return reply.code(400).send({ error: 'invalid_query' });
        }
      }

      const { clause, values } = buildEventsWhere(tenantId, cursor, source);
      values.push(PAGE_SIZE + 1);
      const limitPlaceholder = `$${values.length}`;

      const rows = await withTenant(deps.pool, tenantId, async (tx) => {
        const result = await tx.query<EventRow>(
          `SELECT id, source, kind, payload, created_at
           FROM discovery_events
           WHERE ${clause}
           ORDER BY created_at DESC, id DESC
           LIMIT ${limitPlaceholder}`,
          values,
        );
        return result.rows;
      });

      const hasMore = rows.length > PAGE_SIZE;
      const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
      const lastRow = pageRows.at(-1);
      // The pg driver hands back timestamptz as a Date, not a string, so the
      // cursor timestamp is normalised explicitly. Interpolating the Date's
      // default string form would round-trip through Date.parse at microsecond
      // loss and could place the resumed scan on the wrong side of a tie.
      const nextCursor =
        hasMore && lastRow ? encodeCursor({ t: toIsoTimestamp(lastRow.created_at), id: lastRow.id, s: source ?? null }) : null;

      return reply.code(200).send({
        items: pageRows.map(toListItem),
        nextCursor,
      });
    },
  );
}
