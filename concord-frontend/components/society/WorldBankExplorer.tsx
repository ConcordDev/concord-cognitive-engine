'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Globe2, Loader2, BarChart3, LineChart as LineChartIcon } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface SeriesPoint { year: number; value: number; countryName?: string }
interface IndicatorResult { country: string; indicator: string; alias: string | null; countryName?: string; series: SeriesPoint[]; latest: SeriesPoint | null; count: number; source: string }
interface ComparePoint { country: string; countryName?: string; year: number; value: number }
interface CompareResult { indicator: string; countries: string[]; points: ComparePoint[]; count: number; source: string }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('society', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const POPULAR_COUNTRIES: { code: string; name: string }[] = [
  { code: 'USA', name: 'United States' }, { code: 'CHN', name: 'China' }, { code: 'IND', name: 'India' },
  { code: 'JPN', name: 'Japan' }, { code: 'DEU', name: 'Germany' }, { code: 'GBR', name: 'United Kingdom' },
  { code: 'FRA', name: 'France' }, { code: 'BRA', name: 'Brazil' }, { code: 'KOR', name: 'Korea, Rep.' },
  { code: 'MEX', name: 'Mexico' }, { code: 'CAN', name: 'Canada' }, { code: 'NGA', name: 'Nigeria' },
];

export function WorldBankExplorer() {
  const [country, setCountry] = useState('USA');
  const [indicator, setIndicator] = useState('gdp');
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [data, setData] = useState<IndicatorResult | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareCountries, setCompareCountries] = useState<string[]>(['USA', 'CHN', 'DEU', 'JPN']);
  const chartHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const env = await callMacro<{ indicators: Record<string, string> }>('wb-common-indicators', {});
      if (env.ok && env.result) setAliases(env.result.indicators);
    })();
  }, []);

  const lookup = useMutation({
    mutationFn: async () => {
      const env = await callMacro<IndicatorResult>('wb-indicator', { country, indicator });
      if (env.ok && env.result) { setData(env.result); setError(null); } else { setData(null); setError(env.error || 'lookup failed'); }
    },
  });

  const runCompare = useMutation({
    mutationFn: async () => {
      const env = await callMacro<CompareResult>('wb-compare', { countries: compareCountries, indicator });
      if (env.ok && env.result) { setCompare(env.result); setError(null); } else { setCompare(null); setError(env.error || 'compare failed'); }
    },
  });

  useEffect(() => {
    let chart: { remove: () => void } | null = null;
    let cancelled = false;
    if (!data || !chartHostRef.current || data.series.length === 0) return;
    (async () => {
      const lib = await import('lightweight-charts');
      if (cancelled || !chartHostRef.current) return;
      chartHostRef.current.innerHTML = '';
      const c = lib.createChart(chartHostRef.current, {
        height: 220, layout: { background: { color: '#09090b' } as never, textColor: '#a1a1aa' },
        grid: { vertLines: { color: '#1f1f23' }, horzLines: { color: '#1f1f23' } },
        rightPriceScale: { borderColor: '#27272a' }, timeScale: { borderColor: '#27272a' },
      });
      const series = (c as unknown as { addLineSeries: (o?: unknown) => { setData: (d: unknown[]) => void } }).addLineSeries({ color: '#22d3ee', lineWidth: 2 });
      const sorted = [...data.series].sort((a, b) => a.year - b.year);
      series.setData(sorted.map((p) => ({ time: `${p.year}-01-01`, value: p.value })));
      chart = c as unknown as { remove: () => void };
    })();
    return () => { cancelled = true; chart?.remove(); };
  }, [data]);

  const aliasEntries = useMemo(() => Object.keys(aliases).sort().slice(0, 24), [aliases]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Globe2 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">World Bank Indicators</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">data.worldbank.org · open</span>
        </div>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); lookup.mutate(); }} className="flex flex-wrap items-center gap-2">
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white">
          {POPULAR_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
        </select>
        <input type="text" value={indicator} onChange={(e) => setIndicator(e.target.value)} placeholder="indicator (e.g. gdp, population, life-expectancy)" className="flex-1 min-w-[200px] rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" list="wb-aliases" />
        <datalist id="wb-aliases">
          {Object.keys(aliases).map((k) => <option key={k} value={k}>{aliases[k]}</option>)}
        </datalist>
        <button type="submit" disabled={lookup.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {lookup.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LineChartIcon className="h-3.5 w-3.5" />}
          Lookup
        </button>
      </form>

      {aliasEntries.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[10px]">
          {aliasEntries.map((k) => (
            <button key={k} onClick={() => setIndicator(k)} className={`rounded px-1.5 py-0.5 font-mono ${indicator === k ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{k}</button>
          ))}
        </div>
      )}

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}

      {data && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">{data.countryName || data.country} — {data.alias || data.indicator}</h3>
              {data.latest && <p className="font-mono text-xs text-cyan-300">latest: {data.latest.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({data.latest.year}) · {data.count} pts</p>}
            </div>
            <SaveAsDtuButton
              compact
              apiSource="world-bank"
              apiUrl="https://data.worldbank.org/"
              title={`World Bank — ${data.countryName || data.country} ${data.alias || data.indicator}`}
              content={`${data.countryName || data.country} · ${data.alias || data.indicator}\n${data.series.slice(0, 20).map((p) => `  ${p.year}: ${p.value}`).join('\n')}`}
              extraTags={['society', 'world-bank', data.country.toLowerCase(), (data.alias || data.indicator).toLowerCase()]}
              rawData={data}
            />
          </div>
          <div ref={chartHostRef} className="mt-3 w-full" />
        </div>
      )}

      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs font-semibold text-zinc-200">
            <BarChart3 className="h-3.5 w-3.5 text-cyan-400" /> Cross-country compare
          </div>
          <button onClick={() => runCompare.mutate()} disabled={runCompare.isPending || compareCountries.length < 2} className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
            {runCompare.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />} Compare {compareCountries.length}
          </button>
        </div>
        <div className="mb-2 flex flex-wrap gap-1 text-[10px]">
          {POPULAR_COUNTRIES.map((c) => {
            const on = compareCountries.includes(c.code);
            return (
              <button key={c.code} onClick={() => setCompareCountries((prev) => on ? prev.filter((x) => x !== c.code) : prev.concat(c.code))} className={`rounded px-1.5 py-0.5 font-mono ${on ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{c.code}</button>
            );
          })}
        </div>
        {compare && compare.points.length > 0 && (() => {
          const max = Math.max(...compare.points.map((p) => p.value || 0));
          return (
            <div className="space-y-1">
              {compare.points.map((p) => (
                <div key={p.country} className="flex items-center gap-2 text-[11px]">
                  <span className="w-12 font-mono text-zinc-400">{p.country}</span>
                  <div className="flex-1 rounded-full bg-zinc-800">
                    <div className="h-3 rounded-full bg-cyan-500/60" style={{ width: `${Math.max(2, (p.value / max) * 100)}%` }} />
                  </div>
                  <span className="w-32 text-right font-mono text-cyan-300">{p.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                  <span className="w-12 text-right text-zinc-400">{p.year}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
