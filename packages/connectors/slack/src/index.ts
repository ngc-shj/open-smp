import { WebClient } from '@slack/web-api';
import type { UsersListResponse } from '@slack/web-api';
import {
  ConnectorError,
  REQUEST_TIMEOUT_MS,
  diagnose,
  isTransportError,
  waitUnlessAborted,
  type ConnectorContext,
  type RawAccount,
  type SaaSConnector,
} from '@open-smp/connectors-core';

// SC2/C1. The second connector, and the first that answers "no" to a capability.
//
// SCOPES: `users:read` and `users:read.email`. Exactly two, and the second is
// not optional decoration — without it `users.list` still succeeds and
// `profile.email` is simply absent, so every Slack account arrives with
// `email: null` and matches nobody. That failure is silent at every layer this
// repository can test, which is why the pair is stated here rather than only in
// the plan.
//
// It is also why nothing here reaches `admin.apps.approved.list`. Slack's
// installed-app listing needs `admin.apps:read` and an org-level Enterprise Grid
// token, and — unlike Google, where `tokens.list` got its OWN JWT client so a
// missing delegation could not take `listUsers` down — Slack's scopes live on
// ONE installed bot token. There is no containment to buy. A future cycle that
// wants that data takes a separate credential field, never a scope added here.

const PAGE_SIZE = 200;
const MAX_ATTEMPTS = 5;

/**
 * The longest a provider-mandated wait may hold this run.
 *
 * `Retry-After` comes off a response header with no upper bound, and honouring
 * it verbatim inside `runSync`'s open transaction is how a `retry-after:
 * 2000000` holds a pooled connection, an idle-in-transaction session and a live
 * credential buffer for weeks. Review found this the round after the round that
 * closed the same blast radius. Above 2^31 ms Node fires the timer immediately,
 * which turns the same header into a hot loop — the clamp closes both.
 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Derived from the response type rather than imported: `@slack/web-api` exports
 * `UsersListResponse` from its root and not the `Member` interface inside it, so
 * this is the spelling that makes an upstream rename a compile error.
 */
export type SlackMember = NonNullable<UsersListResponse['members']>[number];

export type UsersListParams = { limit: number; cursor?: string };
export type UsersListResponseData = UsersListResponse;

export interface SlackConnectorDeps {
  usersList?: (params: UsersListParams) => Promise<UsersListResponseData>;
  sleep?: (ms: number) => Promise<void>;
}

export interface SlackConnectorConfig {
  botToken: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Slack reports failure two ways and neither is an HTTP status alone: a platform
 * error carries `data.error` (a string like `invalid_auth`), and a rate limit
 * carries `retryAfter` with `code` set to a STRING rather than a number — so a
 * `typeof code === 'number'` reading, which is what the Google connector does,
 * finds nothing here.
 */
function platformErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const data = (error as { data?: { error?: unknown } }).data;
  return typeof data?.error === 'string' ? data.error : undefined;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : undefined;
}

/** Seconds the provider asked us to wait, when it said so. */
function retryAfterSeconds(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as { retryAfter?: unknown }).retryAfter;
  // Typed, not merely present. `'retryAfter' in error` classified any object
  // carrying the property — whatever its value — as rate limited.
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRateLimited(error: unknown): boolean {
  if (statusOf(error) === 429) return true;
  if (platformErrorCode(error) === 'ratelimited') return true;
  return retryAfterSeconds(error) !== undefined;
}

// Non-retryable by construction: retrying a revoked token or a missing scope
// spends attempts on a state that cannot change within a run.
const AUTH_ERRORS: ReadonlySet<string> = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'missing_scope',
  'no_permission',
  'org_login_required',
]);

/**
 * The account status, from the one boolean Slack offers.
 *
 * `RawAccount['accountStatus']` has three members because Google's
 * `Schema$User` carries `archived` and `suspended` as separate fields. Slack has
 * `deleted` and nothing else, so `'suspended'` is UNREACHABLE from this
 * connector — a filter on that state means "Google accounts only", which is a
 * claim no screen makes. Recorded rather than papered over by inventing a
 * mapping.
 */
function mapAccountStatus(member: SlackMember): RawAccount['accountStatus'] {
  return member.deleted ? 'archived' : 'active';
}

