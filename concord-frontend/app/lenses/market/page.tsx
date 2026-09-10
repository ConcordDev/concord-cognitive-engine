'use client';

/**
 * Market Lens — DTU marketplace + competitive intel.
 * Thin shell + one `active` union; panels own listings / analysis / heatmaps.
 */

import { useLensNav } from '@/hooks/useLensNav';
import MarketHeatmap from '@/components/market/MarketHeatmap';
import Watchlist from '@/components/market/Watchlist';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SectorHeatmapPanel } from '@/components/market/SectorHeatmap';
import { CompetitorTracker } from '@/components/market/CompetitorTracker';
import { CompetitiveIntelligence } from '@/components/market/CompetitiveIntelligence';
import { MarketAnalysisWorkbench } from '@/components/market/MarketAnalysisWorkbench';
import { MarketListingsPanel } from '@/components/market/MarketListingsPanel';
import { useState } from 'react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import SectorHeatmap, { type SectorHeatmapQuote } from '@/components/lens/SectorHeatmap';
import { cn } from '@/lib/utils';

type MarketView = 'listings' | 'analysis' | 'heatmaps' | 'competitors' | 'intel';

const TABS: { id: MarketView; label: string }[] = [
  { id: 'listings', label: 'Listings' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'heatmaps', label: 'Heatmaps' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'intel', label: 'Intel' },
];

export default function MarketLensPage() {
  useLensNav('market');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('market');
  const [active, setActive] = useState<MarketView>('listings');

  useLensCommand(
    [
      { id: 'tab-listings', keys: 'l', description: 'Listings', category: 'navigation', action: () => setActive('listings') },
      { id: 'tab-analysis', keys: 'a', description: 'Analysis workbench', category: 'navigation', action: () => setActive('analysis') },
      { id: 'tab-heatmaps', keys: 'h', description: 'Heatmaps', category: 'navigation', action: () => setActive('heatmaps') },
      { id: 'tab-competitors', keys: 'c', description: 'Competitors', category: 'navigation', action: () => setActive('competitors') },
      { id: 'tab-intel', keys: 'i', description: 'Competitive intel', category: 'navigation', action: () => setActive('intel') },
    ],
    { lensId: 'market' },
  );

  return (
    <LensShell lensId="market" asMain={false}>
      <FirstRunTour lensId="market" />
      <DepthBadge lensId="market" size="sm" className="ml-2" />
      <div className="p-6 space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏪</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Market Lens</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className="text-sm text-gray-400">DTU marketplace, listings, and economy simulation</p>
            </div>
          </div>
          <DTUExportButton domain="market" data={{}} compact />
        </header>

        <SectorHeatmap
          quotes={(realtimeData as { quotes?: SectorHeatmapQuote[] } | null)?.quotes}
          isLive={isLive}
          lastUpdated={lastUpdated}
        />
        <RealtimeDataPanel domain="market" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        <nav aria-label="Market views" className="flex gap-1 overflow-x-auto border-b border-lattice-border pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition',
                active === t.id
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
                  : 'text-gray-400 hover:text-violet-300 border border-transparent',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {active === 'listings' && <MarketListingsPanel />}
        {active === 'analysis' && <MarketAnalysisWorkbench />}
        {active === 'heatmaps' && (
          <div className="space-y-4">
            <MarketHeatmap />
            <Watchlist />
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <SectorHeatmapPanel />
            </section>
          </div>
        )}
        {active === 'competitors' && <CompetitorTracker />}
        {active === 'intel' && <CompetitiveIntelligence />}
      </div>
      <CrossLensRecentsPanel lensId="market" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
