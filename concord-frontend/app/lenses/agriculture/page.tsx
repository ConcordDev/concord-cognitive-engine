'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Wheat } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
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

function AgricultureFarmDesk() {
  useLensIdentity('agriculture');
  const reduceMotion = useReducedMotion();
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

  return (
    <LensShell lensId="agriculture" asMain={false}>
      <FirstRunTour lensId="agriculture" />
      <DepthBadge lensId="agriculture" size="sm" className="ml-2" />
      <div data-lens-theme="agriculture" className={ds.pageContainer}>
        <ShellPreview lensId="agriculture" defaultOpen />
        <a href="#agriculture-desk" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-emerald-500 focus:outline-none">
          Skip to farm desk
        </a>

        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Wheat className="w-8 h-8 text-green-400" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Farm desk</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>
                John Deere Ops Center / Granular — fields, fleet, FieldView, harvest
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DTUExportButton domain="agriculture" data={{}} compact />
            {pending && <span className="text-xs text-neon-blue animate-pulse">Running…</span>}
          </div>
        </header>

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

        <nav
          id="agriculture-desk"
          className="flex items-center gap-1 border-b border-emerald-900/30 pb-2 overflow-x-auto"
          aria-label="Farm desk"
        >
          {FARM_DESK_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition',
                active === tab.id
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                  : 'text-gray-400 hover:text-emerald-300 hover:bg-emerald-900/10 border border-transparent',
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </nav>

        <motion.div
          key={active}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          {body}
        </motion.div>

        <ActionResultPanel />

        <div className="px-4 mb-2">
          <LensFeedPanel lensId="agriculture" />
        </div>
        <section className="mt-4">
          <LensFeedButton domain="agriculture" label="Live crop-yield feed" />
        </section>
          <CrossLensRecentsPanel lensId="agriculture" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>

      <button
        type="button"
        onClick={() => setWorkbenchOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-emerald-50 shadow-2xl text-sm font-medium"
        title="Farm Workbench — fields, weather + soil, scouting log"
      >
        <Wheat className="w-4 h-4" /> Farm Workbench
      </button>
      <FarmWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
    </LensShell>
  );
}
