'use client';

/**
 * Real estate lens — one Zillow/Redfin home-search app.
 *
 * Single view union: search (map + rail + inspector) | comps | desk | world.
 * Panels own their macros. Page is a thin shell.
 */

import { useMemo, useState, type ComponentProps, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BarChart3, Building2, Calculator, Map as MapIcon } from 'lucide-react';
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
      <div data-lens-theme="realestate" className={ds.pageContainer}>
        <ShellPreview lensId="realestate" defaultOpen={false} />
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Building2 className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Real Estate</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
                <DTUExportButton domain="realestate" data={realtimeData || {}} compact />
              </div>
              <p className={ds.textMuted}>Map, listing inspector, and comps — Zillow-shaped, honest numbers only.</p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Real estate views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

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
          <CrossLensRecentsPanel lensId="realestate" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />

        <MobileTabBar
          tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon }))}
          active={active}
          onSelect={(id) => setActive(id as RealEstateView)}
        />
      </div>
    </LensShell>
  );
}
