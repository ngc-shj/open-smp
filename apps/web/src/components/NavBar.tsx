'use client';

import Link from 'next/link';
import { useTranslator } from '@/lib/i18n/locale-context';

// The first surface wired to the dictionary (i18n/C1). One is enough to prove
// the resolution path end to end, and shipping a dictionary nothing renders is
// the "shape consumed by no one" SC5 recorded the cost of. The remaining 85
// strings are C2.
//
// A client component, because two pages that render it (`/import`, `/login`'s
// sibling flows) are themselves client components — the locale therefore
// arrives through context, resolved once by the root layout.
export function NavBar() {
  const t = useTranslator();

  return (
    // Named, because /accounts carries a second <nav> for its status tabs and
    // `getByRole('navigation')` is ambiguous there.
    <nav data-testid="navbar" className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <span className="text-sm font-semibold text-neutral-900">{t('nav.brand')}</span>
        <Link href="/accounts" className="text-sm text-neutral-600 hover:text-neutral-900">
          {t('nav.accounts')}
        </Link>
        <Link href="/licenses" className="text-sm text-neutral-600 hover:text-neutral-900">
          {t('nav.licenses')}
        </Link>
        <Link href="/import" className="text-sm text-neutral-600 hover:text-neutral-900">
          {t('nav.import')}
        </Link>
        <Link href="/apps" className="text-sm text-neutral-600 hover:text-neutral-900">
          {t('nav.apps')}
        </Link>
        <Link href="/discovery" className="text-sm text-neutral-600 hover:text-neutral-900">
          {t('nav.discovery')}
        </Link>
        <Link href="/events" className="text-sm text-neutral-600 hover:text-neutral-900">
          {t('nav.events')}
        </Link>
      </div>
    </nav>
  );
}
