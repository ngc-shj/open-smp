import { google, admin_directory_v1 } from 'googleapis';
import {
  ConnectorError,
  diagnose,
  waitUnlessAborted,
  type ConnectorContext,
  type RawAccount,
  type RawToken,
  type SaaSConnector,
} from '@open-smp/connectors-core';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';

// SC3/C1. `tokens.list` needs `admin.directory.user.security`, and it is
// requested by its OWN JWT client rather than being added to the one above.
//
// WHY, and it is the load-bearing decision in this contract: domain-wide
// delegation authorizes a scope SET, and an assertion asking for a scope the
// delegation does not carry fails `unauthorized_client` for the WHOLE
// assertion. Widening `scopes: [SCOPE]` would therefore mean that any operator
// who has not yet added this scope in the admin console loses `listUsers` — and
// with it `sync`, the product's entire inventory — on upgrade. Two clients
// confine that failure to the capability that needs the scope.
//
// Marked VE3 in docs/archive/review/oauth-token-audit-plan.md: this is
// documented Google behaviour, not something any test in this repository can
// measure, because there is no real tenant here. It is stated as the reason for
// the design and NOT as a measured fact.
const TOKENS_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.security';

const PAGE_SIZE = 500;
const MAX_ATTEMPTS = 5;
const EPOCH_SENTINEL = '1970-01-01T00:00:00.000Z';

export type UsersListParams = admin_directory_v1.Params$Resource$Users$List;
export type UsersListResponseData = admin_directory_v1.Schema$Users;
export type TokensListParams = admin_directory_v1.Params$Resource$Tokens$List;
export type TokensListResponseData = admin_directory_v1.Schema$Tokens;

export interface GoogleWorkspaceConnectorDeps {
  usersList?: (params: UsersListParams) => Promise<{ data: UsersListResponseData }>;
  tokensList?: (params: TokensListParams) => Promise<{ data: TokensListResponseData }>;
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

function toRawToken(token: admin_directory_v1.Schema$Token, userKey: string): RawToken {
  const clientId = token.clientId;
  if (!clientId) {
    // Without it the grant cannot be attributed to an application, which is the
    // only thing FR1 reports — so it is fatal here rather than yielded as a row
    // that aggregates into nothing.
    throw new ConnectorError('fatal', false, 'GWS token payload is missing clientId');
  }

  return {
    clientId,
    displayName: token.displayText ?? null,
    scopes: token.scopes ?? [],
    // `?? null`, never `Boolean(...)`. Google returns these as optional, and
    // coercing an absent `anonymous` to `false` would report an application
    // Google does not recognise as one it does — the direction that hides the
    // discovery this feature exists for.
    anonymous: token.anonymous ?? null,
    nativeApp: token.nativeApp ?? null,
    userKey,
  };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  ctx: ConnectorContext,
  sleep: (ms: number) => Promise<void>,
  operation: string,
  secret: string,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      const status = statusOf(error);

      if (status === 401 || status === 403) {
        // The other member of the class SC2 fixed on the Slack side and left
        // here — with the comment that had recorded the gap deleted by the same
        // change. gaxios redacts `Authorization` by default, but that is a
        // third-party default this repository neither pins nor asserts, and the
        // config URL it does NOT redact carries an employee address.
        throw new ConnectorError('auth', false, 'Google Workspace authentication failed', {
          cause: diagnose(error, secret),
        });
      }

      const isRetryableStatus = status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
      if (!isRetryableStatus || attempt >= MAX_ATTEMPTS) {
        const kind = status === 429 ? 'rate_limit' : 'transient';
        throw new ConnectorError(kind, true, `Google Workspace ${operation} failed after retries`, {
          cause: diagnose(error, secret),
        });
      }

      const backoffMs = 2 ** (attempt - 1) * 1000;
      const jitterMs = Math.random() * 1000;
      ctx.logger.warn(`Google Workspace ${operation} retrying after error`, {
        attempt,
        status,
        delayMs: Math.round(backoffMs + jitterMs),
      });
      // The same abort-aware wait Slack uses. This connector had none, in the
      // same transaction, which is the class-with-two-members shape this cycle
      // has now paid for three times.
      await waitUnlessAborted(
        backoffMs + jitterMs,
        ctx.signal,
        sleep,
        () => new ConnectorError('fatal', false, `Google Workspace ${operation} aborted`),
      );
    }
  }
}

