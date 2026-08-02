import { describe, expect, it, vi } from 'vitest';
import { ConnectorError, diagnose, waitUnlessAborted } from '../src/index.js';

// SC2, review round 3. `diagnose` and `waitUnlessAborted` live here because the
// class each closes has one member per connector — and both were hoisted with
// no test in their new home, so every property either one claims was observable
// only through whichever connector happened to exercise it.

const TOKEN = 'xoxb-0000-secret-value';

describe('diagnose', () => {
  it('removes the secret from every string it keeps', () => {
    // All four, not only message and name: `platformError` and `code` are
    // provider-controlled paths too, and each scrub shipped without a case that
    // could see it removed.
    const out = diagnose(
      Object.assign(new Error(`Bearer ${TOKEN} rejected`), {
        name: TOKEN,
        code: `code_${TOKEN}`,
        data: { error: `fail ${TOKEN}` },
      }),
      TOKEN,
    );

    expect(JSON.stringify(out)).not.toContain(TOKEN);
    for (const field of ['message', 'name', 'code', 'platformError'] as const) {
      expect(String(out[field]), field).toContain('[redacted]');
    }
  });

  it('leaves the message alone when there is no secret to remove', () => {
    // The guard, which had no observer: without it `''.split('')` explodes the
    // message into characters joined by the marker. A connector whose credential
    // is optional reaches this, and so does an unparseable service account.
    expect(diagnose(new Error('invalid_auth'), '')).toMatchObject({ message: 'invalid_auth' });
  });

  it.each([
    ['a Slack-shaped error', { statusCode: 429, data: { error: 'ratelimited' }, retryAfter: 30 }],
    // Each fixture names ONE spelling. Setting several made the arms mutually
    // redundant, so either could be deleted with the suite green.
    ['a numeric code (googleapis)', { code: 429, data: { error: 'ratelimited' } }],
    ['a bare status', { status: 429, data: { error: 'ratelimited' } }],
    ['a nested response', { response: { status: 429, data: { error: 'ratelimited' } } }],
  ])('keeps the classification from %s', (_label, shape) => {
    // BOTH shapes. Hoisting the function without widening it made every Google
    // diagnosis `{statusCode: undefined, platformError: undefined}` — the status
    // the previous `cause: error` had carried was simply lost.
    const out = diagnose(Object.assign(new Error('nope'), shape), TOKEN);

    expect(out.statusCode).toBe(429);
    expect(out.platformError).toBe('ratelimited');
  });

  it.each([
    // What googleapis ACTUALLY throws. The `error` member is an object, not a
    // string, so the fixtures above — a Slack body under a Google envelope —
    // could not tell the widened function from the unwidened one. Both live
    // spellings are named: `status` is AIP-193, `errors[0].reason` is the
    // classic Admin SDK body that directory_v1 still returns.
    [
      'the AIP-193 body',
      { code: 429, response: { status: 429, data: { error: { code: 429, message: 'Rate limit', status: 'RESOURCE_EXHAUSTED' } } } },
      'RESOURCE_EXHAUSTED',
    ],
    [
      'the classic Admin SDK body',
      {
        code: 429,
        response: {
          status: 429,
          data: {
            error: {
              code: 429,
              message: 'Rate limit',
              errors: [{ domain: 'usageLimits', reason: 'rateLimitExceeded', message: 'Rate limit' }],
            },
          },
        },
      },
      'rateLimitExceeded',
    ],
  ])('reads the platform error out of %s', (_label, shape, expected) => {
    const out = diagnose(Object.assign(new Error('nope'), shape), TOKEN);

    expect(out.statusCode).toBe(429);
    expect(out.platformError).toBe(expected);
  });

  it('copies no field that could carry the request', () => {
    // The projection is the control; the scrub is defence in depth. A whitelist
    // rather than a filter, so a shape nobody anticipated cannot smuggle a
    // header through.
    const out = diagnose(
      Object.assign(new Error('nope'), {
        config: { headers: { Authorization: `Bearer ${TOKEN}` } },
        request: { url: `https://x.example?token=${TOKEN}` },
        response: { config: { headers: { Authorization: TOKEN } } },
      }),
      'a-different-secret',
    );

    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(Object.keys(out).sort()).toEqual([
      'code',
      'message',
      'name',
      'platformError',
      'retryAfter',
      'statusCode',
    ]);
  });
});

