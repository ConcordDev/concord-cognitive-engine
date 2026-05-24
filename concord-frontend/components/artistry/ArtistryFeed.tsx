'use client';

import { useState, useCallback } from 'react';
import {
  Music, Image, Video, FileText, Code2, Gamepad2, Box,
  Clock, Sparkles, SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArtistryPost, ArtistryContentType, FeedMode, FeedFilter } from '@/lib/artistry/types';
import { PreviewCard } from './PreviewCard';

const CONTENT_TYPE_FILTERS: { type: ArtistryContentType; label: string; icon: typeof Music }[] = [
  { type: 'audio', label: 'Audio', icon: Music },
  { type: 'image', label: 'Image', icon: Image },
  { type: 'video', label: 'Video', icon: Video },
  { type: 'text', label: 'Text', icon: FileText },
  { type: 'code', label: 'Code', icon: Code2 },
  { type: 'interactive', label: 'Interactive', icon: Gamepad2 },
  { type: '3d', label: '3D', icon: Box },
];

const LENS_FILTERS = [
  'music', 'art', 'code', 'creative', 'writing', 'game', 'video', 'design', 'research',
];

const TIME_RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  all: 'All Time',
};

interface ArtistryFeedProps {
  posts: ArtistryPost[];
  loading: boolean;
  hasMore: boolean;
  feedMode: FeedMode;
  filters: FeedFilter;
  onFilterChange: (filters: FeedFilter) => void;
  onFeedModeChange: (mode: FeedMode) => void;
  onLoadMore: () => void;
  onViewInLens: (post: ArtistryPost) => void;
}

export function ArtistryFeed({
  posts,
  loading,
  hasMore,
  feedMode,
  filters,
  onFilterChange,
  onFeedModeChange,
  onLoadMore,
  onViewInLens,
}: ArtistryFeedProps) {
  const [showFilters, setShowFilters] = useState(false);

  const toggleContentType = useCallback((type: ArtistryContentType) => {
    const current = filters.contentTypes;
    const updated = current.includes(type)
      ? current.filter(t => t !== type)
      : [...current, type];
    onFilterChange({ ...filters, contentTypes: updated });
  }, [filters, onFilterChange]);

  const toggleLens = useCallback((lens: string) => {
    const current = filters.lenses;
    const updated = current.includes(lens)
      ? current.filter(l => l !== lens)
      : [...current, lens];
    onFilterChange({ ...filters, lenses: updated });
  }, [filters, onFilterChange]);

  const activeFilterCount = filters.contentTypes.length + filters.lenses.length +
    (filters.timeRange !== 'all' ? 1 : 0) + filters.tags.length;

  return (
    <div className="space-y-4">
      {/* Feed controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Feed mode toggle */}
          <div className="flex bg-white/5 rounded-lg p-0.5">
            <button
              onClick={() => onFeedModeChange('chronological')}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded text-xs transition-colors',
                feedMode === 'chronological' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white',
              )}
            >
              <Clock className="w-3 h-3" /> New
            </button>
            <button
              onClick={() => onFeedModeChange('discovery')}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded text-xs transition-colors',
                feedMode === 'discovery' ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white',
              )}
            >
              <Sparkles className="w-3 h-3" /> Discover
            </button>
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-colors',
              showFilters || activeFilterCount > 0 ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-gray-400 hover:text-white',
            )}
          >
            <SlidersHorizontal className="w-3 h-3" />
            Filters
            {activeFilterCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-neon-cyan/20 text-[9px]">{activeFilterCount}</span>
            )}
          </button>

          {/* Clear filters */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => onFilterChange({ contentTypes: [], lenses: [], tags: [], timeRange: 'all' })}
              className="text-[10px] text-gray-400 hover:text-white"
            >
              Clear all
            </button>
          )}
        </div>

        {/* No-citation badge — architectural commitment */}
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-white/[0.03] text-[9px] text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-neon-green/50" />
          Free discovery · No citations · No downloads
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white/[0.03] rounded-xl border border-white/5 p-4 space-y-3">
          {/* Content type filters */}
          <div>
            <h4 className="text-[10px] text-gray-400 uppercase mb-2">Content Type</h4>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_TYPE_FILTERS.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => toggleContentType(type)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors border',
                    filters.contentTypes.includes(type)
                      ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20'
                      : 'text-gray-400 hover:text-white border-white/5 hover:border-white/10',
                  )}
                >
                  <Icon className="w-3 h-3" /> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Lens filters */}
          <div>
            <h4 className="text-[10px] text-gray-400 uppercase mb-2">Source Lens</h4>
            <div className="flex flex-wrap gap-1.5">
              {LENS_FILTERS.map(lens => (
                <button
                  key={lens}
                  onClick={() => toggleLens(lens)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs capitalize transition-colors border',
                    filters.lenses.includes(lens)
                      ? 'bg-neon-purple/10 text-neon-purple border-neon-purple/20'
                      : 'text-gray-400 hover:text-white border-white/5 hover:border-white/10',
                  )}
                >
                  {lens}
                </button>
              ))}
            </div>
          </div>

          {/* Time range */}
          <div>
            <h4 className="text-[10px] text-gray-400 uppercase mb-2">Time Range</h4>
            <div className="flex gap-1.5">
              {Object.entries(TIME_RANGE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => onFilterChange({ ...filters, timeRange: key as FeedFilter['timeRange'] })}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs transition-colors border',
                    filters.timeRange === key
                      ? 'bg-white/10 text-white border-white/20'
                      : 'text-gray-400 hover:text-white border-white/5',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Masonry feed grid */}
      <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
        {posts.map(post => (
          <div key={post.id} className="break-inside-avoid">
            <PreviewCard post={post} onViewInLens={onViewInLens} />
          </div>
        ))}
      </div>

      {/* Load more / empty state */}
      {loading && (
        <div className="flex justify-center py-8">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="w-4 h-4 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin" />
            Loading...
          </div>
        </div>
      )}

      {!loading && hasMore && (
        <div className="flex justify-center py-4">
          <button
            onClick={onLoadMore}
            className="px-6 py-2 rounded-lg bg-white/5 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            Load more
          </button>
        </div>
      )}

      {!loading && posts.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No creative works found</p>
          <p className="text-xs mt-1">Try adjusting your filters or check back later</p>
        </div>
      )}
    </div>
  );
}
