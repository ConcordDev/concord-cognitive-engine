'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Wheat } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ShellPreview } from '@/components/lens/ShellPreview';
import LiveFeed from '@/components/lens/LiveFeed';
import WeatherHero, { type WeatherPayload } from '@/components/lens/WeatherHero';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { AgricultureActionPanel } from '@/components/agriculture/AgricultureActionPanel';
import { ActionResultPanel } from '@/components/agriculture/ActionResultPanel';
import { DeereWorkbenchPanel } from '@/components/agriculture/DeereWorkbenchPanel';
import { FarmDeskProvider, useFarmDesk } from '@/components/agriculture/FarmDeskContext';
import FarmWorkbench from '@/components/agriculture/FarmWorkbench';
import { OpsDeskPanel } from '@/components/agriculture/OpsDeskPanel';
import PrecisionAgPanel from '@/components/agriculture/PrecisionAgPanel';
import { RecordsMapPanel } from '@/components/agriculture/RecordsMapPanel';
import { RecordsPanel } from '@/components/agriculture/RecordsPanel';
import { ScoutPanel } from '@/components/agriculture/ScoutPanel';
import {
  FARM_DESK_TABS,
  isRecordKind,
  type FarmDeskView,
} from '@/components/agriculture/ag-types';

export default function AgricultureLensPage() {
  useLensNav('agriculture');
  return (
    <FarmDeskProvider>
      <AgricultureFarmDesk />
    </FarmDeskProvider>
  );
}

const DESK_TITLES: Partial<Record<FarmDeskView, string>> = {
  ops: 'Your farm today',
  map: 'Every field on the map',
  workbench: 'The Ops Center',
  precision: 'The view from the field',
  operator: 'Plans for the season',
  scout: 'What is out in the field',
};

function AgricultureFarmDesk() {
  useLensIdentity('agriculture');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('agriculture');
  const {
    latestData: weatherData,
    isLive: weatherLive,
    lastUpdated: weatherUpdated,
  } = useRealtimeLens('eco');
  const { pending } = useFarmDesk();
  const [active, setActive] = useState<FarmDeskView>('ops');
  const [workbenchOpen, setWorkbenchOpen] = useState(false);

  useLensCommand(
    [
      { id: 'view-ops', keys: 'o', description: 'Ops desk', category: 'navigation', action: () => setActive('ops') },
      { id: 'tab-fields', keys: 'f', description: 'Fields', category: 'navigation', action: () => setActive('fields') },
      { id: 'tab-crops', keys: 'c', description: 'Crops', category: 'navigation', action: () => setActive('crops') },
      { id: 'tab-livestock', keys: 'l', description: 'Livestock', category: 'navigation', action: () => setActive('livestock') },
      { id: 'tab-equipment', keys: 'e', description: 'Equipment', category: 'navigation', action: () => setActive('equipment') },
      { id: 'tab-water', keys: 'w', description: 'Water', category: 'navigation', action: () => setActive('water') },
      { id: 'tab-harvest', keys: 'h', description: 'Harvest', category: 'navigation', action: () => setActive('harvest') },
      { id: 'tab-certs', keys: 'r', description: 'Certifications', category: 'navigation', action: () => setActive('certs') },
      { id: 'view-map', keys: 'm', description: 'Map', category: 'navigation', action: () => setActive('map') },
      { id: 'view-workbench', keys: 'd', description: 'Deere Ops Center', category: 'navigation', action: () => setActive('workbench') },
      { id: 'view-precision', keys: 'p', description: 'FieldView', category: 'navigation', action: () => setActive('precision') },
      { id: 'view-operator', keys: 'b', description: 'Plans bench', category: 'navigation', action: () => setActive('operator') },
      { id: 'view-scout', keys: 's', description: 'Scout', category: 'navigation', action: () => setActive('scout') },
      { id: 'open-workbench', keys: 'shift+w', description: 'Farm workbench overlay', category: 'navigation', action: () => setWorkbenchOpen(true) },
    ],
    { lensId: 'agriculture' },
  );

  let body: ReactNode = null;
  if (active === 'ops') {
    body = <OpsDeskPanel onOpenRecords={(kind) => setActive(kind)} />;
  } else if (isRecordKind(active)) {
    body = <RecordsPanel kind={active} />;
  } else if (active === 'map') {
    body = <RecordsMapPanel />;
  } else if (active === 'workbench') {
    body = <DeereWorkbenchPanel />;
  } else if (active === 'precision') {
    body = <PrecisionAgPanel />;
  } else if (active === 'operator') {
    body = (
      <PipingProvider>
        <AgricultureActionPanel />
      </PipingProvider>
    );
  } else {
    body = <ScoutPanel />;
  }

  const label = FARM_DESK_TABS.find((t) => t.id === active)?.label;
  const title = DESK_TITLES[active] ?? `Your ${label?.toLowerCase() ?? 'farm'} records`;

  return (
    <LensShell lensId="agriculture" asMain={false}>
      <FirstRunTour lensId="agriculture" />
      <DepthBadge lensId="agriculture" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="agriculture"
        crumb="Agriculture"
        title={`${title}${active === 'ops' && who ? `, ${who}` : ''}`}
        subtitle="Fields, fleet, field view and harvest."
        actions={
          <>
            {pending && <span className="animate-pulse text-xs text-neon-blue">Running…</span>}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="agriculture" data={{}} compact />
          </>
        }
        tabs={FARM_DESK_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        activeTab={active}
        onTab={(id) => setActive(id as FarmDeskView)}
        tabsLabel="Farm desk"
        cta={{ label: 'Farm Workbench', icon: Wheat, onClick: () => setWorkbenchOpen(true), title: 'Farm Workbench — fields, weather + soil, scouting log (Shift+W)' }}
      >
        <div className="space-y-5">
          <ShellPreview lensId="agriculture" defaultOpen />

          {active === 'ops' && (
            <>
              <WeatherHero
                data={weatherData as WeatherPayload | null}
                isLive={weatherLive}
                lastUpdated={weatherUpdated}
              />
              <LiveFeed
                articles={
                  (realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as ComponentProps<
                    typeof LiveFeed
                  >['articles']
                }
                domain="agriculture"
                isLive={isLive}
                lastUpdated={lastUpdated}
                limit={10}
              />
              <RealtimeDataPanel
                domain="agriculture"
                data={realtimeData}
                isLive={isLive}
                lastUpdated={lastUpdated}
                insights={insights}
                compact
              />
            </>
          )}

          <div id="agriculture-desk">{body}</div>

          <ActionResultPanel />

          <LensFeedPanel lensId="agriculture" />
          <LensFeedButton domain="agriculture" label="Live crop-yield feed" />
        </div>
      </NorthStarFrame>

      <FarmWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
    </LensShell>
  );
}