export class GoogleWorkspaceConnector implements SaaSConnector {
  id = 'google-workspace';
  authKind: SaaSConnector['authKind'] = 'oauth2';
  tokenCapability: SaaSConnector['tokenCapability'] = 'per-user-grants';

  private readonly cfg: GoogleWorkspaceConnectorConfig;
  private readonly deps: GoogleWorkspaceConnectorDeps;
  private cachedUsersList: GoogleWorkspaceConnectorDeps['usersList'];
  private cachedTokensList: GoogleWorkspaceConnectorDeps['tokensList'];

  constructor(cfg: GoogleWorkspaceConnectorConfig, deps?: GoogleWorkspaceConnectorDeps) {
    this.cfg = cfg;
    this.deps = deps ?? {};
  }

  /**
   * The secret handed to `diagnose`.
   *
   * The PEM, not the document containing it — passing `serviceAccountJson` made
   * the scrub a guaranteed no-op, since an exact-substring needle that is a
   * whole JSON blob matches nothing an error message carries.
   *
   * CALIBRATED, because the first correction overstated it too: the material a
   * googleapis error realistically carries is the derived `ya29.` access token
   * in `config.headers.Authorization` and the signed assertion in `config.data`,
   * and this needle matches neither. **The projection is the control** — it is a
   * whitelist, and neither `config` nor `response` is on it. The scrub covers
   * the one case the whitelist cannot: a credential echoed verbatim into `name`
   * or `message`.
   */
  private privateKey(): string {
    try {
      const parsed = JSON.parse(this.cfg.serviceAccountJson) as { private_key?: unknown };
      return typeof parsed.private_key === 'string' ? parsed.private_key : '';
    } catch {
      // An unparseable document has no key to leak, and `diagnose` treats an
      // empty secret as "nothing to scrub" rather than splitting on every
      // character.
      return '';
    }
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

  /**
   * Built lazily and SEPARATELY from the users client, so a delegation that has
   * not been granted TOKENS_SCOPE fails here and only here — see the constant's
   * comment for why that matters and why the claim is VE3 rather than measured.
   *
   * The two clients duplicate the JSON parse and the JWT construction. That is
   * the price of the isolation: sharing a builder would mean sharing a scope
   * list, which is the thing being avoided.
   */
  private async getTokensList(): Promise<NonNullable<GoogleWorkspaceConnectorDeps['tokensList']>> {
    if (this.deps.tokensList) {
      return this.deps.tokensList;
    }
    if (this.cachedTokensList) {
      return this.cachedTokensList;
    }

    const serviceAccount = JSON.parse(this.cfg.serviceAccountJson) as {
      client_email: string;
      private_key: string;
    };

    const authClient = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [TOKENS_SCOPE],
      subject: this.cfg.impersonateAdminEmail,
    });

    const directory = google.admin({ version: 'directory_v1', auth: authClient });

    this.cachedTokensList = async (params: TokensListParams) => {
      const response = await directory.tokens.list(params);
      return { data: response.data };
    };

    return this.cachedTokensList;
  }

  async listTokens(ctx: ConnectorContext, userKey: string): Promise<readonly RawToken[]> {
    if (ctx.signal.aborted) {
      throw new ConnectorError('fatal', false, 'Google Workspace token audit aborted');
    }

    const tokensList = await this.getTokensList();
    const sleep = this.deps.sleep ?? defaultSleep;

    // One request, no loop: `Schema$Tokens` carries `{kind, etag, items}` and no
    // `nextPageToken`, and `Params$Resource$Tokens$List` accepts `userKey`
    // alone. Measured from the installed googleapis types, not assumed.
    const response = await withRetry(() => tokensList({ userKey }), ctx, sleep, 'tokens.list', this.privateKey());

    return (response.data.items ?? []).map((token) => toRawToken(token, userKey));
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

      const response = await withRetry(() => usersList(params), ctx, sleep, 'users.list', this.privateKey());
      const users = response.data.users ?? [];

      for (const user of users) {
        yield toRawAccount(user);
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
}
