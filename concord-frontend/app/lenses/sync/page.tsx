'use client';

/**
 * /lenses/sync: DTU cross-device sync in the north-star look. Devices is the
 * full SyncDashboard (status, sync-now, revoke, auto-sync, conflicts,
 * selective sync, quota, activity) over the `sync` macros; Syncthing and
 * tooling are the live GitHub release and repo feeds, now first-class views.
 */

import { useState } from 'react';
import { Boxes, Laptop, Loader2, Plus, Rocket } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SyncDashboard } from '@/components/sync/SyncDashboard';
import { SyncthingReleases } from '@/components/sync/SyncthingReleases';
import { SyncRepos } from '@/components/sync/SyncRepos';

type SyncView = 'devices' | 'releases' | 'tooling';

const VIEWS: { id: SyncView; label: string; keys: string; title: string; hint: string; icon: typeof Laptop }[] = [
  { id: 'devices', label: 'Devices', keys: '1', title: 'Your brain, everywhere', hint: 'Devices, conflicts, scopes, quota and activity', icon: Laptop },
  { id: 'releases', label: 'Syncthing', keys: '2', title: 'What just shipped upstream', hint: 'Syncthing releases from GitHub', icon: Rocket },
  { id: 'tooling', label: 'Tooling', keys: '3', title: 'Tools that sync', hint: 'Sync tooling repositories from GitHub', icon: Boxes },
];

function defaultDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'This browser';
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || 'Browser';
  return `${platform} browser`;
}

export default function SyncPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<SyncView>('devices');
  const [registering, setRegistering] = useState(false);
  const [dashboardKey, setDashboardKey] = useState(0);

  const registerThisDevice = async () => {
    setRegistering(true);
    try {
      const r = await lensRun('sync', 'register_device', { deviceLabel: defaultDeviceLabel(), autoSync: true });
      if (!r.data?.ok) throw new Error(r.data?.error || 'Could not register this device.');
      useUIStore.getState().addToast({ type: 'success', message: 'This device is registered for sync.' });
      setView('devices');
      setDashboardKey((k) => k + 1);
    } catch (e) {
      useUIStore.getState().addToast({ type: 'error', message: (e as Error).message || 'Could not register this device.' });
    } finally {
      setRegistering(false);
    }
  };

  useLensCommand(
    VIEWS.map((v) => ({
      id: `sync-${v.id}`,
      keys: v.keys,
      description: `${v.label}: ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'sync' },
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="sync" asMain={false}>
      <FirstRunTour lensId="sync" />
      <DepthBadge lensId="sync" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="sync"
        crumb="Sync"
        title={`${current.title}${view === 'devices' && who ? `, ${who}` : ''}`}
        subtitle="Your second brain follows you across devices, instances and peers. No subscription: pure peer-to-peer over Concord federation."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as SyncView)}
        tabsLabel="Sync views"
        cta={{
          label: registering ? 'Registering…' : 'Register this device',
          icon: registering ? Loader2 : Plus,
          onClick: () => void registerThisDevice(),
          disabled: registering,
          title: 'Add this browser as a synced device',
        }}
      >
        {view === 'devices' && <SyncDashboard key={dashboardKey} />}
        {view === 'releases' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <SyncthingReleases />
          </section>
        )}
        {view === 'tooling' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <SyncRepos />
          </section>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
