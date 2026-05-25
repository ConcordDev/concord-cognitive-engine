'use client';

/**
 * Recommendations — personalized picks computed from the user's own
 * saved collections + view history. Backs gallery `recommendations` +
 * `view-history` + `record-view` macros. No seed data: an empty
 * history yields an explicit empty state.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Sparkles, Loader2, AlertTriangle, Frame, History, RefreshCw } from 'lucide-react';

interface TasteEntry { name: string; weight: number }
interface TasteProfile {
  topArtists: TasteEntry[];
  topDepartments: TasteEntry[];
  topCultures: TasteEntry[];
  basisCount: number;
}
interface RecWork {
  id: number;
  refId: string;
  title: string;
  artist: string;
  date?: string;
  image: string | null;
  museum: string;
  department?: string;
  culture?: string;
  reason: string;
}
interface RecsResult {
  recommendations: RecWork[];
  profile: TasteProfile | null;
  basis?: string;
  reason?: string;
}
interface HistoryEntry {
  id: string;
  title: string;
  artist: string;
  date?: string | null;
  image?: string | null;
  museum?: string | null;
  viewedAt: string;
}

export function Recommendations() {
  const [recs, setRecs] = useState<RecsResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [recR, histR] = await Promise.all([
      lensRun<RecsResult>('gallery', 'recommendations', { limit: 12 }),
      lensRun<{ history: HistoryEntry[] }>('gallery', 'view-history', { limit: 16 }),
    ]);
    if (recR.data?.ok && recR.data.result) setRecs(recR.data.result);
    else setError(recR.data?.error || 'Could not compute recommendations.');
    if (histR.data?.ok && histR.data.result) setHistory(histR.data.result.history || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Recording a view of a recommended work refines the taste profile.
  const recordView = useCallback(async (w: RecWork) => {
    await lensRun('gallery', 'record-view', {
      refId: w.refId, title: w.title, artist: w.artist, date: w.date,
      image: w.image, museum: w.museum, department: w.department, culture: w.culture,
    });
    await load();
  }, [load]);

  return (
    <div className="rounded-lg border border-fuchsia-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-fuchsia-500/10 pb-2">
        <Sparkles className="h-4 w-4 text-fuchsia-400" />
        <h3 className="text-sm font-semibold text-white">For you</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Personalized</span>
        <button type="button" onClick={load} disabled={loading} className="ml-auto rounded bg-zinc-800 p-1 hover:bg-zinc-700 disabled:opacity-40" aria-label="Refresh">
          <RefreshCw className={`w-3 h-3 text-zinc-300 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="py-6 text-center text-zinc-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
      )}

      {!loading && !error && recs?.reason === 'no_history' && (
        <div className="py-6 text-center text-[12px] text-zinc-400 italic">
          No viewing history yet. Browse and save artworks to get personalized recommendations.
        </div>
      )}

      {!loading && recs?.profile && (
        <div className="rounded border border-fuchsia-500/20 bg-fuchsia-500/5 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-fuchsia-300 font-semibold">Your taste profile · {recs.profile.basisCount} signals</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {recs.profile.topArtists.map((a) => (
              <span key={`a-${a.name}`} className="rounded bg-fuchsia-500/15 text-fuchsia-200 px-1.5 py-0.5 text-[10px]">{a.name}</span>
            ))}
            {recs.profile.topDepartments.map((d) => (
              <span key={`d-${d.name}`} className="rounded bg-zinc-800 text-zinc-300 px-1.5 py-0.5 text-[10px]">{d.name}</span>
            ))}
            {recs.profile.topCultures.map((c) => (
              <span key={`c-${c.name}`} className="rounded bg-zinc-800 text-zinc-300 px-1.5 py-0.5 text-[10px]">{c.name}</span>
            ))}
          </div>
        </div>
      )}

      {!loading && recs && recs.recommendations.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {recs.recommendations.map((w) => (
            <button
              key={w.refId} type="button" onClick={() => recordView(w)}
              className="rounded border border-zinc-800 bg-zinc-900/40 p-1.5 text-left hover:border-fuchsia-400/50 transition-colors"
            >
              {w.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host
                <img src={w.image} alt={w.title} className="w-full h-28 object-cover rounded" />
              ) : (
                <div className="w-full h-28 bg-zinc-950 rounded flex items-center justify-center"><Frame className="w-6 h-6 text-zinc-700" /></div>
              )}
              <div className="text-[10px] text-zinc-200 mt-1 line-clamp-2">{w.title}</div>
              <div className="text-[9px] text-zinc-400">{w.artist}</div>
              <div className="text-[9px] text-fuchsia-400/80 italic mt-0.5 line-clamp-1">{w.reason}</div>
            </button>
          ))}
        </div>
      )}

      {!loading && recs && recs.profile && recs.recommendations.length === 0 && recs.reason !== 'no_history' && (
        <div className="py-4 text-center text-[12px] text-zinc-400 italic">
          Profile built, but no new picks available right now. Try again later.
        </div>
      )}

      {history.length > 0 && (
        <div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mt-1">
            <History className="w-3 h-3" /> Recently viewed
          </div>
          <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
            {history.map((h) => (
              <div key={h.id} className="w-20 shrink-0">
                <div className="h-20 w-20 rounded bg-zinc-950 overflow-hidden flex items-center justify-center">
                  {h.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host
                    <img src={h.image} alt={h.title} className="h-full w-full object-cover" />
                  ) : <Frame className="w-5 h-5 text-zinc-700" />}
                </div>
                <div className="text-[9px] text-zinc-400 mt-0.5 line-clamp-2">{h.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
