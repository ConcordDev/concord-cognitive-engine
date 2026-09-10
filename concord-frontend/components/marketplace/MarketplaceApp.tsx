'use client';

import { useEffect, useRef, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BarChart2,
  Download,
  GitBranch,
  LayoutDashboard,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
  X,
} from 'lucide-react';
import {
  BarChart3 as MobileTabAnal,
  Heart as MobileTabHeart,
  Package as MobileTabPkg,
  ShoppingBag as MobileTabBag,
  ShoppingCart as MobileTabCart,
  Store as MobileTabStore,
} from 'lucide-react';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { FeedBanner } from '@/components/lens/FeedBanner';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { ArtifactDetailModal } from '@/components/market/ArtifactDetailModal';
import { ActivityBadge } from '@/components/platform/ActivityBadge';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import RoyaltyCascadeViz from '@/components/visualizations/RoyaltyCascadeViz';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { AudioPreviewBar } from './ItemCard';
import { BrowsePanel } from './BrowsePanel';
import { SellPanel } from './SellPanel';
import { CartPanel } from './CartPanel';
import { PurchasesPanel } from './PurchasesPanel';
import { WatchlistPanel } from './WatchlistPanel';
import { AnalyticsPanel } from './AnalyticsPanel';
import { useMarketplace } from './MarketplaceProvider';
import type { CreatorInfo, MarketplaceItem, MarketplaceTabId } from './types';

const TABS: { id: MarketplaceTabId; label: string; icon: typeof Store }[] = [
  { id: 'browse', label: 'Browse', icon: Store },
  { id: 'sell', label: 'Sell', icon: LayoutDashboard },
  { id: 'cart', label: 'Cart', icon: ShoppingCart },
  { id: 'purchases', label: 'Purchases', icon: Download },
  { id: 'watchlist', label: 'Watchlist', icon: Star },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
];

const PANELS: Record<MarketplaceTabId, ComponentType> = {
  browse: BrowsePanel,
  sell: SellPanel,
  cart: CartPanel,
  purchases: PurchasesPanel,
  watchlist: WatchlistPanel,
  analytics: AnalyticsPanel,
};

export function MarketplaceApp() {
  const m = useMarketplace();
  const reduceMotion = useReducedMotion();
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    isLive,
    lastUpdated,
  } = useRealtimeLens('marketplace');

  useLensCommand(
    [
      { id: 'goto-browse', keys: 'b', description: 'Browse', category: 'navigation', action: () => m.setTab('browse') },
      { id: 'goto-myshop', keys: 'm', description: 'Sell', category: 'navigation', action: () => m.setTab('sell') },
      { id: 'goto-cart', keys: 'c', description: 'Cart', category: 'navigation', action: () => m.setTab('cart') },
      { id: 'goto-purchases', keys: 'p', description: 'Purchases', category: 'navigation', action: () => m.setTab('purchases') },
      { id: 'goto-watchlist', keys: 'w', description: 'Watchlist', category: 'navigation', action: () => m.setTab('watchlist') },
      {
        id: 'view-toggle',
        keys: 'v',
        description: 'Toggle grid / list',
        category: 'view',
        action: () => m.setViewMode((v) => (v === 'grid' ? 'list' : 'grid')),
      },
      {
        id: 'new-listing',
        keys: 'n',
        description: 'New listing',
        category: 'actions',
        action: () => {
          m.setTab('sell');
          m.setShowNewListing(true);
        },
      },
      {
        id: 'palette',
        keys: 'mod+k',
        description: 'Quick search across all listings',
        category: 'navigation',
        action: () => m.setPaletteOpen(true),
        global: true,
      },
    ],
    { lensId: 'marketplace' }
  );

  const Active = PANELS[m.tab];

  return (
    <>
      <FirstRunTour lensId="marketplace" />
      <DepthBadge lensId="marketplace" size="sm" className="ml-2" />
      <div className={cn('lens-marketplace space-y-6 pb-24', ds.pageContainer)} data-lens-theme="marketplace">
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Store className="w-6 h-6 text-amber-400" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                  Creative Marketplace
                </h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ActivityBadge />
            <DTUExportButton domain="marketplace" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={() => m.setTab('sell')}
              className="btn-neon flex items-center gap-2 text-sm"
            >
              <LayoutDashboard className="w-4 h-4" /> Seller Dashboard
            </button>
            <button
              onClick={() => m.setTab('cart')}
              className="relative p-2 rounded-lg bg-lattice-surface border border-lattice-border hover:border-neon-purple/50 transition-colors"
            >
              <ShoppingCart className="w-5 h-5" />
              {m.cart.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neon-pink text-white text-[10px] font-bold flex items-center justify-center">
                  {m.cart.length}
                </span>
              )}
            </button>
          </div>
        </header>

        <FeedBanner domain="marketplace" />

        <nav className="flex items-center gap-1 bg-lattice-surface/50 p-1 rounded-lg w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => m.setTab(t.id)}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors',
                m.tab === t.id
                  ? 'bg-neon-purple/20 text-neon-purple'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
              {t.id === 'cart' && m.cart.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-neon-pink/20 text-neon-pink text-[10px] font-bold">
                  {m.cart.length}
                </span>
              )}
              {t.id === 'watchlist' && m.watchlist.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-neon-yellow/20 text-neon-yellow text-[10px] font-bold">
                  {m.watchlist.size}
                </span>
              )}
            </button>
          ))}
        </nav>

        <motion.div
          key={m.tab}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
        >
          <Active />
        </motion.div>

        <AnimatePresence>
          {m.previewItem && (
            <AudioPreviewBar
              item={m.previewItem}
              playing={m.isPlaying}
              onToggle={() => m.setIsPlaying((p) => !p)}
              onClose={m.closePreview}
            />
          )}
        </AnimatePresence>

        {m.selectedArtifactId && (
          <ArtifactDetailModal
            artifactId={m.selectedArtifactId}
            onClose={() => m.setSelectedArtifactId(null)}
          />
        )}

        <AnimatePresence>
          {m.royaltyVizDtuId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center p-4"
              onClick={() => m.setRoyaltyVizDtuId(null)}
            >
              <motion.div
                initial={{ y: 80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 80, opacity: 0 }}
                className="bg-lattice-surface border border-neon-cyan/20 rounded-xl w-full max-w-2xl p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-neon-cyan" /> Royalty Cascade
                  </h3>
                  <button
                    onClick={() => m.setRoyaltyVizDtuId(null)}
                    className="text-gray-400 hover:text-white"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <RoyaltyCascadeViz />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {m.paletteOpen && <MarketplacePalette />}

      <LensAgentFab
        lensId="marketplace"
        lensPrompt="You're inside Concord's Marketplace lens — DTU listings, royalty cascade, beat/sample marketplace. Prefer expert_mode for cited research on trends, discovery.search for listings, run_lens_action for purchases."
      />
      {m.deferredReady && (
        <>
          <SessionRail lensId="marketplace" hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="marketplace" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
        </>
      )}
      <MobileTabBar
        tabs={[
          { id: 'browse', label: 'Browse', icon: MobileTabBag },
          { id: 'sell', label: 'Sell', icon: MobileTabStore },
          { id: 'cart', label: 'Cart', icon: MobileTabCart },
          { id: 'purchases', label: 'Orders', icon: MobileTabPkg },
          { id: 'watchlist', label: 'Watch', icon: MobileTabHeart },
          { id: 'analytics', label: 'Stats', icon: MobileTabAnal },
        ]}
        active={m.tab}
        onSelect={(id) => m.setTab(id as MarketplaceTabId)}
      />
    </>
  );
}

