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

// Annotated, not double-cast. `as unknown as` turned off the one drift check
// available at this boundary: SlackMember is derived FROM UsersListResponse so
// an upstream rename is a compile error, and the cast undid that for the
// fixtures. Found in review.
const PAGES: UsersListResponseData[] = [page1, page2, page3];
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
    // The page size too. Asserting only the cursor left PAGE_SIZE free to move:
    // 200 → 1 passed 13/13 and multiplies calls per sync by 200.
    expect(new Set(seen.map((p) => p.limit))).toEqual(new Set([200]));

    // Full-field equality on one account, so a mapping that dropped a field
    // reds here rather than in whichever assertion happened to name it.
    // toStrictEqual, not toEqual. `toEqual` treats a key valued `undefined` as
    // absent, so deleting is_app_user / is_restricted / is_ultra_restricted from
    // narrowRaw passed 13/13 — precisely the fields whose retention the source
    // comment justifies. Measured in review as mutation M11.
    expect(accounts.find((a) => a.externalId === 'U0000000001')).toStrictEqual<RawAccount>({
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
    const taro: SlackMember = page1.members[0]!;
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
      expect(toRawAccount(member).lastActivityAt).toBeNull();
    }
  });

  it('maps the whole of `deleted` onto exactly two states', () => {
    // Set EQUALITY over both inputs, not "no fixture produces suspended" —
    // which is trivially true and proves nothing. `'suspended'` is unreachable
    // from Slack because the provider has one boolean where Google has two
    // fields, and that is a property of the mapping rather than of the fixture.
    const base: SlackMember = page1.members[0]!;
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
    const sleep = vi.fn(async (_ms: number) => {});

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
    const sleep = vi.fn(async (_ms: number) => {});

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

  it('scrubs the token on the auth branch too, not only on the retry branch', async () => {
    // Review round 2: the scrub was asserted on ONE of the two throw sites, and
    // a 401 whose SDK message echoes the Authorization header takes the other.
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error(`401 for Authorization: Bearer ${BOT_TOKEN}`), {
        data: { error: 'invalid_auth' },
      });
    });

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList });

    let caught: unknown;
    try {
      await collect(connector.listUsers(makeContext()));
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).not.toContain(BOT_TOKEN);
    expect(JSON.stringify((caught as Error).cause)).not.toContain(BOT_TOKEN);
    expect((caught as Error).cause).toMatchObject({ platformError: 'invalid_auth' });
  });

  it('gives up after max attempts on repeated 5xx and reports transient, retryable', async () => {
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('Internal Error'), { statusCode: 500 });
    });
    const sleep = vi.fn(async (_ms: number) => {});

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
    const sleep = vi.fn(async (_ms: number) => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });

    let caught: unknown;
    try {
      await collect(connector.listUsers(makeContext()));
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).not.toContain(BOT_TOKEN);
    // And NOT in `cause` either. The previous form pinned the token there on
    // the reasoning that sync reads only `.message` — which made disclosure a
    // convention held at every consumer, on a file whose own comment says
    // convention is insufficient. `console.error(msg, { error })` inspects the
    // whole chain. Review found it; the cause is now a scrubbed diagnosis.
    expect(JSON.stringify((caught as Error).cause)).not.toContain(BOT_TOKEN);
    // The diagnosis survives the scrubbing, or the assertion above would be
    // satisfied by discarding it.
    expect((caught as Error).cause).toMatchObject({ statusCode: 500 });
    expect(JSON.stringify((caught as Error).cause)).toContain('[redacted]');
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

  it('stops paging when the run is cancelled', async () => {
    // The abort guard had no case at all, neither side: makeContext() always
    // supplied a live signal, so deleting the check passed 13/13 and a
    // cancelled sync would have kept paging. sync.ts now supplies a real
    // deadline signal, which is what makes this guard reachable in production.
    const controller = new AbortController();
    const usersList = vi.fn(async () => {
      controller.abort();
      return PAGES[0]!;
    });

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList });
    const ctx = { ...makeContext(), signal: controller.signal };

    await expect(collect(connector.listUsers(ctx))).rejects.toMatchObject({ kind: 'fatal' });
    // One page was read and yielded before the abort was observed; the SECOND
    // request is the one that must not happen.
    expect(usersList).toHaveBeenCalledTimes(1);
  });

  it('classifies a rate limit as a rate limit, and waits as long as the provider asked', async () => {
    // Both halves were unasserted. Forcing `kind` to 'transient' passed 13/13,
    // and `sleep(0)` passed 13/13 because sleep was checked by call count only —
    // so a provider-mandated 30s wait was served with ~1s and the next attempt
    // met the same limit.
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('A rate limit was exceeded'), {
        code: 'slack_webapi_rate_limited_error',
        retryAfter: 30,
      });
    });
    const sleep = vi.fn(async (_ms: number) => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });

    await expect(collect(connector.listUsers(makeContext()))).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
    expect(usersList).toHaveBeenCalledTimes(5);
    // Every wait is at least the mandated 30s, and none is the ~1s the
    // exponential schedule alone would have produced on attempt 1.
    expect(sleep.mock.calls.length).toBeGreaterThan(0);
    for (const call of sleep.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(30_000);
    }
  });

  it('does not classify a stray retryAfter property as a rate limit', () => {
    // `'retryAfter' in error` fired on any object carrying the property,
    // whatever its value. RT10's allow side for the typed replacement.
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { retryAfter: 'soon', statusCode: 500 });
    });
    const sleep = vi.fn(async (_ms: number) => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });

    return expect(collect(connector.listUsers(makeContext()))).rejects.toMatchObject({
      kind: 'transient',
    });
  });

  it('waits on its own schedule when the provider named no delay', async () => {
    // The other arm. The rate-limit test's mandated 30s dominates the max(), so
    // `delayMs = mandatedMs` survived it — every 5xx retry would then sleep 0ms.
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('Internal Error'), { statusCode: 500 });
    });
    const sleep = vi.fn(async (_ms: number) => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });
    await expect(collect(connector.listUsers(makeContext()))).rejects.toMatchObject({
      kind: 'transient',
    });

    expect(sleep.mock.calls.length).toBe(4);
    for (const call of sleep.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(1000);
    }
  });

  it('caps a provider-mandated wait', async () => {
    // `Retry-After` has no upper bound on the wire, and the wait happens inside
    // the sync transaction. A `retry-after: 2000000` held it for weeks; above
    // 2^31 ms Node fires immediately and the same header becomes a hot loop.
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('rate limited'), { retryAfter: 2_000_000 });
    });
    const sleep = vi.fn(async (_ms: number) => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });
    await expect(collect(connector.listUsers(makeContext()))).rejects.toMatchObject({
      kind: 'rate_limit',
    });

    for (const call of sleep.mock.calls) {
      expect(call[0]).toBeLessThanOrEqual(60_000);
    }
  });

  it.each([
    ['an HTTP 429', { statusCode: 429 }],
    ['the ratelimited platform code', { data: { error: 'ratelimited' } }],
  ])('classifies %s as a rate limit', async (_label, shape) => {
    // Two of the three arms had no case at all — deleting either passed 16/16.
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('slow down'), shape);
    });
    const sleep = vi.fn(async (_ms: number) => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });

    await expect(collect(connector.listUsers(makeContext()))).rejects.toMatchObject({
      kind: 'rate_limit',
    });
  });

  it('retries a transport failure, which nothing else would', async () => {
    // Setting `retries: 0` on the SDK moved this class here. Before that clause
    // a socket error or one of the new 30-second timeouts was retried by
    // NOTHING — not the SDK, not withRetry, and not BullMQ, whose sync job runs
    // `attempts: 1`. One slow response was a terminal sync failure.
    let call = 0;
    const usersList = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        throw Object.assign(new Error('A request error occurred'), {
          code: 'slack_webapi_request_error',
        });
      }
      return PAGES[2]!;
    });
    const sleep = vi.fn(async (_ms: number) => {});

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });
    const accounts = await collect(connector.listUsers(makeContext()));

    expect(usersList).toHaveBeenCalledTimes(2);
    expect(accounts.map((a) => a.externalId)).toEqual(['U0000000005']);
  });

  it('does not wait out a retry after the run is over', async () => {
    // The wait is where a deadline used to be unobservable: the paging loop
    // polls the signal only between pages, and defaultSleep never looked at it.
    const controller = new AbortController();
    const usersList = vi.fn(async () => {
      throw Object.assign(new Error('Internal Error'), { statusCode: 500 });
    });
    const sleep = vi.fn(async (_ms: number) => {
      controller.abort();
    });

    const connector = new SlackConnector({ botToken: BOT_TOKEN }, { usersList, sleep });
    const ctx = { ...makeContext(), signal: controller.signal };

    await expect(collect(connector.listUsers(ctx))).rejects.toMatchObject({ kind: 'fatal' });
    // One request, one wait, then out — not the five attempts the schedule
    // would otherwise have spent.
    expect(usersList).toHaveBeenCalledTimes(1);
  });
});
