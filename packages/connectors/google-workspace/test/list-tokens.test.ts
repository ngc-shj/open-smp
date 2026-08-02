import { describe, expect, it, vi } from 'vitest';
import { ConnectorError, type ConnectorContext } from '@open-smp/connectors-core';
import {
  GoogleWorkspaceConnector,
  type GoogleWorkspaceConnectorDeps,
  type TokensListParams,
  type TokensListResponseData,
} from '../src/index.js';
import tokens from '../fixtures/tokens-mixed.json' with { type: 'json' };

// SC3/C1. VE1 puts the real call out of reach — there is no Google Workspace
// tenant here and the compose stack's credentials are fake — so what this tier
// can prove is the mapping and the request shape, through the same injection
// seam list-users.test.ts uses. What it CANNOT prove is that the Google call
// works at all, and the plan says so rather than implying otherwise.

const USER = 'gws-user-001';

function makeContext(signal?: AbortSignal): ConnectorContext {
  return {
    credentials: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    signal: signal ?? new AbortController().signal,
  };
}

type TokensList = NonNullable<GoogleWorkspaceConnectorDeps['tokensList']>;

function connectorWith(tokensList: TokensList): GoogleWorkspaceConnector {
  return new GoogleWorkspaceConnector(
    { serviceAccountJson: '{}', impersonateAdminEmail: 'admin@corp.example' },
    // A no-op sleep, so the retry path's backoff does not put five seconds of
    // real time into the suite.
    { tokensList, sleep: async () => undefined },
  );
}

describe('GoogleWorkspaceConnector.listTokens', () => {
  it('maps every grant in one response, preserving the aggregation key', async () => {
    const tokensList = vi.fn(async () => ({ data: tokens as TokensListResponseData }));

    const result = await connectorWith(tokensList).listTokens(makeContext(), USER);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      clientId: '407408718192.apps.googleusercontent.com',
      displayName: 'Registered Analytics Tool',
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      anonymous: false,
      nativeApp: false,
      userKey: USER,
    });
  });

  it('keeps "the provider did not say" distinct from false', async () => {
    // The third fixture grant carries no `anonymous` and no `nativeApp`.
    // `Boolean(undefined)` is false, and reporting an application Google does
    // not recognise as one it DOES recognise hides exactly the discovery this
    // feature exists for. Absence is a third state.
    const tokensList = vi.fn(async () => ({ data: tokens as TokensListResponseData }));

    const result = await connectorWith(tokensList).listTokens(makeContext(), USER);

    expect(result[2]).toMatchObject({ anonymous: null, nativeApp: null, displayName: null });
    // And the paired direction, or a mapper that returned null for everything
    // would satisfy the assertion above (RT10).
    expect(result[1]).toMatchObject({ anonymous: true, displayName: 'Nobody Registered This' });
  });

  it('defaults an ABSENT scope list to empty rather than to undefined', async () => {
    // The third fixture grant carries no `scopes` KEY. An earlier draft gave it
    // `"scopes": []`, and the mutation that drops the `?? []` survived — the
    // fixture did not contain the case the test named, so the assertion held
    // either way. Absent and empty are the same result and different inputs.
    const tokensList = vi.fn(async () => ({ data: tokens as TokensListResponseData }));

    const result = await connectorWith(tokensList).listTokens(makeContext(), USER);

    expect(result[2]!.scopes).toEqual([]);
    // Not merely equal to [] — an `undefined` reaching the worker's zod parse
    // would be rejected there, but only after it had already crossed.
    expect(Array.isArray(result[2]!.scopes)).toBe(true);
  });

  it('asks for one user and nothing else', async () => {
    // Measured from the installed types: Params$Resource$Tokens$List accepts
    // `userKey` alone — no pageToken, no maxResults, no customer. A request
    // carrying more would be sending parameters the endpoint does not define.
    const tokensList = vi.fn(async (_params: TokensListParams) => ({
      data: tokens as TokensListResponseData,
    }));

    await connectorWith(tokensList).listTokens(makeContext(), USER);

    expect(tokensList).toHaveBeenCalledTimes(1);
    // The params, asserted exactly; the second argument is the per-request
    // transport options (abort signal), which are not endpoint parameters.
    expect(tokensList.mock.calls[0]?.[0]).toEqual({ userKey: USER });
  });

  it('issues no request at all for an already-aborted run', async () => {
    const tokensList = vi.fn(async () => ({ data: tokens as TokensListResponseData }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      connectorWith(tokensList).listTokens(makeContext(controller.signal), USER),
    ).rejects.toThrow(ConnectorError);
    // The check must come BEFORE the call, or an aborted run still spends a
    // request against the per-user fan-out this capability is bounded by.
    expect(tokensList).not.toHaveBeenCalled();
  });

  it('answers an empty grant list with an empty array, not an error', async () => {
    const tokensList = vi.fn(async () => ({ data: { kind: 'admin#directory#tokenList' } }));

    const result = await connectorWith(tokensList).listTokens(makeContext(), USER);

    // `items` is absent when a user has granted nothing, which is the ordinary
    // case for most accounts and must not read as a failure.
    expect(result).toEqual([]);
  });

  it('refuses a grant with no clientId rather than yielding one that aggregates into nothing', async () => {
    const tokensList = vi.fn(async () => ({
      data: { items: [{ displayText: 'Anonymous', userKey: USER }] } as TokensListResponseData,
    }));

    await expect(connectorWith(tokensList).listTokens(makeContext(), USER)).rejects.toThrow(
      /missing clientId/,
    );
  });

  it('reports a failed token read as tokens.list, not as users.list', async () => {
    // The retry helper is shared with listUsers and used to name that operation
    // unconditionally. A token failure reporting "users.list failed" sends the
    // reader to the wrong call.
    const tokensList = vi.fn(async () => {
      throw { code: 500 };
    });

    await expect(connectorWith(tokensList).listTokens(makeContext(), USER)).rejects.toThrow(
      /tokens\.list failed after retries/,
    );
  });
});
