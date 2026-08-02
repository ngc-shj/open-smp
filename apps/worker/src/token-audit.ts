import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  ConnectorError,
  rawTokenSchema,
  type ConnectorContext,
  type Logger,
  type RawToken,
} from '@open-smp/connectors-core';
import { decryptCredentials } from '@open-smp/crypto';
import { withTenant } from '@open-smp/schema';
import {
  TOKEN_AUDIT_EVENT_SOURCE,
  type DiscoveredApplication,
} from '@open-smp/api-types';
import type { TokenAuditJobData, TokenAuditJobResult } from '@open-smp/queues';
import type { ConnectorRegistry } from './connectors.js';

export interface TokenAuditDeps {
  pool: Pool;
  connectorRegistry: ConnectorRegistry;
  encryptionKeys: Map<number, Buffer>;
  logger: Logger;
}

/**
 * How many accounts one run reads. Named for its subject, not `MAX_ACCOUNTS`:
 * one name cannot hold two values, and this bound has nothing to do with the
 * import caps.
 *
 * It exists because the fan-out is one HTTP request per account — forced by the
 * provider, which offers no domain-wide token endpoint — so an unbounded run on
 * a large tenant is thousands of sequential calls against a rate-limited API.
 */
export /**
 * How long one audit may run.
 *
 * Longer than sync's, because the fan-out is per account and forced by the
 * provider (`tokens.list` takes a userKey and nothing else) — but bounded,
 * where it used to be unbounded in wall clock.
 */
const TOKEN_AUDIT_DEADLINE_MS = 20 * 60 * 1000;

export const TOKEN_AUDIT_MAX_ACCOUNTS = 1_000;

/**
 * How many distinct applications one event reports, and how many scopes each
 * carries. The payload is a jsonb column, and a run over 1 000 accounts can
 * observe far more grants than a reader will ever page through.
 */
export const TOKEN_AUDIT_MAX_APPLICATIONS = 200;
export const TOKEN_AUDIT_MAX_SCOPES_PER_APPLICATION = 25;

type AccountRow = { external_id: string };

/**
 * Aggregates grants into applications as the run proceeds.
 *
 * In the job rather than in a query, because the alternative is a table — and a
 * new table brings SCL9's catalog-derivation gap and SCL10's composite-FK
 * obligation due in the same contract. The cost is stated in the plan: this
 * reports what ONE run observed, and cross-run history is not available.
 */
function aggregate(grants: readonly RawToken[]): DiscoveredApplication[] {
  const byClientId = new Map<string, { app: DiscoveredApplication; scopes: Set<string> }>();

  for (const grant of grants) {
    let entry = byClientId.get(grant.clientId);
    if (!entry) {
      entry = {
        app: {
          clientId: grant.clientId,
          displayName: grant.displayName,
          userCount: 0,
          anonymous: grant.anonymous,
          scopes: [],
        },
        scopes: new Set<string>(),
      };
      byClientId.set(grant.clientId, entry);
    }
    entry.app.userCount += 1;
    // A later grant may carry a display name where the first did not; taking
    // the first non-null keeps the application identifiable without letting a
    // subsequent null erase it.
    entry.app.displayName ??= grant.displayName;
    // `anonymous` is only ever widened toward "the provider said something".
    entry.app.anonymous ??= grant.anonymous;
    for (const scope of grant.scopes) {
      entry.scopes.add(scope);
    }
  }

  return [...byClientId.values()]
    .map(({ app, scopes }) => ({
      ...app,
      scopes: [...scopes].sort().slice(0, TOKEN_AUDIT_MAX_SCOPES_PER_APPLICATION),
    }))
    // Most-granted first: the application 400 people authorised is the one an
    // operator needs to see, and a truncated list must not cut it.
    .sort((a, b) => b.userCount - a.userCount || a.clientId.localeCompare(b.clientId))
    .slice(0, TOKEN_AUDIT_MAX_APPLICATIONS);
}

async function recordEvent(
  deps: TokenAuditDeps,
  tenantId: string,
  kind: string,
  payload: object,
): Promise<void> {
  // Its own short transaction, committed independently — the same shape
  // `sync_failed` uses, and for the same reason: a run that failed must leave a
  // trail rather than rolling its own record back with itself.
  await withTenant(deps.pool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO discovery_events (tenant_id, source, kind, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [tenantId, TOKEN_AUDIT_EVENT_SOURCE, kind, JSON.stringify(payload)],
    );
  });
}

/**
 * Runs one token audit: read the accounts already inventoried for an
 * application, ask the connector for each account's third-party grants, and
 * record what the run observed.
 *
 * **No transaction spans the fan-out.** `runSync` holds one open across its
 * whole connector stream, and copying that here would hold a pooled connection
 * for as many HTTP round-trips as the tenant has accounts. The account list is
 * read in one short transaction, the fan-out runs with no connection held, and
 * the result is written in another.
 *
 * **Partial success is the ordinary outcome**, and this is the first job in the
 * codebase that has one. An error that will repeat for every account — `auth`,
 * `fatal` — aborts the run, because 999 further attempts cannot improve it. Any
 * other error is counted against that account and the run continues, since a
 * transient failure on one account says nothing about the next.
 */
