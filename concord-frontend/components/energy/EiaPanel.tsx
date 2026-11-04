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

import { Component, useState, type ReactNode } from 'react';
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
interface MixRow { fuel?: string; mwh?: number; sharePct?: number; pct?: number }
interface MixResult {
  region: string;
  mix: MixRow[];
  totalMWh?: number;
}

/** The handler's named share field. `pct` is not part of the contract. */
export function mixSharePct(row: MixRow): number | null {
  const raw = row?.sharePct;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && String(raw).trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

class MixColumnBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError() {
    return { message: 'Generation mix could not render. Rates already loaded on this page are unchanged.' };
  }
  render() {
    if (this.state.message) {
      return <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">{this.state.message}</div>;
    }
    return this.props.children;
  }
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

function MixBars({ mix }: { mix: MixResult }) {
  const rows = mix.mix.map((m) => {
    const share = mixSharePct(m);
    return { fuel: m.fuel || 'Unknown', mwh: m.mwh, share };
  });
  const recorded = rows.flatMap((r) => (r.share == null ? [] : [{ fuel: r.fuel, share: r.share }]));
  const totalMWh = mix.totalMWh;
  const total = typeof totalMWh === 'number' && Number.isFinite(totalMWh) ? totalMWh.toLocaleString() : 'not recorded';
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
      {recorded.length > 0 && (
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
          {recorded.map((r) => {
            const cls = FUEL_COLOR[r.fuel.toLowerCase()] || FUEL_COLOR.other;
            return <div key={r.fuel} className={cls} style={{ width: `${r.share}%` }} title={`${r.fuel}: ${r.share.toFixed(1)}%`} />;
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        {rows.slice(0, 8).map((r) => (
          <div key={r.fuel} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1">
            <span className="capitalize text-zinc-300">{r.fuel}</span>
            <span className="font-mono text-cyan-300">{r.share == null ? 'Not recorded' : `${r.share.toFixed(1)}%`}</span>
          </div>
        ))}
      </div>
      <SaveAsDtuButton
        compact
        apiSource="eia"
        title={`${mix.region} generation mix · ${total} MWh`}
        content={`Region: ${mix.region}\nTotal: ${total} MWh\nMix:\n${rows.map((r) => {
          const mwh = typeof r.mwh === 'number' && Number.isFinite(r.mwh) ? r.mwh.toLocaleString() : 'not recorded';
          return `  ${r.fuel}: ${mwh} MWh (${r.share == null ? 'share not recorded' : `${r.share.toFixed(1)}%`})`;
        }).join('\n')}`}
        extraTags={['energy', 'generation', (mix.region || '').toLowerCase()]}
        rawData={mix}
      />
    </motion.div>
  );
}

export function EiaPanel() {
  const [state, setState] = useState('CA');
  const [region, setRegion] = useState('US');
  const [rate, setRate] = useState<RateResult | null>(null);
  const [mix, setMix] = useState<MixResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mixError, setMixError] = useState<string | null>(null);
  const [mixAttempt, setMixAttempt] = useState(0);

  const rateMutation = useMutation({
    mutationFn: async () => callMacro<RateResult>('eia-electricity-rates', { state }),
    onSuccess: (env) => { if (env.ok && env.result) { setRate(env.result); setError(null); } else { setRate(null); setError(env.error || 'rate failed'); } },
  });
  const mixMutation = useMutation({
    mutationFn: async () => callMacro<MixResult>('eia-generation-mix', { region }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setMix(env.result); setMixError(null); }
      else { setMix(null); setMixError(env.error || 'Generation mix is unavailable.'); }
    },
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
            <button type="button" onClick={() => { setMixAttempt((n) => n + 1); mixMutation.mutate(); }} disabled={mixMutation.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
              {mixMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load mix'}
            </button>
          </div>
          <MixColumnBoundary key={mixAttempt}>
          {mixError && <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">{mixError}</div>}
          {mix && Array.isArray(mix.mix) && mix.mix.length > 0 && (
            <MixBars mix={{ ...mix, region: mix.region || region }} />
          )}
          </MixColumnBoundary>
        </div>
      </div>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
    </div>
  );
}
