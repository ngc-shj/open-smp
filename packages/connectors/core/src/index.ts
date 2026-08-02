import type { TokenCapability } from '@open-smp/api-types';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface ConnectorContext {
  credentials: Record<string, string>;
  logger: Logger;
  signal: AbortSignal;
}

export interface RawAccount {
  externalId: string; // provider-stable ID (GWS: user.id, NOT email)
  email: string | null;
  displayName: string | null;
  accountStatus: 'active' | 'suspended' | 'archived';
  isAdmin: boolean;
  lastActivityAt: string | null; // ISO 8601
  raw: unknown; // provider payload, stored in discovery_events only
}

/**
 * One third-party OAuth grant, by one user, to one application (SC3/C1).
 *
 * No `raw` field, unlike RawAccount. The provider payload adds `kind` and `etag`
 * and nothing else — every field an audit needs is projected above — so storing
 * it would be a retention and disclosure surface with no consumer.
 */
export interface RawToken {
  clientId: string; // the OAuth client the grant was issued to; the aggregation key
  displayName: string | null; // provider's `displayText`, absent for some grants
  scopes: string[];
  /** `null` means the provider did not say, which is not the same as `false`. */
  anonymous: boolean | null;
  nativeApp: boolean | null;
  userKey: string; // the account that granted it
}

export interface SaaSConnector {
  id: string; // e.g. 'google-workspace'
  authKind: 'oauth2' | 'apikey' | 'scim';
  /**
   * REQUIRED, unlike `listTokens`. That is the whole change: a connector had to
   * be interrogated with `typeof connector.listTokens === 'function'`, which
   * cannot distinguish "cannot" from "not implemented yet" and gives a caller
   * nothing to render.
   *
   * `per-user-grants` and a present `listTokens` are the same claim made twice,
   * and a test asserts they agree for every connector — the type system cannot,
   * because an optional method's presence is not visible in the type.
   */
  tokenCapability: TokenCapability;
  listUsers(ctx: ConnectorContext): AsyncIterable<RawAccount>;

  /**
   * Third-party OAuth grants held by ONE account (SC3/C1).
   *
   * OPTIONAL, and that is the whole of the capability model today: a caller asks
   * `typeof connector.listTokens === 'function'` and there is nothing else to
   * ask. Declaring capabilities properly is deliberately deferred to SC2
   * (`SCT1` in the oauth-token-audit plan) — designing that vocabulary against
   * one implementation is what `docs/roadmap.md`'s order trigger warns about.
   *
   * An array, not an AsyncIterable like `listUsers`, and the difference is
   * measured rather than stylistic: `admin.directory.tokens.list` returns
   * `{kind, etag, items}` with **no `nextPageToken`**, and its parameters are
   * `{userKey}` alone — no `pageToken`, no `maxResults`. A streaming signature
   * would promise paging the endpoint does not have.
   *
   * Per user, for the same reason: the API offers no domain-wide form, so the
   * fan-out is forced by the provider and belongs to the caller, which is where
   * its bound can be stated.
   */
  listTokens?(ctx: ConnectorContext, userKey: string): Promise<readonly RawToken[]>;
}

export type ConnectorErrorKind = 'auth' | 'rate_limit' | 'transient' | 'fatal';

/**
 * What may travel in a `ConnectorError`'s `cause`.
 *
 * NOT the provider error. `apps/worker/src/sync.ts` writes `error.message` into
 * `discovery_events`, whose UPDATE and DELETE are REVOKEd, and
 * `console.error(msg, { error })` — the spelling the `Logger` interface's
 * `meta?: Record<string, unknown>` invites — inspects the whole cause chain. An
 * SDK error routinely carries the request it made, including its
 * `Authorization` header.
 *
 * Lives HERE rather than in one connector because the class has as many members
 * as there are connectors: review found the Slack half fixed and the Google half
 * still passing the raw error, with the comment that had recorded the gap
 * deleted by the same change.
 */
export function diagnose(error: unknown, secret: string): Record<string, unknown> {
  // An empty secret would make `split('')` explode the message into characters.
  // The guard is here and not at the call site because a connector whose
  // credential is optional is a reachable shape.
  const scrub = (text: string): string =>
    secret === '' ? text : text.split(secret).join('[redacted]');

  const source = (typeof error === 'object' && error !== null ? error : {}) as Record<
    string,
    unknown
  >;
  const response = source.response as { status?: unknown; data?: { error?: unknown } } | undefined;

  // BOTH SHAPES. The first version read `statusCode` and `data.error`, which are
  // Slack's spellings — a `GaxiosError` carries `status` and
  // `response.data.error`, so hoisting the function without widening it made
  // every Google diagnosis `{statusCode: undefined, platformError: undefined}`.
  // Propagating a helper is not copying it (R3).
  // Four spellings, and the numeric `code` is the one googleapis actually uses
  // — `statusOf` in the Google connector reads it FIRST. Widening this function
  // without it left the canonical Google error diagnosing as
  // `{statusCode: undefined}`, which is the defect the widening was for.
  const status = [source.statusCode, source.code, source.status, response?.status].find(
    (value): value is number => typeof value === 'number',
  );
  const data = source.data as { error?: unknown } | undefined;
  // Scrubbed like the other strings, and read from BOTH GRAMMARS. Slack puts a
  // bare enum string here (`invalid_auth`, `ratelimited`). Google does not: an
  // Admin SDK failure carries an OBJECT, which is why widening the envelope
  // (`data.error` → also `response.data.error`) in an earlier round still left
  // every real Google diagnosis at `platformError: undefined` — both arms
  // required a string. gaxios' own extractor takes the same two branches
  // (`typeof res.data.error === 'string'` then `=== 'object'`), reading
  // `.status` for the AIP-193 spelling; the classic Admin SDK shape carries the
  // machine-readable reason in `errors[0].reason` instead, so both are read.
  //
  // The fixture is the reason this survived three rounds: the Google case
  // asserted a Slack-shaped body under a Google envelope, a payload googleapis
  // cannot produce (RT1).
  const platformErrorOf = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (typeof value !== 'object' || value === null) return undefined;
    const record = value as { status?: unknown; errors?: unknown };
    if (typeof record.status === 'string') return record.status;
    const reason = (Array.isArray(record.errors) ? record.errors[0] : undefined) as
      | { reason?: unknown }
      | undefined;
    return typeof reason?.reason === 'string' ? reason.reason : undefined;
  };
  const rawPlatformError = platformErrorOf(data?.error) ?? platformErrorOf(response?.data?.error);
  const platformError = rawPlatformError === undefined ? undefined : scrub(rawPlatformError);

  return {
    name: typeof source.name === 'string' ? scrub(source.name) : undefined,
    message: typeof source.message === 'string' ? scrub(source.message) : undefined,
    // Scrubbed like every other string here: it is a provider-controlled path,
    // which is the same reason `platformError` is.
    code: typeof source.code === 'string' ? scrub(source.code) : undefined,
    statusCode: status,
    platformError,
    retryAfter: typeof source.retryAfter === 'number' ? source.retryAfter : undefined,
  };
}

