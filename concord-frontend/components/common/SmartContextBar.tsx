'use client';

/**
 * SmartContextBar — Persistent domain-awareness bar for lens pages.
 *
 * Renders at the top of every lens page and surfaces:
 *   1. Total DTU count for the current domain
 *   2. Most recent autogen / dream / synthesis insight
 *   3. Trending topic titles (top 5 recent DTUs)
 *   4. Quick-action "Ask about [domain]" button that navigates to chat
 *
 * Data is fetched via the generic lens API (`apiHelpers.lens.list`) with a
 * 30-second stale window so the bar stays responsive without hammering the
 * backend.  All API failures are caught gracefully — the bar simply omits
 * sections whose data is unavailable.
 */

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { MessageCircle, TrendingUp, Sparkles, Database } from 'lucide-react';

interface SmartContextBarProps {
  /** Domain slug passed to the lens API (e.g. "education", "finance"). */
  domain: string;
  /** Human-readable label shown in the "Ask about ___" button. */
  domainLabel: string;
}

/** Shape of a single item returned by the lens list endpoint. */
interface LensItem {
  id?: string;
  title?: string;
  source?: string;
  [key: string]: unknown;
}

/** Shape of the paginated response from the lens list endpoint. */
interface LensListResponse {
  items: LensItem[];
  total: number;
}

function SmartContextBar({ domain, domainLabel }: SmartContextBarProps) {
  // Fetch the most recent DTUs for this domain.
  // The query is intentionally lenient — if the API is down or the domain has
  // no data we simply render with safe defaults (0 count, no items).
  const { data: domainDtus } = useQuery<LensListResponse>({
    queryKey: ['domain-context', domain],
    queryFn: () =>
      apiHelpers.lens
        .list(domain, { limit: 5 })
        .then((r) => r.data as LensListResponse)
        .catch(() => ({ items: [], total: 0 })),
    staleTime: 30_000,
  });

  const dtuCount = domainDtus?.total || domainDtus?.items?.length || 0;
  const recentItems: LensItem[] = domainDtus?.items || [];

  // Try to find a generated insight (autogen / dream / synthesis).
  // Falls back to the most recent item of any source if none match.
  const lastInsight =
    recentItems.find(
      (item) => item.source === 'autogen' || item.source === 'dream' || item.source === 'synthesis'
    ) || recentItems[0];

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-lattice-surface/50 border-b border-lattice-border text-sm">
      {/* DTU Count */}
      <div className="flex items-center gap-1.5 text-gray-400">
        <Database className="w-3.5 h-3.5 text-neon-cyan" />
        <span className="font-mono text-xs">{dtuCount}</span>
        <span className="text-xs">DTUs</span>
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-lattice-border" />

      {/* Last Insight */}
      {lastInsight && (
        <>
          <div className="flex items-center gap-1.5 text-gray-400 min-w-0 flex-1">
            <Sparkles className="w-3.5 h-3.5 text-neon-purple flex-shrink-0" />
            <span className="text-xs truncate">{lastInsight.title || 'Latest insight'}</span>
          </div>
          <div className="w-px h-4 bg-lattice-border" />
        </>
      )}

      {/* Trending Topics — only shown on medium+ screens when there is data */}
      {recentItems.length > 1 && (
        <>
          <div className="hidden md:flex items-center gap-1.5 text-gray-400">
            <TrendingUp className="w-3.5 h-3.5 text-neon-green flex-shrink-0" />
            <span className="text-xs">
              {recentItems
                .slice(0, 3)
                .map((item) => (item.title || '').slice(0, 20))
                .filter(Boolean)
                .join(' \u00b7 ')}
            </span>
          </div>
          <div className="w-px h-4 bg-lattice-border hidden md:block" />
        </>
      )}

      {/* Ask Button — navigates to the chat lens with domain context */}
      <button
        className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-xs hover:bg-neon-cyan/20 transition-colors flex-shrink-0"
        onClick={() => {
          window.location.href = `/lenses/chat?context=${encodeURIComponent(domain)}`;
        }}
      >
        <MessageCircle className="w-3.5 h-3.5" />
        Ask about {domainLabel}
      </button>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSmartContextBar = withErrorBoundary(SmartContextBar);
export { _WrappedSmartContextBar as SmartContextBar };
