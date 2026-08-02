import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { runMigrations, withTenant } from '@open-smp/schema';
import { encryptCredentials } from '@open-smp/crypto';
import {
  ConnectorError,
  type RawToken,
  type SaaSConnector,
  type ConnectorContext,
} from '@open-smp/connectors-core';
import { TOKEN_AUDIT_EVENT_SOURCE } from '@open-smp/api-types';
import {
  runTokenAudit,
  TOKEN_AUDIT_DEADLINE_MS,
  TOKEN_AUDIT_MAX_ACCOUNTS,
} from '../src/token-audit.js';
import type { ConnectorRegistry } from '../src/connectors.js';

// SC3/C2 acceptance, against real Postgres 16.
//
// VE1 puts the Google call out of reach, so the connector is a fake — but the
// JOB is the shipped one, and what this file proves is the job's three
// decisions: the fan-out is bounded, a partial run is recorded as partial, and
// an error that repeats for every account stops the run instead of costing N
// more requests.

let container: StartedPostgreSqlContainer;
let pool: Pool;

const encryptionKeys = new Map([[1, Buffer.alloc(32, 7)]]);
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeConnector(
  listTokens?: (ctx: unknown, userKey: string) => Promise<readonly RawToken[]>,
  // SC2/C4. The declaration and the method are the same claim, and a real
  // connector is asserted to keep them agreeing (connector-registry.test.ts).
  // A FAKE is the only thing that can be in the disagreeing states, which is
  // why the override exists — without it the two operands of the audit's
  // condition are perfectly correlated in every test and `||` could be `&&`
  // with nothing noticing. Measured in review.
  capabilityOverride?: SaaSConnector['tokenCapability'],
): SaaSConnector {
  return {
    id: 'google-workspace',
    authKind: 'oauth2',
    tokenCapability: capabilityOverride ?? (listTokens ? 'per-user-grants' : 'none'),
    // Not reached: the audit reads saas_accounts, not the connector's user
    // stream. That is the property, so the fake makes a regression loud rather
    // than quietly re-fetching the domain on every audit.
    listUsers: () => {
      throw new Error('listUsers must not be called by the token audit');
    },
    ...(listTokens
      ? {
          // The signal IS observed, as both real connectors observe it. A fake
          // that ignored it made the audit deadline unobservable at this tier —
          // the same RT1 gap the sync fake had.
          listTokens: async (ctx: ConnectorContext, userKey: string) => {
            if (ctx.signal.aborted) {
              throw new ConnectorError('fatal', false, 'fake connector: run aborted');
            }
            return listTokens(ctx, userKey);
          },
        }
      : {}),
  };
}

function registryFor(connector: SaaSConnector): ConnectorRegistry {
  return new Map([['google-workspace', () => connector]]);
}

function grant(clientId: string, userKey: string, overrides: Partial<RawToken> = {}): RawToken {
  return {
    clientId,
    displayName: `App ${clientId}`,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    anonymous: false,
    nativeApp: false,
    userKey,
    ...overrides,
  };
}

async function seedApp(tenantId: string, accountCount: number): Promise<string> {
  return withTenant(pool, tenantId, async (tx) => {
    const saasAppId = randomUUID();
    const { blob, keyVersion } = encryptCredentials(
      new TextEncoder().encode(
        JSON.stringify({ serviceAccountJson: '{}', impersonateAdminEmail: 'a@b.c' }),
      ),
      { tenantId, saasAppId },
      encryptionKeys,
    );
    await tx.query(
      `INSERT INTO saas_apps (id, tenant_id, key, display_name, credentials_enc, credentials_key_version)
       VALUES ($1, $2, 'google-workspace', 'GWS', $3, $4)`,
      [saasAppId, tenantId, Buffer.from(blob), keyVersion],
    );
    if (accountCount > 0) {
      await tx.query(
        `INSERT INTO saas_accounts (tenant_id, saas_app_id, external_id, account_status)
         SELECT $1, $2, 'user-' || lpad(g::text, 6, '0'), 'active'
         FROM generate_series(1, $3::int) g`,
        [tenantId, saasAppId, accountCount],
      );
    }
    return saasAppId;
  });
}

async function eventsFor(tenantId: string) {
  return withTenant(pool, tenantId, async (tx) => {
    const { rows } = await tx.query<{
      kind: string;
      payload: Record<string, unknown>;
      source: string;
    }>(
      'SELECT source, kind, payload FROM discovery_events WHERE tenant_id = $1 ORDER BY created_at',
      [tenantId],
    );
    return rows;
  });
}

let tenantId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  await runMigrations(container.getConnectionUri());
  const url = new URL(container.getConnectionUri());
  url.username = 'opensmp_app';
  url.password = 'opensmp';
  pool = new Pool({ connectionString: url.toString() });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
}, 60_000);

beforeEach(async () => {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id',
    [`tenant-${randomUUID()}`, 'Token Audit'],
  );
  tenantId = rows[0]!.id;
});

