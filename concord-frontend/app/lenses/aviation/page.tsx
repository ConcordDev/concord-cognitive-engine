'use client';

import { useState, type ComponentProps } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plane, BarChart3, Users, Navigation, Wrench, DollarSign, Weight, CloudRain, Map,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed from '@/components/lens/LiveFeed';
import type { AvView } from '@/components/aviation/aviation-nav';
import DashboardPanel from '@/components/aviation/DashboardPanel';
import FlightsPanel from '@/components/aviation/FlightsPanel';
import PilotsPanel from '@/components/aviation/PilotsPanel';
import FleetOpsPanel from '@/components/aviation/FleetOpsPanel';
import MaintenancePanel from '@/components/aviation/MaintenancePanel';
import CharterPanel from '@/components/aviation/CharterPanel';
import WeightBalancePanel from '@/components/aviation/WeightBalancePanel';
import WeatherOpsPanel from '@/components/aviation/WeatherOpsPanel';
import EfbPanel from '@/components/aviation/EfbPanel';

const TABS: { id: AvView; label: string; icon: typeof Plane; keys: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3, keys: 'd' },
  { id: 'flights', label: 'Flights', icon: Plane, keys: 'f' },
  { id: 'pilots', label: 'Pilots', icon: Users, keys: 'p' },
  { id: 'fleet', label: 'Fleet', icon: Navigation, keys: 'l' },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench, keys: 'm' },
  { id: 'charter', label: 'Charter', icon: DollarSign, keys: 'c' },
  { id: 'wb', label: 'W&B', icon: Weight, keys: 'b' },
  { id: 'weather', label: 'Weather', icon: CloudRain, keys: 'w' },
  { id: 'efb', label: 'EFB', icon: Map, keys: 'e' },
];

export default function AviationLensPage() {
  useLensNav('aviation');
  useLensIdentity('aviation');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('aviation');
  const [active, setActive] = useState<AvView>('dashboard');

  useLensCommand(
    TABS.map((t) => ({
      id: `mode-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActive(t.id),
    })),
    { lensId: 'aviation' },
  );

  const articles = (realtimeData as { articles?: Array<{ pubDate?: string } & Record<string, unknown>> } | null)?.articles;
  const feedNow = lastUpdated ? new Date(lastUpdated).getTime() : 0;
  const recentSafetyAlerts = feedNow
    ? (articles || []).filter((a) => {
      const pd = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      return pd > 0 && (feedNow - pd) < 7 * 86_400_000;
    }).length
    : 0;

  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <LensShell lensId="aviation" asMain={false}>
      <FirstRunTour lensId="aviation" />
      <DepthBadge lensId="aviation" size="sm" className="ml-2" />
      <div data-lens-theme="aviation" className={ds.pageContainer}>
        <a href="#aviation-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-sky-500 focus:outline-none">
          Skip to aviation content
        </a>
        <ShellPreview lensId="aviation" defaultOpen={false} />

        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Plane className="w-8 h-8 text-sky-400" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Aviation</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>ForeFlight-shaped EFB — flights, fleet, W&amp;B, weather, moving map.</p>
            </div>
          </div>
        </header>

        <LiveFeed
          articles={articles as ComponentProps<typeof LiveFeed>['articles']}
          domain="aviation"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={6}
        />
        <RealtimeDataPanel domain="aviation" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        <DTUExportButton domain="aviation" data={{}} compact />

        <div className="flex flex-col md:flex-row gap-4">
          <nav
            className="md:w-44 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible border-b md:border-b-0 md:border-r border-sky-900/40 pb-2 md:pb-0 md:pr-3"
            aria-label="Aviation views"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const on = active === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActive(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors',
                    on
                      ? 'bg-sky-500/15 text-sky-200 border border-sky-500/30'
                      : 'text-gray-400 hover:text-white border border-transparent hover:bg-white/[0.04]',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  <kbd className="ml-auto hidden md:inline text-[10px] font-mono text-gray-500">{tab.keys}</kbd>
                </button>
              );
            })}
          </nav>

          <main id="aviation-main" className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
              >
                <AviationView active={active} onNavigate={setActive} recentSafetyAlerts={recentSafetyAlerts} />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <LensFeedButton domain="aviation" label="Live aviation feed" />
        <CrossLensRecentsPanel lensId="aviation" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}

function AviationView({
  active,
  onNavigate,
  recentSafetyAlerts,
}: {
  active: AvView;
  onNavigate: (view: AvView) => void;
  recentSafetyAlerts: number;
}) {
  switch (active) {
    case 'dashboard':
      return <DashboardPanel onNavigate={onNavigate} recentSafetyAlerts={recentSafetyAlerts} />;
    case 'flights':
      return <FlightsPanel />;
    case 'pilots':
      return <PilotsPanel />;
    case 'fleet':
      return <FleetOpsPanel />;
    case 'maintenance':
      return <MaintenancePanel />;
    case 'charter':
      return <CharterPanel />;
    case 'wb':
      return <WeightBalancePanel />;
    case 'weather':
      return <WeatherOpsPanel />;
    case 'efb':
      return <EfbPanel />;
  }
}
