import { google, admin_directory_v1 } from 'googleapis';
import { ConnectorError, type ConnectorContext, type RawAccount, type SaaSConnector } from '@open-smp/connectors-core';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';
const PAGE_SIZE = 500;
const MAX_ATTEMPTS = 5;
const EPOCH_SENTINEL = '1970-01-01T00:00:00.000Z';

export type UsersListParams = admin_directory_v1.Params$Resource$Users$List;
export type UsersListResponseData = admin_directory_v1.Schema$Users;

export interface GoogleWorkspaceConnectorDeps {
  usersList?: (params: UsersListParams) => Promise<{ data: UsersListResponseData }>;
  sleep?: (ms: number) => Promise<void>;
}

export interface GoogleWorkspaceConnectorConfig {
  serviceAccountJson: string;
  impersonateAdminEmail: string;
  customerId?: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHttpStatusError(error: unknown): error is { code?: number; response?: { status?: number } } {
  return typeof error === 'object' && error !== null;
}

function statusOf(error: unknown): number | undefined {
  if (!isHttpStatusError(error)) return undefined;
  if (typeof error.code === 'number') return error.code;
  return error.response?.status;
}

function mapAccountStatus(user: admin_directory_v1.Schema$User): RawAccount['accountStatus'] {
  if (user.archived) return 'archived';
  if (user.suspended) return 'suspended';
  return 'active';
}

function mapLastActivityAt(lastLoginTime: string | null | undefined): string | null {
  if (!lastLoginTime || lastLoginTime === EPOCH_SENTINEL) return null;
  return lastLoginTime;
}

function toRawAccount(user: admin_directory_v1.Schema$User): RawAccount {
  const externalId = user.id;
  if (!externalId) {
    throw new ConnectorError('fatal', false, 'GWS user payload is missing id');
  }

  return {
    externalId,
    email: user.primaryEmail ?? null,
    displayName: user.name?.fullName ?? null,
    accountStatus: mapAccountStatus(user),
    isAdmin: Boolean(user.isAdmin) || Boolean(user.isDelegatedAdmin),
    lastActivityAt: mapLastActivityAt(user.lastLoginTime),
    raw: user,
  };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  ctx: ConnectorContext,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      const status = statusOf(error);

      if (status === 401 || status === 403) {
        throw new ConnectorError('auth', false, 'Google Workspace authentication failed', { cause: error });
      }

      const isRetryableStatus = status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
      if (!isRetryableStatus || attempt >= MAX_ATTEMPTS) {
        const kind = status === 429 ? 'rate_limit' : 'transient';
        throw new ConnectorError(kind, true, 'Google Workspace users.list failed after retries', { cause: error });
      }

      const backoffMs = 2 ** (attempt - 1) * 1000;
      const jitterMs = Math.random() * 1000;
      ctx.logger.warn('Google Workspace users.list retrying after error', {
        attempt,
        status,
        delayMs: Math.round(backoffMs + jitterMs),
      });
      await sleep(backoffMs + jitterMs);
    }
  }
}

export class GoogleWorkspaceConnector implements SaaSConnector {
  id = 'google-workspace';
  authKind: SaaSConnector['authKind'] = 'oauth2';

  private readonly cfg: GoogleWorkspaceConnectorConfig;
  private readonly deps: GoogleWorkspaceConnectorDeps;
  private cachedUsersList: GoogleWorkspaceConnectorDeps['usersList'];

  constructor(cfg: GoogleWorkspaceConnectorConfig, deps?: GoogleWorkspaceConnectorDeps) {
    this.cfg = cfg;
    this.deps = deps ?? {};
  }

  private async getUsersList(): Promise<NonNullable<GoogleWorkspaceConnectorDeps['usersList']>> {
    if (this.deps.usersList) {
      return this.deps.usersList;
    }
    if (this.cachedUsersList) {
      return this.cachedUsersList;
    }

    const serviceAccount = JSON.parse(this.cfg.serviceAccountJson) as {
      client_email: string;
      private_key: string;
    };

    const authClient = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [SCOPE],
      subject: this.cfg.impersonateAdminEmail,
    });

    const directory = google.admin({ version: 'directory_v1', auth: authClient });

    this.cachedUsersList = async (params: UsersListParams) => {
      const response = await directory.users.list(params);
      return { data: response.data };
    };

    return this.cachedUsersList;
  }

  async *listUsers(ctx: ConnectorContext): AsyncIterable<RawAccount> {
    const usersList = await this.getUsersList();
    const sleep = this.deps.sleep ?? defaultSleep;
    let pageToken: string | undefined;

    do {
      if (ctx.signal.aborted) {
        throw new ConnectorError('fatal', false, 'Google Workspace sync aborted');
      }

      const params: UsersListParams = {
        customer: this.cfg.customerId ?? 'my_customer',
        maxResults: PAGE_SIZE,
        ...(pageToken ? { pageToken } : {}),
      };

      const response = await withRetry(() => usersList(params), ctx, sleep);
      const users = response.data.users ?? [];

      for (const user of users) {
        yield toRawAccount(user);
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
}
