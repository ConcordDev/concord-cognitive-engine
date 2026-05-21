'use client';

/**
 * EnergyTouPanel — time-of-use rate modeling. The user configures a
 * peak / off-peak / (optional) shoulder TOU plan with peak-hour
 * windows; the `energy.tou-breakdown` macro splits hour-tagged readings
 * into a peak / off-peak / shoulder cost breakdown and compares total
 * TOU cost against the flat rate. All values are computed from real
 * user-entered readings carrying an `hour` field.
 */

import { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface TouPlan {
  peakRate: number;
  offPeakRate: number;
  shoulderRate: number | null;
  peakStartHour: number;
  peakEndHour: number;
  shoulderStartHour: number | null;
  shoulderEndHour: number | null;
  utility: string | null;
}
interface TouBucket { kwh: number; cost: number; rate: number }
interface TouBreakdown {
  days: number;
  peak: TouBucket;
  offPeak: TouBucket;
  shoulder: TouBucket | null;
  untimedKwh: number;
  totalKwh: number;
  touCost: number;
  flatRateCost: number;
  savingsVsFlat: number;
  peakSharePct: number;
}

export function EnergyTouPanel({ onChange }: { onChange: () => void }) {
  const [plan, setPlan] = useState<TouPlan | null>(null);
  const [breakdown, setBreakdown] = useState<TouBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    peakRate: '', offPeakRate: '', shoulderRate: '',
    peakStartHour: '16', peakEndHour: '21', utility: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    const g = await lensRun('energy', 'tou-get', {});
    const p = (g.data?.result?.plan as TouPlan | null) || null;
    setPlan(p);
    if (p) {
      const b = await lensRun('energy', 'tou-breakdown', { days: 30 });
      setBreakdown(b.data?.ok ? (b.data.result as TouBreakdown) : null);
    } else {
      setBreakdown(null);
    }
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const savePlan = async () => {
    if (!(Number(form.peakRate) > 0) || !(Number(form.offPeakRate) > 0)) {
      setError('Peak and off-peak rates must be greater than zero.');
      return;
    }
    const r = await lensRun('energy', 'tou-set', {
      peakRate: Number(form.peakRate),
      offPeakRate: Number(form.offPeakRate),
      ...(Number(form.shoulderRate) > 0 ? { shoulderRate: Number(form.shoulderRate) } : {}),
      peakStartHour: Number(form.peakStartHour),
      peakEndHour: Number(form.peakEndHour),
      utility: form.utility.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Clock className="w-3.5 h-3.5 text-lime-400" /> Time-of-use plan
        </h3>
        {plan && (
          <p className="text-[11px] text-zinc-500 mb-2">
            Active: peak ${plan.peakRate}/kWh ({plan.peakStartHour}:00&ndash;{plan.peakEndHour}:00),
            off-peak ${plan.offPeakRate}/kWh{plan.shoulderRate != null ? `, shoulder $${plan.shoulderRate}/kWh` : ''}
            {plan.utility ? ` · ${plan.utility}` : ''}
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Field label="Peak $/kWh" value={form.peakRate} onChange={(v) => setForm({ ...form, peakRate: v })} />
          <Field label="Off-peak $/kWh" value={form.offPeakRate} onChange={(v) => setForm({ ...form, offPeakRate: v })} />
          <Field label="Shoulder $/kWh (opt)" value={form.shoulderRate} onChange={(v) => setForm({ ...form, shoulderRate: v })} />
          <Field label="Peak start (hour)" value={form.peakStartHour} onChange={(v) => setForm({ ...form, peakStartHour: v })} />
          <Field label="Peak end (hour)" value={form.peakEndHour} onChange={(v) => setForm({ ...form, peakEndHour: v })} />
          <Field label="Utility (opt)" value={form.utility} numeric={false} onChange={(v) => setForm({ ...form, utility: v })} />
        </div>
        <button type="button" onClick={savePlan}
          className="mt-2 px-3 py-1.5 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
          {plan ? 'Update plan' : 'Save plan'}
        </button>
      </section>

      {plan && breakdown && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Peak vs off-peak (last 30 days)</h3>
          {breakdown.totalKwh === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">
              Log readings with an <span className="text-zinc-300">hour</span> field to see the TOU breakdown.
            </p>
          ) : (
            <>
              <div className="h-3 rounded-full bg-zinc-800 overflow-hidden flex">
                <div className="h-full bg-rose-500" style={{ width: `${pctOf(breakdown.peak.kwh, breakdown.totalKwh)}%` }} title="peak" />
                {breakdown.shoulder && (
                  <div className="h-full bg-amber-500" style={{ width: `${pctOf(breakdown.shoulder.kwh, breakdown.totalKwh)}%` }} title="shoulder" />
                )}
                <div className="h-full bg-lime-500" style={{ width: `${pctOf(breakdown.offPeak.kwh, breakdown.totalKwh)}%` }} title="off-peak" />
              </div>
              <ul className="mt-2 space-y-1">
                <Bucket label="Peak" color="bg-rose-500" b={breakdown.peak} />
                {breakdown.shoulder && <Bucket label="Shoulder" color="bg-amber-500" b={breakdown.shoulder} />}
                <Bucket label="Off-peak" color="bg-lime-500" b={breakdown.offPeak} />
              </ul>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <Stat label="TOU cost" value={`$${breakdown.touCost}`} />
                <Stat label="Flat-rate cost" value={`$${breakdown.flatRateCost}`} />
                <Stat label="Savings vs flat"
                  value={`$${breakdown.savingsVsFlat}`}
                  accent={breakdown.savingsVsFlat >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
              </div>
              {breakdown.untimedKwh > 0 && (
                <p className="text-[10px] text-zinc-500 mt-1.5">
                  {breakdown.untimedKwh} kWh untimed (no hour) — billed at off-peak. Tag readings with an hour for accuracy.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function pctOf(v: number, total: number) { return total > 0 ? (v / total) * 100 : 0; }

function Field({ label, value, onChange, numeric = true }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-zinc-500 uppercase tracking-wide">{label}</span>
      <input value={value} inputMode={numeric ? 'decimal' : 'text'} onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
    </label>
  );
}

function Bucket({ label, color, b }: { label: string; color: string; b: TouBucket }) {
  return (
    <li className="flex items-center justify-between text-xs bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
      <span className="flex items-center gap-1.5 text-zinc-200">
        <span className={`w-2 h-2 rounded-sm ${color}`} /> {label}
      </span>
      <span className="text-zinc-400">{b.kwh} kWh · ${b.cost} @ ${b.rate}/kWh</span>
    </li>
  );
}

function Stat({ label, value, accent = 'text-zinc-100' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
      <p className={`text-base font-bold ${accent}`}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
