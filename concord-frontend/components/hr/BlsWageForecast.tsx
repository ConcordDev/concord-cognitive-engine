'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TrendingUp, Loader2, WifiOff, AlertTriangle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

/**
 * BlsWageForecast — the decision-oriented surface for hr.laborForecast, the
 * single backend macro that ASSEMBLES the real BLS connector
 * (hr.bls-series-lookup) with the real Holt-Winters engine (temporal.forecast)
 * server-side. Pick a real labor/wage indicator + a forecast horizon; the
 * server pulls the genuine BLS series and runs seasonal triple-exponential
 * smoothing, returning the projection + the 80/95% confidence intervals the
 * math actually produces. No fabricated data: when the deploy box has no
 * outbound egress the macro returns { ok:false, reason:'no_egress' } and this
 * panel says so plainly rather than inventing a series.
 */

// Mirror of the backend LABOR_SERIES catalog (server/domains/hr.js). Friendly
// key → the human label; the key is what the macro resolves to a real BLS id.
const SERIES_OPTIONS: { key: string; label: string }[] = [
  { key: 'avg-hourly-earnings', label: 'Avg hourly earnings — total private (USD/hr)' },
  { key: 'unemployment-rate', label: 'Unemployment rate — U-3 (%)' },
  { key: 'labor-force-participation', label: 'Labor force participation rate (%)' },
  { key: 'nonfarm-payrolls', label: 'Total nonfarm payrolls (thousands)' },
  { key: 'job-openings', label: 'Job openings — JOLTS (thousands)' },
  { key: 'cpi-all-items', label: 'CPI-U — all items (index)' },
];

interface ForecastPrediction {
  step: number;
  forecast: number;
  lower95: number;
  upper95: number;
  lower80: number;
  upper80: number;
}
interface LaborForecast {
  seriesId: string;
  seriesLabel: string;
  unit: string | null;
  granularity: 'monthly' | 'quarterly' | 'annual';
  seasonal: boolean;
  observations: number;
  window: { startYear: string; endYear: string };
  latest: { value: number; period: string; year: string } | null;
  method: 'holt-winters-additive' | 'holt-double-exponential';
  parameters: { alpha: number; beta: number; gamma: number | null };
  horizon: number;
  forecast: ForecastPrediction[];
  trend: { direction: 'increasing' | 'decreasing' | 'flat'; perPeriod: number; lastLevel: number };
  accuracy: { mse: number; rmse: number; mape: string };
  accuracyLabel: 'excellent' | 'good' | 'moderate' | 'poor';
}

// The macro's honest-failure envelope.
interface FailResult { ok: false; reason?: string; error?: string; detail?: string; have?: number; need?: number }
type MacroEnv =
  | { ok: true; result: LaborForecast }
  | { ok: false; reason?: string; error?: string; detail?: string; have?: number; need?: number };

