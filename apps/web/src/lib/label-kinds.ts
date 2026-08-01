// Relative, not the `@/` alias. This module is reached by audit-transition.ts,
// which is unit-tested, and the root vitest project does not resolve that
// alias. It works today only because these imports are type-only and erased
// before vitest sees it — so adding any runtime import here would break an
// unrelated test file with an error naming the wrong module.
import type { AccountLabelKind } from './api-types';
import type { MessageKey } from './i18n/messages';

// Single source for label-kind display strings (R2), in a module with no
// 'use client' directive: server components read this map directly, and a
// non-component export from a client module is not available to them — it
// resolves to undefined at render time rather than failing to build.
//
// i18n: the values are MESSAGE KEYS, not English. This map is what makes a
// fourth kind a compile error, which is why the translation is keyed here
// rather than at each of the six call sites — a kind added to the domain with
// no copy then fails to build instead of rendering an empty chip.
export const LABEL_KIND_KEYS: Record<AccountLabelKind, MessageKey> = {
  known_shared: 'labelKind.known_shared',
  service_account: 'labelKind.service_account',
  external_collaborator: 'labelKind.external_collaborator',
};

export const LABEL_KINDS = Object.keys(LABEL_KIND_KEYS) as AccountLabelKind[];
