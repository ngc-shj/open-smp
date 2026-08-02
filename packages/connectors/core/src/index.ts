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
