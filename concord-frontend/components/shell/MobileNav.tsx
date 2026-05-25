'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Layers, MessageSquare, Wallet, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavTab {
  href: string;
  label: string;
  icon: typeof Home;
  /** Match any path starting with this prefix (defaults to exact match on href). */
  matchPrefix?: string;
}

const TABS: NavTab[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/lenses', label: 'Lenses', icon: Layers, matchPrefix: '/lenses' },
  { href: '/lenses/chat', label: 'Chat', icon: MessageSquare, matchPrefix: '/lenses/chat' },
  { href: '/lenses/wallet', label: 'Wallet', icon: Wallet, matchPrefix: '/lenses/wallet' },
  { href: '/profile', label: 'Profile', icon: User, matchPrefix: '/profile' },
];

/**
 * MobileNav — Fixed bottom navigation bar for viewports < 768px (md breakpoint).
 *
 * Renders 5 tabs (Home, Lenses, Chat, Wallet, Profile) with lucide icons.
 * Highlights the active route. Uses safe-area inset padding for devices
 * with a home indicator (iPhone X+, etc.).
 */
export function MobileNav() {
  const pathname = usePathname();

  const isActive = (tab: NavTab): boolean => {
    if (tab.matchPrefix) {
      // For the root Lenses tab, only match exact /lenses (not /lenses/chat etc.)
      if (tab.href === '/lenses') {
        return pathname === '/lenses' || pathname === '/lenses/all';
      }
      return pathname.startsWith(tab.matchPrefix);
    }
    return pathname === tab.href;
  };

  return (
    <nav
      role="navigation"
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-lattice-border bg-lattice-surface/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-around h-14">
        {TABS.map((tab) => {
          const active = isActive(tab);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full gap-0.5 text-[10px] font-medium transition-colors',
                active
                  ? 'text-neon-cyan'
                  : 'text-gray-400 active:text-gray-300',
              )}
            >
              <Icon
                className={cn(
                  'w-5 h-5 transition-colors',
                  active ? 'text-neon-cyan' : 'text-gray-400',
                )}
                strokeWidth={active ? 2.25 : 1.75}
              />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
