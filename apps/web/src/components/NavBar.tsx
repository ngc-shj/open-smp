import Link from 'next/link';

export function NavBar() {
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <span className="text-sm font-semibold text-neutral-900">open-smp</span>
        <Link href="/accounts" className="text-sm text-neutral-600 hover:text-neutral-900">
          Accounts
        </Link>
        <Link href="/licenses" className="text-sm text-neutral-600 hover:text-neutral-900">
          Licences
        </Link>
        <Link href="/import" className="text-sm text-neutral-600 hover:text-neutral-900">
          Import
        </Link>
        <Link href="/apps" className="text-sm text-neutral-600 hover:text-neutral-900">
          Apps
        </Link>
        <Link href="/events" className="text-sm text-neutral-600 hover:text-neutral-900">
          Events
        </Link>
      </div>
    </nav>
  );
}
