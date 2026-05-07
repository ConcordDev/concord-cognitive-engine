'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { subscribe, connectSocket } from '@/lib/realtime/socket';
import { isInViewport } from '@/lib/utils';
import { Zap, Sparkles, Star, Ghost, Tag } from 'lucide-react';
import { TierBadge } from '@/components/dtu/TierBadge';

interface DTUEvent {
  id: string;
  title?: string;
  summary?: string;
  tier?: string;
  type?: string;
  emergent?: string;
  actor?: string;
  source?: string;
  tags?: string[];
  timestamp: string;
  isNew?: boolean;
}

const TIER_CONFIG: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  regular: { icon: Zap, color: 'text-gray-400', label: 'Regular' },
  mega: { icon: Star, color: 'text-neon-cyan', label: 'Mega' },
  hyper: { icon: Sparkles, color: 'text-neon-purple', label: 'Hyper' },
  shadow: { icon: Ghost, color: 'text-gray-500', label: 'Shadow' },
};

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const TYPE_COLORS: Record<string, string> = {
  MESH_BEACON: 'bg-neon-purple/20 text-neon-purple',
  'meta-derivation': 'bg-neon-cyan/20 text-neon-cyan',
  synthesis: 'bg-neon-blue/20 text-neon-blue',
  dream: 'bg-neon-pink/20 text-neon-pink',
  capture: 'bg-emerald-500/20 text-emerald-400',
};

function LiveDTUFeed({
  limit = 10,
  onDtuClick,
}: {
  limit?: number;
  onDtuClick?: (id: string) => void;
}) {
  const [liveDtus, setLiveDtus] = useState<DTUEvent[]>([]);
  const [isFeedVisible, setIsFeedVisible] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);

  // Pause real-time updates when the feed is scrolled out of the viewport
  const checkVisibility = useCallback(() => {
    if (feedRef.current) {
      setIsFeedVisible(isInViewport(feedRef.current));
    }
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', checkVisibility, { passive: true });
    checkVisibility();
    return () => window.removeEventListener('scroll', checkVisibility);
  }, [checkVisibility]);

  // Fetch recent DTUs as initial state
  const { data: dtusData } = useQuery({
    queryKey: ['dtus-recent'],
    queryFn: () => apiHelpers.dtus.paginated({ limit, pageSize: limit }).then((r) => r.data),
    refetchInterval: isFeedVisible ? 60000 : false,
  });

  // Populate initial list from query
  useEffect(() => {
    const items =
      (dtusData as { dtus?: DTUEvent[]; items?: DTUEvent[] })?.dtus ||
      (dtusData as { dtus?: DTUEvent[]; items?: DTUEvent[] })?.items ||
      [];
    if (items.length > 0 && liveDtus.length === 0) {
      setLiveDtus(
        items.slice(0, limit).map((d: DTUEvent) => ({
          id: d.id || '',
          title: d.title || d.summary || '',
          summary: d.summary || '',
          tier: d.tier || 'regular',
          type: d.type || '',
          emergent: d.emergent || d.actor || '',
          source: d.source || '',
          tags: Array.isArray(d.tags) ? d.tags : [],
          timestamp: d.timestamp || new Date().toISOString(),
          isNew: false,
        }))
      );
    }
  }, [dtusData, limit, liveDtus.length]);

  // Subscribe to real-time DTU creation
  useEffect(() => {
    connectSocket();

    const unsub = subscribe<Record<string, unknown>>('dtu:created', (data) => {
      const newDtu: DTUEvent = {
        id: (data.id as string) || crypto.randomUUID(),
        title: (data.title as string) || (data.summary as string) || 'New DTU',
        summary: (data.summary as string) || '',
        tier: (data.tier as string) || 'regular',
        type: (data.type as string) || '',
        emergent: (data.emergent as string) || (data.actor as string) || '',
        source: (data.source as string) || '',
        tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
        timestamp: (data.timestamp as string) || new Date().toISOString(),
        isNew: true,
      };

      setLiveDtus((prev) => [newDtu, ...prev].slice(0, limit));

      // Clear "new" flag after animation
      setTimeout(() => {
        setLiveDtus((prev) => prev.map((d) => (d.id === newDtu.id ? { ...d, isNew: false } : d)));
      }, 2000);
    });

    return unsub;
  }, [limit]);

  return (
    <div className="rounded-xl border border-lattice-border bg-lattice-surface/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-blue" />
          Live DTU Birth Feed
        </h2>
        <span className="text-xs text-gray-500">{liveDtus.length} recent</span>
      </div>

      <div ref={feedRef} className="space-y-1 max-h-[320px] overflow-y-auto no-scrollbar">
        {liveDtus.length === 0 ? (
          <div className="text-center py-6">
            <Zap className="w-6 h-6 mx-auto mb-2 text-gray-600" />
            <p className="text-xs text-gray-500">Waiting for new DTUs...</p>
          </div>
        ) : (
          liveDtus.map((dtu) => {
            const tierConf = TIER_CONFIG[dtu.tier || 'regular'] || TIER_CONFIG.regular;
            const TierIcon = tierConf.icon;
            return (
              <div
                key={dtu.id}
                onClick={() => onDtuClick?.(dtu.id)}
                role={onDtuClick ? 'button' : undefined}
                tabIndex={onDtuClick ? 0 : undefined}
                className={`flex items-start gap-2 px-2 py-2 rounded-lg transition-all ${
                  onDtuClick ? 'cursor-pointer' : ''
                } ${
                  dtu.isNew
                    ? 'bg-neon-cyan/10 border border-neon-cyan/30 animate-pulse'
                    : 'hover:bg-lattice-deep/50'
                }`}
              >
                <TierIcon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${tierConf.color}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-200 truncate">
                    {dtu.title || dtu.summary || dtu.id.slice(0, 12)}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <TierBadge tier={dtu.tier || 'regular'} size="sm" showRegular />
                    {dtu.type && (
                      <span
                        className={`text-[10px] px-1 py-px rounded ${TYPE_COLORS[dtu.type] || 'bg-gray-500/20 text-gray-400'}`}
                      >
                        {dtu.type}
                      </span>
                    )}
                    {dtu.source && (
                      <span
                        className="text-[10px] text-gray-500 truncate max-w-[80px]"
                        title={dtu.source}
                      >
                        via {dtu.source}
                      </span>
                    )}
                  </div>
                  {dtu.tags && dtu.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Tag className="w-2.5 h-2.5 text-gray-600" />
                      {dtu.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] text-gray-500">
                          #{tag}
                        </span>
                      ))}
                      {dtu.tags.length > 3 && (
                        <span className="text-[10px] text-gray-600">+{dtu.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
                <span
                  className="text-[10px] text-gray-600 flex-shrink-0"
                  title={new Date(dtu.timestamp).toLocaleString()}
                >
                  {formatTimeAgo(dtu.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedLiveDTUFeed = withErrorBoundary(LiveDTUFeed);
export { _WrappedLiveDTUFeed as LiveDTUFeed };