describe('SC3/C2: the audit reads what sync already inventoried', () => {
  it('asks the connector once per account and aggregates grants into applications', async () => {
    const saasAppId = await seedApp(tenantId, 3);
    const listTokens = vi.fn(async (_ctx: unknown, userKey: string) =>
      userKey === 'user-000003'
        ? [grant('shared-app', userKey)]
        : [grant('shared-app', userKey), grant('solo-app', userKey)],
    );

    const result = await runTokenAudit(
      { pool, connectorRegistry: registryFor(fakeConnector(listTokens)), encryptionKeys, logger },
      { tenantId, saasAppId },
    );

    expect(listTokens).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ scanned: 3, failed: 0, applications: 2 });

    const events = await eventsFor(tenantId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: TOKEN_AUDIT_EVENT_SOURCE,
      kind: 'token_audit_completed',
    });
    const applications = events[0]!.payload.applications as {
      clientId: string;
      userCount: number;
    }[];
    // FR1's figure, and most-granted first so a truncated list keeps the row an
    // operator most needs to see.
    expect(applications.map((a) => [a.clientId, a.userCount])).toEqual([
      ['shared-app', 3],
      ['solo-app', 2],
    ]);
  });

  it('bounds the fan-out, because one account is one HTTP request', async () => {
    const saasAppId = await seedApp(tenantId, TOKEN_AUDIT_MAX_ACCOUNTS + 5);
    const listTokens = vi.fn(async () => []);

    const result = await runTokenAudit(
      { pool, connectorRegistry: registryFor(fakeConnector(listTokens)), encryptionKeys, logger },
      { tenantId, saasAppId },
    );

    expect(listTokens).toHaveBeenCalledTimes(TOKEN_AUDIT_MAX_ACCOUNTS);
    expect(result.scanned).toBe(TOKEN_AUDIT_MAX_ACCOUNTS);
  });

  it('records a partial run as partial rather than as success or failure', async () => {
    // The first outcome in this codebase that is neither. Counting it as
    // success hides the accounts nobody read; counting it as failure discards
    // the ones that were read.
    const saasAppId = await seedApp(tenantId, 4);
    const listTokens = vi.fn(async (_ctx: unknown, userKey: string) => {
      if (userKey === 'user-000002') throw new ConnectorError('transient', true, 'boom');
      return [grant('seen-app', userKey)];
    });

    const result = await runTokenAudit(
      { pool, connectorRegistry: registryFor(fakeConnector(listTokens)), encryptionKeys, logger },
      { tenantId, saasAppId },
    );

    expect(listTokens).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ scanned: 3, failed: 1 });
    const events = await eventsFor(tenantId);
    expect(events[0]!.kind).toBe('token_audit_completed');
    expect(events[0]!.payload).toMatchObject({ scanned: 3, failed: 1 });
  });

  it('stops on an error that will repeat for every account', async () => {
    // An auth failure is a delegation problem: 999 further requests cannot
    // improve it, and issuing them is the cost this branch exists to avoid.
    const saasAppId = await seedApp(tenantId, 50);
    const listTokens = vi.fn(async () => {
      throw new ConnectorError('auth', false, 'unauthorized_client');
    });

    await expect(
      runTokenAudit(
        { pool, connectorRegistry: registryFor(fakeConnector(listTokens)), encryptionKeys, logger },
        { tenantId, saasAppId },
      ),
    ).rejects.toThrow(ConnectorError);

    expect(listTokens).toHaveBeenCalledTimes(1);
    // And it leaves a trail: the run's own transaction committed independently,
    // the way sync_failed does, so a failed audit is not silent.
    const events = await eventsFor(tenantId);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('token_audit_failed');
  });

  it('records that a connector cannot look, which is not the same as finding nothing', async () => {
    const saasAppId = await seedApp(tenantId, 2);

    const result = await runTokenAudit(
      { pool, connectorRegistry: registryFor(fakeConnector()), encryptionKeys, logger },
      { tenantId, saasAppId },
    );

    expect(result).toMatchObject({ scanned: 0, applications: 0 });
    const events = await eventsFor(tenantId);
    // SC2/C4: a distinct KIND, not `token_audit_failed` with an error string.
    // The old shape made "this connector cannot be audited" indistinguishable
    // from "the audit broke" on the one surface that reads these events.
    expect(events[0]!.kind).toBe('token_audit_unsupported');
    expect(events[0]!.payload.capability).toBe('none');
  });

  it('counts a grant the connector should not have produced, and keeps going', async () => {
    // The boundary parse, exactly as sync parses each account. What it does on
    // rejection is a deliberate call and not the one the first draft of this
    // test assumed: a malformed payload counts the ACCOUNT as failed and the
    // run continues.
    //
    // Killing the run would be the all-or-nothing behaviour this job
    // deliberately does not have, and the alternative is not silence — a
    // systematic connector defect surfaces as `scanned: 0` beside a `failed`
    // equal to the account count, which is louder than one thrown error.
    const saasAppId = await seedApp(tenantId, 2);
    const listTokens = vi.fn(async (_ctx: unknown, userKey: string) =>
      userKey === 'user-000001'
        ? [{ ...grant('x', userKey), clientId: '' } as RawToken]
        : [grant('good-app', userKey)],
    );

    const result = await runTokenAudit(
      { pool, connectorRegistry: registryFor(fakeConnector(listTokens)), encryptionKeys, logger },
      { tenantId, saasAppId },
    );

    expect(result).toMatchObject({ scanned: 1, failed: 1 });
    // The healthy account's grants still landed — a malformed neighbour must
    // not take them with it.
    const applications = (await eventsFor(tenantId))[0]!.payload.applications as {
      clientId: string;
    }[];
    expect(applications.map((a) => a.clientId)).toEqual(['good-app']);
  });

  it('runs against an application with no accounts without calling the connector', async () => {
    const saasAppId = await seedApp(tenantId, 0);
    const listTokens = vi.fn(async () => []);

    const result = await runTokenAudit(
      { pool, connectorRegistry: registryFor(fakeConnector(listTokens)), encryptionKeys, logger },
      { tenantId, saasAppId },
    );

    expect(listTokens).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 0, failed: 0, applications: 0 });
    // Still recorded: "nobody has synced this application yet" is a fact an
    // operator needs, and an audit that logs nothing looks like one that never ran.
    expect((await eventsFor(tenantId))[0]!.kind).toBe('token_audit_completed');
  });

  it.each([
    ['declares per-user-grants and has no listTokens', undefined, 'per-user-grants' as const],
    ['declares none while carrying listTokens', vi.fn(async () => []), 'none' as const],
  ])('records unsupported when a connector %s', async (_label, listTokens, capability) => {
    // Neither state can arise from a real connector — connector-registry
    // asserts that — which is exactly why only a fake can reach these arms.
    // The first would be a TypeError inside the audit loop if the method check
    // were dropped; the second is the declaration winning over a method that
    // happens to exist, which is what makes the declaration load-bearing rather
    // than decorative.
    const saasAppId = await seedApp(tenantId, 2);

    const result = await runTokenAudit(
      {
        pool,
        connectorRegistry: registryFor(fakeConnector(listTokens, capability)),
        encryptionKeys,
        logger,
      },
      { tenantId, saasAppId },
    );

    expect(result).toMatchObject({ scanned: 0, applications: 0 });
    if (listTokens) {
      expect(listTokens, 'the declaration must win over a present method').not.toHaveBeenCalled();
    }
    const events = await eventsFor(tenantId);
    expect(events[0]!.kind).toBe('token_audit_unsupported');
    expect(events[0]!.payload.capability).toBe(capability);
  });

  it('keeps its own deadline when a caller supplies a signal', async () => {
    // The sync sibling gained this cell in review round 5 and this path had no
    // counterpart at all, so collapsing `AbortSignal.any([deps.signal,
    // deadline])` back to the `??` form — which lets a caller remove the
    // deadline entirely (R43) — stayed green here. This is the longer-running of
    // the two jobs (20 minutes against 10) and it holds the same open
    // transaction.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy: MockInstance<(milliseconds: number) => AbortSignal> = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms) => realTimeout(ms));

    try {
      const saasAppId = await seedApp(tenantId, 1);
      const never = new AbortController().signal;
      let seen: AbortSignal | undefined;
      const listTokens = vi.fn(async (ctx: unknown) => {
        seen = (ctx as ConnectorContext).signal;
        return [] as RawToken[];
      });

      await runTokenAudit(
        {
          pool,
          connectorRegistry: registryFor(fakeConnector(listTokens)),
          encryptionKeys,
          logger,
          signal: never,
        },
        { tenantId, saasAppId },
      );

      expect(listTokens).toHaveBeenCalled();
      expect(never.aborted).toBe(false);
      // Not the caller's signal, and the deadline really was composed in — the
      // second assertion is what `AbortSignal.any([deps.signal])` fails.
      expect(seen, 'the connector ran under the caller-supplied signal alone').not.toBe(never);
      expect(timeoutSpy, 'no deadline was composed into the run signal').toHaveBeenCalledWith(
        TOKEN_AUDIT_DEADLINE_MS,
      );
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('stops when the run deadline has passed', async () => {
    // The sibling got this one round earlier; this path did not, so reverting
    // its signal to a never-aborting controller stayed green — the exact
    // asymmetry review kept finding.
    const saasAppId = await seedApp(tenantId, 2);
    const listTokens = vi.fn(async () => []);

    await expect(
      runTokenAudit(
        {
          pool,
          connectorRegistry: registryFor(fakeConnector(listTokens)),
          encryptionKeys,
          logger,
          signal: AbortSignal.abort(),
        },
        { tenantId, saasAppId },
      ),
    ).rejects.toThrow(/aborted/);

    expect(
      listTokens,
      'the audit asked the provider after the run was over',
    ).not.toHaveBeenCalled();
  });
});
