'use client';

import { useEffect, useRef, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BarChart2,
  Download,
  Plus,
  GitBranch,
  LayoutDashboard,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

const TABS: { id: MarketplaceTabId; label: string; keys: string; title: string; icon: typeof Store }[] = [
  { id: 'browse', keys: 'B', title: 'What is for sale', label: 'Browse', icon: Store },
  { id: 'sell', keys: 'M', title: 'What you are selling', label: 'Sell', icon: LayoutDashboard },
  { id: 'cart', keys: 'C', title: 'What is in your cart', label: 'Cart', icon: ShoppingCart },
  { id: 'purchases', keys: 'P', title: 'What you have bought', label: 'Purchases', icon: Download },
  { id: 'watchlist', keys: 'W', title: 'What you are watching', label: 'Watchlist', icon: Star },
  { id: 'analytics', keys: 'A', title: 'How your shop is doing', label: 'Analytics', icon: BarChart2 },
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
  const current = TABS.find((t) => t.id === m.tab) ?? TABS[0];
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  return (
    <>
      <FirstRunTour lensId="marketplace" />
      <DepthBadge lensId="marketplace" size="sm" className="ml-2" />
      <div className="lens-marketplace relative min-h-full space-y-5 px-8 pb-28 pt-6" data-lens-theme="marketplace">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Marketplace</p>
            <h1 className="mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{m.tab === 'browse' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <ActivityBadge />
            <DTUExportButton domain="marketplace" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-amber-400/10 px-2.5 py-0.5 text-xs text-amber-300">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={() => m.setTab('cart')}
              aria-label="Open cart"
              title="Open cart (C)"
              className="relative rounded-full border border-white/10 bg-white/[0.03] p-2.5 text-zinc-300 transition-colors hover:border-white/25"
            >
              <ShoppingCart className="h-5 w-5" />
              {m.cart.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-teal-400 text-[10px] font-bold text-black">
                  {m.cart.length}
                </span>
              )}
            </button>
          </div>
        </header>

        <FeedBanner domain="marketplace" />

        <nav className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Marketplace views">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => m.setTab(t.id)}
              aria-current={m.tab === t.id ? 'page' : undefined}
              title={`${t.label} (${t.keys})`}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                m.tab === t.id ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200'
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.id === 'cart' && m.cart.length > 0 && (
                <span className="rounded-full bg-teal-400/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">{m.cart.length}</span>
              )}
              {t.id === 'watchlist' && m.watchlist.size > 0 && (
                <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">{m.watchlist.size}</span>
              )}
              <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
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

        <button
          type="button"
          onClick={() => { m.setTab('sell'); m.setShowNewListing(true); }}
          title="New listing (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New listing
        </button>

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
