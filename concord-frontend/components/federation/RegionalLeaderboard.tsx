'use client';

/**
 * RegionalLeaderboard — "popular in your region" feed.
 *
 * Renders a compact leaderboard of the top-ranked DTUs in the viewer's
 * declared region, country, or globally. Hits
 *   GET /api/federation/leaderboard?scope=regional|national|global
 *
 * Shows:
 *   • Scope toggle (Regional / National / Global)
 *   • Top N DTUs with score, citations, likes, views
 *   • Viewer's own best-ranked DTU if they have one in the list
 *   • Empty-state when the viewer hasn't declared the relevant location
 *
 * Default scope is regional — the whole point of this component is
 * the "popular where you are" view.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { MapPin, Flag, Globe, TrendingUp, Quote, Heart, Eye, Trophy } from 'lucide-react';

type Scope = 'regional' | 'national' | 'global';

interface LeaderboardEntry {
  id: string;
  title: string;
  domain: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  score: number;
  citations: number;
  likes: number;
  views: number;
}

interface LeaderboardResponse {
  ok: boolean;
  scope: Scope;
  region: string | null;
  nation: string | null;
  total: number;
  top: LeaderboardEntry[];
  viewerRank: (LeaderboardEntry & { position: number }) | null;
}

interface Props {
  /** Initial scope. Default 'regional'. */
  defaultScope?: Scope;
  /** Max rows to display. Backend default is 20. */
  limit?: number;
  /** Compact mode for dashboard embed (fewer columns). */
  compact?: boolean;
  className?: string;
}

const SCOPE_CONFIG: Record<Scope, { label: string; icon: React.ElementType; color: string }> = {
  regional: { label: 'Regional', icon: MapPin, color: 'text-neon-cyan' },
  national: { label: 'National', icon: Flag, color: 'text-neon-purple' },
  global: { label: 'Global', icon: Globe, color: 'text-neon-blue' },
};

function RegionalLeaderboard({
  defaultScope = 'regional',
  limit = 10,
  compact = false,
  className,
}: Props) {
  const [scope, setScope] = useState<Scope>(defaultScope);

  const { data, isLoading, error } = useQuery<LeaderboardResponse>({
    queryKey: ['federation-leaderboard', scope, limit],
    queryFn: async () => {
      const res = await api.get('/api/federation/leaderboard', {
        params: { scope, limit },
      });
      return res.data;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const top = data?.top || [];
  const viewerRank = data?.viewerRank || null;
  const locationLabel =
    scope === 'regional' ? data?.region : scope === 'national' ? data?.nation : 'Worldwide';
  const needsLocation =
    !isLoading &&
    ((scope === 'regional' && !data?.region) || (scope === 'national' && !data?.nation));

  return (
    <section
      className={cn(
        'rounded-xl border border-lattice-border bg-lattice-surface/60 overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-semibold text-white truncate">
            Popular {locationLabel ? `in ${locationLabel}` : ''}
          </h3>
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="Leaderboard scope">
          {(Object.keys(SCOPE_CONFIG) as Scope[]).map((s) => {
            const cfg = SCOPE_CONFIG[s];
            const Icon = cfg.icon;
            const isActive = scope === s;
            return (
              <button
                key={s}
                onClick={() => setScope(s)}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
                  isActive
                    ? `${cfg.color} bg-lattice-deep border border-current/30`
                    : 'text-gray-500 hover:text-gray-300'
                )}
                title={cfg.label}
              >
                <Icon className="w-3.5 h-3.5" />
                {!compact && cfg.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Body */}
      <div className="p-4">
        {isLoading ? (
          <div className="text-center py-6 text-sm text-gray-500">Loading…</div>
        ) : error ? (
          <div className="text-center py-6 text-sm text-red-400">Failed to load leaderboard</div>
        ) : needsLocation ? (
          <div className="text-center py-6 text-sm text-gray-500">
            <p className="mb-2">
              You haven&apos;t declared your {scope === 'regional' ? 'region' : 'country'} yet.
            </p>
            <Link href="/onboarding/location" className="text-neon-cyan hover:underline text-xs">
              Set your location →
            </Link>
          </div>
        ) : top.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-500">
            Nothing ranked yet in this scope.
          </div>
        ) : (
          <ol className="space-y-2">
            {top.map((entry, idx) => (
              <li key={entry.id}>
                <Link
                  href={`/dtu/${entry.id}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border/50 hover:border-neon-cyan/30 transition-colors"
                >
                  <span
                    className={cn(
                      'flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0',
                      idx === 0
                        ? 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/40'
                        : idx === 1
                          ? 'bg-gray-300/10 text-gray-300 border border-gray-400/30'
                          : idx === 2
                            ? 'bg-amber-600/20 text-amber-500 border border-amber-600/30'
                            : 'bg-lattice-border/30 text-gray-500'
                    )}
                  >
                    {idx === 0 ? <Trophy className="w-3.5 h-3.5" /> : idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{entry.title}</div>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <Quote className="w-3 h-3" />
                        {entry.citations}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Heart className="w-3 h-3" />
                        {entry.likes}
                      </span>
                      {!compact && (
                        <span className="inline-flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          {entry.views}
                        </span>
                      )}
                      {!compact && <span className="uppercase tracking-wide">{entry.domain}</span>}
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-600 font-mono flex-shrink-0">
                    {entry.score.toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}

        {/* Viewer's own rank footer */}
        {viewerRank && (
          <div className="mt-3 pt-3 border-t border-lattice-border text-xs text-gray-500 flex items-center justify-between">
            <span>Your best entry</span>
            <span>
              #{viewerRank.position} &middot; {viewerRank.title}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedRegionalLeaderboard = withErrorBoundary(RegionalLeaderboard);
export { _WrappedRegionalLeaderboard as RegionalLeaderboard };
export default _WrappedRegionalLeaderboard;