/**
 * Waits, and stops waiting when the run is over.
 *
 * `Promise.race`, not a check either side of the sleep. The first version
 * checked before and after and claimed that was "the most a caller-supplied
 * sleep can offer" — false: an abort one millisecond into a clamped 60-second
 * wait still held `runSync`'s open transaction, its pooled connection and its
 * decrypted credential buffer for the remaining 60 seconds. It ended the run one
 * full wait later rather than shortening it.
 *
 * In `connectors-core` because the class has one member per connector, which is
 * the lesson `diagnose` above was moved here for.
 */
export function waitUnlessAborted(
  ms: number,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void>,
  onAborted: () => Error,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(onAborted());
  }

  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(onAborted());
    signal.addEventListener('abort', abort, { once: true });
    void sleep(ms).then(
      () => {
        // No re-check here: after the pre-check there is no await before the
        // listener is attached, so any later abort has already rejected. A
        // re-check would be unreachable code wearing a guard's clothes.
        signal.removeEventListener('abort', abort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Errors an SDK used to retry and a connector that turned SDK retries off does
 * not classify.
 *
 * HERE, not once per connector, and the reason is the review history rather
 * than tidiness. Slack learned this in round 2: setting `retries: 0` moved the
 * responsibility to the connector, and the first version of that fix left every
 * socket failure and every one of the new request timeouts retried by NOTHING —
 * not the SDK, not `withRetry` (no status, no platform error), and not BullMQ,
 * whose sync job runs `attempts: 1`. A single slow response became a terminal
 * sync failure. Round 6 then propagated `retry: false` and a request timeout to
 * the Google connector WITHOUT this predicate, reproducing the identical defect
 * against gaxios' spellings — the sites were enumerated, the reason the change
 * was safe at the seed was not (R3).
 *
 * The evidence is provider-neutral because `diagnose` already normalises both
 * providers' status and platform-error spellings:
 *
 *   - a DOMException name — `AbortError` from a signal, `TimeoutError` from a
 *     request deadline. gaxios copies it into `code` (common.js: "The
 *     DOMException's equivalent to code is its name"); `@slack/web-api` leaves
 *     it on `name`.
 *   - a STRING `code` with no HTTP status and no platform-error payload:
 *     `slack_webapi_request_error`, or the Node socket code gaxios copies from
 *     the cause (`ECONNRESET`, `ETIMEDOUT`). A numeric `code` is googleapis'
 *     HTTP status and is NOT this class.
 *
 * A rate limit is not transport, and callers must decide that first: it carries
 * a status or a platform error, so it does not reach the last line, but the KIND
 * a caller reports still has to come from its own rate-limit predicate.
 */
export function isTransportError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const source = error as { code?: unknown; name?: unknown };
  if (source.name === 'AbortError' || source.name === 'TimeoutError') return true;
  if (source.code === 'AbortError' || source.code === 'TimeoutError') return true;
  if (typeof source.code !== 'string') return false;

  // The empty secret is "nothing to scrub", not a scrub of everything — see the
  // guard in `diagnose`. Reused rather than re-spelled so this predicate reads
  // the same four status spellings and both platform-error grammars the
  // projection does.
  const { statusCode, platformError } = diagnose(error, '');
  return statusCode === undefined && platformError === undefined;
}

/**
 * The per-request ceiling every connector applies.
 *
 * HERE, not once per connector: the Slack client was given one in review round
 * 1 and the Google client was still on the SDK default (none) in round 6 — the
 * one-member-per-connector class this module exists for. Neither SDK applies one
 * unasked: `@slack/web-api` defaults `timeout` to 0, which installs no
 * `AbortSignal` at all, and gaxios applies one only when the request supplies
 * it. `runSync` iterates a
 * connector INSIDE an open `withTenant` transaction, so a hung request holds a
 * pooled Postgres connection and an idle-in-transaction session for as long as
 * it hangs, and the sync worker's `concurrency: 1` stalls every other tenant.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

export class ConnectorError extends Error {
  kind: ConnectorErrorKind;
  retryable: boolean;

  constructor(kind: ConnectorErrorKind, retryable: boolean, message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConnectorError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

export { rawAccountSchema } from './raw-account.schema.js';
export { rawTokenSchema } from './raw-token.schema.js';
