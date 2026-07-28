// Relative imports, not the `@/` alias: this module is unit-tested and the root
// vitest project resolves no alias. Same reason as label-filters.ts and
// label-kinds.ts.
import type { LinkStatus } from './api-types';

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
