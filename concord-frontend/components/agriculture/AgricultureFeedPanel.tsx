'use client';

/**
 * AgricultureFeedPanel — the agriculture lens's crop-yield feed section:
 * the display half of the domain's `feed` verb, joined in one component.
 *
 * The verb ingests World Bank cereal-yield rows as DTUs and reports them
 * honestly ("Ingested N new · M already seen"), but those DTUs are stored
 * at local scope by dtu.create while the shared global-feed route admits
 * only scope "global" rows — so the shared LensFeedPanel could never show
 * them (F3: the feed ingests and never displays). This panel reads the
 * lens's own ingest back through the `feed-list` verb (source-pinned to
 * the feed handler's mint) and owns the Pull, so what the section ingests
 * is what the section lists. Rendering reuses the shared FeedDTUCard.
 */

import { useState, useEffect, useCallback } from 'react';
import { Rss, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { FeedDTUCard } from '@/components/feeds/FeedDTUCard';

interface FeedListItem {
  id: string;
  title: string;
  summary?: string;
  sourceName?: string;
  sourceUrl?: string;
  publishedAt?: string | null;
  tags?: string[];
}

interface PullResult { ingested: number; skipped: number; source: string }

export function AgricultureFeedPanel() {
  const [items, setItems] = useState<FeedListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [pullError, setPullError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await lensRun({ domain: 'agriculture', action: 'feed-list', input: { limit: 20 } });
      const list = (res.data?.result as { items?: FeedListItem[] } | undefined)?.items;
      if (Array.isArray(list)) setItems(list);
    } catch {
      // non-critical; feed panel is supplemental
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function pull() {
    setPulling(true);
    setPullError('');
    setPullResult(null);
    try {
      const r = await lensRun({ domain: 'agriculture', action: 'feed', input: {} });
      if (r.data?.ok) {
        setPullResult(r.data.result as PullResult);
        await load();
      } else {
        setPullError(r.data?.error || 'Feed unavailable.');
      }
    } catch {
      setPullError('Feed unavailable.');
    } finally {
      setPulling(false);
    }
  }

  return (
    <div data-testid="agriculture-feed-panel" className="rounded-xl border border-gray-700/50 bg-gray-900/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/40">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Live Feed</span>
        <span className="text-[10px] text-gray-500">Crop-yield feed — World Bank data</span>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/30">
        <button
          onClick={pull}
          disabled={pulling}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 inline-flex items-center gap-1"
        >
          {pulling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}
          Pull feed
        </button>
        {pullResult && (
          <span className="text-[11px] text-emerald-300" role="status">
            Ingested {pullResult.ingested} new DTU{pullResult.ingested === 1 ? '' : 's'} from {pullResult.source}
            {pullResult.skipped > 0 ? ` · ${pullResult.skipped} already seen` : ''}
          </span>
        )}
        {pullError && (
          <span className="text-[11px] text-rose-400" role="status">{pullError}</span>
        )}
        {!pullResult && !pullError && (
          <span className="text-[11px] text-gray-400">Ingests real items from a free public source as DTUs.</span>
        )}
      </div>

      <div className="p-2 space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-800/50 animate-pulse" />
          ))
        ) : items.length === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-3">No live feed items yet</p>
        ) : (
          items.slice(0, 5).map((item) => (
            <div key={item.id} data-testid="feed-dtu-card">
              <FeedDTUCard
                title={item.title}
                summary={item.summary}
                sourceName={item.sourceName || 'World Bank Open Data'}
                sourceUrl={item.sourceUrl}
                domain="agriculture"
                tags={(item.tags || []).filter((t) => t !== 'feed' && t !== 'live')}
                publishedAt={item.publishedAt || undefined}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
