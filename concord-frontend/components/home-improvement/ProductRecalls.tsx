'use client';

/**
 * ProductRecalls — real U.S. Consumer Product Safety Commission recall
 * feed (home-improvement.feed macro). Previously only reachable through
 * the generic <LensFeedButton>, which pulls the feed and shows nothing
 * but a bare "ingested N" count — no way to see WHICH products were
 * recalled, the hazard, or the remedy. This renders the real list.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface RecallSummary {
  id: string;
  recallId: string | null;
  product: string;
  hazard: string;
  remedy: string;
  recallDate: string | null;
  dtuId: string;
}

export function ProductRecalls() {
  const [recalls, setRecalls] = useState<RecallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPull, setLastPull] = useState<{ ingested: number; skipped: number } | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ recalls: RecallSummary[]; count: number }>('home-improvement', 'feed', { op: 'list' });
      if (r.data?.ok && r.data.result) setRecalls(r.data.result.recalls || []);
    } catch (e) { console.error('[ProductRecalls] list failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  async function pull() {
    setPulling(true); setError(null);
    try {
      const r = await lensRun<{ ingested: number; skipped: number; recalls: RecallSummary[] }>('home-improvement', 'feed', { op: 'pull', limit: 12 });
      if (r.data?.ok && r.data.result) {
        setLastPull({ ingested: r.data.result.ingested, skipped: r.data.result.skipped });
        await loadList();
      } else {
        setError(r.data?.error || 'CPSC feed unavailable.');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'CPSC feed unavailable.'); }
    finally { setPulling(false); }
  }

  return (
    <div className="rounded-xl border border-rose-900/40 bg-rose-950/10 p-4 space-y-3">
      <header className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-rose-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">Product recalls</h2>
          <p className="text-[10px] text-zinc-400">Real recalls from the U.S. Consumer Product Safety Commission — check before you buy, or after you own it.</p>
        </div>
        <button
          onClick={pull} disabled={pulling}
          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 inline-flex items-center gap-1"
        >
          {pulling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Check for new recalls
        </button>
      </header>

      {lastPull && (
        <p className="text-[11px] text-rose-300">
          {lastPull.ingested > 0 ? `${lastPull.ingested} new recall${lastPull.ingested === 1 ? '' : 's'} found.` : 'No new recalls since last check.'}
          {lastPull.skipped > 0 && <span className="text-zinc-500"> ({lastPull.skipped} already seen)</span>}
        </p>
      )}
      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : recalls.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">
          No recalls checked yet. Click &quot;Check for new recalls&quot; to pull the live CPSC feed.
        </div>
      ) : (
        <ul className="space-y-1.5 max-h-96 overflow-y-auto">
          {recalls.map((r) => (
            <li key={r.id} className="rounded-lg border border-rose-900/30 bg-rose-950/5 p-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-zinc-100">{r.product}</p>
                  <p className="text-[10px] text-zinc-400">Hazard: {r.hazard}{r.remedy && r.remedy !== '?' ? ` · Remedy: ${r.remedy}` : ''}</p>
                  {r.recallDate && <p className="text-[9px] text-zinc-500 font-mono mt-0.5">{r.recallDate}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ProductRecalls;
