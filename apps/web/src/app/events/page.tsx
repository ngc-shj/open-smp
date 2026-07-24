import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api-server';
import type { DiscoveryEventListResponse } from '@/lib/api-types';
import { NavBar } from '@/components/NavBar';

async function fetchEvents(cursor: string | undefined): Promise<DiscoveryEventListResponse> {
  const params = new URLSearchParams();
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

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const params = await searchParams;
  const { items, nextCursor } = await fetchEvents(params.cursor);

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-6 text-lg font-semibold text-neutral-900">Discovery events</h1>

        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Source</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Kind</th>
                <th className="px-3 py-2 text-left font-medium text-neutral-600">Counts</th>
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
                  <td className="px-3 py-2 text-neutral-500">{event.createdAt}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">
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
              href={`/events?cursor=${encodeURIComponent(nextCursor)}`}
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
