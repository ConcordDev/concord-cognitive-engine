'use client';

/**
 * FredSeriesPanel — FRED economic time series (GDP, CPI, unemployment,
 * fed funds rate, ...). REAL_FREE; requires FRED_API_KEY env var.
 *
 * Phase 11 (Item 9). Empty/missing-key/error states are honest — no
 * fake placeholder data.
 */

import { useState, useEffect, useCallback } from 'react';
import { LineChart, RefreshCw, AlertTriangle, KeyRound, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Observation { date: string; value: number | null; }
interface FredResponse {
  ok: boolean;
  source?: string;
  fetchedAt?: number;
  seriesId?: string;
  observations?: Observation[];
  reason?: string;
  envVar?: string;
  signupUrl?: string;
  message?: string;
  error?: string;
}

const POPULAR_SERIES = [
  { id: 'GDP',         label: 'US Real GDP' },
  { id: 'CPIAUCSL',    label: 'CPI (All items)' },
  { id: 'UNRATE',      label: 'Unemployment rate' },
  { id: 'FEDFUNDS',    label: 'Federal funds rate' },
  { id: 'DGS10',       label: '10-year Treasury' },
  { id: 'M2SL',        label: 'M2 money supply' },
  { id: 'PAYEMS',      label: 'Nonfarm payrolls' },
];

async function runMacro(domain: string, name: string, input: Record<string, unknown>) {
  try { const r = await lensRun({ domain, name, input }); return r?.data as FredResponse | null; }
  catch { return null; }
}

export interface FredSeriesPanelProps { className?: string; }

export function FredSeriesPanel({ className }: FredSeriesPanelProps) {
  const [seriesId, setSeriesId] = useState('GDP');
  const [data, setData] = useState<FredResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (id: string) => {
    setLoading(true);
    const r = await runMacro('finance', 'live_fred_series', { series_id: id, limit: 24, sort_order: 'asc' });
    setData(r);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(seriesId); }, [fetchData, seriesId]);

  const valid = (data?.observations || []).filter(o => o.value != null) as { date: string; value: number }[];
  const latest = valid[valid.length - 1];
  const earliest = valid[0];
  const min = valid.length ? Math.min(...valid.map(p => p.value)) : 0;
  const max = valid.length ? Math.max(...valid.map(p => p.value)) : 1;
  const range = max - min || 1;

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <LineChart className="w-4 h-4 text-emerald-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">FRED · {POPULAR_SERIES.find(s => s.id === seriesId)?.label || seriesId}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button type="button" onClick={() => void fetchData(seriesId)} disabled={loading} className="p-1 text-zinc-500 hover:text-zinc-200" aria-label="Refresh">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40">
        <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 w-full">
          {POPULAR_SERIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {data && !data.ok && data.reason === 'missing_api_key' && (
        <div className="px-3 py-4 text-xs space-y-2 bg-amber-500/5 border-y border-amber-500/20">
          <div className="flex items-center gap-1.5 text-amber-300">
            <KeyRound className="w-3.5 h-3.5" /> <span className="font-medium">API key required</span>
          </div>
          <p className="text-zinc-300">Set <code className="text-amber-300 bg-zinc-900 px-1 rounded">{data.envVar}</code> in <code className="text-zinc-300 bg-zinc-900 px-1 rounded">.env</code> to enable real FRED data.</p>
          {data.signupUrl && (
            <a href={data.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200">
              <ExternalLink className="w-3 h-3" /> Free signup
            </a>
          )}
        </div>
      )}

      {data && !data.ok && data.reason !== 'missing_api_key' && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> FRED unreachable ({data.reason || 'unknown'})
        </div>
      )}

      {data?.ok && valid.length === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No data for that series.</div>
      )}

      {data?.ok && valid.length > 0 && (
        <>
          <div className="px-3 py-3 flex items-baseline justify-between">
            <div>
              <div className="text-2xl font-bold text-zinc-100 tabular-nums">{latest.value.toLocaleString()}</div>
              <div className="text-[10px] text-zinc-500 font-mono">{latest.date}</div>
            </div>
            {earliest && earliest.date !== latest.date && (
              <div className="text-right">
                <div className="text-xs text-zinc-400 tabular-nums">was {earliest.value.toLocaleString()}</div>
                <div className="text-[10px] text-zinc-500 font-mono">{earliest.date}</div>
              </div>
            )}
          </div>
          <div className="px-3 pb-3">
            <svg viewBox={`0 0 ${valid.length * 10} 40`} className="w-full h-16" preserveAspectRatio="none">
              <polyline fill="none" stroke="#34d399" strokeWidth={1.5}
                points={valid.map((p, i) => `${i * 10},${40 - (p.value - min) / range * 36 - 2}`).join(' ')} />
            </svg>
            <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-1">
              <span>{valid[0].date}</span>
              <span>{valid[valid.length - 1].date}</span>
            </div>
          </div>
        </>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Federal Reserve Bank of St. Louis · fred.stlouisfed.org
      </footer>
    </section>
  );
}

export default FredSeriesPanel;
