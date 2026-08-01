import type { Metadata } from 'next';
import { LocaleProvider } from '@/lib/i18n/locale-context';
import { getLocale } from '@/lib/i18n/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'open-smp',
  description: 'SaaS account matching and orphan/ghost account discovery',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The one place that is server-side and wraps every page, so the locale is
  // resolved once here rather than per component — which is also what lets
  // `/import` and `/login`, both client pages, render translated chrome.
  const locale = await getLocale();

  return (
    // `lang` follows the locale. It was hardcoded to "en", which is a claim a
    // screen reader acts on: announcing Japanese text with an English voice.
    <html lang={locale}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
