'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
import {
  Waves,
  Clock,
  Activity,
  BookOpen,
  Map,
  Plus,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

type OceanTab = 'tides' | 'waves' | 'live' | 'logbook' | 'map';

const TABS: { key: OceanTab; label: string; keys: string; icon: typeof Waves }[] = [
  { key: 'tides', label: 'Tides', keys: 't', icon: Clock },
  { key: 'waves', label: 'Waves & Water', keys: 'w', icon: Waves },
  { key: 'live', label: 'Live Marine', keys: 'l', icon: Activity },
  { key: 'logbook', label: 'Logbook', keys: 'b', icon: BookOpen },
  { key: 'map', label: 'Map', keys: 'm', icon: Map },
];

interface Spot { id: string; name: string; kind: string; lat: number | null; lon: number | null; notes: string }

export default function OceanLensPage() {
  useLensNav('ocean');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('ocean');

  const [activeTab, setActiveTab] = useState<OceanTab>('tides');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

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

  const tabs = TABS.map((t) => ({ id: t.key, label: t.label, icon: t.icon, keys: t.keys }));
  const titles: Record<OceanTab, string> = {
    tides: `Read the tide${who ? `, ${who}` : ''}`,
    waves: 'Feel the swell',
    live: 'Watch the water move',
    logbook: 'Log your time on the water',
    map: 'Chart your spots',
  };

  return (
    <LensShell lensId="ocean" asMain={false}>
      <FirstRunTour lensId="ocean" />
      <DepthBadge lensId="ocean" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="ocean"
        crumb="Ocean Operations"
        title={titles[activeTab]}
        subtitle="Tides, marine forecasts, live vessel & buoy data, and a personal dive/surf/fishing logbook"
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="ocean" data={realtimeData || {}} compact />
          </>
        )}
        tabs={tabs}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as OceanTab)}
        tabsLabel="Ocean views"
        cta={{ label: 'Log a spot', icon: Plus, onClick: () => setActiveTab('logbook'), title: 'Open the logbook (B)' }}
      >
      <div className="space-y-4">
        {activeTab === 'tides' && (
          <div className="space-y-4">
            <NoaaTidesPanel />
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <TidePredictions />
            </section>
            <section>
              <TideActionStack />
            </section>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <NoaaStationExplorer />
            </section>
          </div>
        )}

        {activeTab === 'waves' && (
          <div className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <WaveEcosystemPanel />
            </section>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
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
          <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
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
      </NorthStarFrame>
    </LensShell>
  );
}
