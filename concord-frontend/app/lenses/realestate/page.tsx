'use client';

/**
 * Real estate lens — one Zillow/Redfin home-search app.
 *
 * Single view union: search (map + rail + inspector) | comps | desk | world.
 * Panels own their macros. Page is a thin shell.
 */

import { useMemo, useState, type ComponentProps, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BarChart3, Building2, Calculator, Map as MapIcon, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed from '@/components/lens/LiveFeed';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { SearchMapPanel } from '@/components/realestate/SearchMapPanel';
import { CompsPanel } from '@/components/realestate/CompsPanel';
import { ArtifactDeskPanel } from '@/components/realestate/ArtifactDeskPanel';
import { WorldPropertiesPanel } from '@/components/realestate/WorldPropertiesPanel';
import { RealEstateProvider } from '@/components/realestate/RealEstateContext';
import { PipingProvider } from '@/components/panel-polish';

type RealEstateView = 'search' | 'comps' | 'desk' | 'world';

const VIEWS: { id: RealEstateView; label: string; keys: string; hint: string; icon: typeof MapIcon }[] = [
  { id: 'search', label: 'Search', keys: '1', hint: 'Map + listings + inspector', icon: MapIcon },
  { id: 'comps', label: 'Comps', keys: '2', hint: 'CMA · compare · AVM', icon: Calculator },
  { id: 'desk', label: 'Desk', keys: '3', hint: 'Pipeline · rentals · showings', icon: BarChart3 },
  { id: 'world', label: 'World', keys: '4', hint: 'In-world buy / sell / lease', icon: Building2 },
];

const PANELS: Record<RealEstateView, ComponentType> = {
  search: SearchMapPanel,
  comps: CompsPanel,
  desk: ArtifactDeskPanel,
  world: WorldPropertiesPanel,
};

export default function RealEstateLensPage() {
  useLensNav('realestate');
  useLensIdentity('realestate');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('realestate');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<RealEstateView>('search');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'realestate' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () =>
      reduceMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.16 },
          },
    [reduceMotion],
  );

  return (
    <LensShell lensId="realestate" asMain={false}>
      <FirstRunTour lensId="realestate" />
      <DepthBadge lensId="realestate" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="realestate"
        crumb="Real estate"
        title={`Find your next place${active === 'search' && who ? `, ${who}` : ''}`}
        subtitle="Map, listing inspector, comps, pipeline and in-world property."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="realestate" data={realtimeData || {}} compact />
          </>
        }
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={active}
        onTab={(id) => setActive(id as RealEstateView)}
        tabsLabel="Real estate views"
        cta={{ label: 'Search homes', icon: Search, onClick: () => setActive('search') }}
      >
        <ShellPreview lensId="realestate" defaultOpen={false} />

        <PipingProvider>
          <RealEstateProvider>
            <AnimatePresence mode="wait">
              <motion.div key={active} {...motionProps}>
                <Panel />
              </motion.div>
            </AnimatePresence>
          </RealEstateProvider>
        </PipingProvider>

        <LiveFeed
          articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as ComponentProps<typeof LiveFeed>['articles']}
          domain="realestate"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={8}
        />
        <RealtimeDataPanel
          domain="realestate"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />

        <section className="mt-4">
          <LensFeedButton domain="realestate" label="Live home-value feed" />
        </section>

        <MobileTabBar
          tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon }))}
          active={active}
          onSelect={(id) => setActive(id as RealEstateView)}
        />
      </NorthStarFrame>
    </LensShell>
  );
}
