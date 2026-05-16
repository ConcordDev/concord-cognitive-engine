'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Palette, Info } from 'lucide-react';
import { ArtistryFeed } from '@/components/artistry/ArtistryFeed';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type {
  ArtistryPost, FeedMode, FeedFilter,
} from '@/lib/artistry/types';

// ============================================================================
// Seed Data — empty; all posts come from the backend API
// ============================================================================

// ============================================================================
// Artistry Page
// ============================================================================

export default function ArtistryPage() {
  const [feedMode, setFeedMode] = useState<FeedMode>('chronological');
  const [filters, setFilters] = useState<FeedFilter>({
    contentTypes: [],
    lenses: [],
    tags: [],
    timeRange: 'all',
  });
  const { items: postItems } = useLensData<ArtistryPost>('artistry', 'post', {
    seed: [],
  });
  const posts: ArtistryPost[] = postItems.map(i => ({ ...(i.data as unknown as ArtistryPost), id: i.id }));

  // ---- Filtering ----
  const filteredPosts = useMemo(() => {
    let result = posts;

    if (filters.contentTypes.length > 0) {
      result = result.filter(p => filters.contentTypes.includes(p.contentType));
    }
    if (filters.lenses.length > 0) {
      result = result.filter(p => filters.lenses.includes(p.sourceLens));
    }
    if (filters.tags.length > 0) {
      result = result.filter(p => p.tags.some(t => filters.tags.includes(t)));
    }
    if (filters.timeRange !== 'all') {
      const now = Date.now();
      const cutoffs: Record<string, number> = {
        today: 86400000,
        week: 604800000,
        month: 2592000000,
      };
      const cutoff = cutoffs[filters.timeRange] || 0;
      result = result.filter(p => now - new Date(p.createdAt).getTime() < cutoff);
    }

    // Sort: chronological (newest first) by default
    if (feedMode === 'chronological') {
      result = [...result].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    // Discovery mode would apply recommendations — for now, just shuffle slightly
    if (feedMode === 'discovery') {
      result = [...result].sort(() => Math.random() - 0.5);
    }

    return result;
  }, [posts, filters, feedMode]);

  const handleViewInLens = useCallback((post: ArtistryPost) => {
    // Navigate to the source lens where the full artifact lives
    window.location.href = `/lenses/${post.sourceLens}?artifact=${post.sourceArtifactId}`;
  }, []);

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-pink/20 to-neon-purple/20 flex items-center justify-center">
                <Palette className="w-5 h-5 text-neon-pink" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Concord Artistry</h1>
                <p className="text-xs text-gray-500">Cross-domain creative discovery</p>
              </div>
            </div>
          </div>

          {/* Commitment banner */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-gray-400">
            <Info className="w-4 h-4 text-neon-cyan flex-shrink-0 mt-0.5" />
            <div>
              <p><strong className="text-gray-300">Free advertising for creators.</strong> No cost to post, no cost to browse. No ads. No promoted posts. No pay-for-visibility. Ever.</p>
              <p className="mt-1 text-gray-500">Every piece of content links back to its source lens. No citations, no downloads from Artistry — this is a funnel, not a destination.</p>
            </div>
          </div>
        </motion.div>

        {/* Feed */}
        <ArtistryFeed
          posts={filteredPosts}
          loading={false}
          hasMore={false}
          feedMode={feedMode}
          filters={filters}
          onFilterChange={setFilters}
          onFeedModeChange={setFeedMode}
          onLoadMore={() => {}}
          onViewInLens={handleViewInLens}
        />
      </div>
    </div>
  );
}
