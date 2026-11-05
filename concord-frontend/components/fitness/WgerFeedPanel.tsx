'use client';

/**
 * WgerFeedPanel — the in-lens list for the wger exercise feed.
 *
 * F14 (completed by the feed-library fix): the listing is the STORED
 * library, not the pull response. On mount the panel reads
 * fitness.feed-library (server state recorded at ingest: each exercise
 * by name with its full DTU id, the seen set included), so the listing
 * renders identically before any pull and survives reload. Pull feed
 * ingests the day's batch and refreshes the same stored listing.
 */

import { useEffect, useState } from 'react';
import { Dumbbell, Loader2, Rss } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface LibraryItem { name: string; dtuId: string | null; exerciseId: number }
interface FeedResult { ingested: number; skipped: number; source: string; dtuIds?: string[]; library?: LibraryItem[] }

export function WgerFeedPanel() {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [receipt, setReceipt] = useState<FeedResult | null>(null);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await lensRun({ domain: 'fitness', action: 'feed-library', input: {} });
        if (live && res.data?.ok !== false) {
          setItems((res.data?.result as { items?: LibraryItem[] })?.items ?? []);
        }
      } catch { /* the empty state below covers a failed first read */ }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, []);

  async function pull() {
    setBusy(true); setError(null);
    try {
      const res = await lensRun({ domain: 'fitness', action: 'feed', input: {} });
      if (res.data?.ok === false) {
        setError(res.data?.error || 'Feed unavailable.');
        setReceipt(null);
      } else {
        const result = res.data?.result as FeedResult;
        setReceipt(result);
        setFreshIds(new Set(result.dtuIds ?? []));
        if (Array.isArray(result.library)) setItems(result.library);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Feed unavailable.');
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Dumbbell className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Exercise library feed — wger</span>
        <button onClick={pull} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}
          Pull feed
        </button>
      </header>
      <div className="p-4">
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {receipt && (
          <p role="status" className="text-xs text-emerald-300 mb-2">
            {receipt.ingested} new DTU{receipt.ingested === 1 ? '' : 's'} from {receipt.source}
            {receipt.skipped > 0 && <span className="text-gray-400"> · {receipt.skipped} already seen</span>}
          </p>
        )}
        {loading ? (
          <p className="text-xs text-gray-400">Loading the stored exercise library…</p>
        ) : items.length > 0 ? (
          <ul className="divide-y divide-white/5">
            {items.map((ex) => (
              <li key={`${ex.exerciseId}-${ex.dtuId ?? 'legacy'}`} className="py-1.5 flex items-baseline gap-2 text-xs">
                <span className="text-white flex-1">{ex.name}</span>
                {ex.dtuId && freshIds.has(ex.dtuId) && <span className="text-[10px] text-emerald-300 font-semibold">NEW</span>}
                {ex.dtuId
                  ? <span className="font-mono text-[10px] text-cyan-300 break-all">{ex.dtuId}</span>
                  : <span className="text-[10px] text-gray-500">ingested before ids were kept</span>}
              </li>
            ))}
          </ul>
        ) : (
          !receipt && <p className="text-xs text-gray-400">Pull the feed to ingest real exercises from the open wger workout database as DTUs — every pull adds its batch to this stored library, by name, with its DTU ids, and the library stays here between visits.</p>
        )}
      </div>
    </div>
  );
}

export default WgerFeedPanel;
