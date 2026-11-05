'use client';

/**
 * FeedItemsPanel — the products the retail feed has ingested, listed
 * INSIDE the lens. Each pull of the "Live product feed" button creates
 * real DTUs in the library; before this panel those items were findable
 * nowhere in Retail (the feed worked and its output vanished). The list
 * is the lens's own ingestion record (retail.feed-items), newest first.
 */

import { useCallback, useEffect, useState } from 'react';
import { PackageSearch, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface FeedItem {
  dtuId: string;
  code: string;
  name: string;
  brands: string;
  source: string;
  ingestedAt: string;
}

export function FeedItemsPanel() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('retail', 'feed-items', {});
      setItems((r.data?.result?.items || []) as FeedItem[]);
    } catch { /* keep the last list */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="mt-3 rounded-xl border border-white/10 bg-lattice-deep/40 p-4" aria-label="Feed-ingested products">
      <div className="flex items-center gap-2">
        <PackageSearch className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-gray-100">Ingested by the feed</h3>
        <span className="text-[11px] text-gray-500">{items.length} item{items.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-emerald-300 disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-gray-500">
          Nothing ingested yet. Pull the live product feed above and the items it creates — each one a DTU in your library — will be listed here.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-white/5">
          {items.map((it) => (
            <li key={it.dtuId} className="flex items-baseline gap-2 py-1.5 text-xs">
              <span className="flex-1 truncate text-gray-200">{it.name}</span>
              {it.brands && <span className="text-gray-500 truncate">{it.brands}</span>}
              <span className="font-mono text-[10px] text-gray-500">{it.code}</span>
              <span className="text-[10px] text-emerald-300/80">DTU</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default FeedItemsPanel;
