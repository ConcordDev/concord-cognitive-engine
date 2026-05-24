'use client';

/**
 * EiaPanel — bespoke EIA electricity rates + generation-mix panel for
 * the energy lens. Backed by energy.eia-electricity-rates +
 * energy.eia-generation-mix (gated by EIA_API_KEY).
 *
 * Per category-leader research (EIA Data Browser, Electricity Maps,
 * OWID, Carbon Brief): state-rate KPI + monthly line + generation
 * donut + Save-as-DTU.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Zap, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface RateResult {
  state: string; sector: string;
  latest: { period: string; priceCentsPerKwh: number } | null;
  yearOverYearChangePct: number | null;
  monthlySeries: Array<{ period: string; priceCentsPerKwh: number }>;
}
interface MixResult {
  region: string;
  mix: Array<{ fuel: string; mwh: number; pct: number }>;
  totalMWh: number;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('energy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const FUEL_COLOR: Record<string, string> = {
  'natural gas': 'bg-amber-500/30 text-amber-200',
  'coal': 'bg-zinc-700 text-zinc-200',
  'nuclear': 'bg-violet-500/30 text-violet-200',
  'hydro': 'bg-sky-500/30 text-sky-200',
  'wind': 'bg-cyan-500/30 text-cyan-200',
  'solar': 'bg-yellow-500/30 text-yellow-200',
  'other renewables': 'bg-emerald-500/30 text-emerald-200',
  'other': 'bg-zinc-800 text-zinc-400',
};

const STATES = ['US', 'CA', 'TX', 'NY', 'FL', 'IL', 'PA', 'OH', 'MA', 'WA'];

export function EiaPanel() {
  const [state, setState] = useState('CA');
  const [region, setRegion] = useState('US');
  const [rate, setRate] = useState<RateResult | null>(null);
  const [mix, setMix] = useState<MixResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rateMutation = useMutation({
    mutationFn: async () => callMacro<RateResult>('eia-electricity-rates', { state }),
    onSuccess: (env) => { if (env.ok && env.result) { setRate(env.result); setError(null); } else { setRate(null); setError(env.error || 'rate failed'); } },
  });
  const mixMutation = useMutation({
    mutationFn: async () => callMacro<MixResult>('eia-generation-mix', { region }),
    onSuccess: (env) => { if (env.ok && env.result) setMix(env.result); else setMix(null); },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Electricity rates + generation mix</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">eia open data</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">State</label>
            <select value={state} onChange={(e) => setState(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" onClick={() => rateMutation.mutate()} disabled={rateMutation.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
              {rateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load rates'}
            </button>
          </div>
          {rate?.latest && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
              <div className="flex items-end justify-between">
                <div>
                  <div className="font-mono text-3xl font-bold text-white">{rate.latest.priceCentsPerKwh.toFixed(1)}¢</div>
                  <div className="text-[11px] text-zinc-400">per kWh · {rate.latest.period} · residential</div>
                </div>
                {rate.yearOverYearChangePct !== null && (
                  <div className={`flex items-center gap-1 text-sm font-mono ${rate.yearOverYearChangePct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {rate.yearOverYearChangePct >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {rate.yearOverYearChangePct >= 0 ? '+' : ''}{rate.yearOverYearChangePct.toFixed(1)}% YoY
                  </div>
                )}
              </div>
              {/* mini bars */}
              <div className="flex items-end gap-0.5 h-12">
                {rate.monthlySeries.slice().reverse().map((m, i) => {
                  const max = Math.max(...rate.monthlySeries.map((x) => x.priceCentsPerKwh));
                  const h = max > 0 ? (m.priceCentsPerKwh / max) * 100 : 0;
                  return <div key={i} className="flex-1 rounded-t bg-cyan-500/40" style={{ height: `${h}%` }} title={`${m.period}: ${m.priceCentsPerKwh}¢`} />;
                })}
              </div>
              <SaveAsDtuButton
                compact
                apiSource="eia"
                title={`${state} electricity rate — ${rate.latest.priceCentsPerKwh}¢/kWh (${rate.latest.period})`}
                content={`State: ${state}\nLatest: ${rate.latest.period} · ${rate.latest.priceCentsPerKwh}¢/kWh\nYoY change: ${rate.yearOverYearChangePct ?? '—'}%\nMonthly series (12 months): ${JSON.stringify(rate.monthlySeries)}`}
                extraTags={['energy', 'electricity', 'rates', state.toLowerCase()]}
                rawData={rate}
              />
            </motion.div>
          )}
        </div>

        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">Region</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
              {['US', 'CAL', 'TEX', 'NY', 'FLA', 'NW', 'SE'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" onClick={() => mixMutation.mutate()} disabled={mixMutation.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
              {mixMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load mix'}
            </button>
          </div>
          {mix && mix.mix.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
              {/* Stacked bar by fuel */}
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
                {mix.mix.map((m) => {
                  const cls = FUEL_COLOR[m.fuel.toLowerCase()] || FUEL_COLOR.other;
                  return <div key={m.fuel} className={cls} style={{ width: `${m.pct}%` }} title={`${m.fuel}: ${m.pct.toFixed(1)}%`} />;
                })}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                {mix.mix.slice(0, 8).map((m) => (
                  <div key={m.fuel} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1">
                    <span className="capitalize text-zinc-300">{m.fuel}</span>
                    <span className="font-mono text-cyan-300">{m.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <SaveAsDtuButton
                compact
                apiSource="eia"
                title={`${region} generation mix · ${mix.totalMWh.toLocaleString()} MWh`}
                content={`Region: ${region}\nTotal: ${mix.totalMWh.toLocaleString()} MWh\nMix:\n${mix.mix.map((m) => `  ${m.fuel}: ${m.mwh.toLocaleString()} MWh (${m.pct.toFixed(1)}%)`).join('\n')}`}
                extraTags={['energy', 'generation', region.toLowerCase()]}
                rawData={mix}
              />
            </motion.div>
          )}
        </div>
      </div>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
    </div>
  );
}