async function runLaborForecast(input: Record<string, unknown>): Promise<MacroEnv> {
  const r = await apiHelpers.lens.runDomain('hr', 'laborForecast', { input });
  const data = (r as { data?: { ok: boolean; result?: unknown } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  // lens.run wraps the handler: a handler failure ({ ok:false, reason }) lands
  // nested in data.result; a success lands the forecast object in data.result.
  const inner = data.result as (LaborForecast & { ok?: boolean; reason?: string; error?: string }) | undefined;
  if (inner && inner.ok === false) return inner as FailResult;
  if (data.ok && inner && Array.isArray(inner.forecast)) return { ok: true, result: inner as LaborForecast };
  return { ok: false, error: (inner as FailResult)?.error || 'Forecast unavailable.' };
}

function reasonMessage(env: Extract<MacroEnv, { ok: false }>): { icon: 'egress' | 'warn'; text: string } {
  if (env.reason === 'no_egress') {
    return {
      icon: 'egress',
      text:
        'BLS is unreachable from this deployment — live forecasting needs outbound network egress to api.bls.gov. ' +
        'An operator can enable egress (and optionally set a free BLS_API_KEY to raise the daily limit). No series was fabricated.',
    };
  }
  if (env.reason === 'insufficient_history') {
    return { icon: 'warn', text: `Not enough history to forecast — need ${env.need ?? 4} observations, have ${env.have ?? 0}.` };
  }
  if (env.reason === 'bls_error') return { icon: 'warn', text: `BLS returned an error: ${env.detail || 'unknown'}.` };
  return { icon: 'warn', text: env.detail || env.error || env.reason || 'Forecast unavailable.' };
}

export function BlsWageForecast() {
  const [seriesKey, setSeriesKey] = useState(SERIES_OPTIONS[0].key);
  const [horizon, setHorizon] = useState(12);

  const forecast = useMutation({
    mutationFn: () => runLaborForecast({ series: seriesKey, horizon }),
  });

  const env = forecast.data;
  const result = env && env.ok ? env.result : null;
  const failure = env && !env.ok ? reasonMessage(env) : null;

  // Shared value range so the confidence bands render on one scale.
  const scale = useMemo(() => {
    if (!result) return null;
    let min = Infinity, max = -Infinity;
    for (const p of result.forecast) { min = Math.min(min, p.lower95); max = Math.max(max, p.upper95); }
    if (result.latest) { min = Math.min(min, result.latest.value); max = Math.max(max, result.latest.value); }
    const span = max - min || 1;
    return { min, max, span };
  }, [result]);

  const pct = (v: number) => (scale ? Math.max(0, Math.min(100, ((v - scale.min) / scale.span) * 100)) : 0);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-amber-500/15 pb-3">
        <TrendingUp className="h-5 w-5 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Labor &amp; Wage Forecast</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          bls → holt-winters
        </span>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => { e.preventDefault(); forecast.mutate(); }}
      >
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          <span className="font-medium">Indicator</span>
          <select
            value={seriesKey}
            onChange={(e) => setSeriesKey(e.target.value)}
            className="min-w-[16rem] rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
          >
            {SERIES_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          <span className="font-medium">Horizon <span className="font-mono text-amber-300">{horizon}</span> periods</span>
          <input
            type="range"
            min={1}
            max={24}
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="h-7 w-40 accent-amber-500"
          />
        </label>

        <button
          type="submit"
          disabled={forecast.isPending}
          className="inline-flex items-center gap-1.5 rounded bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {forecast.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
          Project
        </button>

        {result && (
          <div className="ml-auto">
            <SaveAsDtuButton
              compact
              apiSource="bls"
              apiUrl={`https://data.bls.gov/cgi-bin/surveymost?ln=${result.seriesId}`}
              title={`${result.seriesLabel} — ${result.horizon}-period Holt-Winters forecast`}
              content={`${result.seriesLabel} (${result.seriesId})\nMethod: ${result.method} · trend ${result.trend.direction} · MAPE ${result.accuracy.mape} (${result.accuracyLabel})\nHistory: ${result.observations} ${result.granularity} obs, ${result.window.startYear}–${result.window.endYear}\n\nForecast (value [80% band] [95% band]):\n${result.forecast.map((p) => `  +${p.step}: ${p.forecast} [${p.lower80}–${p.upper80}] [${p.lower95}–${p.upper95}]`).join('\n')}`}
              extraTags={['hr', 'bls', 'forecast', result.seriesId.toLowerCase()]}
              rawData={result}
            />
          </div>
        )}
      </form>

      {failure && (
        <div className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
          {failure.icon === 'egress' ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />}
          <span>{failure.text}</span>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px]">
            <div className="text-zinc-300">
              <span className="font-semibold text-white">{result.seriesLabel}</span>
              <span className="ml-2 text-zinc-500">series {result.seriesId}</span>
            </div>
            <div className="flex items-center gap-3 text-zinc-400">
              <span>{result.seasonal ? 'seasonal Holt-Winters' : 'Holt double-exp'}</span>
              <span>trend <span className="text-amber-300">{result.trend.direction}</span></span>
              <span className={
                result.accuracyLabel === 'excellent' || result.accuracyLabel === 'good' ? 'text-emerald-300'
                  : result.accuracyLabel === 'moderate' ? 'text-amber-300' : 'text-red-300'
              }>
                MAPE {result.accuracy.mape} · {result.accuracyLabel}
              </span>
            </div>
          </div>

          {result.latest && (
            <div className="text-[11px] text-zinc-400">
              Latest actual: <span className="font-mono text-cyan-300">{result.latest.value.toLocaleString()}</span>
              {result.unit ? ` ${result.unit}` : ''} ({result.latest.period} {result.latest.year}) · {result.observations} {result.granularity} observations
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-[11px]">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1 pr-3 font-medium">Period</th>
                  <th className="py-1 pr-3 font-medium">Projected</th>
                  <th className="py-1 pr-3 font-medium">80% interval</th>
                  <th className="py-1 pr-3 font-medium">95% interval</th>
                  <th className="py-1 font-medium">Range</th>
                </tr>
              </thead>
              <tbody>
                {result.forecast.map((p) => (
                  <tr key={p.step} className="border-t border-zinc-800/70">
                    <td className="py-1 pr-3 font-mono text-zinc-400">+{p.step}</td>
                    <td className="py-1 pr-3 font-mono text-amber-200">{p.forecast.toLocaleString()}</td>
                    <td className="py-1 pr-3 font-mono text-zinc-400">{p.lower80.toLocaleString()} – {p.upper80.toLocaleString()}</td>
                    <td className="py-1 pr-3 font-mono text-zinc-500">{p.lower95.toLocaleString()} – {p.upper95.toLocaleString()}</td>
                    <td className="py-1">
                      <div className="relative h-2 w-full min-w-[6rem] rounded bg-zinc-800">
                        <div className="absolute top-0 h-2 rounded bg-amber-500/20" style={{ left: `${pct(p.lower95)}%`, width: `${Math.max(2, pct(p.upper95) - pct(p.lower95))}%` }} />
                        <div className="absolute top-0 h-2 rounded bg-amber-500/40" style={{ left: `${pct(p.lower80)}%`, width: `${Math.max(2, pct(p.upper80) - pct(p.lower80))}%` }} />
                        <div className="absolute top-[-1px] h-2.5 w-0.5 rounded bg-amber-300" style={{ left: `${pct(p.forecast)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-zinc-500">
            Intervals are the real residual-std bands from temporal.forecast (α {result.parameters.alpha}, β {result.parameters.beta}
            {result.parameters.gamma != null ? `, γ ${result.parameters.gamma}` : ''}); they widen with horizon by construction.
          </p>
        </div>
      )}
    </div>
  );
}
