// Shared rate-limit option fragments (C6 contract values — do not change
// without updating the contract). Route-specific keyGenerators stay local
// and are spread alongside these where needed (e.g. login.ts).

export const MUTATION_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

export const LIST_RATE_LIMIT = { max: 240, timeWindow: '1 minute' };

// S12: 5/min, keyed by default (client IP) — see login.ts for the paired
// account-bucket limit.
export const LOGIN_IP_RATE_LIMIT = { max: 5, timeWindow: '1 minute' };

export const LOGIN_ACCOUNT_BUCKET_RATE_LIMIT = { max: 20, timeWindow: '1 hour' };

// The account bucket is enforced by a standalone limiter (account-bucket.ts),
// not @fastify/rate-limit, so it needs the window as milliseconds.
export const LOGIN_ACCOUNT_BUCKET_MAX = 20;
export const LOGIN_ACCOUNT_BUCKET_WINDOW_MS = 60 * 60 * 1000;
