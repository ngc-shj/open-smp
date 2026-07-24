import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollJob, SessionExpiredError } from '../src/lib/polling';

// vi.stubGlobal is vitest's native fetch-mock mechanism; the repo has no msw
// setup and pollJob is the only fetch-dependent lib helper.
function stubFetchOnce(status: number, body?: unknown) {
  const mock = vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pollJob', () => {
  it('rejects with SessionExpiredError when the job endpoint returns 401', async () => {
    stubFetchOnce(401);

    await expect(pollJob('job-1')).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('rejects with a generic error (not SessionExpiredError) on other non-ok statuses', async () => {
    stubFetchOnce(500);

    const rejection = expect(pollJob('job-1')).rejects;
    await rejection.toThrowError('job status request failed: 500');
    stubFetchOnce(500);
    await expect(pollJob('job-1')).rejects.not.toBeInstanceOf(SessionExpiredError);
  });

  it('resolves when the job reports completed', async () => {
    stubFetchOnce(200, { state: 'completed', result: null });

    await expect(pollJob('job-1')).resolves.toBeUndefined();
  });

  it('rejects when the job reports failed', async () => {
    stubFetchOnce(200, { state: 'failed', result: null });

    await expect(pollJob('job-1')).rejects.toThrowError('job failed');
  });
});
