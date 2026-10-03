'use client';

import type { ReactNode } from 'react';
import { useUIStore } from '@/store/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Search, Command, Menu } from 'lucide-react';
import { useOnlineStatus } from '@/components/common/OfflineIndicator';
import { HeartbeatBar } from '@/components/live/HeartbeatBar';
import { XPWidget } from '@/components/gamification/XPWidget';
import { WalletBadge } from '@/components/economy/WalletBadge';
import { LensTitle } from './topbar/LensTitle';
import { SovereignHealthRibbon } from './SovereignHealthRibbon';
import { NotificationBell } from '@/components/social/NotificationBell';
import { DMIndicator } from '@/components/social/DMIndicator';
import { UserMenu } from './topbar/UserMenu';
import { usePowerMode } from '@/hooks/usePowerMode';
import { safeGetItem } from '@/lib/safe-storage';

export function Topbar({ trailing }: { trailing?: ReactNode } = {}) {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const { isOnline } = useOnlineStatus();
  const { powerMode, togglePowerMode } = usePowerMode();

  // Background resonance fetch — exists ONLY to prime the react-query cache
  // for HeartbeatBar's own `resonance-quick` query (same queryKey, same
  // endpoint: GET /api/lattice/resonance). HeartbeatBar itself only mounts
  // under `powerMode &&` below, so priming this cache for non-Power-Mode
  // sessions (the default — see hooks/usePowerMode.ts) was pure waste: a
  // 30s poll running forever for a component that never renders. Gated the
  // same way HeartbeatBar is gated.
  useQuery({
    queryKey: ['resonance-quick'],
    queryFn: () => api.get('/api/lattice/resonance').then((r) => r.data).catch(() => null),
    refetchInterval: 30000,
    enabled: powerMode,
    retry: false,
  });

  // Fetch user info for display name — gated on the same client-visible
  // "has entered" signal Providers.tsx uses (the auth cookie itself is
  // httpOnly, so JS can't read it directly; `concord_entered` is set by
  // login/register/onboarding and cleared on logout + the 401 interceptor,
  // per lib/api/client.ts). Skips the probe entirely for anonymous visitors
  // instead of generating a guaranteed 401 on every lens page mount.
  const hasEntered = typeof window !== 'undefined' && !!safeGetItem(window.localStorage, 'concord_entered');
  const { data: userData } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/api/auth/me').then((r) => r.data).catch(() => null),
    enabled: hasEntered,
    staleTime: 60000,
    retry: false,
  });

  // System health is now surfaced for everyone via <SovereignHealthRibbon />
  // (its own gated poll of /api/system/health) — no separate powerMode poll here.

  // Fetch affect state for the mood indicator — same story, `powerMode &&`-only
  // consumer below.
  const { data: affectData } = useQuery({
    queryKey: ['affect-topbar'],
    queryFn: () => api.get('/api/affect/state').then((r) => r.data).catch(() => null),
    refetchInterval: 30000,
    enabled: powerMode,
    retry: false,
  });

  const affectLabel = affectData?.state?.label as string | undefined;
  const affectSummary = affectData?.state?.summary as string | undefined;

  return (
    <header
      role="banner"
      className={`h-14 bg-lattice-surface border-b border-lattice-border flex items-center justify-between gap-3 px-4 sticky top-0 z-30 transition-all duration-300 ${
        sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'
      }`}
    >
      {/* Left - Mobile menu + Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <LensTitle />
      </div>

      {/* Center - Search (hidden on small mobile) */}
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="hidden sm:flex h-8 w-full max-w-sm items-center gap-2 px-2.5 rounded-md border border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05] transition-colors group"
        aria-label="Open command palette"
      >
        <Search className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300" />
        <span className="text-[13px] text-zinc-500 hidden md:inline">Search or jump to…</span>
        <kbd className="ml-auto hidden lg:inline-flex items-center gap-0.5 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
          <Command className="w-2.5 h-2.5" />K
        </kbd>
      </button>

      {/* Right Side */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {/* Mobile search button */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="sm:hidden p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
          aria-label="Search"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Sovereign health ribbon — metabolic status for everyone */}
        <SovereignHealthRibbon />

        {/* Affect mood indicator (Power Mode only) */}
        {powerMode && affectLabel && (
          <div
            className="hidden md:flex items-center gap-1.5 px-2 py-1"
            title={affectSummary || `Current mood: ${affectLabel}`}
          >
            <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
            <span className="text-xs text-purple-300 capitalize">{affectLabel}</span>
          </div>
        )}

        <WalletBadge />

        {powerMode && (
          <div className="hidden md:block">
            <XPWidget />
          </div>
        )}

        {powerMode && (
          <div className="hidden md:block">
            <HeartbeatBar />
          </div>
        )}

        {/* Social indicators: DM + Notifications */}
        <DMIndicator userId={userData?.id || userData?._id} />
        <NotificationBell userId={userData?.id || userData?._id} />
        {trailing}

        {/* User name + avatar with online status dot */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <UserMenu powerMode={powerMode} onTogglePowerMode={togglePowerMode} />
            {/* Online status indicator */}
            {/* Connection state: green when online, gray "saved locally" when offline */}
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-lattice-surface ${isOnline ? 'bg-green-400' : 'bg-zinc-500'}`}
              title={isOnline ? 'Online' : 'Offline — changes saved locally'}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
