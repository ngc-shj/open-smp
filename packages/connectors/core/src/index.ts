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

export interface SaaSConnector {
  id: string; // e.g. 'google-workspace'
  authKind: 'oauth2' | 'apikey' | 'scim';
  listUsers(ctx: ConnectorContext): AsyncIterable<RawAccount>;
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
