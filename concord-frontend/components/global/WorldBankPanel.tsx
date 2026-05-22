'use client';

/**
 * WorldBankPanel — real World Bank country indicator time series,
 * drop-in for global + finance lenses. No API key.
 *
 * Phase 4 (sixth wave) of the UX completeness sprint.
 */

import { useState, useEffect, useCallback } from 'react';
import { LineChart, RefreshCw, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Point {
  year: number;
  value: number | null;
  country?: string;
  indicator?: string;
}

interface TimeseriesResult {
  points: Point[];
  indicatorName?: string;
}

const POPULAR_INDICATORS = [
  { code: 'NY.GDP.MKTP.CD',     label: 'GDP (US$)' },
  { code: 'SP.POP.TOTL',         label: 'Population' },
  { code: 'SP.DYN.LE00.IN',      label: 'Life expectancy' },
  { code: 'SE.ADT.LITR.ZS',      label: 'Literacy rate' },
  { code: 'IT.NET.USER.ZS',      label: 'Internet users %' },
  { code: 'EG.USE.ELEC.KH.PC',   label: 'Electric power kWh/cap' },
  { code: 'SL.UEM.TOTL.ZS',      label: 'Unemployment %' },
  { code: 'FP.CPI.TOTL.ZG',      label: 'Inflation %' },
];

const POPULAR_COUNTRIES = ['US', 'GB', 'CN', 'IN', 'DE', 'FR', 'JP', 'BR', 'CA', 'AU'];

function formatValue(v: number | null, indicator: string): string {
  if (v == null) return '—';
  if (indicator.includes('GDP') || indicator === 'NY.GDP.MKTP.CD') {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    return `$${v.toLocaleString()}`;
  }
  if (indicator === 'SP.POP.TOTL') {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    return v.toLocaleString();
  }
  if (indicator.endsWith('.ZS') || indicator.endsWith('.ZG')) return `${v.toFixed(2)}%`;
  if (v >= 1000) return v.toLocaleString();
  return v.toFixed(2);
}

export interface WorldBankPanelProps {
  domain: 'global' | 'finance';
  className?: string;
}

export function WorldBankPanel({ domain, className }: WorldBankPanelProps) {
  const [country, setCountry] = useState('US');
  const [indicator, setIndicator] = useState('NY.GDP.MKTP.CD');
  const [points, setPoints] = useState<Point[]>([]);
  const [indicatorName, setIndicatorName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (c: string, i: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<TimeseriesResult>(domain, 'indicatorTimeseries', {
        country: c, indicator: i, yearsBack: 15,
      });
      if (r.data.ok && r.data.result) {
        setPoints(r.data.result.points || []);
        setIndicatorName(r.data.result.indicatorName || null);
      } else {
        setPoints([]);
        setError(r.data.error || 'fetch_failed');
      }
    } catch (e) {
      setPoints([]);
      setError(e instanceof Error ? e.message : 'fetch_failed');
    }
    setLoading(false);
  }, [domain]);

  useEffect(() => { void fetchData(country, indicator); }, [fetchData, country, indicator]);

  // Compute spark stats.
  const validPoints = points.filter(p => p.value != null);
  const latest = validPoints[validPoints.length - 1];
  const earliest = validPoints[0];
  const min = validPoints.length > 0 ? Math.min(...validPoints.map(p => p.value as number)) : 0;
  const max = validPoints.length > 0 ? Math.max(...validPoints.map(p => p.value as number)) : 1;
  const range = max - min || 1;

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <LineChart className="w-4 h-4 text-emerald-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">World Bank · {indicatorName || indicator}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(country, indicator)}
          disabled={loading}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 flex gap-2 flex-wrap">
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
        >
          {POPULAR_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={indicator}
          onChange={(e) => setIndicator(e.target.value)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 flex-1 min-w-0"
        >
          {POPULAR_INDICATORS.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
        </select>
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> World Bank unreachable ({error})
        </div>
      )}

      {!error && validPoints.length === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
          No data for that country + indicator.
        </div>
      )}

      {validPoints.length > 0 && (
        <>
          <div className="px-3 py-3 flex items-baseline justify-between">
            <div>
              <div className="text-2xl font-bold text-zinc-100 tabular-nums">
                {formatValue(latest?.value ?? null, indicator)}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono">{latest?.year}</div>
            </div>
            {earliest && earliest.year !== latest?.year && (
              <div className="text-right">
                <div className="text-xs text-zinc-400 tabular-nums">
                  was {formatValue(earliest.value, indicator)}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono">{earliest.year}</div>
              </div>
            )}
          </div>
          {/* Spark line */}
          <div className="px-3 pb-3">
            <svg viewBox={`0 0 ${validPoints.length * 10} 40`} className="w-full h-16" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="#34d399"
                strokeWidth={1.5}
                points={validPoints.map((p, i) => `${i * 10},${40 - ((p.value as number) - min) / range * 36 - 2}`).join(' ')}
              />
            </svg>
            <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-1">
              <span>{validPoints[0]?.year}</span>
              <span>{validPoints[validPoints.length - 1]?.year}</span>
            </div>
          </div>
        </>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: World Bank Open Data · api.worldbank.org/v2
      </footer>
    </section>
  );
}

export default WorldBankPanel;
