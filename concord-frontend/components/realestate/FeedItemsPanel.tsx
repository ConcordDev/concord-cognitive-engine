'use client';

/**
 * FeedItemsPanel — F4: the home-value feed's ingested items, readable
 * in the lens. The feed pulls real US Census Bureau ACS median home
 * values by state and stores them as public DTUs; before this panel
 * no surface named the source in standing copy and no ingested item
 * was viewable anywhere ("unverifiable by construction" — Review 5).
 * The source is named here, and every ingested value is listed.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface FeedItem {
  id: string;
  title: string;
  state: string | null;
  medianValue: number | null;
  year: number;
}

export function FeedItemsPanel() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await lensRun<{ items?: FeedItem[]; source?: string }>('realestate', 'feed-items', {});
      const result = (r.data?.result ?? r.data) as { items?: FeedItem[]; source?: string };
      setItems(result.items || []);
      setSource(result.source || '');
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="re-feed-items">
      <h3 className="text-xs font-semibold text-gray-200">Home-value feed — ingested values</h3>
      <p className="mt-0.5 text-[11px] text-gray-400">
        Source: {source || 'US Census Bureau — American Community Survey 1-Year (median owner-occupied home value by state)'}.
        Pulled live by the feed above and stored as public records you can inspect here.
      </p>
      {failed ? (
        <p className="mt-2 text-[11px] text-rose-300">Couldn&apos;t load the ingested values.</p>
      ) : items === null ? (
        <div className="mt-2 h-5 animate-pulse rounded bg-slate-800/60" />
      ) : items.length === 0 ? (
        <p className="mt-2 text-[11px] text-gray-400">Nothing ingested yet — pull the feed above and the values will stand here.</p>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="re-feed-items-list">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] px-2 py-1 text-[11px]">
              <span className="text-gray-300">{it.state || it.title}</span>
              <span className="font-mono text-cyan-300">
                {it.medianValue != null ? `$${it.medianValue.toLocaleString()}` : '—'}
                <span className="ml-1 text-gray-400">{it.year}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
