'use client';

import { useUIStore } from '@/store/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Search, Command, Menu, Activity } from 'lucide-react';
import { SyncStatusDot, useOnlineStatus } from '@/components/common/OfflineIndicator';
import { HeartbeatBar } from '@/components/live/HeartbeatBar';
import { XPWidget } from '@/components/gamification/XPWidget';
import { WalletBadge } from '@/components/economy/WalletBadge';
import { LensTitle } from './topbar/LensTitle';
import { NotificationBell } from '@/components/social/NotificationBell';
import { DMIndicator } from '@/components/social/DMIndicator';
import { UserMenu } from './topbar/UserMenu';
import { usePowerMode } from '@/hooks/usePowerMode';

export function Topbar() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const { isOnline } = useOnlineStatus();
  const { powerMode, togglePowerMode } = usePowerMode();

  // Background resonance fetch (data consumed by HeartbeatBar via its own query)
  useQuery({
    queryKey: ['resonance-quick'],
    queryFn: () => api.get('/api/lattice/resonance').then((r) => r.data).catch(() => null),
    refetchInterval: 30000,
    retry: false,
  });

  // Fetch user info for display name
  const { data: userData } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/api/auth/me').then((r) => r.data).catch(() => null),
    staleTime: 60000,
    retry: false,
  });

  // Fetch system health for pulse indicator
  const { data: healthData } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api.get('/api/system/health').then((r) => r.data).catch(() => null),
    refetchInterval: 60000,
    retry: false,
  });

  // Fetch affect state for mood indicator
  const { data: affectData } = useQuery({
    queryKey: ['affect-topbar'],
    queryFn: () => api.get('/api/affect/state').then((r) => r.data).catch(() => null),
    refetchInterval: 30000,
    retry: false,
  });

  const userName = userData?.username || userData?.displayName || userData?.name || userData?.email?.split('@')[0] || null;
  const systemHealthy = healthData?.status === 'ok' || healthData?.healthy === true;
  const systemDegraded = healthData && !systemHealthy;

  const affectLabel = affectData?.state?.label as string | undefined;
  const affectSummary = affectData?.state?.summary as string | undefined;

  return (
    <header
      role="banner"
      className={`h-14 lg:h-16 bg-lattice-surface border-b border-lattice-border flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30 transition-all duration-300 ${
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
        className="hidden sm:flex items-center gap-2 px-3 lg:px-4 py-2 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-blue/50 transition-colors group"
        aria-label="Open command palette"
      >
        <Search className="w-4 h-4 text-gray-400 group-hover:text-neon-blue" />
        <span className="text-sm text-gray-400 hidden md:inline">Search...</span>
        <div className="hidden lg:flex items-center gap-1 ml-4 lg:ml-8">
          <kbd className="px-1.5 py-0.5 text-xs bg-lattice-elevated rounded text-gray-500">
            <Command className="w-3 h-3 inline" />
          </kbd>
          <kbd className="px-1.5 py-0.5 text-xs bg-lattice-elevated rounded text-gray-500">
            K
          </kbd>
        </div>
      </button>

      {/* Right Side */}
      <div className="flex items-center gap-2 lg:gap-3">
        {/* Mobile search button */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="sm:hidden p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
          aria-label="Search"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* System Pulse Indicator (Power Mode only) */}
        {powerMode && (
          <div
            className="flex items-center gap-1.5 px-2 py-1"
            title={systemDegraded ? 'System degraded' : 'System healthy'}
          >
            <Activity
              className={`w-3.5 h-3.5 ${
                systemDegraded
                  ? 'text-amber-400'
                  : systemHealthy
                    ? 'text-green-400'
                    : 'text-gray-500 animate-pulse'
              }`}
            />
            <span className={`hidden lg:inline text-xs ${
              systemDegraded ? 'text-amber-400' : systemHealthy ? 'text-green-400' : 'text-gray-500'
            }`}>
              {systemDegraded ? 'Degraded' : systemHealthy ? 'Healthy' : 'Checking'}
            </span>
          </div>
        )}

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

        {/* FE-010: Online/offline status indicator */}
        <div
          className="hidden sm:flex items-center gap-2 px-2 py-1.5"
          title={isOnline ? 'Online' : 'Offline — changes saved locally'}
        >
          <SyncStatusDot status={isOnline ? 'synced' : 'offline'} />
          <span className="hidden md:inline text-xs text-gray-400">
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>

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

        {/* User name + avatar with online status dot */}
        <div className="flex items-center gap-1.5">
          {userName && (
            <span className="hidden lg:inline text-xs text-gray-400 max-w-[100px] truncate">
              {userName}
            </span>
          )}
          <div className="relative">
            <UserMenu powerMode={powerMode} onTogglePowerMode={togglePowerMode} />
            {/* Online status indicator */}
            {isOnline && (
              <span
                className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-lattice-surface"
                title="Online"
              />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
