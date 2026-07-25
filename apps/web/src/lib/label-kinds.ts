import type { AccountLabelKind } from '@/lib/api-types';

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
