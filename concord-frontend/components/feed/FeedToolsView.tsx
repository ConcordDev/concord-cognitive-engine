'use client';

import { FeedToolsPanel } from '@/components/feed/FeedToolsPanel';
import { useFeedPosts } from '@/components/feed/useFeedPosts';

/** Ranked For You / threads / lists / polls / saved / spaces / controls. */
export function FeedToolsView() {
  const { candidates } = useFeedPosts('for-you');
  return (
    <div className="flex-1 min-w-0 max-w-3xl p-4">
      <FeedToolsPanel candidates={candidates} />
    </div>
  );
}
