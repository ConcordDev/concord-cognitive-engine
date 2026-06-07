'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/legal/terms', label: 'Terms of Service' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/cookies', label: 'Cookie Policy' },
  { href: '/legal/acceptable-use', label: 'Acceptable Use' },
  { href: '/legal/ai-disclosure', label: 'AI Disclosure' },
  { href: '/legal/dmca', label: 'DMCA Policy' },
  { href: '/legal/security', label: 'Security' },
];

const LAST_UPDATED = 'June 7, 2026';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-lattice-deep">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-lattice-border bg-lattice-void/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-neon-cyan"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Concord
          </Link>
          <span className="text-xs text-zinc-400">Last updated: {LAST_UPDATED}</span>
        </div>
      </header>

      <div className="mx-auto flex flex-col md:flex-row max-w-6xl gap-8 px-6 py-10">
        {/* Sidebar navigation */}
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="sticky top-20 space-y-1">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Legal
            </p>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-neon-cyan/10 text-neon-cyan font-medium'
                      : 'text-zinc-400 hover:bg-lattice-surface hover:text-zinc-200'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}

            <div className="mt-6 border-t border-lattice-border pt-4">
              <p className="text-[11px] text-zinc-400">
                Questions about our policies? Contact us at{' '}
                <a
                  href="mailto:legal@concord-os.org"
                  className="text-neon-cyan/70 hover:text-neon-cyan"
                >
                  legal@concord-os.org
                </a>
              </p>
            </div>
          </nav>
        </aside>

        {/* Mobile nav */}
        <div className="mb-6 flex gap-2 overflow-x-auto md:hidden">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-neon-cyan/15 text-neon-cyan'
                    : 'bg-lattice-surface text-zinc-400'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Content area */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