/**
 * What is kept from the provider payload.
 *
 * NOT the whole member. `RawAccount.raw` is persisted into `discovery_events`,
 * whose UPDATE and DELETE are REVOKEd by migration 0005 — so anything landing
 * there is unredactable by the application, and `Member.profile` carries phone
 * numbers, image URLs, job titles and custom fields that no consumer reads.
 *
 * The classification flags are kept even though nothing maps them today: they
 * are the evidence for the bot/guest decision below, and a run that discarded
 * them could not be reinterpreted later.
 */
function narrowRaw(member: SlackMember): Record<string, unknown> {
  return {
    id: member.id,
    team_id: member.team_id,
    name: member.name,
    real_name: member.real_name,
    deleted: member.deleted,
    is_admin: member.is_admin,
    is_owner: member.is_owner,
    is_primary_owner: member.is_primary_owner,
    is_bot: member.is_bot,
    is_app_user: member.is_app_user,
    is_restricted: member.is_restricted,
    is_ultra_restricted: member.is_ultra_restricted,
    profile: {
      email: member.profile?.email,
      display_name: member.profile?.display_name,
    },
  };
}

export function toRawAccount(member: SlackMember): RawAccount {
  const externalId = member.id;
  if (!externalId) {
    throw new ConnectorError('fatal', false, 'Slack member payload is missing id');
  }

  return {
    externalId,
    email: member.profile?.email ?? null,
    displayName: member.real_name ?? member.profile?.display_name ?? null,
    accountStatus: mapAccountStatus(member),
    // Three separately-privileged states collapse into one boolean. OR'd rather
    // than reading `is_admin` alone, the same way the Google connector ORs
    // `isAdmin` with `isDelegatedAdmin` — what is lost is WHICH privilege, not
    // whether the account has one.
    isAdmin:
      Boolean(member.is_admin) || Boolean(member.is_owner) || Boolean(member.is_primary_owner),
    // Always null, and `Member.updated` is the trap. That field is a
    // profile-modification timestamp, not activity; reading it would be exactly
    // the error SCL7 records SC5 refusing to make — approximating "idle" from
    // the wrong column — one cycle after that refusal.
    lastActivityAt: null,
    raw: narrowRaw(member),
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
      const code = platformErrorCode(error);
      const status = statusOf(error);

      // Every message is a FIXED STRING and the diagnosis travels in `cause`
      // with the token removed — see diagnose(). `sync.ts` writes
      // `error.message` into a table whose UPDATE and DELETE are REVOKEd.
      if ((code !== undefined && AUTH_ERRORS.has(code)) || status === 401 || status === 403) {
        throw new ConnectorError('auth', false, 'Slack authentication failed', {
          cause: diagnose(error, secret),
        });
      }

      const rateLimited = isRateLimited(error);
      const retryable =
        rateLimited ||
        (typeof status === 'number' && status >= 500 && status < 600) ||
        isTransportError(error);
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new ConnectorError(
          rateLimited ? 'rate_limit' : 'transient',
          true,
          `Slack ${operation} failed after retries`,
          { cause: diagnose(error, secret) },
        );
      }

      // The provider's own number wins when it gave one. Serving a mandated
      // 30-second wait with ~1 second of exponential backoff spends the next
      // attempt on the same rate limit — the `retryAfter` was being read to
      // CLASSIFY the error and then discarded.
      // Clamped. The provider's number wins over the connector's schedule, but
      // not over the run's own bound — see MAX_RETRY_AFTER_MS.
      const mandatedMs = Math.min((retryAfterSeconds(error) ?? 0) * 1000, MAX_RETRY_AFTER_MS);
      const backoffMs = 2 ** (attempt - 1) * 1000 + Math.random() * 1000;
      const delayMs = Math.max(mandatedMs, backoffMs);

      ctx.logger.warn(`Slack ${operation} retrying after error`, {
        attempt,
        ...(status === undefined ? {} : { status }),
        ...(code === undefined ? {} : { code }),
        delayMs: Math.round(delayMs),
      });
      await waitUnlessAborted(
        delayMs,
        ctx.signal,
        sleep,
        () => new ConnectorError('fatal', false, `Slack ${operation} aborted`),
      );
    }
  }
}

export class SlackConnector implements SaaSConnector {
  id = 'slack';
  authKind: SaaSConnector['authKind'] = 'apikey';
  // Not `workspace-apps`, though Slack has that shape: reaching it needs
  // `admin.apps:read` on an org-level Enterprise Grid token, and this connector
  // holds neither. Declaring a capability the credentials cannot exercise is
  // the overstated-control failure one level up from the one C4 replaces.
  tokenCapability: SaaSConnector['tokenCapability'] = 'none';

