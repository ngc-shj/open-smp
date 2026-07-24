import { describe, expect, it, vi } from 'vitest';
import { ConnectorError, type ConnectorContext, type RawAccount } from '@open-smp/connectors-core';
import { GoogleWorkspaceConnector, type UsersListResponseData } from '../src/index.js';
import page1 from '../fixtures/users-page1.json' with { type: 'json' };
import page2 from '../fixtures/users-page2.json' with { type: 'json' };
import page3 from '../fixtures/users-page3.json' with { type: 'json' };

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

describe('GoogleWorkspaceConnector.listUsers', () => {
  it('yields all users exactly once across a 3-page fixture run with correct field mapping', async () => {
    const pages: UsersListResponseData[] = [page1, page2, page3];
    let call = 0;
    const usersList = vi.fn(async () => {
      const data = pages[call] ?? { users: [] };
      call += 1;
      return { data };
    });

    const connector = new GoogleWorkspaceConnector(
      { serviceAccountJson: '{}', impersonateAdminEmail: 'admin@corp.example' },
      { usersList },
    );

    const accounts = await collect(connector.listUsers(makeContext()));

    expect(accounts).toHaveLength(5);
    expect(usersList).toHaveBeenCalledTimes(3);

    const externalIds = accounts.map((a) => a.externalId);
    expect(new Set(externalIds).size).toBe(5);
    expect(externalIds).not.toContain('taro.yamada@corp.example');

    const taro = accounts.find((a) => a.externalId === '100000000000000000001');
    expect(taro).toEqual<RawAccount>({
      externalId: '100000000000000000001',
      email: 'taro.yamada@corp.example',
      displayName: 'Taro Yamada',
      accountStatus: 'active',
      isAdmin: true,
      lastActivityAt: '2026-07-01T09:15:00.000Z',
      raw: page1.users[0],
    });

    const epochUser = accounts.find((a) => a.externalId === '100000000000000000002');
    expect(epochUser?.lastActivityAt).toBeNull();

    const suspendedDelegatedAdmin = accounts.find((a) => a.externalId === '100000000000000000003');
    expect(suspendedDelegatedAdmin?.accountStatus).toBe('suspended');
    expect(suspendedDelegatedAdmin?.isAdmin).toBe(true);

    const archivedAndSuspended = accounts.find((a) => a.externalId === '100000000000000000004');
    expect(archivedAndSuspended?.accountStatus).toBe('archived');
  });

  it('retries once on a 429 then succeeds, without duplicate yields', async () => {
    let call = 0;
    const usersList = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        const error = Object.assign(new Error('Too Many Requests'), { code: 429 });
        throw error;
      }
      return { data: page3 as UsersListResponseData };
    });
    const sleep = vi.fn(async () => {});

    const connector = new GoogleWorkspaceConnector(
      { serviceAccountJson: '{}', impersonateAdminEmail: 'admin@corp.example' },
      { usersList, sleep },
    );

    const accounts = await collect(connector.listUsers(makeContext()));

    expect(usersList).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(accounts).toHaveLength(1);
    expect(accounts.map((a) => a.externalId)).toEqual(['100000000000000000005']);
  });

  it('maps a 401/403 response to a non-retryable ConnectorError with kind auth', async () => {
    const usersList = vi.fn(async () => {
      const error = Object.assign(new Error('Forbidden'), { code: 403 });
      throw error;
    });
    const sleep = vi.fn(async () => {});

    const connector = new GoogleWorkspaceConnector(
      { serviceAccountJson: '{}', impersonateAdminEmail: 'admin@corp.example' },
      { usersList, sleep },
    );

    await expect(collect(connector.listUsers(makeContext()))).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
    expect(usersList).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after max attempts on repeated 5xx and reports transient, retryable', async () => {
    const usersList = vi.fn(async () => {
      const error = Object.assign(new Error('Internal Error'), { code: 500 });
      throw error;
    });
    const sleep = vi.fn(async () => {});

    const connector = new GoogleWorkspaceConnector(
      { serviceAccountJson: '{}', impersonateAdminEmail: 'admin@corp.example' },
      { usersList, sleep },
    );

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
});
