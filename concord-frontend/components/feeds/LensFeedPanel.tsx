'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { onEvent } from '@/lib/realtime/event-bus';
import { FeedDTUCard } from './FeedDTUCard';

interface FeedItem {
  id: string;
  title: string;
  core?: { definitions?: string[] };
  meta?: {
    sourceName?: string;
    sourceUrl?: string;
    publishedAt?: string;
    domain?: string;
    lensId?: string;
  };
  source?: { name?: string };
  tags?: string[];
  _isLive?: boolean;
}

interface LensFeedPanelProps {
  lensId: string;
  domain?: string;
  limit?: number;
  className?: string;
}

/**
 * LensFeedPanel — Per-lens live web DTU feed panel.
 * Fetches DTUs scoped to the given lens from /api/global/feed/:lensId and
 * subscribes to feed:new-dtu socket events to show real-time arrivals.
 * Renders in news-app style using FeedDTUCard.
 */
export function LensFeedPanel({ lensId, domain, limit = 20, className }: LensFeedPanelProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [isLive, setIsLive] = useState(false);

  const effectiveDomain = domain ?? lensId;

  const fetchFeed = useCallback(async () => {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${apiBase}/api/global/feed/${lensId}?limit=${limit}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok && Array.isArray(data.feed)) {
        setItems(data.feed);
      }
    } catch {
      // non-critical; feed panel is supplemental
    } finally {
      setLoading(false);
    }
  }, [lensId, limit]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  // Subscribe to real-time feed events
  useEffect(() => {
    const unsub = onEvent('feed:new-dtu', (raw: unknown) => {
      const data = raw as {
        lensId?: string;
        domain?: string;
        dtuId?: string;
        title?: string;
        sourceName?: string;
        sourceUrl?: string;
        tags?: string[];
      };
      if (data?.lensId !== lensId && data?.domain !== effectiveDomain) return;

      const liveItem: FeedItem = {
        id: data.dtuId || `live-${Date.now()}`,
        title: data.title || 'New feed item',
        meta: {
          sourceName: data.sourceName,
          sourceUrl: data.sourceUrl,
          publishedAt: new Date().toISOString(),
          domain: effectiveDomain,
          lensId,
        },
        tags: data.tags || [],
        _isLive: true,
      };

      setItems((prev) => [liveItem, ...prev].slice(0, limit));
      setLiveCount((n) => n + 1);
      setIsLive(true);
    });
    return unsub;
  }, [lensId, effectiveDomain, limit]);

  // Fade the live indicator after 10s of no new events
  useEffect(() => {
    if (!isLive) return;
    const t = setTimeout(() => setIsLive(false), 10000);
    return () => clearTimeout(t);
  }, [isLive, liveCount]);

  const displayItems = items.slice(0, collapsed ? 0 : 5);

  return (
    <div
      data-testid="lens-feed-panel"
      className={cn(
        'rounded-xl border border-gray-700/50 bg-gray-900/60 overflow-hidden',
        className
      )}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/40">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
            Live Feed
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-400" />
              </span>
              Live
            </span>
          )}
          {liveCount > 0 && !isLive && (
            <span className="text-[10px] text-gray-400">{liveCount} new</span>
          )}
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-gray-400 hover:text-gray-300 transition"
          aria-label={collapsed ? 'Expand feed' : 'Collapse feed'}
        >
          {collapsed ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Feed items */}
      {!collapsed && (
        <div className="p-2 space-y-2">
          {loading ? (
            // Skeleton placeholders
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-gray-800/50 animate-pulse" />
            ))
          ) : displayItems.length === 0 ? (
            <p className="text-[11px] text-gray-400 text-center py-3">No live feed items yet</p>
          ) : (
            displayItems.map((item) => (
              <div key={item.id} data-testid="feed-dtu-card">
                <FeedDTUCard
                  title={item.title}
                  summary={item.core?.definitions?.[0]}
                  sourceName={item.meta?.sourceName || item.source?.name || effectiveDomain}
                  sourceUrl={item.meta?.sourceUrl}
                  domain={item.meta?.domain || effectiveDomain}
                  tags={(item.tags || []).filter(
                    (t) => !t.startsWith('lens:') && t !== 'feed' && t !== 'live'
                  )}
                  publishedAt={item.meta?.publishedAt}
                />
              </div>
            ))
          )}

          {!loading && items.length > 5 && (
            <a
              href={`/lenses/feed?domain=${lensId}`}
              className="flex items-center justify-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 py-1 transition"
            >
              View all <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
