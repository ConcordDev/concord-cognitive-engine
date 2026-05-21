'use client';

/**
 * ArtistPage — aggregates one artist's works across the Cleveland Museum
 * of Art and the Art Institute of Chicago into a single artist page.
 * Backs the gallery `artist` macro.
 */

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { User, Loader2, AlertTriangle, Frame } from 'lucide-react';

interface ArtistWork {
  id: number;
  refId: string;
  title: string;
  date?: string;
  type?: string;
  medium?: string;
  image: string | null;
  museum: string;
  url?: string;
}
interface ArtistResult {
  artist: string;
  works: ArtistWork[];
  totalWorks: number;
  sources: { museum: string; count: number }[];
  dateRange?: { earliest: number; latest: number } | null;
  mediumBreakdown?: Record<string, number>;
  reason?: string;
}

export function ArtistPage() {
  const [name, setName] = useState('');
  const [data, setData] = useState<ArtistResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!name.trim()) { setError('Enter an artist name.'); return; }
    setLoading(true); setError(null); setData(null);
    const r = await lensRun<ArtistResult>('gallery', 'artist', { name: name.trim(), limit: 30 });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Artist lookup failed.');
    setLoading(false);
  }, [name]);

  const mediums = data?.mediumBreakdown
    ? Object.entries(data.mediumBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <User className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Artist pages</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Cross-museum</span>
      </header>

      <div className="flex items-center gap-2">
        <input
          type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white"
          placeholder="Artist name (e.g. Claude Monet)"
        />
        <button
          type="button" onClick={run} disabled={loading}
          className="rounded bg-emerald-600/80 hover:bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Look up'}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {!data && !error && !loading && (
        <div className="py-6 text-center text-[12px] text-zinc-500 italic">No artist loaded yet. Search a name to aggregate works across museums.</div>
      )}

      {data && data.totalWorks === 0 && (
        <div className="py-6 text-center text-[12px] text-zinc-500 italic">
          No works found for &ldquo;{data.artist}&rdquo; in the connected museum collections.
        </div>
      )}

      {data && data.totalWorks > 0 && (
        <div className="space-y-3">
          <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
            <h4 className="text-base font-bold text-white">{data.artist}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
              <span>{data.totalWorks} works</span>
              {data.dateRange && <span>{data.dateRange.earliest}–{data.dateRange.latest}</span>}
              {data.sources.map((s) => (
                <span key={s.museum}>{s.museum}: <span className="text-emerald-300">{s.count}</span></span>
              ))}
            </div>
            {mediums.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {mediums.map(([m, n]) => (
                  <span key={m} className="rounded bg-emerald-500/15 text-emerald-200 px-1.5 py-0.5 text-[10px]">{m} ({n})</span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-96 overflow-y-auto">
            {data.works.map((w) => (
              <a
                key={w.refId} href={w.url || '#'} target="_blank" rel="noopener noreferrer"
                className="rounded border border-zinc-800 bg-zinc-900/40 p-1.5 hover:border-emerald-400/50 transition-colors"
              >
                {w.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host
                  <img src={w.image} alt={w.title} className="w-full h-28 object-cover rounded" />
                ) : (
                  <div className="w-full h-28 bg-zinc-950 rounded flex items-center justify-center"><Frame className="w-6 h-6 text-zinc-700" /></div>
                )}
                <div className="text-[10px] text-zinc-200 mt-1 line-clamp-2">{w.title}</div>
                <div className="text-[9px] text-zinc-500">{w.date || ''} · {w.museum}</div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
