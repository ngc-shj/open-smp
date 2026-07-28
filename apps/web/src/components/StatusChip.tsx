// The map lives in a .ts module so the unit project can reach it: vitest cannot
// transform .tsx (apps/web/tsconfig.json sets jsx: preserve), and the map's
// agreement with the domain and with globals.css is what needs asserting.
import { chipClassFor } from '@/lib/link-statuses';

// `status` stays `string`, not LinkStatus: the wire type is a bare string, so a
// value outside the domain must still render. chipClassFor gives it the neutral
// chip; only a *domain member* with no class is a compile error.
export function StatusChip({ status }: { status: string }) {
  return <span className={chipClassFor(status)}>{status}</span>;
}