function MarketplacePalette() {
  const m = useMarketplace();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const q = m.paletteQuery.trim().toLowerCase();
  const creatorName = (c: CreatorInfo | string | undefined): string => {
    if (!c) return '';
    if (typeof c === 'string') return c;
    return c.name || '';
  };
  const hits = (
    q
      ? m.allItems.filter(
          (i) =>
            (i.title || '').toLowerCase().includes(q) ||
            creatorName(i.creator).toLowerCase().includes(q) ||
            (i.tags || []).some((t) => String(t).toLowerCase().includes(q))
        )
      : m.allItems
  ).slice(0, 50);

  const lowestPrice = (it: MarketplaceItem): number | null => {
    const p = it.prices as unknown as Record<string, number> | undefined;
    if (!p) return null;
    const nums = Object.values(p).filter((v) => typeof v === 'number') as number[];
    return nums.length ? Math.min(...nums) : null;
  };

  const choose = (it: MarketplaceItem) => {
    m.setSelectedArtifactId(String(it.id));
    m.setPaletteOpen(false);
    m.setPaletteQuery('');
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-[100] pt-[14vh]"
      onClick={() => m.setPaletteOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Quick search marketplace"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }}
    >
      <div
        className="bg-lattice-deep border border-emerald-500/40 rounded-xl w-full max-w-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).click();
          }
        }}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <ShoppingBag className="w-4 h-4 text-emerald-400" />
          <input
            ref={inputRef}
            value={m.paletteQuery}
            onChange={(e) => m.setPaletteQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                m.setPaletteOpen(false);
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                m.setPaletteIdx((i) => Math.min(i + 1, hits.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                m.setPaletteIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && hits[m.paletteIdx]) {
                e.preventDefault();
                choose(hits[m.paletteIdx]);
              }
            }}
            placeholder="Search by title, creator, or tag…"
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30"
          />
          <kbd className="text-[10px] text-white/40 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 font-mono">
            esc
          </kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {hits.length === 0 ? (
            <li className="px-4 py-3 text-xs text-white/40 italic">No matches.</li>
          ) : (
            hits.map((it, i) => (
              <li
                key={String(it.id)}
                onMouseEnter={() => m.setPaletteIdx(i)}
                onClick={() => choose(it)}
                className={`px-4 py-2 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  i === m.paletteIdx
                    ? 'bg-emerald-500/10 border-l-2 border-emerald-400'
                    : 'border-l-2 border-transparent hover:bg-white/5'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{it.title || String(it.id)}</div>
                  <div className="text-[11px] text-white/40 truncate">
                    {(() => {
                      const cn2 = creatorName(it.creator);
                      return cn2 ? `by ${cn2}` : '';
                    })()}
                    {creatorName(it.creator) && it.type ? ' · ' : ''}
                    {it.type ?? ''}
                  </div>
                </div>
                {(() => {
                  const lp = lowestPrice(it);
                  return lp != null ? (
                    <span className="text-xs text-emerald-300 font-mono tabular-nums shrink-0">
                      {lp} CC
                    </span>
                  ) : null;
                })()}
              </li>
            ))
          )}
        </ul>
        <div className="px-4 py-2 border-t border-white/10 text-[10px] text-white/40 flex items-center justify-between">
          <span>↑↓ navigate · ↵ open · ⌘N new listing</span>
          <span>
            {hits.length} {hits.length === 1 ? 'result' : 'results'}
          </span>
        </div>
      </div>
    </div>
  );
}
