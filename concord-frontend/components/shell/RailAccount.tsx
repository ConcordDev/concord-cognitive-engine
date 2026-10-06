'use client';

/**
 * RailAccount — the sidebar rail's footer: search (⌘K), notifications, theme,
 * sessions and the account avatar.
 *
 * Lens north stars (docs/lens-northstar) put lenses on a thin icon rail with
 * no top bar, the avatar at the bottom of the rail. On lens pages the Topbar
 * is hidden on desktop, so these controls live here. Menus open beside the
 * rail (placement="side"). Status chrome (brains / tick / wallet) stays out of
 * lens chrome by design; the health details panel is still one click away
 * from the account menu's system page and from the Topbar elsewhere.
 */

import { useQuery } from '@tanstack/react-query';
import { HelpCircle, PanelRight, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { safeGetItem } from '@/lib/safe-storage';
import { usePowerMode } from '@/hooks/usePowerMode';
import { useOnlineStatus } from '@/components/common/OfflineIndicator';
import { NotificationBell } from '@/components/social/NotificationBell';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { UserMenu } from './topbar/UserMenu';
import { cn } from '@/lib/utils';

/** AppShell listens for this and toggles the session sidebar. */
export const TOGGLE_SESSIONS_EVENT = 'concord:toggle-sessions';

const railBtn =
  'flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100';

export function RailAccount({ expanded }: { expanded: boolean }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const { powerMode, togglePowerMode } = usePowerMode();
  const { isOnline } = useOnlineStatus();
  const hasEntered = typeof window !== 'undefined' && !!safeGetItem(window.localStorage, 'concord_entered');
  // Same query key as the Topbar, so the two share one cached /auth/me.
  const { data: userData } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/api/auth/me').then((r) => r.data).catch(() => null),
    enabled: hasEntered,
    staleTime: 60000,
    retry: false,
  });
  const userId = userData?.id || userData?._id;

  return (
    <div className={cn('flex items-center gap-1', expanded ? 'flex-row flex-wrap' : 'flex-col')}>
      <button type="button" onClick={() => setCommandPaletteOpen(true)} className={railBtn} title="Search or jump to (⌘K)" aria-label="Search">
        <Search className="h-4 w-4" />
      </button>
      <NotificationBell userId={userId} placement="side" />
      <ThemeToggle />
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(TOGGLE_SESSIONS_EVENT))}
        className={railBtn}
        title="Sessions (Ctrl+Shift+S)"
        aria-label="Open sessions"
      >
        <PanelRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('concord:open-help'))}
        className={railBtn}
        title="Help & feedback"
        aria-label="Help and feedback"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      <div className="relative mt-1">
        <UserMenu powerMode={powerMode} onTogglePowerMode={togglePowerMode} placement="side" />
        <span
          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-lattice-surface ${isOnline ? 'bg-green-400' : 'bg-zinc-500'}`}
          title={isOnline ? 'Online' : 'Offline — changes saved locally'}
        />
      </div>
    </div>
  );
}

export default RailAccount;
