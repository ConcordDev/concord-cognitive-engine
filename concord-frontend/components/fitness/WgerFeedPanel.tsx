'use client';

/**
 * WgerFeedPanel — the in-lens list for the wger exercise feed.
 *
 * F14: pulling the "Live exercise feed" ingested real exercise DTUs
 * from wger, but they surfaced in no list — the pull reported only a
 * count. This panel lists the batch the pull actually fetched: each
 * exercise by name, fresh ingests with their full DTU id (findable,
 * citable), and already-seen rows marked as such.
 */

import { useState } from 'react';
import { Dumbbell, Loader2, Rss } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SurfacedExercise { name: string; dtuId: string | null; fresh: boolean }
interface FeedResult { ingested: number; skipped: number; source: string; exercises?: SurfacedExercise[] }

export function WgerFeedPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pull() {
    setBusy(true); setError(null);
    try {
      const res = await lensRun({ domain: 'fitness', action: 'feed', input: {} });
      if (res.data?.ok === false) {
        setError(res.data?.error || 'Feed unavailable.');
        setResult(null);
      } else {
        setResult(res.data?.result as FeedResult);
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
        {!result && !error && (
          <p className="text-xs text-gray-400">Pull the feed to ingest real exercises from the open wger workout database as DTUs — the batch lands here, by name, with its DTU ids.</p>
        )}
        {result && (
          <>
            <p role="status" className="text-xs text-emerald-300 mb-2">
              {result.ingested} new DTU{result.ingested === 1 ? '' : 's'} from {result.source}
              {result.skipped > 0 && <span className="text-gray-400"> · {result.skipped} already seen</span>}
            </p>
            {result.exercises && result.exercises.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {result.exercises.map((ex, i) => (
                  <li key={`${ex.name}-${i}`} className="py-1.5 flex items-baseline gap-2 text-xs">
                    <span className="text-white flex-1">{ex.name}</span>
                    {ex.fresh && ex.dtuId
                      ? <span className="font-mono text-[10px] text-cyan-300 break-all">{ex.dtuId}</span>
                      : <span className="text-[10px] text-gray-500">already ingested</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">No exercises in this batch.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default WgerFeedPanel;