  private readonly cfg: SlackConnectorConfig;
  private readonly deps: SlackConnectorDeps;

  // INSTANCE-scoped, never module-scoped, and this is the invariant with the
  // least coverage anywhere else in the platform. One worker process serves
  // every tenant. A memoised module-level `WebClient` — the idiom this SDK's own
  // examples use — would write tenant A's workspace members into tenant B's
  // `saas_accounts` INSIDE `withTenant(B)`: RLS passes, the composite tenant
  // foreign key passes, and the credential AAD binding passes, because the write
  // really is happening in B's transaction with B's credentials decrypted. None
  // of this platform's isolation controls can see it.
  private cachedUsersList: SlackConnectorDeps['usersList'];

  constructor(cfg: SlackConnectorConfig, deps?: SlackConnectorDeps) {
    this.cfg = cfg;
    this.deps = deps ?? {};
  }

  /**
   * Public, and only because the invariant above cannot otherwise be asserted.
   *
   * Hoisting `cachedUsersList` to module scope is a one-line edit with no local
   * symptom — every test passes, the type checker is satisfied, and the damage
   * appears as one tenant's accounts under another. Without a network there is
   * no behavioural handle on it, so the test asks two instances for their
   * resolver and requires two different functions.
   */
  resolveUsersList(): NonNullable<SlackConnectorDeps['usersList']> {
    if (this.deps.usersList) {
      return this.deps.usersList;
    }
    if (this.cachedUsersList) {
      return this.cachedUsersList;
    }

    // Options, not defaults, and every one of them was a review finding.
    //
    //   retries: 0            — the SDK's default is `tenRetriesInAboutThirtyMinutes`,
    //                           which would sit UNDER `withRetry`'s own loop:
    //                           MAX_ATTEMPTS of 5 became ~55 HTTP attempts and
    //                           hours of wall clock per page, and the stated
    //                           bound was not the real bound.
    //   rejectRateLimitedCalls — the default (`false`) makes the SDK absorb a
    //                           429, sleep out `Retry-After` internally, and
    //                           finally throw a BARE Error carrying no
    //                           `statusCode`, no `data.error` and no
    //                           `retryAfter`. Every arm of `isRateLimited`
    //                           missed it, so `kind: 'rate_limit'` was
    //                           unreachable and a rate limit was reported as
    //                           `transient`. `true` produces
    //                           `WebAPIRateLimitedError`, which is the shape
    //                           `isRateLimited` was written for.
    //   timeout               — see REQUEST_TIMEOUT_MS.
    const client = new WebClient(this.cfg.botToken, {
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
      timeout: REQUEST_TIMEOUT_MS,
    });

    this.cachedUsersList = (params: UsersListParams) => client.users.list(params);

    return this.cachedUsersList;
  }

  // NO `listTokens`, and its absence is the point rather than an omission.
  //
  // Slack has no per-user third-party-grant listing. `admin.apps.approved.list`
  // reports apps at the WORKSPACE level with no user attribution, which
  // `RawToken` requires and `/discovery` renders a count from — so it is a
  // differently-shaped capability, not this one. Until C4 gives the interface a
  // vocabulary, `typeof connector.listTokens === 'function'` is the whole model,
  // and this class is its first real "no": the branch in
  // apps/worker/src/token-audit.ts has existed since SC3 and only ever been
  // taken by a fake.

  async *listUsers(ctx: ConnectorContext): AsyncIterable<RawAccount> {
    const usersList = this.resolveUsersList();
    const sleep = this.deps.sleep ?? defaultSleep;
    let cursor: string | undefined;

    do {
      if (ctx.signal.aborted) {
        throw new ConnectorError('fatal', false, 'Slack sync aborted');
      }

      const params: UsersListParams = {
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      };

      const response = await withRetry(
        () => usersList(params),
        ctx,
        sleep,
        'users.list',
        this.cfg.botToken,
      );

      for (const member of response.members ?? []) {
        yield toRawAccount(member);
      }

      // Cursor paging, unlike `tokens.list`, which had none at all. An empty
      // string is what Slack returns on the last page, so it is falsy here by
      // design rather than by accident.
      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }
}
