'use client';

/**
 * EnergyCheapestWindowPanel — "when should I run this?" cost advisor.
 *
 * Pure deterministic math over REAL rate inputs: the `energy.cheapest-window`
 * macro spreads a shiftable load (kWh over a duration) across every possible
 * contiguous run window in the 24h day, using the user's saved time-of-use
 * rate plan (set in the Time-of-use tab via `tou-set`) — never a fabricated
 * price curve. If no TOU plan is saved, this renders an honest empty state
 * pointing at the Time-of-use tab; a flat rate has no time-of-day signal to
 * optimize against, so no recommendation is invented from one.
 *
 * GATED / deferred: live hardware control. Actually switching a real device
 * (EV charger, dishwasher smart plug) to run in the recommended window needs
 * real smart-plug / CT-clamp hardware talking to a home-automation
 * integration — genuinely external, not built here. This panel is
 * advisory-only and never implies Concord switched anything.
 */

import { useCallback, useEffect, useState } from 'react';
import { Timer, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface WindowResult {
  startHour: number;
  endHour: number;
  hours: number[];
  cost: number;
}
interface CheapestWindowData {
  hasData: boolean;
  message?: string;
  source?: string;
  kWh?: number;
  durationHours?: number;
  kwhPerHour?: number;
  hourlyRates?: number[];
  cheapestWindow?: WindowResult;
  worstWindow?: WindowResult;
  currentWindow?: WindowResult | null;
  savingsVsWorst?: number;
  savingsPctVsWorst?: number;
  savingsVsRunningNow?: number | null;
}

function fmtHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

const SOURCE_LABEL: Record<string, string> = {
  'tou-schedule-stored': 'your saved time-of-use plan',
  'tou-schedule-param': 'the time-of-use schedule provided',
  'explicit-hourly-rates': 'the hourly rate table provided',
};

export function EnergyCheapestWindowPanel() {
  const [kWh, setKWh] = useState('10');
  const [durationHours, setDurationHours] = useState('3');
  const [result, setResult] = useState<CheapestWindowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compute = useCallback(async () => {
    const kwhNum = Number(kWh);
    const durNum = Number(durationHours);
    if (!(kwhNum > 0) || !(durNum >= 1 && durNum <= 24)) {
      setError('Enter a load size (kWh > 0) and a duration between 1 and 24 hours.');
      return;
    }
    setError(null);
    setLoading(true);
    const r = await lensRun('energy', 'cheapest-window', { kWh: kwhNum, durationHours: durNum });
    setLoading(false);
    if (r.data?.ok === false) {
      setError(r.data?.error || 'Failed to compute cheapest window.');
      return;
    }
    setResult((r.data?.result as CheapestWindowData) || null);
  }, [kWh, durationHours]);

  useEffect(() => { void compute(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Timer className="w-3.5 h-3.5 text-lime-400" /> When should I run this?
        </h3>
        <p className="text-[11px] text-zinc-400 mb-2">
          Enter a shiftable load (EV charge, dishwasher, laundry) and find the cheapest
          contiguous window to run it, computed from your saved time-of-use rate plan.
        </p>
        <div className="grid grid-cols-2 gap-2 max-w-sm">
          <Field label="Load size (kWh)" value={kWh} onChange={setKWh} />
          <Field label="Duration (hours)" value={durationHours} onChange={setDurationHours} />
        </div>
        <button
          type="button"
          onClick={() => void compute()}
          disabled={loading}
          className="mt-2 px-3 py-1.5 bg-lime-600 hover:bg-lime-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
        >
          {loading ? 'Computing…' : 'Find cheapest window'}
        </button>
        {error && (
          <div className="mt-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </section>

      {loading && !result && (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      )}

      {result && !result.hasData && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{result.message || 'No rate data available yet.'}</span>
        </div>
      )}

      {result && result.hasData && result.cheapestWindow && result.worstWindow && (() => {
        const cheapestWindow = result.cheapestWindow!;
        const worstWindow = result.worstWindow!;
        const hourlyRates = result.hourlyRates || [];
        const sourceLabel = (result.source && SOURCE_LABEL[result.source]) || result.source || 'the rate data provided';
        return (
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-xl p-3">
                <p className="text-[10px] text-emerald-300 uppercase tracking-wide mb-1">Cheapest window</p>
                <p className="text-lg font-bold text-emerald-200">
                  {fmtHour(cheapestWindow.startHour)}&ndash;{fmtHour(cheapestWindow.endHour)}
                </p>
                <p className="text-xs text-zinc-300">${cheapestWindow.cost.toFixed(2)} to run {result.kWh} kWh</p>
              </div>
              <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl p-3">
                <p className="text-[10px] text-rose-300 uppercase tracking-wide mb-1">Worst window</p>
                <p className="text-lg font-bold text-rose-200">
                  {fmtHour(worstWindow.startHour)}&ndash;{fmtHour(worstWindow.endHour)}
                </p>
                <p className="text-xs text-zinc-300">${worstWindow.cost.toFixed(2)} to run {result.kWh} kWh</p>
              </div>
            </div>

            <div className="text-xs text-zinc-300 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              Running in the cheapest window instead of the worst saves{' '}
              <span className="text-emerald-400 font-semibold">${(result.savingsVsWorst ?? 0).toFixed(2)}</span>{' '}
              ({result.savingsPctVsWorst ?? 0}%). Computed from {sourceLabel}.
              {result.currentWindow && result.savingsVsRunningNow != null && result.savingsVsRunningNow > 0 && (
                <> Running now instead would cost ${(result.savingsVsRunningNow + cheapestWindow.cost).toFixed(2)} —
                  waiting for the cheapest window saves ${result.savingsVsRunningNow.toFixed(2)}.</>
              )}
            </div>

            {/* Show the math, not a black box: the hourly rate table actually used. */}
            {hourlyRates.length === 24 && (
              <details className="text-[11px] text-zinc-400">
                <summary className="cursor-pointer text-zinc-300">Show hourly rate table used</summary>
                <div className="mt-2 grid grid-cols-6 sm:grid-cols-12 gap-1">
                  {hourlyRates.map((rate, h) => (
                    <div
                      key={h}
                      className={`text-center rounded px-1 py-0.5 ${
                        cheapestWindow.hours.includes(h)
                          ? 'bg-emerald-900/50 text-emerald-300'
                          : worstWindow.hours.includes(h)
                            ? 'bg-rose-900/50 text-rose-300'
                            : 'bg-zinc-900'
                      }`}
                    >
                      <div>{fmtHour(h)}</div>
                      <div>${rate.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        );
      })()}

      <div className="text-[10px] text-zinc-500 border-t border-zinc-800 pt-2">
        Advisory only: Concord computes the cheapest time to run a load from your real rate
        data. It does not, and cannot, switch any device on your behalf — actually running your
        dishwasher or EV charger at the recommended time needs real smart-plug / CT-clamp
        hardware wired to a home-automation integration, which is genuinely external and out of
        scope here.
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-zinc-400 uppercase tracking-wide">{label}</span>
      <input
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
      />
    </label>
  );
}
