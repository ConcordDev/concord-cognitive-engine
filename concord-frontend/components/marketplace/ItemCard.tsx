'use client';

import { motion } from 'framer-motion';
import { Check, GitBranch, Pause, Play, ShoppingCart, Star, X } from 'lucide-react';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';
import { cn } from '@/lib/utils';
import {
  formatPrice,
  hasPreview,
  typeBadgeColor,
  typeIcon,
  type MarketplaceItem,
  type ViewMode,
} from './types';

export function starRating(rating: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <Star
      key={i}
      className={cn(
        'w-3 h-3',
        i < Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'
      )}
    />
  ));
}

export function WaveformBars({ playing, small }: { playing?: boolean; small?: boolean }) {
  const barCount = small ? 20 : 40;
  return (
    <div className={cn('flex items-end gap-px', small ? 'h-6' : 'h-10')}>
      {Array.from({ length: barCount }, (_, i) => {
        const h = 20 + Math.sin(i * 0.7) * 30 + Math.cos(i * 1.3) * 25;
        return (
          <motion.div
            key={i}
            className={cn('rounded-sm', playing ? 'bg-neon-purple' : 'bg-gray-600')}
            style={{ width: small ? 2 : 3, height: `${h}%` }}
            animate={playing ? { height: [`${h}%`, `${h + 15}%`, `${h}%`] } : {}}
            transition={
              playing
                ? { duration: 0.4 + ((i * 7) % 10) / 33, repeat: Infinity, repeatType: 'mirror' }
                : {}
            }
          />
        );
      })}
    </div>
  );
}

