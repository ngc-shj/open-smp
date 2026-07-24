import { cookies } from 'next/headers';

// Server-side fetch to the API, forwarding the incoming session cookie.
// Talks directly to API_URL (bypassing the Next.js rewrite, which only
// exists for the browser) since server components run outside the browser
// and have no same-origin cookie jar of their own.
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const headers = new Headers(init?.headers);
  if (cookieHeader) {
    headers.set('Cookie', cookieHeader);
  }

  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
}

export async function apiGetJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${path}`);
  }
  return (await res.json()) as T;
}
