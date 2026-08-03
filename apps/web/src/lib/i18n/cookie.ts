import { DEFAULT_LOCALE, type Locale } from './messages';
import { isLocale } from './translate';

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
 * narrower than it looks. With no `path`, the cookie takes the DIRECTORY of the
 * document that wrote it — which for a one-segment page like `/accounts` is
 * already `/`, so the attribute changes nothing there. Nor does reaching
 * `/identities/<id>` through a `<Link>`: that is a pushState, and Chrome still
 * derives the default from the URL the document was LOADED at. Both measured,
 * by dropping the attribute and watching the E2E stay green.
 *
 * What does reach it is a document LOAD at the nested route — a reloaded or
 * bookmarked identity page. The cookie is then scoped to `/identities`, and
 * every other page stays in the old language while the control on that one page
 * insists it changed. Measured too: `/licenses` came back `lang="en"`.
 *
 * `Secure` CONDITIONALLY, derived from the page's own scheme. The first version
 * declined it outright, reasoning that the attribute "would make the control
 * silently stop working on any plain-HTTP deployment — a real failure in
 * exchange for nothing". The premise is contradicted one file away: the session
 * cookie in apps/api/src/routes/login.ts records the same constraint (the
 * http://localhost compose demo) and resolves it with
 * `secure: new URL(appOrigin).protocol === 'https:'`. The conditional form was
 * already the house pattern.
 *
 * What it protects is small — the value is a display preference, and the reader
 * validates by membership before use — so this is about the recorded reason
 * rather than the exposure. This module is where the next first-party
 * browser-written cookie will be modelled from, and "Secure is unavailable" is
 * the wrong thing to leave there.
 */
export function localeCookie(locale: Locale): string {
  // MEMBERSHIP AT BOTH ENDS. The reader decides by `LOCALES.includes`; the one
  // caller decided by an `as Locale` cast, and this function then interpolated
  // that value straight into a cookie GRAMMAR. Closed by construction today —
  // the values come from a `<select>` built from LOCALES — but the module's
  // obvious next step is negotiation from `Accept-Language` or a `?lang=`
  // parameter, and either makes `en; max-age=0` an attribute injection that
  // rescopes or expires the cookie. Guarding the exported function is what a
  // future caller reaches; guarding the caller is not.
  const safe = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; secure' : '';
  return `${LOCALE_COOKIE}=${safe}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}