describe('waitUnlessAborted', () => {
  const stop = () => new ConnectorError('fatal', false, 'aborted');

  it('shortens the wait rather than ending the run after it', async () => {
    // The property the first version did NOT have: it checked the signal either
    // side of a bare `setTimeout`, so an abort one millisecond in still held the
    // caller's open transaction for the rest of the wait.
    const controller = new AbortController();
    let resolveSleep: (() => void) | undefined;
    const sleep = vi.fn(() => new Promise<void>((resolve) => (resolveSleep = resolve)));

    const waiting = waitUnlessAborted(60_000, controller.signal, sleep, stop);
    controller.abort();

    await expect(waiting).rejects.toBeInstanceOf(ConnectorError);
    // The sleep is still outstanding — the wait was abandoned, not awaited.
    expect(resolveSleep).toBeTypeOf('function');
  });

  it('does not start a wait the run has already outlived', async () => {
    const sleep = vi.fn(async () => {});

    await expect(waitUnlessAborted(1, AbortSignal.abort(), sleep, stop)).rejects.toBeInstanceOf(
      ConnectorError,
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it('resolves normally when the run is still live', async () => {
    const sleep = vi.fn(async () => {});

    await expect(
      waitUnlessAborted(1, new AbortController().signal, sleep, stop),
    ).resolves.toBeUndefined();
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it('removes the listener it added when the wait completes normally', async () => {
    // Without this the listener and its closure stay on a signal that lives for
    // the whole run — up to 1000 accounts x 4 retries on one audit signal.
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const sleep = vi.fn(async () => {});

    for (let i = 0; i < 5; i += 1) {
      await waitUnlessAborted(1, controller.signal, sleep, stop);
    }

    // THE IDENTITY, not the count. Spying the call count alone was still blind
    // to the only property that makes the removal effective: removing some other
    // function leaves the leak fully in place and keeps the count at 5.
    expect(remove, 'the listener is not removed when a wait completes').toHaveBeenCalledTimes(5);
    expect(add).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i += 1) {
      expect(remove.mock.calls[i]?.[1], `wait ${i} removed a different listener`).toBe(
        add.mock.calls[i]?.[1],
      );
    }
    expect(sleep).toHaveBeenCalledTimes(5);
  });

  it('removes the listener it added when the sleep rejects', async () => {
    // The second removal site, which had no case at all: the rejection arm is
    // the one an injected or failing timer takes, and a leak there accumulates
    // on exactly the signal that lives longest.
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const sleep = vi.fn(async () => {
      throw new Error('timer broke');
    });

    for (let i = 0; i < 3; i += 1) {
      await expect(waitUnlessAborted(1, controller.signal, sleep, stop)).rejects.toThrow(
        'timer broke',
      );
    }

    expect(remove, 'the listener is not removed when the sleep rejects').toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i += 1) {
      expect(remove.mock.calls[i]?.[1], `wait ${i} removed a different listener`).toBe(
        add.mock.calls[i]?.[1],
      );
    }
  });

  it('propagates a failing sleep rather than reporting a completed wait', async () => {
    // `resolve()` in place of the rejection made an injected sleep's failure
    // look like a successful wait, and the retry loop continued.
    const sleep = vi.fn(async () => {
      throw new Error('timer broke');
    });

    await expect(
      waitUnlessAborted(1, new AbortController().signal, sleep, stop),
    ).rejects.toThrow('timer broke');
  });
});
