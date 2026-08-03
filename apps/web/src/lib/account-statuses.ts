// Relative imports, not the `@/` alias: this module is unit-tested and the root
// vitest project resolves no alias. Same reason as label-kinds.ts and
// link-statuses.ts.
import type { AccountStatus } from './api-types';
import type { MessageKey } from './i18n/messages';

/**
 * Display key per account status, keyed by the domain.
 *
 * Domain-keyed so a fourth status with no copy is a compile error, read
 * through `accountStatusKeyFor` for the same reason `linkStatusKeyFor` exists:
 * the wire type is a bare `string`.
 *
 * A third copy of the same three-line shape `LINK_STATUS_KEYS` /
 * `linkStatusKeyFor` and `IDENTITY_STATUS_KEYS` / `identityStatusKeyFor`
 * already have, not extracted into a shared helper. The obvious extraction —
 * `messageKeyFor(keys, value)` — takes the map and the value as independent
 * arguments, so a call site can pair the wrong two; the i18n review withdrew
 * an extraction with exactly this failure mode.
 */
export const ACCOUNT_STATUS_KEYS: Record<AccountStatus, MessageKey> = {
  active: 'accountStatus.active',
  suspended: 'accountStatus.suspended',
  archived: 'accountStatus.archived',
};

/**
 * The string-indexed read. A value outside the domain renders verbatim rather
 * than as the untranslated-key marker — an unexpected status is data worth
 * seeing, and `⟨accountStatus.whatever⟩` would hide it behind a translation
 * bug.
 *
 * `Object.hasOwn`, not `?? null`: a bare index reaches the prototype, and a
 * value like `constructor` or `toString` returns a non-nullish function, so
 * `??` never fires.
 */
export function accountStatusKeyFor(status: string): MessageKey | null {
  return Object.hasOwn(ACCOUNT_STATUS_KEYS, status)
    ? (ACCOUNT_STATUS_KEYS as Record<string, MessageKey>)[status]!
    : null;
}
