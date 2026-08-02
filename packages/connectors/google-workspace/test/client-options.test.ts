import { beforeEach, describe, expect, it, vi } from 'vitest';

// SC2, review round 6. The Slack sibling of this file was written in round 2,
// and this connector was still on the SDK's defaults four rounds later — the
// one-member-per-connector class this cycle has now paid for four times.
//
// What the defaults were: googleapis-common sets `options.retry = true` unless
// asked otherwise, arming gaxios' interceptor (3 retries on GET for 408/429/5xx
// plus 2 network retries) UNDER this connector's own `withRetry` loop, so
// MAX_ATTEMPTS of 5 was really up to ~20 requests with two backoff schedules
// stacked; and gaxios applies a timeout only when one is supplied, so there was
// none while the connector runs inside an open `withTenant` transaction.
//
// The same argument the Slack file makes applies: mocking the SDK observes what
// THIS CONNECTOR PASSES, which is a property of this repository. The SDK's
// behaviour given those options is measured in the source comment, not here.
const usersList = vi.fn(async (_params: unknown, _options?: unknown) => ({
  data: { users: [] },
}));
const tokensList = vi.fn(async (_params: unknown, _options?: unknown) => ({
  data: { items: [] },
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: class {} },
    admin: () => ({ users: { list: usersList }, tokens: { list: tokensList } }),
  },
  admin_directory_v1: {},
}));

const { GoogleWorkspaceConnector } = await import('../src/index.js');

const SERVICE_ACCOUNT = JSON.stringify({
  client_email: 'a@b.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nDEMO\n-----END PRIVATE KEY-----\n',
});

function makeContext(signal: AbortSignal) {
  return {
    credentials: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    signal,
  };
}

beforeEach(() => {
  usersList.mockClear();
  tokensList.mockClear();
});

describe('the Google clients this connector builds', () => {
  it.each([
    [
      'users.list',
      usersList,
      async (connector: InstanceType<typeof GoogleWorkspaceConnector>, signal: AbortSignal) => {
        for await (const _ of connector.listUsers(makeContext(signal))) {
          // drained; the fixture yields nothing
        }
      },
    ],
    [
      'tokens.list',
      tokensList,
      async (connector: InstanceType<typeof GoogleWorkspaceConnector>, signal: AbortSignal) => {
        await connector.listTokens(makeContext(signal), 'user-1');
      },
    ],
  ])('overrides the SDK defaults on %s', async (_label, spy, drive) => {
    // Both clients, because they are built separately (SC3/C1 keeps the scopes
    // apart) and an option applied to one is not applied to the other.
    const controller = new AbortController();
    const connector = new GoogleWorkspaceConnector({
      serviceAccountJson: SERVICE_ACCOUNT,
      impersonateAdminEmail: 'admin@corp.example',
    });

    await drive(connector, controller.signal);

    expect(spy).toHaveBeenCalledTimes(1);
    const options = spy.mock.calls[0]?.[1] as
      | { retry?: boolean; timeout?: number; signal?: AbortSignal }
      | undefined;

    // False, so `withRetry`'s MAX_ATTEMPTS is the real bound rather than a
    // quarter of it.
    expect(options?.retry).toBe(false);
    // Any positive timeout: without one gaxios applies no deadline at all. The
    // VALUE is a tuning choice and is deliberately not pinned.
    expect(options?.timeout).toBeGreaterThan(0);
    // The run's signal, so an abort cuts an in-flight request rather than only
    // the gap between pages.
    expect(options?.signal).toBe(controller.signal);
  });
});
