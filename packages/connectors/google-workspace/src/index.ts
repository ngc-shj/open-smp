import { google, admin_directory_v1 } from 'googleapis';
import {
  ConnectorError,
  REQUEST_TIMEOUT_MS,
  diagnose,
  isTransportError,
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

/**
 * What the connector forwards to the SDK per request.
 *
 * `signal` is threaded rather than left to the run-level deadline: without it
 * `AbortSignal.timeout(SYNC_DEADLINE_MS)` only takes effect BETWEEN pages and
 * between retries, so an in-flight `users.list` that never answers holds the
 * open `withTenant` transaction regardless.
 */
export interface GoogleRequestOptions {
  signal?: AbortSignal;
}

export interface GoogleWorkspaceConnectorDeps {
  usersList?: (
    params: UsersListParams,
    options?: GoogleRequestOptions,
  ) => Promise<{ data: UsersListResponseData }>;
  tokensList?: (
    params: TokensListParams,
    options?: GoogleRequestOptions,
  ) => Promise<{ data: TokensListResponseData }>;
  sleep?: (ms: number) => Promise<void>;
}

export interface GoogleWorkspaceConnectorConfig {
  serviceAccountJson: string;
  impersonateAdminEmail: string;
  customerId?: string;
}

/**
 * The service-account document, or a fixed-string failure.
 *
 * `JSON.parse`'s own message embeds the first ten characters of its input
 * ("Unexpected token 'M', \"MIIEvQIBAD\"... is not valid JSON"), and these two
 * parses run OUTSIDE `withRetry` — so a `SyntaxError` never reaches `diagnose`
 * and is never scrubbed. `runSync` writes `error.message` verbatim into
 * `discovery_events`, whose UPDATE and DELETE are REVOKEd: unredactable, and the
 * same sink `buildSlackConnector` refuses to echo input into. Round 6 guarded
 * the third parse, inside `privateKey()`, and left these two (R3).
 */
function parseServiceAccount(raw: string): { client_email: string; private_key: string } {
  try {
    return JSON.parse(raw) as { client_email: string; private_key: string };
  } catch {
    throw new ConnectorError(
      'fatal',
      false,
      'google-workspace serviceAccountJson is not valid JSON',
    );
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Options, not defaults — the same three findings the Slack client carries,
 * which were fixed there in review round 1 and never propagated here.
 *
 *   retry: false — googleapis-common defaults `options.retry` to `true`, which
 *                  arms gaxios' retry interceptor: 3 retries on GET for
 *                  408/429/5xx plus 2 network retries. That loop sits UNDER
 *                  `withRetry`, so MAX_ATTEMPTS of 5 was really up to ~20 HTTP
 *                  requests against a rate-limited API with two backoff
 *                  schedules stacked, while the log line reported attempt 1..5.
 *                  The stated bound was not the real bound — verbatim the
 *                  finding the Slack client's `retries: 0` answers.
 *   timeout      — gaxios applies one only when asked (`if (opts.timeout)`),
 *                  so there was none. See REQUEST_TIMEOUT_MS.
 *   signal       — so an abort cuts an IN-FLIGHT request, not only the gap
 *                  between pages.
 */
function requestOptions(options?: GoogleRequestOptions): {
  retry: boolean;
  timeout: number;
  signal?: AbortSignal;
} {
  return {
    retry: false,
    timeout: REQUEST_TIMEOUT_MS,
    ...(options?.signal ? { signal: options.signal } : {}),
  };
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

/**
 * OAuth token-endpoint errors that will repeat for every account in the run.
 *
 * From RFC 6749 §5.2's error registry, restricted to the codes a service-account
 * assertion can actually produce. Retrying any of them spends attempts on a
 * state that cannot change within a run, and reporting them as `transient` tells
 * the operator to wait when what they must do is grant the delegation.
 */
const OAUTH_AUTH_ERRORS: ReadonlySet<string> = new Set([
  'invalid_grant',
  'unauthorized_client',
  'invalid_client',
  'invalid_scope',
  'access_denied',
]);

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

      // 400, TOO. Domain-wide delegation that was never granted, and an
      // impersonated subject that does not exist, are returned by
      // `oauth2.googleapis.com/token` as HTTP 400 with `unauthorized_client` /
      // `invalid_grant` — RFC 6749 §5.2 reserves 401 for `invalid_client`. A 400
      // missed this arm, was not 429 and not 5xx, and came out `transient`; the
      // token audit only short-circuits on `auth` or `fatal`, so it repeated the
      // same doomed exchange for up to TOKEN_AUDIT_MAX_ACCOUNTS accounts and
      // then wrote `token_audit_completed` with zero grants. An operator whose
      // delegation was never granted read that as "no third-party apps".
      //
      // Classified on the NORMALISED platform error, which `diagnose` already
      // produces for both providers' grammars — the same shape Slack's
      // AUTH_ERRORS set uses.
      const platformError: unknown = diagnose(error, secret).platformError;
      const isOauthAuthError =
        typeof platformError === 'string' && OAUTH_AUTH_ERRORS.has(platformError);
      if (status === 401 || status === 403 || isOauthAuthError) {
        // The other member of the class SC2 fixed on the Slack side and left
        // here — with the comment that had recorded the gap deleted by the same
        // change. gaxios redacts `Authorization` by default, but that is a
        // third-party default this repository neither pins nor asserts, and the
        // config URL it does NOT redact carries an employee address.
        throw new ConnectorError('auth', false, 'Google Workspace authentication failed', {
          cause: diagnose(error, secret),
        });
      }

      // The transport arm, which this connector did not have when review round 6
      // turned the SDK's own retries off and added a request timeout. gaxios
      // sets `status` only when there IS a response, and copies a string `code`
      // from the cause (`ECONNRESET`) or the DOMException name (`TimeoutError`)
      // when there is not — so `statusOf` returns undefined for every socket
      // failure and for every one of the new 30-second timeouts, and the line
      // below threw `failed after retries` on attempt 1 with zero retries taken.
      // Nothing downstream recovers it: the sync job runs `attempts: 1`. This is
      // verbatim the defect the Slack connector paid for in round 2, which is
      // why the predicate now lives in connectors-core rather than here.
      //
      // An abort from `ctx.signal` reaches this arm too and is retried once —
      // then `waitUnlessAborted` rejects immediately, so the run ends without
      // issuing another request.
      const isRetryableStatus =
        status === 429 ||
        (typeof status === 'number' && status >= 500 && status < 600) ||
        isTransportError(error);
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
  private cachedPrivateKey: string | undefined;

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
    // MEMOIZED, because a JS string cannot be zeroized at any level. This was
    // called once per `withRetry` — once per page of `users.list`, and once per
    // account of `tokens.list`, bounded only by TOKEN_AUDIT_MAX_ACCOUNTS — and
    // each call minted a fresh permanently-unclearable copy of the PEM in the
    // worker heap. Five rounds of narrowing the credential-buffer class would
    // have been undone by one audit run of a 1000-seat tenant.
    if (this.cachedPrivateKey !== undefined) {
      return this.cachedPrivateKey;
    }
    try {
      const parsed = JSON.parse(this.cfg.serviceAccountJson) as { private_key?: unknown };
      this.cachedPrivateKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';
    } catch {
      // An unparseable document has no key to leak, and `diagnose` treats an
      // empty secret as "nothing to scrub" rather than splitting on every
      // character. Reached in production before either client is built, because
      // `withRetry` evaluates this at the call.
      this.cachedPrivateKey = '';
    }
    return this.cachedPrivateKey;
  }

  private async getUsersList(): Promise<NonNullable<GoogleWorkspaceConnectorDeps['usersList']>> {
    if (this.deps.usersList) {
      return this.deps.usersList;
    }
    if (this.cachedUsersList) {
      return this.cachedUsersList;
    }

    const serviceAccount = parseServiceAccount(this.cfg.serviceAccountJson);

    const authClient = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [SCOPE],
      subject: this.cfg.impersonateAdminEmail,
      // The TOKEN EXCHANGE, which `requestOptions` below cannot reach: it is a
      // separate request google-auth-library issues from its own transporter, on
      // the FIRST hop of every sync — inside `runSync`'s open `withTenant`
      // transaction, with no `statement_timeout` underneath.
      //
      // `retry` AS WELL AS `timeout`, and the first version of this fix said
      // "no timeout, no signal and no retry" while supplying only the timeout.
      // `gtoken` passes its own `retryConfig: { httpMethodsToRetry: ['POST'] }`,
      // and gaxios arms its interceptor on the mere PRESENCE of that object —
      // `retry` then defaults to 3 and `noResponseRetries` to 2, each attempt
      // re-arming a fresh 30-second deadline. That is ~93 s per exchange, and
      // the transport arm added in the same round multiplies it by
      // MAX_ATTEMPTS. Instance defaults are merged deeply, so these win over
      // gtoken's per-request object.
      transporterOptions: {
        timeout: REQUEST_TIMEOUT_MS,
        retryConfig: { retry: 0, noResponseRetries: 0 },
      },
    });

    const directory = google.admin({ version: 'directory_v1', auth: authClient });

    this.cachedUsersList = async (params: UsersListParams, options?: GoogleRequestOptions) => {
      const response = await directory.users.list(params, requestOptions(options));
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

    const serviceAccount = parseServiceAccount(this.cfg.serviceAccountJson);

    const authClient = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [TOKENS_SCOPE],
      subject: this.cfg.impersonateAdminEmail,
      // See the users client: the token exchange is not covered by
      // `requestOptions`, and gtoken arms gaxios' retry interceptor on its own.
      transporterOptions: {
        timeout: REQUEST_TIMEOUT_MS,
        retryConfig: { retry: 0, noResponseRetries: 0 },
      },
    });

    const directory = google.admin({ version: 'directory_v1', auth: authClient });

    this.cachedTokensList = async (params: TokensListParams, options?: GoogleRequestOptions) => {
      const response = await directory.tokens.list(params, requestOptions(options));
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
    const response = await withRetry(
      () => tokensList({ userKey }, { signal: ctx.signal }),
      ctx,
      sleep,
      'tokens.list',
      this.privateKey(),
    );

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

      const response = await withRetry(
        () => usersList(params, { signal: ctx.signal }),
        ctx,
        sleep,
        'users.list',
        this.privateKey(),
      );
      const users = response.data.users ?? [];

      for (const user of users) {
        yield toRawAccount(user);
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
}
