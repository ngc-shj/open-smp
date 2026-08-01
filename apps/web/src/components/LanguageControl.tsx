'use client';

import { useRouter } from 'next/navigation';
import { localeCookie } from '@/lib/i18n/cookie';
import { useLocale, useTranslator } from '@/lib/i18n/locale-context';
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/messages';

// i18n/C3. The one place the locale is chosen.
//
// The write is a plain `document.cookie` rather than a server action: the value
// is a display preference with no server-side decision attached to it, and the
// read path already treats it as untrusted — `getLocale` falls back on anything
// that is not a known locale, which an E2E asserts. A server action would add a
// POST surface to defend for a string the server does not act on.
//
// `router.refresh()` and not a reload, matching LabelControl: the locale is
// resolved by the root layout, so re-fetching this route's server render is
// what re-renders every translated surface AND `<html lang>` with it.
export function LanguageControl() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslator();

  return (
    <select
      aria-label={t('nav.language')}
      value={locale}
      onChange={(event) => {
        // Cast, not a guard: the options are generated from LOCALES, so the
        // only values reachable here are locales. A guard would be a branch no
        // test could enter.
        document.cookie = localeCookie(event.target.value as Locale);
        router.refresh();
      }}
      className="ml-auto rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-700 focus:border-neutral-500 focus:outline-none"
    >
      {LOCALES.map((option) => (
        <option key={option} value={option}>
          {LOCALE_LABELS[option]}
        </option>
      ))}
    </select>
  );
}
