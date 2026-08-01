'use client';

import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_LOCALE, translator, type Locale, type MessageKey } from './translate';

// i18n/C1. The locale crosses to the client through context rather than being
// read there.
//
// It cannot simply be resolved per component: `/import` and `/login` are client
// pages, and a client component cannot render an async server one — which is
// what a `next/headers` lookup inside NavBar would have made it. The root
// layout is the one place that is server-side and wraps everything, so it
// resolves once and hands the answer down.
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useTranslator(): (key: MessageKey) => string {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
