import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { DiscoveryEventListResponse, DiscoveryEventPayload } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';
import { SourceFilter } from '@/components/SourceFilter';
import { LABEL_KIND_NAMES } from '@/lib/label-kinds';

async function fetchEvents(
  source: string | undefined,
  cursor: string | undefined,
): Promise<DiscoveryEventListResponse> {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();

  const res = await apiFetch(`/api/events${query ? `?${query}` : ''}`);

  if (res.status === 401) {
    redirect('/login');
  }
  if (!res.ok) {
    throw new Error(`failed to load events: ${res.status}`);
  }

  return (await res.json()) as DiscoveryEventListResponse;
}

function labelSnapshot(snapshot: DiscoveryEventPayload['before']): string {
  if (!snapshot) return 'none';
  return snapshot.note
    ? `${LABEL_KIND_NAMES[snapshot.kind]} (${snapshot.note})`
    : LABEL_KIND_NAMES[snapshot.kind];
}

/**
 * The audit column answers "what changed", which for a label is the transition
 * rather than either end of it: a `label_set` on an already-labelled account is
 * a different act from one on an unlabelled account, and only the pair shows it.
 *
 * Keyed on the projected payload rather than on a copy of the kind list: the
 * API's allowlist is what decides whether these fields are served at all, so a
 * future audit kind renders here the moment the server projects it. A second
 * kind list on this side would silently render '—' for a real audit event until
 * someone remembered to update it.
 */
function auditTransition(payload: DiscoveryEventPayload): string {
  if (payload.before === undefined && payload.after === undefined) return '—';
  return `${labelSnapshot(payload.before ?? null)} → ${labelSnapshot(payload.after ?? null)}`;
}

// The API constrains `source` to a slug and 400s anything else, and a non-ok
// response here throws — so an unvalidated param turns a hand-typed URL into a
// rendered error page. The accounts page allowlists its filters and falls back
// to a default; this matches that, since a bogus filter is a URL typo rather
// than a condition worth an error screen.
const SOURCE_RE = /^[a-z0-9_-]{1,64}$/;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const source = params.source && SOURCE_RE.test(params.source) ? params.source : undefined;
  const { items, nextCursor } = await fetchEvents(source, params.cursor);

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-6 text-lg font-semibold text-neutral-900">Discovery events</h1>

        <SourceFilter active={source} />

        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Source</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Kind</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Counts</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Label change</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Actor</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Created at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((event) => (
                <tr key={event.id}>
                  <td className="px-3 py-2 text-neutral-700">{event.source}</td>
                  <td className="px-3 py-2 text-neutral-700">{event.kind}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {event.payload.counts ? JSON.stringify(event.payload.counts) : '—'}
                  </td>
                  <td className="px-3 py-2 text-neutral-700">
                    {auditTransition(event.payload)}
                  </td>
                  {/* saasAccountId is rendered as text, not a link: there is no
                      per-account page to navigate to yet (SC25). */}
                  <td className="px-3 py-2 text-neutral-500">{event.payload.actorUserId ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-500">{event.createdAt}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">
                    No events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="mt-4 flex justify-end">
            <Link
              // The cursor is bound to the filter it was minted under, so
              // dropping ?source= here is a 400 rather than a wrong page.
              href={
                source
                  ? `/events?source=${encodeURIComponent(source)}&cursor=${encodeURIComponent(nextCursor)}`
                  : `/events?cursor=${encodeURIComponent(nextCursor)}`
              }
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Load more
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
