'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  List,
  Play,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { MarketplaceTab } from '@/components/lens/MarketplaceTab';
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { ProvenanceBadge } from '@/components/dtu/ProvenanceBadge';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { TrendingListings } from '@/components/marketplace/TrendingListings';
import SocialProofFeed from '@/components/world-lens/SocialProofFeed';
import { TrendingDomains } from '@/components/social/TrendingDomains';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useEvent } from '@/lib/realtime/event-bus';
import type { DTU } from '@/lib/api/generated-types';
import { cn } from '@/lib/utils';
import { ItemCard, WaveformBars, starRating } from './ItemCard';
import { useMarketplace } from './MarketplaceProvider';
import {
  CATEGORIES,
  GENRE_OPTIONS,
  SORT_OPTIONS,
  formatPrice,
  hasPreview,
  typeBadgeColor,
  typeIcon,
  type SortOption,
} from './types';

export function BrowsePanel() {
  const m = useMarketplace();
  const {
    contextDTUs: marketDTUs,
    hyperDTUs,
    megaDTUs,
    regularDTUs,
    tierDistribution,
    publishToMarketplace: publishDTU,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'marketplace' });
  const {
    latestData: realtimeData,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('marketplace');

  const [recentTrades, setRecentTrades] = useState<
    Array<{ dtuId: string; title?: string; price: number; ts: string }>
  >([]);
  const [recentListings, setRecentListings] = useState<
    Array<{ dtuId: string; title?: string; ts: string }>
  >([]);
  useEvent<{ dtuId: string; price?: number; title?: string }>('marketplace:purchase', (data) => {
    setRecentTrades((prev) => [
      {
        dtuId: data.dtuId,
        title: data.title,
        price: data.price || 0,
        ts: new Date().toISOString(),
      },
      ...prev.slice(0, 19),
    ]);
  });
  useEvent<{ dtuId: string; title?: string }>('market:listing', (data) => {
    setRecentListings((prev) => [
      { dtuId: data.dtuId, title: data.title, ts: new Date().toISOString() },
      ...prev.slice(0, 9),
    ]);
  });

  const marketArtifacts = marketDTUs.filter((d: DTU) => d.artifact);
  const showGridSkeleton = m.isBrowseLoading && m.allItems.length === 0;
  const featured = m.featuredItems[m.featuredIdx];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex gap-6 items-start"
    >
      <div className="flex-1 min-w-0 space-y-6">
        {featured && (
          <div className="relative panel p-0 overflow-hidden rounded-xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={m.featuredIdx}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.35 }}
                className="p-6 bg-gradient-to-br from-neon-purple/10 via-transparent to-neon-cyan/5 flex items-center gap-6"
              >
                <div className="w-32 h-32 rounded-xl bg-lattice-deep flex items-center justify-center shrink-0">
                  {hasPreview(featured.type) ? (
                    <WaveformBars />
                  ) : (
                    (() => {
                      const I = typeIcon(featured.type);
                      return <I className="w-12 h-12 text-gray-400" />;
                    })()
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <span
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full font-medium',
                      typeBadgeColor(featured.type)
                    )}
                  >
                    {featured.type} -- Featured
                  </span>
                  <h2 className="text-xl font-bold truncate">{featured.title}</h2>
                  <p className="text-sm text-gray-400 line-clamp-2">{featured.description}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-neon-green font-bold tabular-nums">
                      From {formatPrice(featured.prices.basic)}
                    </span>
                    <div className="flex items-center gap-1">{starRating(featured.rating)}</div>
                    <span className="text-xs text-gray-400 tabular-nums">{featured.sales} sales</span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    {hasPreview(featured.type) && (
                      <button
                        onClick={() => m.handlePlay(featured)}
                        className="btn-neon purple flex items-center gap-1 text-sm"
                      >
                        <Play className="w-4 h-4" /> Preview
                      </button>
                    )}
                    <button
                      onClick={() => m.addToCart(featured)}
                      className="btn-neon flex items-center gap-1 text-sm"
                    >
                      <ShoppingCart className="w-4 h-4" /> Add to Cart
                    </button>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
            {m.featuredItems.length > 1 && (
              <>
                <button
                  onClick={() =>
                    m.setFeaturedIdx(
                      (i) => (i - 1 + m.featuredItems.length) % m.featuredItems.length
                    )
                  }
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  aria-label="Previous"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => m.setFeaturedIdx((i) => (i + 1) % m.featuredItems.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  aria-label="Next"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                  {m.featuredItems.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => m.setFeaturedIdx(i)}
                      className={cn(
                        'w-2 h-2 rounded-full transition-colors',
                        i === m.featuredIdx ? 'bg-neon-purple' : 'bg-gray-600'
                      )}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => m.setCategory(c.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1.5 transition-colors border',
                m.category === c.id
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  : 'bg-lattice-surface border-lattice-border text-gray-400 hover:text-white hover:border-amber-500/30'
              )}
            >
              <c.icon className="w-3.5 h-3.5" /> {c.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={m.search}
              onChange={(e) => m.setSearch(e.target.value)}
              placeholder="Search templates, datasets, artwork..."
              className="w-full pl-10 pr-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg focus:border-neon-purple outline-none text-sm"
            />
          </div>
          <select
            value={m.genreFilter}
            onChange={(e) => m.setGenreFilter(e.target.value)}
            className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
          >
            {GENRE_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={m.sortBy}
            onChange={(e) => m.setSortBy(e.target.value as SortOption)}
            className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="flex items-center bg-lattice-surface border border-lattice-border rounded-lg">
            <button
              onClick={() => m.setViewMode('grid')}
              className={cn(
                'p-2 rounded-l-lg transition-colors',
                m.viewMode === 'grid' ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white'
              )}
              aria-label="Grid3 x3"
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => m.setViewMode('list')}
              className={cn(
                'p-2 rounded-r-lg transition-colors',
                m.viewMode === 'list' ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white'
              )}
              aria-label="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-400">
          {showGridSkeleton
            ? 'Loading listings...'
            : `${m.filteredItems.length} item${m.filteredItems.length !== 1 ? 's' : ''} found`}
        </p>

        {m.browseHasError ? (
          <ErrorState error={m.browseErrorMessage} onRetry={m.refetchBrowse} />
        ) : (
          <div
            className={cn(
              m.viewMode === 'grid'
                ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
                : 'space-y-2'
            )}
          >
            {showGridSkeleton ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="panel p-0 overflow-hidden">
                  <Skeleton variant="block" height={144} className="rounded-none" />
                  <div className="p-3 space-y-2">
                    <Skeleton variant="line" width="80%" />
                    <Skeleton variant="line" width="50%" height={11} />
                    <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
                      <Skeleton variant="line" width={60} height={14} />
                      <Skeleton variant="block" width={54} height={22} className="rounded-lg" />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <AnimatePresence>
                {m.filteredItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    viewMode={m.viewMode}
                    isPlaying={m.previewItem?.id === item.id && m.isPlaying}
                    onPlay={m.handlePlay}
                    onAddToCart={m.addToCart}
                    onSelect={(i) => m.setSelectedArtifactId(i.id)}
                    onRoyaltyClick={(id) => m.setRoyaltyVizDtuId(id)}
                    isStarred={m.watchlist.has(item.id)}
                    onToggleStar={m.toggleWatchlist}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>
        )}
        {!showGridSkeleton && !m.browseHasError && m.filteredItems.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="mb-1 font-medium text-gray-400">No items match your filters</p>
            <p className="text-sm mb-5 text-gray-600">
              Try broader filters or be the first to list something
            </p>
            <button
              onClick={() => m.setSearch('')}
              className="px-5 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30 transition-colors"
            >
              Clear search
            </button>
          </div>
        )}

        <MarketplaceTab domain="marketplace" className="mt-6" />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6">
          {marketArtifacts.length > 0 && (
            <div className="lg:col-span-3 space-y-3">
              <h3 className="text-lg font-bold">DTU Artifacts</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {marketArtifacts.slice(0, 6).map((dtu: DTU) => (
                  <div
                    key={dtu.id}
                    className="p-3 rounded-lg bg-lattice-surface border border-lattice-border space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate flex-1">
                        {dtu.title || dtu.human?.summary || 'Untitled'}
                      </p>
                      <ProvenanceBadge
                        source={dtu.source}
                        model={dtu.meta?.model as string}
                        authority={dtu.meta?.authority as string}
                      />
                    </div>
                    <ArtifactRenderer dtuId={dtu.id} artifact={dtu.artifact!} mode="thumbnail" />
                    <FeedbackWidget targetType="dtu" targetId={dtu.id} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={marketArtifacts.length > 0 ? '' : 'lg:col-start-4'}>
            <ArtifactUploader
              lens="marketplace"
              acceptTypes="audio/*,image/*"
              multi
              compact
              onUploadComplete={() => refetchDTUs()}
            />
            <div className="mt-4">
              <LensContextPanel
                hyperDTUs={hyperDTUs}
                megaDTUs={megaDTUs}
                regularDTUs={regularDTUs}
                tierDistribution={tierDistribution}
                onPublish={(dtu) => publishDTU({ dtuId: dtu.id })}
                title="Marketplace DTUs"
              />
            </div>
            <div className="mt-4">
              <FeedbackWidget targetType="lens" targetId="marketplace" />
            </div>
          </div>
          {realtimeData && (
            <RealtimeDataPanel
              domain="marketplace"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          )}
          {m.deferredReady && (
            <div className="lg:col-span-4 rounded-xl border border-lattice-border bg-lattice-void/40 p-4">
              <TrendingListings />
            </div>
          )}
        </div>
      </div>

      <div className="w-72 shrink-0 space-y-4 sticky top-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
            <Activity className="w-3.5 h-3.5 text-neon-green" /> Recent Activity
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {recentTrades.map((t, i) => (
              <motion.div
                key={`trade-${i}`}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xs text-gray-400 flex items-start gap-1.5"
              >
                <span className="text-neon-green shrink-0">sold</span>
                <span className="truncate">{t.title || t.dtuId}</span>
                {t.price > 0 && <span className="text-neon-green shrink-0">${t.price}</span>}
              </motion.div>
            ))}
            {recentListings.map((l, i) => (
              <motion.div
                key={`listing-${i}`}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xs text-gray-400 flex items-start gap-1.5"
              >
                <span className="text-amber-400 shrink-0">listed</span>
                <span className="truncate">{l.title || l.dtuId}</span>
              </motion.div>
            ))}
            {recentTrades.length === 0 && recentListings.length === 0 && (
              <p className="text-xs text-gray-400 italic">Waiting for activity...</p>
            )}
          </div>
        </div>
        {m.deferredReady && (
          <>
            <SocialProofFeed />
            <TrendingDomains />
          </>
        )}
      </div>
    </motion.div>
  );
}
