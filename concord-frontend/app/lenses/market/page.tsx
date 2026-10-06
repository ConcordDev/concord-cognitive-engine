'use client';

/**
 * Market Lens: north-star chrome over the DTU marketplace + competitive intel.
 * Panels own listings / analysis / heatmaps; the live sector pulse stays on
 * screen above every view.
 */

import { useCallback, useState } from 'react';
import { Store, LineChart, Flame, Crosshair, Eye, Plus } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import MarketHeatmap from '@/components/market/MarketHeatmap';
import Watchlist from '@/components/market/Watchlist';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { SectorHeatmapPanel } from '@/components/market/SectorHeatmap';
import { CompetitorTracker } from '@/components/market/CompetitorTracker';
import { CompetitiveIntelligence } from '@/components/market/CompetitiveIntelligence';
import { MarketAnalysisWorkbench } from '@/components/market/MarketAnalysisWorkbench';
import { MarketListingsPanel } from '@/components/market/MarketListingsPanel';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import SectorHeatmap, { type SectorHeatmapQuote } from '@/components/lens/SectorHeatmap';

type MarketView = 'listings' | 'analysis' | 'heatmaps' | 'competitors' | 'intel';

const TABS: { id: MarketView; label: string; keys: string; title: string; hint: string; icon: typeof Store }[] = [
  { id: 'listings', label: 'Listings', keys: 'l', title: 'What is for sale', hint: 'DTU marketplace listings', icon: Store },
  { id: 'analysis', label: 'Analysis', keys: 'a', title: 'Read the market', hint: 'Analysis workbench', icon: LineChart },
  { id: 'heatmaps', label: 'Heatmaps', keys: 'h', title: 'Where the heat is', hint: 'Market heatmap, watchlist and sectors', icon: Flame },
  { id: 'competitors', label: 'Competitors', keys: 'c', title: 'Who you are up against', hint: 'Competitor tracker', icon: Crosshair },
  { id: 'intel', label: 'Intel', keys: 'i', title: 'What the field is doing', hint: 'Competitive intelligence', icon: Eye },
];

export default function MarketLensPage() {
  useLensNav('market');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('market');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<MarketView>('listings');

  const newListing = useCallback(() => {
    setActive('listings');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="market"] input:not([type="file"]), [data-lens-theme="market"] textarea');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.keys,
        description: `${t.label} — ${t.hint}`,
        category: 'navigation' as const,
        action: () => setActive(t.id),
      })),
      { id: 'market-new-listing', keys: 'n', description: 'New listing', category: 'actions' as const, action: newListing },
    ],
    { lensId: 'market' },
  );

  const current = TABS.find((t) => t.id === active)!;

  return (
    <LensShell lensId="market" asMain={false}>
      <FirstRunTour lensId="market" />
      <DepthBadge lensId="market" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="market"
        crumb="Market"
        title={`${current.title}${active === 'listings' && who ? `, ${who}` : ''}`}
        subtitle="DTU marketplace, listings, economy simulation and competitive intel."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="market" data={{}} compact />
          </>
        }
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, keys: t.keys, hint: t.hint, icon: t.icon }))}
        activeTab={active}
        onTab={(id) => setActive(id as MarketView)}
        cta={{ label: 'New listing', icon: Plus, onClick: newListing, title: 'New listing (N)' }}
      >
        <div className="mb-6 space-y-4">
          <SectorHeatmap
            quotes={(realtimeData as { quotes?: SectorHeatmapQuote[] } | null)?.quotes}
            isLive={isLive}
            lastUpdated={lastUpdated}
          />
          <RealtimeDataPanel domain="market" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        </div>

        {active === 'listings' && <MarketListingsPanel />}
        {active === 'analysis' && <MarketAnalysisWorkbench />}
        {active === 'heatmaps' && (
          <div className="space-y-5">
            <MarketHeatmap />
            <Watchlist />
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <SectorHeatmapPanel />
            </section>
          </div>
        )}
        {active === 'competitors' && <CompetitorTracker />}
        {active === 'intel' && <CompetitiveIntelligence />}
      </NorthStarFrame>
    </LensShell>
  );
}
