'use client';

/**
 * ArtworkCompare — side-by-side comparison of 2-4 CMA artworks with a
 * structured attribute diff. Backs the gallery `compare` macro.
 */

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Columns3, Loader2, AlertTriangle, Plus, X, Frame, Check } from 'lucide-react';

interface CompareItem {
  id: number;
  title: string;
  artist: string;
  date?: string;
  culture?: string;
  type?: string;
  medium?: string;
  department?: string;
  dimensions?: string;
  image: string | null;
  url?: string;
}
interface DiffRow { attribute: string; values: (string | null)[]; shared: boolean }
interface CompareResult {
  items: CompareItem[];
  diff: DiffRow[];
  yearSpan: number | null;
  sharedAttributes: string[];
}

export function ArtworkCompare() {
  const [ids, setIds] = useState<string[]>(['', '']);
  const [data, setData] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setId = (i: number, v: string) => setIds((arr) => arr.map((x, j) => (j === i ? v : x)));
  const addSlot = () => setIds((arr) => (arr.length < 4 ? [...arr, ''] : arr));
  const removeSlot = (i: number) => setIds((arr) => (arr.length > 2 ? arr.filter((_, j) => j !== i) : arr));

  const run = useCallback(async () => {
    const numeric = ids.map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (numeric.length < 2) { setError('Enter at least 2 valid CMA artwork ids.'); return; }
    setLoading(true); setError(null); setData(null);
    const r = await lensRun<CompareResult>('gallery', 'compare', { ids: numeric });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Comparison failed.');
    setLoading(false);
  }, [ids]);

  return (
    <div className="rounded-lg border border-sky-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-sky-500/10 pb-2">
        <Columns3 className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Compare artworks</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Side by side</span>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        {ids.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type="text" value={v} inputMode="numeric"
              onChange={(e) => setId(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
              className="w-32 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white font-mono"
              placeholder={`CMA id ${i + 1}`}
            />
            {ids.length > 2 && (
              <button type="button" onClick={() => removeSlot(i)} className="rounded bg-zinc-800 p-1 hover:bg-zinc-700" aria-label="Remove slot">
                <X className="w-3 h-3 text-zinc-400" />
              </button>
            )}
          </div>
        ))}
        {ids.length < 4 && (
          <button type="button" onClick={addSlot} className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-300 hover:border-zinc-600">
            <Plus className="w-3 h-3" /> slot
          </button>
        )}
        <button
          type="button" onClick={run} disabled={loading}
          className="rounded bg-sky-600/80 hover:bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Compare'}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {!data && !error && !loading && (
        <div className="py-6 text-center text-[12px] text-zinc-500 italic">No comparison yet. Enter 2–4 Cleveland Museum artwork ids.</div>
      )}

      {data && (
        <div className="space-y-3 overflow-x-auto">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${data.items.length}, minmax(140px, 1fr))` }}>
            {data.items.map((it) => (
              <div key={it.id} className="rounded border border-sky-500/20 bg-zinc-900/40 p-2">
                <div className="h-36 w-full rounded bg-zinc-950 overflow-hidden flex items-center justify-center">
                  {it.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host
                    <img src={it.image} alt={it.title} className="h-full w-full object-contain" />
                  ) : <Frame className="w-7 h-7 text-zinc-700" />}
                </div>
                <div className="mt-1.5 text-[11px] font-semibold text-zinc-100 line-clamp-2">{it.title}</div>
                <div className="text-[10px] text-zinc-500">{it.artist}{it.date ? ` · ${it.date}` : ''}</div>
              </div>
            ))}
          </div>

          <table className="w-full text-[11px]">
            <tbody>
              {data.diff.map((row) => (
                <tr key={row.attribute} className="border-t border-zinc-800">
                  <td className="py-1.5 pr-2 align-top">
                    <span className="flex items-center gap-1 capitalize text-zinc-400">
                      {row.shared && <Check className="w-3 h-3 text-emerald-400" />}
                      {row.attribute}
                    </span>
                  </td>
                  {row.values.map((val, i) => (
                    <td key={i} className={`py-1.5 px-2 align-top ${row.shared ? 'text-emerald-300' : 'text-zinc-200'}`}>
                      {val || <span className="text-zinc-600">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center gap-3 text-[10px] text-zinc-400">
            {data.yearSpan != null && <span>Year span: <span className="text-zinc-200 font-mono">{data.yearSpan} yr</span></span>}
            <span>Shared: <span className="text-emerald-300">{data.sharedAttributes.join(', ') || 'none'}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}
