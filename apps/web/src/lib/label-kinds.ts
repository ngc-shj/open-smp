// Relative, not the `@/` alias. This module is reached by audit-transition.ts,
// which is unit-tested, and the root vitest project does not resolve that
// alias. It works today only because this import is type-only and erased
// before vitest sees it — so adding any runtime import here would break an
// unrelated test file with an error naming the wrong module.
import type { AccountLabelKind } from './api-types';

// Single source for label-kind display strings (R2), in a module with no
// 'use client' directive: server components read this map directly, and a
// non-component export from a client module is not available to them — it
// resolves to undefined at render time rather than failing to build.
export const LABEL_KIND_NAMES: Record<AccountLabelKind, string> = {
  known_shared: 'Known shared',
  service_account: 'Service account',
  external_collaborator: 'External collaborator',
};

export const LABEL_KINDS = Object.keys(LABEL_KIND_NAMES) as AccountLabelKind[];
