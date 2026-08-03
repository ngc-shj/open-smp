// The map lives in a .ts module so the unit project can reach it: vitest cannot
// transform .tsx (apps/web/tsconfig.json sets jsx: preserve), and the map's
// agreement with the domain and with globals.css is what needs asserting.
import { chipClassFor } from '@/lib/link-statuses';

// `status` stays `string`, not LinkStatus: the wire type is a bare string, so a
// value outside the domain must still render. chipClassFor gives it the neutral
// chip; only a *domain member* with no class is a compile error.
export function StatusChip({ status, label }: { status: string; label?: string }) {
  // `label` is resolved by the caller, matching how LABEL_KIND_KEYS reaches the
  // reader: the pages are server components with the translator in hand, and a
  // non-component export from a client module is not available to them.
  //
  // Falling back to the raw status is deliberate. A value outside the domain has
  // no copy by definition, and showing it verbatim is more useful than a marker
  // that reads as a translation bug.
  return <span className={chipClassFor(status)}>{label ?? status}</span>;
}
