'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Rss } from 'lucide-react';

interface FeedBannerProps {
  domain: string;
}

/**
 * Shows active feed sources for a lens domain.
 * Displays a compact banner with feed count and source names.
 */
function FeedBanner({ domain }: FeedBannerProps) {
  const { data } = useQuery({
    queryKey: ['feed-sources'],
    queryFn: () => api.get('/api/feeds/sources').then((r) => r.data),
    staleTime: 300_000, // 5 min cache
  });

  const feeds = (data?.feeds || []).filter(
    (f: { domain?: string; active?: boolean }) =>
      f.active !== false && (f.domain === domain || domain === 'news')
  );

  if (feeds.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neon-green/5 border border-neon-green/10 text-xs text-gray-400">
      <Rss className="w-3.5 h-3.5 text-neon-green shrink-0" />
      <span className="text-neon-green font-medium">
        {feeds.length} live feed{feeds.length !== 1 ? 's' : ''}
      </span>
      <span className="text-gray-600">|</span>
      <span className="truncate">
        {feeds
          .slice(0, 3)
          .map((f: { name?: string }) => f.name || 'Feed')
          .join(', ')}
        {feeds.length > 3 && ` +${feeds.length - 3} more`}
      </span>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedFeedBanner = withErrorBoundary(FeedBanner);
export { _WrappedFeedBanner as FeedBanner };
