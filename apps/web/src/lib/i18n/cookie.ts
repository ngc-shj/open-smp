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
 * `path=/` is the part that carries the decision, and its failing case is
 * narrower than it first looks. With no `path`, a browser defaults the cookie
 * to the DIRECTORY of the document that wrote it — which for a one-segment page
 * like `/accounts` is already `/`. The attribute only starts mattering on a
 * nested route: a switch used on `/identities/<id>` would be scoped to
 * `/identities`, and every other page would stay in the old language while the
 * control on that one page insisted it had changed.
 *
 * Measured, not reasoned: dropping this attribute survived the E2E until the
 * spec moved its switch onto the identity page.
 *
 * No `Secure`. The value is a display preference and carries nothing to
 * protect, while the attribute would make the control silently stop working on
 * any plain-HTTP deployment — a real failure in exchange for nothing.
 */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}
