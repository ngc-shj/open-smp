// Relative imports, not the `@/` alias: this module is unit-tested and the root
// vitest project resolves no alias. Same reason as label-filters.ts and
// label-kinds.ts.
import type { IdentityDetailResponse, LinkStatus } from './api-types';
import type { MessageKey } from './i18n/messages';

/**
 * The accounts page's tab order, which is deliberately NOT the domain order.
 *
 * The domain declares `matched, orphan, ghost, ambiguous` because that is the
 * shipped Postgres enum's order (migration 0001_init.sql:7) and a Postgres
 * enum's declaration order is its sort order. The tabs lead with `orphan`
 * because that is the triage-first view and the page's default. Deriving this
 * from the domain would silently reorder a shipped UI, so it stays hand-written
 * and is compile-checked as `LinkStatus[]` instead.
 */
export const ACCOUNT_TABS: readonly LinkStatus[] = ['orphan', 'ghost', 'ambiguous', 'matched'];

/**
 * Display key per identity status, keyed by the domain.
 *
 * A `Record`, not the inline ternary this replaced. `identity.status` is a
 * two-member union today, so the ternary was exhaustive — but a third member
 * added to the union rendered as "Active", a silent wrong answer on the field
 * rather than a marker or a build failure. `packages/schema` declares this as a
 * real pgEnum, so a third member is a migration away.
 *
 * Beside LINK_STATUS_KEYS because it is the same shape and the same argument:
 * a status with no copy is a compile error.
 */
export const IDENTITY_STATUS_KEYS: Record<IdentityDetailResponse['status'], MessageKey> = {
  active: 'identityStatus.active',
  left: 'identityStatus.left',
};

/**
 * Display key per link status, keyed by the domain.
 *
 * The SAME shape `LABEL_KIND_KEYS` has, and it was missing for the same reason
 * that map exists: this vocabulary reaches the reader in three places — the
 * accounts tab strip, the accounts table's chip, and the identity page's chip —
 * and none of them went through the dictionary, so `/accounts` under `ja` read
 * 「アカウント状態」 over a column of English words beside a tab strip reading
 * `orphan ghost ambiguous matched`. The plan diagnosed exactly this class and
 * applied it to the label kinds; its twin in this file was left, and the residue
 * list does not name it.
 *
 * Domain-keyed so a fifth status with no copy is a compile error, read through
 * `linkStatusKeyFor` for the same reason `chipClassFor` exists: the wire type is
 * a bare `string`.
 */
export const LINK_STATUS_KEYS: Record<LinkStatus, MessageKey> = {
  matched: 'linkStatus.matched',
  orphan: 'linkStatus.orphan',
  ghost: 'linkStatus.ghost',
  ambiguous: 'linkStatus.ambiguous',
};

/**
 * The string-indexed read. A value outside the domain renders verbatim rather
 * than as the untranslated-key marker — an unexpected status is data worth
 * seeing, and `⟨linkStatus.whatever⟩` would hide it behind a translation bug.
 *
 * `Object.hasOwn` for the reason `chipClassFor` records below: a bare index
 * reaches the prototype, and five inputs broke that helper's contract.
 */
export function linkStatusKeyFor(status: string): MessageKey | null {
  return Object.hasOwn(LINK_STATUS_KEYS, status)
    ? (LINK_STATUS_KEYS as Record<string, MessageKey>)[status]!
    : null;
}

/**
 * Chip class per link status, keyed by the domain.
 *
 * The declaration is domain-keyed so a status with no chip class is a compile
 * error. The READ (StatusChip) is string-indexed, because the wire type is a
 * bare `string` — `AccountLink.status` and `IdentityAccountItem.linkStatus` are
 * both `string`, so an unexpected value must render a neutral chip rather than
 * crash the page. Those two requirements need two different types: a single
 * `Record<LinkStatus, string>` read with a `string` index is TS7053 under
 * `strict`. Hence the map is declared here and read through `chipClassFor`.
 *
 * Each class name must have a matching rule in app/globals.css. That agreement
 * cannot be derived — Tailwind's `@apply` needs literal class names — so it is
 * gated by a test instead (see link-statuses.test.ts).
 */
export const CHIP_CLASSES: Record<LinkStatus, string> = {
  matched: 'status-chip status-chip-matched',
  orphan: 'status-chip status-chip-orphan',
  ghost: 'status-chip status-chip-ghost',
  ambiguous: 'status-chip status-chip-ambiguous',
};

export const CHIP_CLASS_FALLBACK = 'status-chip bg-neutral-100 text-neutral-700';

/**
 * The string-indexed read. A value outside the domain — which the wire type
 * permits — takes the neutral fallback instead of rendering an unstyled chip.
 *
 * `Object.hasOwn`, not `?? fallback`: a bare index reaches the prototype, so
 * `chipClassFor('constructor')` returns a function and `chipClassFor('toString')`
 * a native method — neither is nullish, so `??` never fires and a non-string
 * escapes into `className` despite the return type. Unreachable today (the
 * value comes from the link_status enum column), but this helper's whole
 * contract is "anything not in the domain gets the neutral chip", and five
 * inputs broke it.
 */
export function chipClassFor(status: string): string {
  return Object.hasOwn(CHIP_CLASSES, status)
    ? (CHIP_CLASSES as Record<string, string>)[status]!
    : CHIP_CLASS_FALLBACK;
}