export function ItemCard({
  item,
  onPlay,
  isPlaying,
  onAddToCart,
  viewMode,
  onSelect,
  onRoyaltyClick,
  isStarred,
  onToggleStar,
}: {
  item: MarketplaceItem;
  onPlay: (item: MarketplaceItem) => void;
  isPlaying: boolean;
  onAddToCart: (item: MarketplaceItem) => void;
  viewMode: ViewMode;
  onSelect?: (item: MarketplaceItem) => void;
  onRoyaltyClick?: (itemId: string) => void;
  isStarred?: boolean;
  onToggleStar?: (id: string) => void;
}) {
  const Icon = typeIcon(item.type);
  const audio = hasPreview(item.type);

  if (viewMode === 'list') {
    return (
      <motion.div
        layout
        onClick={() => onSelect?.(item)}
        className="panel p-4 flex items-center gap-4 hover:border-neon-purple/40 transition-colors cursor-pointer"
      >
        <div className="relative w-14 h-14 rounded-lg bg-lattice-deep flex items-center justify-center shrink-0 overflow-hidden">
          {audio ? (
            <WaveformBars playing={isPlaying} small />
          ) : (
            <Icon className="w-6 h-6 text-gray-400" />
          )}
          {audio && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(item);
              }}
              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" />
              ) : (
                <Play className="w-5 h-5 text-white" />
              )}
            </button>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{item.title}</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                typeBadgeColor(item.type)
              )}
            >
              {item.type}
            </span>
          </div>
          <div className="text-sm text-gray-400 flex items-center gap-2">
            <span>{item.creator.name}</span>
            {item.creator.verified && <Check className="w-3 h-3 text-neon-cyan" />}
            {item.genre && (
              <>
                <span className="text-gray-600">|</span>
                <span>{item.genre}</span>
              </>
            )}
            {item.version && (
              <>
                <span className="text-gray-600">|</span>
                <span>v{item.version}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {starRating(item.rating)}
          <span className="text-xs text-gray-400 ml-1 tabular-nums">{item.rating}</span>
        </div>
        <span className="text-neon-green font-bold tabular-nums">{formatPrice(item.prices.basic)}</span>
        {onToggleStar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(item.id);
            }}
            aria-label={isStarred ? 'Remove from watchlist' : 'Add to watchlist'}
            title={isStarred ? 'In watchlist' : 'Save to watchlist'}
            className={cn(
              'p-1.5 rounded transition-colors',
              isStarred ? 'text-neon-yellow' : 'text-gray-400 hover:text-neon-yellow'
            )}
          >
            <Star className={cn('w-3.5 h-3.5', isStarred && 'fill-current')} />
          </button>
        )}
        <PullToSubstrate domain="marketplace" artifactId={item.id} compact />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToCart(item);
          }}
          className="btn-neon small flex items-center gap-1"
          aria-label="Cart"
        >
          <ShoppingCart className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      onClick={() => onSelect?.(item)}
      className="panel p-0 overflow-hidden hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5 transition-all duration-200 cursor-pointer group"
    >
      <div className="relative h-36 bg-lattice-deep flex items-center justify-center">
        {audio ? (
          <div className="px-4 w-full">
            <WaveformBars playing={isPlaying} />
          </div>
        ) : (
          <Icon className="w-12 h-12 text-gray-600" />
        )}
        {audio && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay(item);
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {isPlaying ? (
              <Pause className="w-8 h-8 text-white" />
            ) : (
              <Play className="w-8 h-8 text-white" />
            )}
          </button>
        )}
        <span
          className={cn(
            'absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full font-medium',
            typeBadgeColor(item.type)
          )}
        >
          {item.type}
        </span>
        {item.featured && (
          <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-neon-green/20 text-neon-green font-medium">
            Featured
          </span>
        )}
        {onToggleStar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(item.id);
            }}
            aria-label={isStarred ? 'Remove from watchlist' : 'Add to watchlist'}
            title={isStarred ? 'In watchlist' : 'Save to watchlist'}
            className={cn(
              'absolute bottom-2 right-2 p-1.5 rounded-full backdrop-blur-sm transition-colors',
              isStarred
                ? 'bg-neon-yellow/30 text-neon-yellow'
                : 'bg-black/40 text-gray-400 hover:text-neon-yellow hover:bg-neon-yellow/15'
            )}
          >
            <Star className={cn('w-3.5 h-3.5', isStarred && 'fill-current')} />
          </button>
        )}
      </div>
      <div className="p-3 space-y-2">
        <p className="font-semibold text-sm truncate">{item.title}</p>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <div className="w-4 h-4 rounded-full bg-lattice-elevated flex items-center justify-center text-[9px] font-bold">
            {item.creator.name[0]}
          </div>
          <span className="truncate">{item.creator.name}</span>
          {item.creator.verified && <Check className="w-3 h-3 text-amber-400 shrink-0" />}
        </div>
        <div className="flex items-center gap-1">
          {starRating(item.rating)}
          <span className="text-[10px] text-gray-400 ml-1 tabular-nums">({item.ratingCount})</span>
        </div>
        {(item.version || item.key || item.genre) && (
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            {item.genre && <span>{item.genre}</span>}
            {item.version && <span>v{item.version}</span>}
            {item.key && <span>{item.key}</span>}
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400 font-bold text-sm tabular-nums">
              From {formatPrice(item.prices.basic)}
            </span>
            {item.sales > 0 && onRoyaltyClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRoyaltyClick(item.id);
                }}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-neon-cyan/10 border border-neon-cyan/20 text-[10px] text-neon-cyan hover:bg-neon-cyan/20 transition-colors tabular-nums"
                title="View royalty cascade"
              >
                <GitBranch className="w-2.5 h-2.5" />
                {item.sales}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <PullToSubstrate domain="marketplace" artifactId={item.id} compact />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddToCart(item);
              }}
              className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30 hover:from-amber-500/30 hover:to-orange-500/30 transition-all text-xs font-medium flex items-center gap-1"
            >
              <ShoppingCart className="w-3 h-3" /> Buy
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function AudioPreviewBar({
  item,
  playing,
  onToggle,
  onClose,
}: {
  item: MarketplaceItem | null;
  playing: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  if (!item) return null;
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      className="fixed bottom-0 left-0 right-0 z-50 bg-lattice-deep/95 backdrop-blur-lg border-t border-lattice-border px-6 py-3"
    >
      <div className="max-w-5xl mx-auto flex items-center gap-4">
        <button
          onClick={onToggle}
          className="p-2 rounded-full bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 transition-colors"
        >
          {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold truncate">{item.title}</span>
            <span className="text-xs text-gray-400">by {item.creator.name}</span>
          </div>
          <WaveformBars playing={playing} small />
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}
