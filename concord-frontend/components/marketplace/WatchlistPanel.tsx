'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Star, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ItemCard } from './ItemCard';
import { useMarketplace } from './MarketplaceProvider';

export function WatchlistPanel() {
  const m = useMarketplace();
  const starred = m.filteredItems.filter((item) => m.watchlist.has(item.id));
  const visibleIds = new Set(starred.map((i) => i.id));
  const orphans = [...m.watchlist].filter((id) => !visibleIds.has(id));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {m.watchlist.size === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Star className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-gray-400 mb-1">Watchlist empty</p>
          <p className="text-sm text-gray-600 mb-5">
            Star any listing in Browse to save it here. Watchlist persists locally on this device.
          </p>
          <button onClick={() => m.setTab('browse')} className="btn-neon purple text-sm">
            <Store className="w-4 h-4" /> Browse listings
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">
              Your watchlist{' '}
              <span className="text-gray-400 text-sm font-normal">({m.watchlist.size})</span>
            </h3>
            <button
              onClick={() => {
                m.setWatchlist(new Set());
                m.persistWatchlist(new Set());
              }}
              className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded border border-lattice-border hover:border-red-500/30"
            >
              Clear all
            </button>
          </div>
          <div
            className={cn(
              m.viewMode === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                : 'space-y-2'
            )}
          >
            <AnimatePresence>
              {starred.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  viewMode={m.viewMode}
                  isPlaying={m.previewItem?.id === item.id && m.isPlaying}
                  onPlay={m.handlePlay}
                  onAddToCart={m.addToCart}
                  onSelect={(i) => m.setSelectedArtifactId(i.id)}
                  onRoyaltyClick={(id) => m.setRoyaltyVizDtuId(id)}
                  isStarred
                  onToggleStar={m.toggleWatchlist}
                />
              ))}
            </AnimatePresence>
          </div>
          {orphans.length > 0 && (
            <div className="mt-6 p-4 rounded-lg border border-lattice-border bg-lattice-deep/30 text-xs text-gray-400">
              <div className="text-gray-400 mb-2 font-medium">
                {orphans.length} starred item{orphans.length === 1 ? '' : 's'} not loaded in current
                view
              </div>
              <div className="font-mono text-[10px] text-gray-400 break-all">{orphans.join(', ')}</div>
              <button
                onClick={() => m.setTab('browse')}
                className="mt-2 text-[11px] text-neon-purple hover:underline"
              >
                Reset filters in Browse →
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
