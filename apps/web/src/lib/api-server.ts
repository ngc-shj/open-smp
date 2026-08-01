import { cookies } from 'next/headers';

// Server-side fetch to the API, forwarding the incoming session cookie.
// Talks directly to API_URL (bypassing the Next.js rewrite, which only
// exists for the browser) since server components run outside the browser
// and have no same-origin cookie jar of their own.
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const SESSION_COOKIE = 'session';

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieStore = await cookies();
  // Forward ONLY the session cookie by name, not the whole cookie jar
  // (CS4-A): over-forwarding would leak any future first-party cookie to the
  // API host, becoming a credential-forwarding hazard if API_URL ever points
  // at a less-trusted host.
  //
  // WHAT THIS DOES NOT COVER, now that the first such cookie exists. `locale`
  // (i18n/C3) is written in the browser at `path=/`, and every browser-side
  // `fetch('/api/...')` reaches the API through next.config.ts's rewrite, which
  // proxies the request's whole Cookie header. So the name-keyed narrowing here
  // holds for SERVER-side calls only. Nothing is lost by it today — `locale` is
  // a display preference — but read as a jar-wide control it would let a later
  // cycle put something sensitive in a first-party cookie and believe this line
  // kept it away from API_URL.
  const session = cookieStore.get(SESSION_COOKIE)?.value;

  const headers = new Headers(init?.headers);
  if (session) {
    headers.set('Cookie', `${SESSION_COOKIE}=${session}`);
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
