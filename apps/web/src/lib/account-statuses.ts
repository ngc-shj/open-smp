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
 * already have, not extracted into a shared helper.
 *
 * The reason is NOT "an extraction was withdrawn once" — that is what this
 * comment said until the Phase 2 self-check, and it does not reach the
 * conclusion. What was withdrawn (i18n-code-review.md:123-130) is the
 * POSITIONAL form, `messageKeyFor(keys, value)`, where map and value are
 * independent arguments and a call site can pair the wrong two. A CLOSURE form
 * has no such failure mode: `keyLookup(ACCOUNT_STATUS_KEYS)` binds the map at
 * construction and leaves nothing to mis-pair.
 *
 * Why the closure form is not taken HERE — a smaller claim, and the true one:
 * bound to this one map it has a single consumer, which is indirection rather
 * than reuse. Reaching the other two means editing link-statuses.ts, a shipped
 * module carrying two vocabularies and their observers, which this change's
 * plan does not cover. And `chipClassFor` there is a fourth near-twin that
 * returns a non-null fallback rather than `null`, so a shared read would cover
 * three of four and leave the fourth as the exception. SC8 carries the trigger:
 * the next vocabulary, or any change that already has link-statuses.ts open.
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
