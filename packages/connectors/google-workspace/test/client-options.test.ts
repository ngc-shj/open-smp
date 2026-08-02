import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorError } from '@open-smp/connectors-core';

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
const jwt = vi.fn();
const admin = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      // RECORDING, not `class {}`. The first version of this file discarded the
      // constructor argument, so it was the only file in the repository that
      // reaches the real client builders and it asserted nothing about them —
      // widening `scopes: [TOKENS_SCOPE]` to `[SCOPE, TOKENS_SCOPE]` left every
      // gate green, which is the exact widening the source comment says must not
      // happen. The Slack sibling has asserted its constructor's token since
      // round 2.
      JWT: class {
        constructor(options: unknown) {
          jwt(options);
        }
      },
    },
    admin: (options: unknown) => {
      admin(options);
      return { users: { list: usersList }, tokens: { list: tokensList } };
    },
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
  jwt.mockClear();
  admin.mockClear();
});

describe('the Google clients this connector builds', () => {
  it.each([
    [
      'users.list',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      async (connector: InstanceType<typeof GoogleWorkspaceConnector>) => {
        for await (const _ of connector.listUsers(makeContext(new AbortController().signal))) {
          // drained
        }
      },
    ],
    [
      'tokens.list',
      'https://www.googleapis.com/auth/admin.directory.user.security',
      async (connector: InstanceType<typeof GoogleWorkspaceConnector>) => {
        await connector.listTokens(makeContext(new AbortController().signal), 'user-1');
      },
    ],
  ])('asks %s for exactly one scope', async (_label, scope, drive) => {
    // SC3/C1's load-bearing decision: domain-wide delegation authorises a scope
    // SET, and an assertion asking for a scope the delegation does not carry
    // fails `unauthorized_client` for the WHOLE assertion — so widening either
    // client's scopes would take the other capability down for every operator
    // who has not updated their admin console. Nothing anywhere asserted it.
    const connector = new GoogleWorkspaceConnector({
      serviceAccountJson: SERVICE_ACCOUNT,
      impersonateAdminEmail: 'admin@corp.example',
    });

    await drive(connector);

    expect(jwt).toHaveBeenCalledTimes(1);
    expect(jwt.mock.calls[0]?.[0]).toMatchObject({
      email: 'a@b.iam.gserviceaccount.com',
      subject: 'admin@corp.example',
      scopes: [scope],
    });
    expect(admin).toHaveBeenCalledWith(expect.objectContaining({ version: 'directory_v1' }));
  });

  it.each([
    [
      'users.list',
      async (c: InstanceType<typeof GoogleWorkspaceConnector>) => {
        for await (const _ of c.listUsers(makeContext(new AbortController().signal))) {
          // drained
        }
      },
    ],
    [
      'tokens.list',
      async (c: InstanceType<typeof GoogleWorkspaceConnector>) => {
        await c.listTokens(makeContext(new AbortController().signal), 'user-1');
      },
    ],
  ])(
    'reports an unparseable service account as a fixed string on the %s path',
    async (_l, drive) => {
      // These two parses run OUTSIDE `withRetry`, so a `SyntaxError` never reaches
      // `diagnose` and is never scrubbed — and `runSync` writes `error.message`
      // verbatim into `discovery_events`, whose UPDATE and DELETE are REVOKEd.
      // V8's message embeds the first ten characters of its input, so a pasted
      // document's prefix would be written to an unredactable table.
      const connector = new GoogleWorkspaceConnector({
        serviceAccountJson: 'MIIEvQIBADANBgkqhkiG9w0-not-json',
        impersonateAdminEmail: 'admin@corp.example',
      });

      const caught = await drive(connector).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(caught).toBeInstanceOf(ConnectorError);
      expect((caught as Error).message).toBe(
        'google-workspace serviceAccountJson is not valid JSON',
      );
      expect((caught as Error).message).not.toContain('MIIEvQIBAD');
    },
  );

  it('bounds the token exchange, which the per-request options cannot reach', async () => {
    // The JWT client issues its own request to obtain an access token, from its
    // own transporter, on the first hop of every sync — inside runSync's open
    // withTenant transaction. `requestOptions` is applied to `users.list`, not to
    // that hop, and google-auth-library supplies no timeout of its own.
    const connector = new GoogleWorkspaceConnector({
      serviceAccountJson: SERVICE_ACCOUNT,
      impersonateAdminEmail: 'admin@corp.example',
    });

    for await (const _ of connector.listUsers(makeContext(new AbortController().signal))) {
      // drained
    }

    const options = jwt.mock.calls[0]?.[0] as
      { transporterOptions?: { timeout?: number } } | undefined;
    expect(options?.transporterOptions?.timeout).toBeGreaterThan(0);
  });

  it('parses the service-account document once per client, not once per request', async () => {
    // The sibling cell in list-users.test.ts injects `usersList`, so it never
    // reaches the two parses that build the real clients — it measures the memo
    // and calls it the class. This file is the only one on the production path.
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const connector = new GoogleWorkspaceConnector({
        serviceAccountJson: SERVICE_ACCOUNT,
        impersonateAdminEmail: 'admin@corp.example',
      });

      for await (const _ of connector.listUsers(makeContext(new AbortController().signal))) {
        // drained
      }
      for await (const _ of connector.listUsers(makeContext(new AbortController().signal))) {
        // drained
      }

      // Non-vacuity: the run really did issue requests through the built client.
      expect(usersList).toHaveBeenCalledTimes(2);
      const parses = parse.mock.calls.filter((args) => args[0] === SERVICE_ACCOUNT).length;
      // One for the client, one for the scrub needle — and NOT one per request,
      // which is what mints an unclearable PEM string on every call.
      expect(parses).toBeLessThanOrEqual(2);
    } finally {
      parse.mockRestore();
    }
  });

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
      { retry?: boolean; timeout?: number; signal?: AbortSignal } | undefined;

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
