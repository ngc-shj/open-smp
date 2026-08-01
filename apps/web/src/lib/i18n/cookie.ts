import type { Locale } from './messages';

// i18n/C3. The cookie's name and its write form, in the one module both sides
// can import.
//
// The name used to live in `server.ts`, which reaches `next/headers`. A client
// component importing it from there pulls `next/headers` into the browser
// bundle, so reader and writer would have had to spell 'locale' twice — and the
// day they disagree the switch appears to do nothing, with no error anywhere.

export const LOCALE_COOKIE = 'locale';

/**
 * A year. The choice is a preference, not a session fact: a session cookie
 * would make the language reset every time the browser closes, which reads as
 * the control not having worked.
 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The assignment for `document.cookie`.
 *
 * `path=/` is the part that carries the decision: without it the browser scopes
 * the cookie to the directory of whatever page the switch was used on, so
 * switching on `/accounts` leaves `/licenses` in the old language and the bug
 * looks like a caching problem.
 *
 * No `Secure`. The value is a display preference and carries nothing to
 * protect, while the attribute would make the control silently stop working on
 * any plain-HTTP deployment — a real failure in exchange for nothing.
 */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}
