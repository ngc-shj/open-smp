import { describe, expect, it, vi } from 'vitest';
import { ConnectorError, type ConnectorContext, type RawAccount } from '@open-smp/connectors-core';
import {
  SlackConnector,
  toRawAccount,
  type SlackMember,
  type UsersListParams,
  type UsersListResponseData,
} from '../src/index.js';
import page1 from '../fixtures/users-page1.json' with { type: 'json' };
import page2 from '../fixtures/users-page2.json' with { type: 'json' };
import page3 from '../fixtures/users-page3.json' with { type: 'json' };

const BOT_TOKEN = 'xoxb-0000-1111-nOtARealToken';

function makeContext(): ConnectorContext {
  return {
    credentials: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    signal: new AbortController().signal,
  };
}

async function collect(iterable: AsyncIterable<RawAccount>): Promise<RawAccount[]> {
  const results: RawAccount[] = [];
  for await (const account of iterable) {
    results.push(account);
  }
  return results;
}

const PAGES = [page1, page2, page3] as unknown as UsersListResponseData[];
const ALL_MEMBERS = PAGES.flatMap((page) => page.members ?? []);

describe('SlackConnector.listUsers', () => {
  it('yields every member exactly once across a 3-page cursor run, and follows the cursor', async () => {
    const seen: UsersListParams[] = [];
    let call = 0;
    const usersList = vi.fn(async (params: UsersListParams) => {
      seen.push(params);
      const page = PAGES[call] ?? { ok: true, members: [] };
      call += 1;
      return page;
    });

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList });
    const accounts = await collect(connector.listUsers(makeContext()));

    expect(accounts).toHaveLength(5);
    expect(usersList).toHaveBeenCalledTimes(3);
    expect(new Set(accounts.map((a) => a.externalId)).size).toBe(5);

    // The cursor is read from the PREVIOUS page rather than invented, and the
    // last page's empty string ends the loop rather than requesting page 4.
    expect(seen.map((p) => p.cursor)).toEqual([undefined, 'cursor-page2', 'cursor-page3']);

    // Full-field equality on one account, so a mapping that dropped a field
    // reds here rather than in whichever assertion happened to name it.
    expect(accounts.find((a) => a.externalId === 'U0000000001')).toEqual<RawAccount>({
      externalId: 'U0000000001',
      email: 'taro.yamada@corp.example',
      displayName: 'Taro Yamada',
      accountStatus: 'active',
      isAdmin: true,
      lastActivityAt: null,
      raw: {
        id: 'U0000000001',
        team_id: 'T0001',
        name: 'taro',
        real_name: 'Taro Yamada',
        deleted: false,
        is_admin: true,
        is_owner: false,
        is_primary_owner: false,
        is_bot: false,
        is_app_user: undefined,
        is_restricted: undefined,
        is_ultra_restricted: undefined,
        profile: { email: 'taro.yamada@corp.example', display_name: 'taro' },
      },
    });

    // The bot has no email, which is a legitimately absent field rather than a
    // mapping failure — and it IS synced. See the residue note in the plan: an
    // inventory that silently drops accounts is incomplete with nothing
    // recording it, and `service_account` is the vocabulary already in the
    // product for saying what one is.
    expect(accounts.find((a) => a.externalId === 'U0000000002')?.email).toBeNull();

    // An owner is an admin here, though `is_admin` is false on that member.
    expect(accounts.find((a) => a.externalId === 'U0000000005')?.isAdmin).toBe(true);
  });

  it('does not carry the provider payload beyond the mapped subset', () => {
    // `raw` is persisted into an append-only table, so what it holds is a
    // retention decision. The fixture deliberately carries a phone number and a
    // job title that nothing maps.
    const taro = page1.members[0] as unknown as SlackMember;
    expect(taro.profile?.phone, 'the fixture no longer carries an unmapped field').toBeDefined();

    const raw = toRawAccount(taro).raw as { profile: Record<string, unknown> };

    expect(Object.keys(raw.profile).sort()).toEqual(['display_name', 'email']);
    expect(JSON.stringify(raw)).not.toContain('+81-90-0000-0000');
    expect(JSON.stringify(raw)).not.toContain('Engineer');
  });

  it('never reads a profile timestamp as activity', () => {
    // The detector for C1's Forbidden (SCL7). "lastActivityAt is always null" is
    // satisfied VACUOUSLY by a fixture with no `updated`, so the non-zero value
    // on every member is what gives the claim a failing state: a connector
    // reading `Member.updated` would produce a non-null here.
    expect(
      ALL_MEMBERS.filter((m) => typeof m.updated !== 'number' || m.updated === 0),
      'every fixture member must carry a non-zero `updated`, or this test cannot fail',
    ).toEqual([]);

    for (const member of ALL_MEMBERS) {
      expect(toRawAccount(member as SlackMember).lastActivityAt).toBeNull();
    }
  });

  it('maps the whole of `deleted` onto exactly two states', () => {
    // Set EQUALITY over both inputs, not "no fixture produces suspended" —
    // which is trivially true and proves nothing. `'suspended'` is unreachable
    // from Slack because the provider has one boolean where Google has two
    // fields, and that is a property of the mapping rather than of the fixture.
    const base = page1.members[0] as unknown as SlackMember;
    const image = new Set(
      [true, false].map((deleted) => toRawAccount({ ...base, deleted }).accountStatus),
    );

    expect([...image].sort()).toEqual(['active', 'archived']);
  });

  it('retries once on a rate limit then succeeds, without duplicate yields', async () => {
    let call = 0;
    const usersList = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // The shape @slack/web-api actually throws: `code` is a STRING, so a
        // numeric-status reading finds nothing and `retryAfter` is the signal.
        throw Object.assign(new Error('A rate limit was exceeded'), {
          code: 'slack_webapi_rate_limited_error',
          retryAfter: 30,
        });
      }
      return PAGES[2]!;
    });
    const sleep = vi.fn(async () => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });
    const accounts = await collect(connector.listUsers(makeContext()));

    expect(usersList).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(accounts.map((a) => a.externalId)).toEqual(['U0000000005']);
  });

  it.each([
    ['a platform auth error', { data: { error: 'invalid_auth' } }],
    ['a revoked token', { data: { error: 'token_revoked' } }],
    ['a missing scope', { data: { error: 'missing_scope' } }],
    ['an HTTP 403', { statusCode: 403 }],
  ])('maps %s to a non-retryable auth failure', async (_label, shape) => {
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('nope'), shape);
    });
    const sleep = vi.fn(async () => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });

    await expect(collect(connector.listUsers(makeContext()))).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
    // Retrying a revoked token or a missing scope spends attempts on a state
    // that cannot change within a run.
    expect(usersList).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after max attempts on repeated 5xx and reports transient, retryable', async () => {
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('Internal Error'), { statusCode: 500 });
    });
    const sleep = vi.fn(async () => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });

    let caught: unknown;
    try {
      await collect(connector.listUsers(makeContext()));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConnectorError);
    expect(caught).toMatchObject({ kind: 'transient', retryable: true });
    expect(usersList).toHaveBeenCalledTimes(5);
  });

  it('never puts the bearer token into a message the audit trail will keep', async () => {
    // apps/worker/src/sync.ts writes `error.message` into discovery_events,
    // whose UPDATE and DELETE are REVOKEd — so a message carrying the token is
    // unredactable by the application. A Slack bot token is a directly
    // replayable bearer credential, which is what makes this different from the
    // Google connector's signing key even though the storage path is identical.
    const usersList = vi.fn(async () => {
      // The realistic leak: an SDK error whose message echoes the request.
      throw Object.assign(new Error(`request failed: Authorization: Bearer ${BOT_TOKEN}`), {
        statusCode: 500,
      });
    });
    const sleep = vi.fn(async () => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });

    let caught: unknown;
    try {
      await collect(connector.listUsers(makeContext()));
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).not.toContain(BOT_TOKEN);
    // The provider error is not discarded — it travels in `cause`, which sync
    // does not read. Without this the assertion above is satisfied by throwing
    // away the diagnosis.
    expect(((caught as Error).cause as Error).message).toContain(BOT_TOKEN);
  });

  it('builds a client per instance, never one shared across tenants', () => {
    // One worker process serves every tenant. A module-scope memoised client —
    // the idiom this SDK's own examples use — would write tenant A's members
    // into tenant B's `saas_accounts` inside `withTenant(B)`, past RLS, past the
    // composite tenant foreign key, and past the credential AAD binding.
    //
    // No network is involved: `new WebClient(token)` performs no I/O, so what
    // is asserted is that two connectors resolve two different functions.
    const a = new SlackConnector({ botToken: 'xoxb-tenant-a' });
    const b = new SlackConnector({ botToken: 'xoxb-tenant-b' });

    expect(a.resolveUsersList()).not.toBe(b.resolveUsersList());
    // ...and that one instance still caches, or the assertion above would hold
    // for a connector that rebuilt a client on every page of every run.
    expect(a.resolveUsersList()).toBe(a.resolveUsersList());
  });

  it('declares no token capability at all', () => {
    // The first connector in this repository that answers "no". The branch in
    // apps/worker/src/token-audit.ts has existed since SC3 and only ever been
    // taken by a fake; `typeof connector.listTokens === 'function'` is the whole
    // capability model until C4 replaces it.
    const connector = new SlackConnector({ botToken: BOT_TOKEN });

    expect('listTokens' in connector).toBe(false);
    expect(connector.authKind).toBe('apikey');
    // PINNED, and not merely "not per-user-grants". `workspace-apps` is the
    // shape Slack's admin.apps.approved.list actually has, and declaring it
    // here would claim a capability these credentials cannot exercise — the
    // overstated-control failure one level up from the one C4 replaces.
    // Measured in review: without this line that mutation survived the whole
    // tree, including the plan's own mutation table claiming it redded.
    expect(connector.tokenCapability).toBe('none');
  });
});
