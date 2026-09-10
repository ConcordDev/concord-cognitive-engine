'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TidePredictions } from '@/components/ocean/TidePredictions';
import { NoaaTidesPanel } from '@/components/ocean/NoaaTidesPanel';
import { NoaaStationExplorer } from '@/components/ocean/NoaaStationExplorer';
import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';
import { WaveEcosystemPanel } from '@/components/ocean/WaveEcosystemPanel';
import { TidalSalinityPanel } from '@/components/ocean/TidalSalinityPanel';
import { SpotLog } from '@/components/ocean/SpotLog';
import { LiveMarinePanel } from '@/components/ocean/LiveMarinePanel';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { TideActionStack } from '@/components/ocean/TideActionStack';
import dynamic from 'next/dynamic';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Waves,
  Clock,
  Activity,
  BookOpen,
  Map,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

type OceanTab = 'tides' | 'waves' | 'live' | 'logbook' | 'map';

const TABS: { key: OceanTab; label: string; icon: typeof Waves }[] = [
  { key: 'tides', label: 'Tides', icon: Clock },
  { key: 'waves', label: 'Waves & Water', icon: Waves },
  { key: 'live', label: 'Live Marine', icon: Activity },
  { key: 'logbook', label: 'Logbook', icon: BookOpen },
  { key: 'map', label: 'Map', icon: Map },
];

interface Spot { id: string; name: string; kind: string; lat: number | null; lon: number | null; notes: string }

export default function OceanLensPage() {
  useLensNav('ocean');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('ocean');

  const [activeTab, setActiveTab] = useState<OceanTab>('tides');

  useLensCommand(
    [
      { id: 'tab-tides', keys: 't', description: 'Tides', category: 'navigation', action: () => setActiveTab('tides') },
      { id: 'tab-waves', keys: 'w', description: 'Waves & water', category: 'navigation', action: () => setActiveTab('waves') },
      { id: 'tab-live', keys: 'l', description: 'Live marine', category: 'navigation', action: () => setActiveTab('live') },
      { id: 'tab-logbook', keys: 'b', description: 'Logbook', category: 'navigation', action: () => setActiveTab('logbook') },
      { id: 'tab-map', keys: 'm', description: 'Map', category: 'navigation', action: () => setActiveTab('map') },
    ],
    { lensId: 'ocean' }
  );

  const { data: spots = [] } = useQuery({
    queryKey: ['ocean', 'spot-list', 'map'],
    queryFn: async () => {
      const r = await lensRun<{ spots: Spot[] }>('ocean', 'spot-list', {});
      return r.data?.ok ? r.data.result?.spots ?? [] : [];
    },
    enabled: activeTab === 'map',
  });

  return (
    <LensShell lensId="ocean" asMain={false}>
      <FirstRunTour lensId="ocean" />      <DepthBadge lensId="ocean" size="sm" className="ml-2" />
      <div data-lens-theme="ocean" className={cn(ds.pageContainer, 'space-y-4')}>
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Waves className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Ocean Operations</h1>
              <p className="text-sm text-gray-400">
                Tides, marine forecasts, live vessel & buoy data, and a personal dive/surf/fishing logbook
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="ocean" data={realtimeData || {}} compact />
          </div>
        </header>

        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                activeTab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'
              )}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {activeTab === 'tides' && (
          <div className="space-y-4">
            <NoaaTidesPanel />
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <TidePredictions />
            </section>
            <section>
              <TideActionStack />
            </section>
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <NoaaStationExplorer />
            </section>
          </div>
        )}

        {activeTab === 'waves' && (
          <div className="space-y-4">
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <WaveEcosystemPanel />
            </section>
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <TidalSalinityPanel />
            </section>
          </div>
        )}

        {activeTab === 'live' && (
          <section>
            <LiveMarinePanel />
          </section>
        )}

        {activeTab === 'logbook' && (
          <section>
            <LensFeedButton domain="ocean" />
            <SpotLog />
          </section>
        )}

        {activeTab === 'map' && (
          <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Map className="w-4 h-4 text-cyan-400" /> Logged Spots
            </h3>
            <MapView
              markers={spots
                .filter((s) => s.lat != null && s.lon != null)
                .map((s) => ({ lat: s.lat as number, lng: s.lon as number, label: s.name, popup: `${s.kind}${s.notes ? ` — ${s.notes}` : ''}` }))}
              className="h-[500px]"
              center={[0, -30]}
              zoom={3}
            />
            {spots.length === 0 && (
              <p className="text-[11px] text-gray-500 mt-2">No geotagged spots yet — add one with coordinates in the Logbook tab.</p>
            )}
          </div>
        )}

        <RealtimeDataPanel data={insights} />

        {/* Live Web Feed */}
        <div className="px-4 mb-2">
          <LensFeedPanel lensId="ocean" />
        </div>

        {/* Live Wikipedia oceanography reference. */}
        <WikipediaSearchPanel domain="ocean" title="Wikipedia · oceanography" />
      </div>

      <a href="#ocean-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to ocean content</a>      <CrossLensRecentsPanel lensId="ocean" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
