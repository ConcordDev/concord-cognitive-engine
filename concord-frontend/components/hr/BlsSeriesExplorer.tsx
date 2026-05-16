'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TrendingUp, Loader2, LineChart as LineChartIcon } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface BlsPoint { year: string; period: string; periodName: string; value: number; footnotes?: string[] }
interface BlsSeries { seriesId: string; catalog?: Record<string, unknown>; data: BlsPoint[] }
interface BlsResult { series: BlsSeries[]; seriesCount: number; startYear: string; endYear: string; authenticated: boolean; source: string }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('hr', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const PRESETS: { label: string; series: string; description: string }[] = [
  { label: 'Unemployment rate (U-3)', series: 'LNS14000000', description: 'Civilian unemployment, 16+, seasonally adjusted' },
  { label: 'Labor force participation', series: 'LNS11300000', description: '16+ labor force participation rate' },
  { label: 'Nonfarm payrolls (total)', series: 'CES0000000001', description: 'All-employee total, monthly, thousands' },
  { label: 'Avg hourly earnings — private', series: 'CES0500000003', description: 'Private sector avg hourly earnings, USD' },
  { label: 'CPI-U (all items)', series: 'CUUR0000SA0', description: 'Consumer Price Index for all urban consumers' },
  { label: 'Job openings (JOLTS)', series: 'JTS000000000000000JOL', description: 'Total nonfarm job openings, thousands' },
];

export function BlsSeriesExplorer() {
  const [preset, setPreset] = useState(PRESETS[0]);
  const [data, setData] = useState<BlsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chartHostRef = useRef<HTMLDivElement | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      const env = await callMacro<BlsResult>('bls-series-lookup', { seriesId: preset.series });
      if (env.ok && env.result) setData(env.result);
      else { setData(null); setError(env.error || 'BLS unavailable'); }
    },
  });

  useEffect(() => {
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.series]);

  useEffect(() => {
    let chart: { remove: () => void } | null = null;
    let cancelled = false;
    const series = data?.series?.[0];
    if (!series || !chartHostRef.current || series.data.length === 0) return;
    (async () => {
      const lib = await import('lightweight-charts');
      if (cancelled || !chartHostRef.current) return;
      chartHostRef.current.innerHTML = '';
      const c = lib.createChart(chartHostRef.current, {
        height: 240, layout: { background: { color: '#09090b' } as never, textColor: '#a1a1aa' },
        grid: { vertLines: { color: '#1f1f23' }, horzLines: { color: '#1f1f23' } },
        rightPriceScale: { borderColor: '#27272a' }, timeScale: { borderColor: '#27272a' },
      });
      const lineSeries = (c as unknown as { addLineSeries: (o?: unknown) => { setData: (d: unknown[]) => void } }).addLineSeries({ color: '#22d3ee', lineWidth: 2 });
      const monthFromPeriod = (p: string) => /^M\d{2}$/.test(p) ? Number(p.slice(1)) : 6;
      const sorted = [...series.data].sort((a, b) => Number(a.year) - Number(b.year) || monthFromPeriod(a.period) - monthFromPeriod(b.period));
      lineSeries.setData(sorted.map((p) => ({
        time: `${p.year}-${String(monthFromPeriod(p.period)).padStart(2, '0')}-01`,
        value: p.value,
      })));
      chart = c as unknown as { remove: () => void };
    })();
    return () => { cancelled = true; chart?.remove(); };
  }, [data]);

  const series = data?.series?.[0];
  const latest = series?.data?.[0];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">BLS Labor Indicators</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">bls public api v2</span>
        </div>
        {data && (
          <SaveAsDtuButton
            compact
            apiSource="bls"
            apiUrl={`https://data.bls.gov/cgi-bin/surveymost?ln=${preset.series}`}
            title={`${preset.label} — BLS ${preset.series}`}
            content={`${preset.label} (${preset.series})\n${preset.description}\n\nLatest: ${latest ? `${latest.value} (${latest.periodName} ${latest.year})` : '—'}\nWindow: ${data.startYear}–${data.endYear}\n\n${series?.data?.slice(0, 20).map((p) => `  ${p.year} ${p.periodName}: ${p.value}`).join('\n') || ''}`}
            extraTags={['hr', 'bls', preset.series.toLowerCase()]}
            rawData={data}
          />
        )}
      </header>

      <div className="flex flex-wrap gap-1 text-[10px]">
        {PRESETS.map((p) => (
          <button key={p.series} onClick={() => setPreset(p)} className={`rounded px-2 py-1 font-mono uppercase ${preset.series === p.series ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{p.label}</button>
        ))}
      </div>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {load.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling BLS series…</div>}

      {series && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">{preset.label}</h3>
              <p className="text-[11px] text-zinc-500">{preset.description} · series {series.seriesId}</p>
            </div>
            {latest && (
              <div className="text-right">
                <div className="font-mono text-2xl text-cyan-300">{latest.value.toLocaleString()}</div>
                <div className="text-[10px] text-zinc-500">{latest.periodName} {latest.year}</div>
              </div>
            )}
          </div>
          <div ref={chartHostRef} className="mt-3 w-full" />
          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
            <span><LineChartIcon className="mr-1 inline h-3 w-3" />{series.data.length} observations</span>
            <span>{data?.startYear}–{data?.endYear}{data?.authenticated ? ' · keyed' : ' · public'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