export async function runTokenAudit(
  deps: TokenAuditDeps,
  job: TokenAuditJobData,
): Promise<TokenAuditJobResult> {
  const runId = randomUUID();

  const { credentials, appKey, externalIds } = await withTenant(
    deps.pool,
    job.tenantId,
    async (tx) => {
      const { rows: appRows } = await tx.query<{
        key: string;
        credentials_enc: Buffer | null;
        credentials_key_version: number;
      }>(
        'SELECT key, credentials_enc, credentials_key_version FROM saas_apps WHERE id = $1',
        [job.saasAppId],
      );
      const app = appRows[0];
      if (!app) {
        throw new Error(`saas_apps row not found: ${job.saasAppId}`);
      }
      if (!app.credentials_enc) {
        throw new Error(`saas_apps row ${job.saasAppId} has no stored credentials`);
      }

      const decrypted = decryptCredentials(
        app.credentials_enc,
        app.credentials_key_version,
        { tenantId: job.tenantId, saasAppId: job.saasAppId },
        deps.encryptionKeys,
      );

      // Ordered and bounded in SQL, so the cap selects a deterministic subset
      // rather than whatever the planner happened to return first.
      const { rows } = await tx.query<AccountRow>(
        `SELECT external_id FROM saas_accounts
         WHERE tenant_id = $1 AND saas_app_id = $2
         ORDER BY external_id
         LIMIT $3`,
        [job.tenantId, job.saasAppId, TOKEN_AUDIT_MAX_ACCOUNTS],
      );

      try {
        return {
          credentials: JSON.parse(Buffer.from(decrypted).toString('utf8')) as Record<string, string>,
          appKey: app.key,
          externalIds: rows.map((row) => row.external_id),
        };
      } finally {
        // The sibling in sync.ts has had this since S11; this path held the
        // Google service-account private key for the life of the job with no
        // zeroization at all. Review found it as the remaining member of the
        // credential-buffer class.
        decrypted.fill(0);
      }
    },
  );

  const buildConnector = deps.connectorRegistry.get(appKey);
  if (!buildConnector) {
    throw new Error(`No connector registered for saas_apps.key = ${appKey}`);
  }
  const connector = buildConnector(credentials);

  if (connector.tokenCapability !== 'per-user-grants' || !connector.listTokens) {
    // NF2: a connector that cannot read grants is in an ordinary state. The run
    // records that it found nothing BECAUSE it could not look, which is a
    // different fact from finding nothing.
    //
    // SC2/C4: the KIND now says so. This was `token_audit_failed`, which is
    // also what an authentication failure writes — so `/discovery` dropped both
    // and an operator could not tell a permanent property of the integration
    // from something to go and fix.
    //
    // The condition reads the declaration AND the method, because the two are
    // the same claim made twice and only their agreement is the invariant a
    // test can assert. Auditing on `per-user-grants` with no `listTokens` would
    // be a TypeError inside the loop below.
    await recordEvent(deps, job.tenantId, 'token_audit_unsupported', {
      runId,
      auditedAppKey: appKey,
      capability: connector.tokenCapability,
    });
    return { runId, scanned: 0, failed: 0, applications: 0 };
  }

  const ctx: ConnectorContext = {
    credentials,
    logger: deps.logger,
    // A signal that can fire. It was `new AbortController().signal` — the exact
    // construct the sync path replaced one round earlier, leaving the
    // connectors' own abort guards inert on the path that makes up to
    // TOKEN_AUDIT_MAX_ACCOUNTS sequential requests. R3: the class had two
    // members and only one was fixed.
    signal: AbortSignal.timeout(TOKEN_AUDIT_DEADLINE_MS),
  };

  const grants: RawToken[] = [];
  let scanned = 0;
  let failed = 0;

  for (const externalId of externalIds) {
    try {
      const tokens = await connector.listTokens(ctx, externalId);
      for (const candidate of tokens) {
        // Parsed at the boundary, exactly as sync parses each account: a
        // connector is code this repository owns today and may not tomorrow.
        grants.push(rawTokenSchema.parse(candidate));
      }
      scanned += 1;
    } catch (error) {
      const repeatsForEveryAccount =
        error instanceof ConnectorError && (error.kind === 'auth' || error.kind === 'fatal');
      if (repeatsForEveryAccount) {
        await recordEvent(deps, job.tenantId, 'token_audit_failed', {
          runId,
          auditedAppKey: appKey,
          scanned,
          failed,
          error: error.message,
        });
        throw error;
      }
      failed += 1;
      deps.logger.warn('token audit could not read one account', {
        runId,
        error: String(error),
      });
    }
  }

  const applications = aggregate(grants);
  await recordEvent(deps, job.tenantId, 'token_audit_completed', {
    runId,
    auditedAppKey: appKey,
    scanned,
    failed,
    applications,
  });

  return { runId, scanned, failed, applications: applications.length };
}
