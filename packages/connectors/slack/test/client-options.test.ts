import { beforeEach, describe, expect, it, vi } from 'vitest';

// SC2, review round 2. The mutation this file refutes was DECLARED a survivor:
// "removing `retryConfig: { retries: 0 }` is unobservable, because injection
// bypasses WebClient and the only observer would assert about the SDK."
//
// That was wrong. Mocking the constructor observes what THIS CONNECTOR PASSES,
// which is a property of this repository — the SDK's behaviour given those
// options is measured in the source comment and is not what this asserts.
//
// The options matter enough to pin: the defaults are ten retries over ~30
// minutes, no request timeout at all, and a rate limit absorbed internally and
// rethrown in a shape the classifier cannot see.
const construct = vi.fn();

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    constructor(token: string, options?: unknown) {
      construct(token, options);
    }
    users = { list: async () => ({ ok: true, members: [] }) };
  },
}));

const { SlackConnector } = await import('../src/index.js');

// In a hook, not in the body: a second cell added to this file would otherwise
// inherit the first's calls and `toHaveBeenCalledTimes(1)` would red for a
// reason that names nothing.
beforeEach(() => {
  construct.mockClear();
});

describe('the Slack client this connector builds', () => {
  it('overrides every default that would defeat its own retry contract', () => {
    new SlackConnector({ botToken: 'xoxb-not-real' }).resolveUsersList();

    expect(construct).toHaveBeenCalledTimes(1);
    const [token, options] = construct.mock.calls[0]!;
    expect(token).toBe('xoxb-not-real');
    expect(options).toMatchObject({
      // Zero, so MAX_ATTEMPTS is the real bound rather than a fifth of it.
      retryConfig: { retries: 0 },
      // True, so a 429 arrives as WebAPIRateLimitedError — the shape
      // isRateLimited was written for.
      rejectRateLimitedCalls: true,
    });
    // Any positive timeout: the default of 0 applies no AbortSignal at all, and
    // a hung request holds an open transaction. The VALUE is a tuning choice
    // and is deliberately not pinned.
    expect((options as { timeout: number }).timeout).toBeGreaterThan(0);
  });
});
