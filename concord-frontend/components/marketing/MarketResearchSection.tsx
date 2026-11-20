'use client';

/**
 * Market research — the competitive-intel and market-analysis surfaces that
 * used to share the Market lens with the DTU marketplace. They moved here
 * (owner decision, 2026-11-19) when Market became the Auction House: they
 * are marketing work. Each panel is unchanged and still runs the `market`
 * domain's own macros (trend/elasticity/sizing, sector quotes, competitor
 * tracker, battlecards, win/loss, page watch).
 */

import { useState } from 'react';
import { LineChart, Flame, Crosshair, Eye, Telescope } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useLensCommand } from '@/hooks/useLensCommand';
import MarketHeatmap from '@/components/market/MarketHeatmap';
import Watchlist from '@/components/market/Watchlist';
import { SectorHeatmapPanel } from '@/components/market/SectorHeatmap';
import { CompetitorTracker } from '@/components/market/CompetitorTracker';
import { CompetitiveIntelligence } from '@/components/market/CompetitiveIntelligence';
import { MarketAnalysisWorkbench } from '@/components/market/MarketAnalysisWorkbench';
import SectorHeatmap, { type SectorHeatmapQuote } from '@/components/lens/SectorHeatmap';

type View = 'analysis' | 'sectors' | 'competitors' | 'intel';
const VIEWS: { id: View; label: string; icon: typeof LineChart; key: string }[] = [
  { id: 'competitors', label: 'Competitors', icon: Crosshair, key: 'c' },
  { id: 'intel', label: 'Intel', icon: Eye, key: 'i' },
  { id: 'analysis', label: 'Analysis', icon: LineChart, key: 'a' },
  { id: 'sectors', label: 'Sectors', icon: Flame, key: 'h' },
];

export function MarketResearchSection() {
  const [view, setView] = useState<View>('competitors');
  const { latestData, isLive, lastUpdated } = useRealtimeLens('market');
  useLensCommand(
    VIEWS.map((v) => ({ id: `research-${v.id}`, keys: v.key, description: `Market research: ${v.label}`, category: 'navigation' as const, action: () => setView(v.id) })),
    { lensId: 'marketing' },
  );
  return (
    <section id="market-research" className="scroll-mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#111]" data-testid="market-research">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-gradient-to-r from-pink-600/15 to-transparent px-4 py-3">
        <Telescope className="h-5 w-5 text-pink-400" />
        <h2 className="text-sm font-bold text-zinc-100">Market research</h2>
        <span className="text-[11px] text-zinc-400">competitors · battlecards · win/loss · page watch · sizing · sectors</span>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-2 pt-2" role="tablist" aria-label="Market research">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
              className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-pink-500',
                view === v.id ? 'border-x border-t border-zinc-800 bg-zinc-900 text-pink-300' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="h-3.5 w-3.5" /> {v.label}
            </button>
          );
        })}
      </nav>
      <div className="p-4">
        {view === 'competitors' && <CompetitorTracker />}
        {view === 'intel' && <CompetitiveIntelligence />}
        {view === 'analysis' && <MarketAnalysisWorkbench />}
        {view === 'sectors' && (
          <div className="space-y-5">
            <SectorHeatmap quotes={(latestData as { quotes?: SectorHeatmapQuote[] } | null)?.quotes} isLive={isLive} lastUpdated={lastUpdated} />
            <MarketHeatmap />
            <Watchlist />
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><SectorHeatmapPanel /></div>
          </div>
        )}
      </div>
    </section>
  );
}
