'use client';

/**
 * VisualSearch — color / style / keyword search across artworks.
 * Backs gallery `visual-search` + `visual-search-styles` macros, which
 * translate a hex colour and/or a style keyword into CMA Open Access
 * filter parameters.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Palette, Loader2, AlertTriangle, Frame } from 'lucide-react';

interface VisualWork {
  id: number;
  title: string;
  artist: string;
  date?: string;
  image: string | null;
  type?: string;
  medium?: string;
  department?: string;
  url?: string;
}

const SWATCHES = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#2c3e50', '#ecf0f1'];

export function VisualSearch() {
  const [styles, setStyles] = useState<string[]>([]);
  const [style, setStyle] = useState('');
  const [color, setColor] = useState('');
  const [query, setQuery] = useState('');
  const [works, setWorks] = useState<VisualWork[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await lensRun<{ styles: string[] }>('gallery', 'visual-search-styles', {});
      if (r.data?.ok && r.data.result?.styles) setStyles(r.data.result.styles);
    })();
  }, []);

  const run = useCallback(async () => {
    if (!style && !color && !query.trim()) { setError('Pick a colour, a style, or type a keyword.'); return; }
    setLoading(true); setError(null); setSearched(true);
    const r = await lensRun<{ works: VisualWork[] }>('gallery', 'visual-search', {
      style: style || undefined,
      color: color || undefined,
      query: query.trim() || undefined,
      limit: 24,
    });
    if (r.data?.ok && r.data.result) {
      setWorks(r.data.result.works || []);
    } else {
      setError(r.data?.error || 'Visual search failed.');
      setWorks([]);
    }
    setLoading(false);
  }, [style, color, query]);

  return (
    <div className="rounded-lg border border-violet-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Palette className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Visual search</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Colour · Style</span>
      </header>

      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">Colour</span>
          {SWATCHES.map((c) => (
            <button
              key={c} type="button"
              onClick={() => setColor((prev) => (prev === c ? '' : c))}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-zinc-700'} transition-transform`}
              style={{ backgroundColor: c }}
              aria-label={`Search colour ${c}`}
            />
          ))}
          <input
            type="color" value={color || '#888888'}
            onChange={(e) => setColor(e.target.value)}
            className="h-6 w-8 rounded border border-zinc-700 bg-transparent p-0"
            aria-label="Custom colour"
          />
          {color && <span className="font-mono text-[10px] text-zinc-400">{color}</span>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">Style</span>
          {styles.map((s) => (
            <button
              key={s} type="button"
              onClick={() => setStyle((prev) => (prev === s ? '' : s))}
              className={`rounded px-2 py-0.5 text-[10px] capitalize border ${style === s ? 'border-violet-400 bg-violet-500/20 text-violet-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'}`}
            >
              {s.replace(/-/g, ' ')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white"
            placeholder="Optional keyword (subject, theme)"
          />
          <button
            type="button" onClick={run} disabled={loading}
            className="rounded bg-violet-600/80 hover:bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {searched && !loading && !error && works.length === 0 && (
        <div className="py-6 text-center text-[12px] text-zinc-400 italic">No matching artworks yet. Try a different colour or style.</div>
      )}

      {works.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-96 overflow-y-auto">
          {works.map((w) => (
            <a
              key={w.id} href={w.url || '#'} target="_blank" rel="noopener noreferrer"
              className="rounded border border-zinc-800 bg-zinc-900/40 p-1.5 hover:border-violet-400/50 transition-colors"
            >
              {w.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host
                <img src={w.image} alt={w.title} className="w-full h-28 object-cover rounded" />
              ) : (
                <div className="w-full h-28 bg-zinc-950 rounded flex items-center justify-center"><Frame className="w-6 h-6 text-zinc-700" /></div>
              )}
              <div className="text-[10px] text-zinc-200 mt-1 line-clamp-2">{w.title}</div>
              <div className="text-[9px] text-zinc-400">{w.artist}{w.date ? ` · ${w.date}` : ''}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
