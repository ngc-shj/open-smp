import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { rawAccountSchema, type ConnectorContext, type Logger } from '@open-smp/connectors-core';
import { decryptCredentials } from '@open-smp/crypto';
import { withTenant } from '@open-smp/schema';
import type { SyncJobData, SyncJobResult } from '@open-smp/queues';
import type { ConnectorRegistry } from './connectors.js';

/**
 * How long one sync may hold its transaction.
 *
 * Not a request timeout — the connector owns that. This bounds the WHOLE
 * interaction, including paging: an unbounded `do … while (cursor)` over a
 * provider that keeps answering slowly holds a pooled connection and an
 * idle-in-transaction Postgres session for as long as it takes, and the sync
 * worker's concurrency of 1 means that stalls every other tenant.
 */
const SYNC_DEADLINE_MS = 10 * 60 * 1000;

export interface SyncDeps {
  pool: Pool;
  connectorRegistry: ConnectorRegistry;
  encryptionKeys: Map<number, Buffer>;
  logger: Logger;
  discoveryStoreRaw: boolean;
  /**
   * The run's deadline, injectable so it has an observer.
   *
   * Review found the previous form — a bare `AbortSignal.timeout(...)` inline —
   * had none: reverting it to the never-aborting `new AbortController().signal`
   * left the integration suite green, which is the state the fix existed to
   * leave. Optional, so production takes the default and only a test supplies
   * its own.
   */
  signal?: AbortSignal;
}

interface SaasAppRow {
  key: string;
  credentials_enc: Buffer | null;
  credentials_key_version: number;
}

async function loadSaasApp(tx: PoolClient, saasAppId: string): Promise<SaasAppRow> {
  const { rows } = await tx.query<SaasAppRow>(
    'SELECT key, credentials_enc, credentials_key_version FROM saas_apps WHERE id = $1',
    [saasAppId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`saas_apps row not found: ${saasAppId}`);
  }
  return row;
}

async function upsertAccount(
  tx: PoolClient,
  tenantId: string,
  saasAppId: string,
  account: {
    externalId: string;
    email: string | null;
    displayName: string | null;
    accountStatus: 'active' | 'suspended' | 'archived';
    isAdmin: boolean;
    lastActivityAt: string | null;
  },
  runStartedAt: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO saas_accounts
       (tenant_id, saas_app_id, external_id, email, display_name, account_status, is_admin, last_activity_at, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, saas_app_id, external_id) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = EXCLUDED.display_name,
       account_status = EXCLUDED.account_status,
       is_admin = EXCLUDED.is_admin,
       last_activity_at = EXCLUDED.last_activity_at,
       last_synced_at = EXCLUDED.last_synced_at`,
    [
      tenantId,
      saasAppId,
      account.externalId,
      account.email,
      account.displayName,
      account.accountStatus,
      account.isAdmin,
      account.lastActivityAt,
      runStartedAt,
    ],
  );
}

const MAX_RAW_PAYLOADS_STORED = 500;

/**
 * Runs one sync job: decrypt saas_apps credentials, stream the connector's
 * listUsers, upsert saas_accounts, and record a single discovery_events row.
 * All DB work happens inside withTenant(job.tenantId, ...) per C5.
 */
export async function runSync(deps: SyncDeps, job: SyncJobData): Promise<SyncJobResult> {
  const runId = randomUUID();
  const runStartedAt = new Date();

  let decrypted: Buffer | null = null;
  // Resolved once the app row is loaded, so the failure-path audit event
  // (CF2) can record which source failed even when the main transaction
  // rolls back.
  let appKey: string | null = null;
  try {
    const upserted = await withTenant(deps.pool, job.tenantId, async (tx) => {
      const app = await loadSaasApp(tx, job.saasAppId);
      appKey = app.key;

      if (!app.credentials_enc) {
        throw new Error(`saas_apps row ${job.saasAppId} has no stored credentials`);
      }

      decrypted = Buffer.from(
        decryptCredentials(
          app.credentials_enc,
          app.credentials_key_version,
          { tenantId: job.tenantId, saasAppId: job.saasAppId },
          deps.encryptionKeys,
        ),
      );

      const credentials = JSON.parse(decrypted.toString('utf8')) as Record<string, string>;

      const buildConnector = deps.connectorRegistry.get(app.key);
      if (!buildConnector) {
        throw new Error(`No connector registered for saas_apps.key = ${app.key}`);
      }
      const connector = buildConnector(credentials);

      // A signal that can actually fire. It used to be
      // `new AbortController().signal` — never aborted by anything — which made
      // every connector's own `ctx.signal.aborted` check inert, and the whole
      // provider interaction runs inside this open transaction. Found in
      // review, alongside the Slack client's `timeout: 0` default.
      const ctx: ConnectorContext = {
        credentials,
        logger: deps.logger,
        signal: deps.signal ?? AbortSignal.timeout(SYNC_DEADLINE_MS),
      };

      let count = 0;
      const rawPayloads: unknown[] = [];

      for await (const candidate of connector.listUsers(ctx)) {
        const account = rawAccountSchema.parse(candidate);

        await upsertAccount(
          tx,
          job.tenantId,
          job.saasAppId,
          {
            externalId: account.externalId,
            email: account.email,
            displayName: account.displayName,
            accountStatus: account.accountStatus,
            isAdmin: account.isAdmin,
            lastActivityAt: account.lastActivityAt,
          },
          runStartedAt,
        );
        count += 1;

        if (deps.discoveryStoreRaw && rawPayloads.length < MAX_RAW_PAYLOADS_STORED) {
          rawPayloads.push(account.raw);
        }
      }

      await tx.query(
        `INSERT INTO discovery_events (tenant_id, source, kind, payload)
         VALUES ($1, $2, 'sync_completed', $3::jsonb)`,
        [job.tenantId, app.key, JSON.stringify({ counts: { upserted: count }, runId })],
      );

      if (deps.discoveryStoreRaw) {
        await tx.query(
          `INSERT INTO discovery_events (tenant_id, source, kind, payload)
           VALUES ($1, $2, 'sync_raw', $3::jsonb)`,
          [job.tenantId, app.key, JSON.stringify({ runId, accounts: rawPayloads })],
        );
      }

      return count;
    });

    return { upserted, runId };
  } catch (error) {
    // CF2: the sync transaction is all-or-nothing (a mid-stream connector
    // failure rolls back every upsert — accepted, since re-running is
    // idempotent per NFR3). Without this, a failed run left NO audit trail.
    // Record the failure in its own committed transaction so the run is
    // visible in discovery_events / the events UI. The error message is the
    // connector's own (ConnectorError kind), never credential material.
    if (appKey !== null) {
      try {
        await withTenant(deps.pool, job.tenantId, async (tx) => {
          await tx.query(
            `INSERT INTO discovery_events (tenant_id, source, kind, payload)
             VALUES ($1, $2, 'sync_failed', $3::jsonb)`,
            [
              job.tenantId,
              appKey,
              JSON.stringify({ runId, error: error instanceof Error ? error.message : 'unknown' }),
            ],
          );
        });
      } catch (auditError) {
        deps.logger.error('failed to record sync_failed event', { runId, auditError: String(auditError) });
      }
    }
    throw error;
  } finally {
    // S11: zero the decrypted credential buffer once the run completes or
    // fails. The parsed JS strings derived from it (e.g. the PEM key) are
    // not zeroable at the JS level and remain GC-dependent — accepted for
    // MVP, see C9's in-memory lifecycle note.
    (decrypted as Buffer | null)?.fill(0);
  }
}
