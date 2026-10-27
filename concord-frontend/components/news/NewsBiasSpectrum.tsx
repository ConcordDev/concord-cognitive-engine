'use client';

/**
 * NewsBiasSpectrum — Ground News-shape side-by-side comparison of the same
 * story across left / center / right sources. All data comes from the
 * `news.bias-spectrum` macro; nothing is hardcoded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Scale, AlertTriangle, Search } from 'lucide-react';

import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SpectrumArticle {
  id: string;
  title: string;
  source: string;
  summary: string | null;
  url: string | null;
  publishedAt: string;
  biasLean: 'left' | 'center' | 'right' | null;
  biasScore: number | null;
  biasReason?: string | null;
}

interface SpectrumResult {
  topic?: string;
  columns: {
    left: SpectrumArticle[];
    center: SpectrumArticle[];
    right: SpectrumArticle[];
    unscored?: SpectrumArticle[];
  };
  count?: number;
  unscored?: number;
  coverage?: { left: number | null; center: number | null; right: number | null; reason?: string | null };
  blindspot: 'left' | 'center' | 'right' | null;
}

type ColumnKey = 'left' | 'center' | 'right' | 'unscored';

const COLUMN_STYLE: Record<ColumnKey, { label: string; bar: string; chip: string }> = {
  left: { label: 'Left', bar: 'bg-blue-500', chip: 'text-blue-300 border-blue-500/40 bg-blue-500/10' },
  center: { label: 'Center', bar: 'bg-zinc-400', chip: 'text-zinc-300 border-zinc-500/40 bg-zinc-500/10' },
  right: { label: 'Right', bar: 'bg-red-500', chip: 'text-red-300 border-red-500/40 bg-red-500/10' },
  unscored: { label: 'Unscored', bar: 'bg-zinc-600', chip: 'text-zinc-400 border-zinc-600/40 bg-zinc-600/10' },
};

function pctLabel(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v}%` : '—';
}

export function NewsBiasSpectrum() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SpectrumResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (q: string) => {
    setLoading(true);
    const r = await lensRun('news', 'bias-spectrum', q.trim() ? { query: q.trim() } : {});
    if (r.data?.ok) setResult(r.data.result as SpectrumResult);
    else setResult(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(''); }, [refresh]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-amber-600/15 to-transparent">
        <Scale className="w-5 h-5 text-amber-400" />
        <h2 className="text-sm font-bold text-zinc-100">Bias Spectrum</h2>
        <span className="text-[11px] text-zinc-400">Same story, left / center / right</span>
      </header>

      <div className="p-3 border-b border-zinc-800">
        <form
          className="relative"
          onSubmit={(e) => { e.preventDefault(); void refresh(query); }}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter the spectrum by a story keyword…"
            className="input-lattice w-full pl-10 text-sm"
          />
        </form>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !result || ((result.count ?? (
            (result.columns?.left?.length ?? 0)
            + (result.columns?.center?.length ?? 0)
            + (result.columns?.right?.length ?? 0)
            + (result.columns?.unscored?.length ?? 0)
          )) === 0) ? (
        <div className="px-4 py-10 text-center text-zinc-400 text-sm italic">
          No data yet — add articles in the news directory to compare coverage.
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Coverage bar. Null percents are unscored articles, not 0%. */}
          <div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-800">
              {(['left', 'center', 'right'] as const).map((k) => {
                const pct = result.coverage?.[k];
                return typeof pct === 'number' && pct > 0 ? (
                  <div
                    key={k}
                    className={cn(COLUMN_STYLE[k].bar)}
                    style={{ width: `${pct}%` }}
                    title={`${COLUMN_STYLE[k].label}: ${pct}%`}
                  />
                ) : null;
              })}
            </div>
            <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
              <span>{pctLabel(result.coverage?.left)} Left</span>
              <span>{pctLabel(result.coverage?.center)} Center</span>
              <span>{pctLabel(result.coverage?.right)} Right</span>
            </div>
            {result.coverage?.reason && (
              <p className="text-[10px] text-zinc-500 mt-1">{result.coverage.reason}</p>
            )}
          </div>

          {result.blindspot && (
            <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Blindspot detected — no coverage from{' '}
              <span className="font-semibold capitalize">{result.blindspot}</span>-leaning sources.
            </div>
          )}

          <div className={cn('grid grid-cols-1 gap-3', (result.columns.unscored?.length ?? 0) > 0 ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
            {((result.columns.unscored?.length ?? 0) > 0
              ? (['left', 'center', 'right', 'unscored'] as const)
              : (['left', 'center', 'right'] as const)
            ).map((col) => {
              const style = COLUMN_STYLE[col];
              const items = result.columns[col] ?? [];
              return (
                <section key={col} className="min-w-0">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-300 mb-2">
                    <span className={cn('w-2.5 h-2.5 rounded-full', style.bar)} />
                    {style.label}
                    <span className="text-zinc-600">· {items.length}</span>
                  </h3>
                  {items.length === 0 ? (
                    <p className="text-[11px] text-zinc-400 italic border border-dashed border-zinc-800 rounded-lg py-4 text-center">
                      No {style.label.toLowerCase()} coverage
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {items.map((a) => (
                        <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5">
                          <p className="text-xs font-semibold text-zinc-100 line-clamp-2">{a.title}</p>
                          <p className="text-[10px] text-zinc-400 mt-1">
                            {a.source} · {String(a.publishedAt).slice(0, 10)}
                          </p>
                          {a.summary && (
                            <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{a.summary}</p>
                          )}
                          <span className={cn('inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded border', style.chip)}>
                            {typeof a.biasScore === 'number' && Number.isFinite(a.biasScore)
                              ? `lean ${a.biasScore > 0 ? '+' : ''}${a.biasScore}`
                              : `unscored${a.biasReason ? ` · ${a.biasReason}` : ''}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
