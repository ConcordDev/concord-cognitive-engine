'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TrendingUp, Loader2, LineChart as LineChartIcon, Sparkles } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface BlsPoint { year: string; period: string; periodName: string; value: number; footnotes?: string[] }
interface BlsSeries { seriesId: string; catalog?: Record<string, unknown>; data: BlsPoint[] }
interface BlsResult { series: BlsSeries[]; seriesCount: number; startYear: string; endYear: string; authenticated: boolean; source: string }

// Shape of `temporal.forecast` (server/domains/temporal.js) — additive
// Holt-Winters / Holt double-exponential with an auto-tuned grid search.
// Input: { values: number[], horizon?: number, period?: number }.
// Success result (unwrapped): { n, horizon, method, parameters, period,
// predictions[], trend, accuracy, accuracyLabel }.
interface ForecastPrediction {
  step: number;
  forecast: number;
  lower95: number;
  upper95: number;
  lower80: number;
  upper80: number;
}
interface ForecastResult {
  n: number;
  horizon: number;
  method: 'holt-winters-additive' | 'holt-double-exponential';
  parameters: { alpha: number; beta: number; gamma: number | null };
  period: number | null;
  predictions: ForecastPrediction[];
  trend: { direction: 'increasing' | 'decreasing' | 'flat'; perPeriod: number; lastLevel: number };
  accuracy: { mse: number; rmse: number; mape: string };
  accuracyLabel: 'excellent' | 'good' | 'moderate' | 'poor';
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(domain: string, action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain(domain, action, { input });
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

// temporal.forecast rejects fewer than 4 points ("Need at least 4 data
// points.") — mirrored here only to skip a pointless round-trip; the honest
// message shown to the user still traces back to that real backend rule.
const MIN_FORECAST_POINTS = 4;

function monthFromPeriod(p: string): number {
  return /^M\d{2}$/.test(p) ? Number(p.slice(1)) : 6;
}
function isMonthlyPeriod(p: string): boolean {
  return /^M(0[1-9]|1[0-2])$/.test(p);
}
function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
function isoMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function BlsSeriesExplorer() {
  const [preset, setPreset] = useState(PRESETS[0]);
  const [data, setData] = useState<BlsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forecastOn, setForecastOn] = useState(false);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const chartHostRef = useRef<HTMLDivElement | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      const env = await callMacro<BlsResult>('hr', 'bls-series-lookup', { seriesId: preset.series });
      if (env.ok && env.result) setData(env.result);
      else { setData(null); setError(env.error || 'BLS unavailable'); }
    },
  });

  useEffect(() => {
    setForecastOn(false);
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.series]);

  const series = data?.series?.[0];
  const latest = series?.data?.[0];

  // Chronological ascending order — BLS API v2 returns newest-first.
  const sortedPoints = useMemo(() => {
    if (!series) return [];
    return [...series.data].sort((a, b) => Number(a.year) - Number(b.year) || monthFromPeriod(a.period) - monthFromPeriod(b.period));
  }, [series]);

  const forecastMutation = useMutation({
    mutationFn: async () => {
      setForecastError(null);
      setForecast(null);
      if (sortedPoints.length < MIN_FORECAST_POINTS) {
        setForecastError(`Not enough history to forecast — need at least ${MIN_FORECAST_POINTS} observations, have ${sortedPoints.length}.`);
        return;
      }
      // BLS monthly series (all six presets here) carry real annual
      // seasonality — pass period:12 so the engine runs seasonal
      // Holt-Winters instead of the plain trend model. Falls back to no
      // seasonality if the periods aren't clean calendar months.
      const monthly = sortedPoints.every((p) => isMonthlyPeriod(p.period));
      const env = await callMacro<ForecastResult>('temporal', 'forecast', {
        values: sortedPoints.map((p) => p.value),
        ...(monthly ? { period: 12 } : {}),
      });
      if (env.ok && env.result) {
        setForecast(env.result);
      } else {
        const msg = env.error || 'Forecast unavailable.';
        setForecastError(/at least/i.test(msg) ? `Not enough history to forecast — ${msg}` : msg);
      }
    },
  });

  useEffect(() => {
    if (!forecastOn) { setForecast(null); setForecastError(null); return; }
    if (sortedPoints.length === 0) return;
    forecastMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastOn, sortedPoints]);

  useEffect(() => {
    let chart: { remove: () => void } | null = null;
    let cancelled = false;
    if (!chartHostRef.current || sortedPoints.length === 0) return;
    (async () => {
      const lib = await import('lightweight-charts');
      if (cancelled || !chartHostRef.current) return;
      chartHostRef.current.innerHTML = '';
      const c = lib.createChart(chartHostRef.current, {
        height: 240, layout: { background: { color: '#09090b' } as never, textColor: '#a1a1aa' },
        grid: { vertLines: { color: '#1f1f23' }, horzLines: { color: '#1f1f23' } },
        rightPriceScale: { borderColor: '#27272a' }, timeScale: { borderColor: '#27272a' },
      });

      const historySeries = c.addSeries(lib.LineSeries, { color: '#22d3ee', lineWidth: 2 });
      historySeries.setData(sortedPoints.map((p) => ({
        time: isoMonth(Number(p.year), monthFromPeriod(p.period)),
        value: p.value,
      })));

      if (forecastOn && forecast && forecast.predictions.length > 0) {
        const lastPoint = sortedPoints[sortedPoints.length - 1];
        const lastYear = Number(lastPoint.year);
        const lastMonth = monthFromPeriod(lastPoint.period);
        const timeAtStep = (h: number) => {
          const { year, month } = addMonths(lastYear, lastMonth, h);
          return isoMonth(year, month);
        };
        // Anchor the forecast + band lines at the last real observation so
        // they read as a continuation of the actual series on the chart,
        // not a disconnected/fabricated-looking segment.
        const bridge = { time: isoMonth(lastYear, lastMonth), value: lastPoint.value };

        const forecastSeries = c.addSeries(lib.LineSeries, {
          color: '#fbbf24', lineWidth: 2, lineStyle: lib.LineStyle.Dashed,
          lastValueVisible: false, priceLineVisible: false,
        });
        forecastSeries.setData([bridge, ...forecast.predictions.map((p) => ({ time: timeAtStep(p.step), value: p.forecast }))]);

        const upperSeries = c.addSeries(lib.LineSeries, {
          color: 'rgba(251,191,36,0.4)', lineWidth: 1, lineStyle: lib.LineStyle.Dotted,
          lastValueVisible: false, priceLineVisible: false,
        });
        upperSeries.setData([bridge, ...forecast.predictions.map((p) => ({ time: timeAtStep(p.step), value: p.upper95 }))]);

        const lowerSeries = c.addSeries(lib.LineSeries, {
          color: 'rgba(251,191,36,0.4)', lineWidth: 1, lineStyle: lib.LineStyle.Dotted,
          lastValueVisible: false, priceLineVisible: false,
        });
        lowerSeries.setData([bridge, ...forecast.predictions.map((p) => ({ time: timeAtStep(p.step), value: p.lower95 }))]);
      }

      chart = c;
    })();
    return () => { cancelled = true; chart?.remove(); };
  }, [sortedPoints, forecastOn, forecast]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">BLS Labor Indicators</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">bls public api v2</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setForecastOn((v) => !v)}
            disabled={!data || sortedPoints.length === 0}
            aria-pressed={forecastOn}
            title="Overlay a Holt-Winters forecast (temporal.forecast) on this series"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              forecastOn ? 'bg-amber-500/20 text-amber-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            <Sparkles className="h-3 w-3" /> Forecast
          </button>
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
        </div>
      </header>

      <div className="flex flex-wrap gap-1 text-[10px]">
        {PRESETS.map((p) => (
          <button key={p.series} onClick={() => setPreset(p)} className={`rounded px-2 py-1 font-mono uppercase ${preset.series === p.series ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{p.label}</button>
        ))}
      </div>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {load.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling BLS series…</div>}

      {series && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">{preset.label}</h3>
              <p className="text-[11px] text-zinc-400">{preset.description} · series {series.seriesId}</p>
            </div>
            {latest && (
              <div className="text-right">
                <div className="font-mono text-2xl text-cyan-300">{latest.value.toLocaleString()}</div>
                <div className="text-[10px] text-zinc-400">{latest.periodName} {latest.year}</div>
              </div>
            )}
          </div>
          <div ref={chartHostRef} className="mt-3 w-full" />
          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400">
            <span><LineChartIcon className="mr-1 inline h-3 w-3" />{series.data.length} observations</span>
            <span>{data?.startYear}–{data?.endYear}{data?.authenticated ? ' · keyed' : ' · public'}</span>
          </div>

          {forecastOn && (
            <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px]">
              {forecastMutation.isPending && (
                <span className="flex items-center gap-2 text-amber-200">
                  <Loader2 className="h-3 w-3 animate-spin" /> Forecasting…
                </span>
              )}
              {!forecastMutation.isPending && forecastError && (
                <span className="text-amber-300">{forecastError}</span>
              )}
              {!forecastMutation.isPending && !forecastError && forecast && (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="text-amber-200">
                    <span className="mr-2 inline-block h-0 w-3 border-t-2 border-dashed border-amber-400 align-middle" aria-hidden="true" />
                    {forecast.horizon}-period {forecast.method === 'holt-winters-additive' ? 'seasonal Holt-Winters' : 'Holt double-exponential'} forecast · trend {forecast.trend.direction}
                  </span>
                  <span className={
                    forecast.accuracyLabel === 'excellent' || forecast.accuracyLabel === 'good'
                      ? 'text-emerald-300'
                      : forecast.accuracyLabel === 'moderate' ? 'text-amber-300' : 'text-red-300'
                  }>
                    MAPE {forecast.accuracy.mape} ({forecast.accuracyLabel} fit) · 95% band shown
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
