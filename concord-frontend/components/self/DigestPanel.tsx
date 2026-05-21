'use client';

/**
 * DigestPanel — generated daily / weekly "your day" recap. Calls the
 * self.digest macro and renders the headline + per-metric stat lines
 * with delta indicators. No seed data: an empty ledger yields an
 * explicit "no data" headline from the backend.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, ScrollText, ArrowUp, ArrowDown, Minus } from 'lucide-react';

interface DigestStat {
  metric: string;
  label: string;
  unit: string;
  value: number;
  deltaPct: number | null;
}
interface DigestResult {
  range: 'daily' | 'weekly';
  generatedAt: string;
  headline: string;
  stats: DigestStat[];
  lines: string[];
  readingCount: number;
}

export function DigestPanel({ refreshKey }: { refreshKey: number }) {
  const [range, setRange] = useState<'daily' | 'weekly'>('daily');
  const [data, setData] = useState<DigestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await lensRun<DigestResult>('self', 'digest', { range });
      if (r.data?.ok && r.data.result) setData(r.data.result);
      else setData(null);
    } catch { setData(null); }
    finally { setBusy(false); }
  }, [range]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-rose-200">
          <ScrollText className="h-4 w-4 text-rose-500" aria-hidden /> Recap
        </h3>
        <div className="flex gap-1" role="group" aria-label="Digest range">
          {(['daily', 'weekly'] as const).map((rk) => (
            <button
              key={rk}
              onClick={() => setRange(rk)}
              className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                range === rk ? 'bg-rose-600 text-white' : 'border border-rose-900/40 text-rose-400 hover:text-rose-200'
              }`}
              aria-pressed={range === rk}
            >
              {rk}
            </button>
          ))}
        </div>
      </div>

      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
      ) : data ? (
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-4">
          <p className="text-sm font-medium text-rose-100">{data.headline}</p>
          {data.stats.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {data.stats.map((st) => {
                const D = st.deltaPct == null ? Minus : st.deltaPct > 0 ? ArrowUp : st.deltaPct < 0 ? ArrowDown : Minus;
                return (
                  <li key={st.metric} className="flex items-center justify-between text-xs">
                    <span className="text-rose-400">{st.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-rose-100">{st.value}{st.unit}</span>
                      {st.deltaPct != null && (
                        <span className={`flex items-center gap-0.5 font-mono ${
                          st.deltaPct > 0 ? 'text-emerald-400' : st.deltaPct < 0 ? 'text-amber-400' : 'text-rose-700'
                        }`}>
                          <D className="h-3 w-3" aria-hidden />
                          {Math.abs(st.deltaPct)}%
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className="mt-3 text-[10px] text-rose-800">
            Generated {new Date(data.generatedAt).toLocaleString()} · {data.readingCount} reading{data.readingCount === 1 ? '' : 's'}
          </p>
        </div>
      ) : (
        <p className="rounded border border-rose-900/30 bg-rose-950/10 px-4 py-8 text-center text-xs text-rose-600">
          No data yet.
        </p>
      )}
    </div>
  );
}
