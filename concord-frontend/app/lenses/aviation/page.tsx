'use client';

import { useState, type ComponentProps } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plane, BarChart3, Users, Navigation, Wrench, DollarSign, Weight, CloudRain, Map, Plus,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

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

  const titles: Record<AvView, string> = {
    dashboard: `Clear for departure${who ? `, ${who}` : ''}`,
    flights: 'Plan the flight',
    pilots: 'Know your crew',
    fleet: 'Keep the fleet moving',
    maintenance: 'Keep it airworthy',
    charter: 'Quote the charter',
    wb: 'Balance the load',
    weather: 'Read the sky',
    efb: 'Fly the moving map',
  };

  return (
    <LensShell lensId="aviation" asMain={false}>
      <FirstRunTour lensId="aviation" />
      <DepthBadge lensId="aviation" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="aviation"
        theme="aviation"
        crumb="Aviation"
        title={titles[active]}
        subtitle="Flights, fleet, W&B, weather, moving map."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <DTUExportButton domain="aviation" data={{}} compact />
          </>
        )}
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.keys }))}
        activeTab={active}
        onTab={(id) => setActive(id as AvView)}
        tabsLabel="Aviation views"
        cta={{ label: 'Plan a flight', icon: Plus, onClick: () => setActive('flights'), title: 'Open flight planning (F)' }}
      >
        <ShellPreview lensId="aviation" defaultOpen={false} />

        <div className="mb-5 space-y-4">
          <LiveFeed
            articles={articles as ComponentProps<typeof LiveFeed>['articles']}
            domain="aviation"
            isLive={isLive}
            lastUpdated={lastUpdated}
            limit={6}
          />
          <RealtimeDataPanel domain="aviation" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        </div>

        <div id="aviation-main" className="min-w-0">
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
        </div>

        <LensFeedButton domain="aviation" label="Live aviation feed" />
      </NorthStarFrame>
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
