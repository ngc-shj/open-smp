import { cookies } from 'next/headers';
import { LOCALE_COOKIE } from './cookie';
import { DEFAULT_LOCALE, isLocale, translator, type Locale, type MessageKey } from './translate';

// i18n/C1. Locale resolution, isolated because it reaches `next/headers` and
// nothing that imports it can be unit-tested — the same reason
// discovery-runs.ts exists apart from the page that renders it.

/**
 * The locale for this request.
 *
 * A cookie rather than a URL segment. Sub-path routing is Next's idiom and it
 * would move every page under `app/[locale]/`, which makes
 * page-spec-membership's route derivation yield `[locale]` for all of them and
 * rewrites 11 E2E specs that navigate by bare path — to buy shareable,
 * indexable per-locale URLs that an authenticated internal tool does not use.
 * See docs/archive/review/i18n-plan.md.
 *
 * An unrecognised value falls back rather than throwing: the cookie is
 * user-supplied, and a hand-edited one must not be able to 500 every page.
 */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getTranslator(): Promise<(key: MessageKey) => string> {
  return translator(await getLocale());
}
