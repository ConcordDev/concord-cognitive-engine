'use client';

/**
 * SolarCarbonPanel — bespoke residential solar sizing + carbon
 * footprint surface for the energy lens. Wires energy.solarEstimate
 * + energy.carbonFootprint against form inputs.
 *
 *   • Solar: roof sq ft + peak sun hours + monthly kWh → max panels,
 *     system kW, monthly production, coverage %, cost, after-tax
 *     credit, annual savings, payback years
 *   • Carbon: kWh + therms + gasoline gal + flight mi → CO2 breakdown
 *     metric tons, annual estimate, vs-US-average %, top source,
 *     reduction tips
 *   • Save-as-DTU captures inputs + reports
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sun, Leaf, Loader2, Zap } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface SolarInput { roofAreaSqFt: number; peakSunHours: number; monthlyUsageKWh: number }
interface CarbonInput { electricityKWh: number; naturalGasTherms: number; gasolineGallons: number; flightMiles: number }
interface SolarResult { roofArea?: number; maxPanels?: number; systemSizeKW?: number; monthlyProductionKWh?: number; coveragePercent?: number; estimatedCost?: number; afterTaxCredit?: number; annualSavings?: number; paybackYears?: number; recommendation?: string }
interface CarbonResult { breakdown?: Record<string, number>; totalMetricTons?: number; annualEstimate?: number; vsUSAverage?: string; topSource?: string; reductionTips?: string[] }

async function callEng<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('energy', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

export function SolarCarbonPanel() {
  const [solar, setSolar] = useState<SolarInput>({ roofAreaSqFt: 1500, peakSunHours: 5, monthlyUsageKWh: 900 });
  const [carbon, setCarbon] = useState<CarbonInput>({ electricityKWh: 900, naturalGasTherms: 45, gasolineGallons: 40, flightMiles: 250 });
  const [solarResult, setSolarResult] = useState<SolarResult | null>(null);
  const [carbonResult, setCarbonResult] = useState<CarbonResult | null>(null);

  const analyze = useMutation({
    mutationFn: async () => {
      const [s, c] = await Promise.all([
        callEng<SolarResult>('solarEstimate', { artifact: { data: solar } }),
        callEng<CarbonResult>('carbonFootprint', { artifact: { data: carbon } }),
      ]);
      setSolarResult(s);
      setCarbonResult(c);
      return { s, c };
    },
  });

  const coverageColour = (pct?: number) => {
    if (!pct) return 'text-zinc-400';
    if (pct >= 100) return 'text-emerald-200';
    if (pct >= 60) return 'text-amber-200';
    return 'text-rose-200';
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-400" />
          <h2 className="text-sm font-semibold text-white">Solar + carbon footprint</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">energy.solarEstimate + carbonFootprint</span>
        </div>
        {(solarResult || carbonResult) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-energy-solar-carbon"
            title={`Solar ${solarResult?.systemSizeKW ?? '—'} kW · Carbon ${carbonResult?.annualEstimate ?? '—'} t/yr`}
            content={`Solar:\n  ${solarResult?.recommendation}\n  System: ${solarResult?.systemSizeKW} kW (${solarResult?.maxPanels} panels)\n  Monthly production: ${solarResult?.monthlyProductionKWh} kWh\n  Cost: $${solarResult?.estimatedCost?.toLocaleString()} (after 30% credit: $${solarResult?.afterTaxCredit?.toLocaleString()})\n  Savings: $${solarResult?.annualSavings}/yr · Payback: ${solarResult?.paybackYears} years\n\nCarbon:\n  Monthly: ${carbonResult?.totalMetricTons} tons CO2 | Annual: ${carbonResult?.annualEstimate} tons\n  vs US avg: ${carbonResult?.vsUSAverage}\n  Top source: ${carbonResult?.topSource}\n  Breakdown:\n${Object.entries(carbonResult?.breakdown || {}).map(([k, v]) => `    ${k}: ${v} t`).join('\n')}\n  Tips:\n${(carbonResult?.reductionTips || []).map((t) => `    • ${t}`).join('\n')}`}
            extraTags={['energy', 'solar', 'carbon']}
            rawData={{ solar, carbon, solarResult, carbonResult }}
          />
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Sun className="h-3 w-3" />Solar inputs</div>
          <div className="grid grid-cols-1 gap-2">
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Roof area (sq ft)</span>
              <input type="number" min={100} max={10000} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={solar.roofAreaSqFt} onChange={(e) => setSolar({ ...solar, roofAreaSqFt: Math.max(100, Math.min(10000, Number(e.target.value) || 1000)) })} /></label>
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Peak sun hours (avg/day)</span>
              <input type="number" min={1} max={10} step={0.1} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={solar.peakSunHours} onChange={(e) => setSolar({ ...solar, peakSunHours: Math.max(1, Math.min(10, Number(e.target.value) || 5)) })} /></label>
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Monthly usage (kWh)</span>
              <input type="number" min={100} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={solar.monthlyUsageKWh} onChange={(e) => setSolar({ ...solar, monthlyUsageKWh: Math.max(100, Number(e.target.value) || 900) })} /></label>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Leaf className="h-3 w-3" />Carbon inputs (monthly)</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Electricity (kWh)</span>
              <input type="number" min={0} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={carbon.electricityKWh} onChange={(e) => setCarbon({ ...carbon, electricityKWh: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Nat. gas (therms)</span>
              <input type="number" min={0} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={carbon.naturalGasTherms} onChange={(e) => setCarbon({ ...carbon, naturalGasTherms: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Gasoline (gal)</span>
              <input type="number" min={0} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={carbon.gasolineGallons} onChange={(e) => setCarbon({ ...carbon, gasolineGallons: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Flights (mi)</span>
              <input type="number" min={0} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={carbon.flightMiles} onChange={(e) => setCarbon({ ...carbon, flightMiles: Math.max(0, Number(e.target.value) || 0) })} /></label>
          </div>
        </div>
      </div>

      <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="inline-flex items-center gap-1 rounded border border-yellow-500/40 bg-yellow-500/15 px-3 py-1.5 text-xs font-mono text-yellow-200 hover:bg-yellow-500/25 disabled:opacity-50">
        {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        Analyze
      </button>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analysis failed.</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Sun className="h-3 w-3" />Solar estimate</div>
          {!solarResult && <div className="text-[11px] text-zinc-500">Analyze to estimate.</div>}
          {solarResult && (
            <div className="space-y-2 text-[11px]">
              <div className="flex items-baseline gap-2">
                <span className={`font-mono text-2xl ${coverageColour(solarResult.coveragePercent)}`}>{solarResult.coveragePercent}%</span>
                <span className="text-zinc-500">of usage covered</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded border border-yellow-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">System</div><div className="font-mono text-yellow-200">{solarResult.systemSizeKW} kW</div></div>
                <div className="rounded border border-yellow-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Panels</div><div className="font-mono text-yellow-200">{solarResult.maxPanels}</div></div>
                <div className="rounded border border-yellow-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Production</div><div className="font-mono text-yellow-200">{solarResult.monthlyProductionKWh} kWh/mo</div></div>
                <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Savings</div><div className="font-mono text-emerald-200">${solarResult.annualSavings}/yr</div></div>
              </div>
              <div className="rounded border border-yellow-500/20 bg-zinc-950/40 px-2 py-1">
                <div className="text-[9px] text-zinc-500">Cost</div>
                <div className="font-mono text-yellow-200">${solarResult.estimatedCost?.toLocaleString()} <span className="text-[9px] text-zinc-500">(after 30% credit: ${solarResult.afterTaxCredit?.toLocaleString()})</span></div>
                <div className="text-[10px] text-zinc-400">Payback: ~{solarResult.paybackYears} years</div>
              </div>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Leaf className="h-3 w-3" />Carbon footprint</div>
          {!carbonResult && <div className="text-[11px] text-zinc-500">Analyze to compute.</div>}
          {carbonResult && (
            <div className="space-y-2 text-[11px]">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl text-emerald-200">{carbonResult.annualEstimate}</span>
                <span className="text-zinc-500">tons CO₂/yr</span>
              </div>
              <div className="text-[10px] text-zinc-400">{carbonResult.vsUSAverage} · top source: <span className="text-rose-300">{carbonResult.topSource}</span></div>
              {carbonResult.breakdown && (
                <div className="space-y-0.5">
                  {Object.entries(carbonResult.breakdown).map(([k, v]) => {
                    const max = Math.max(...Object.values(carbonResult.breakdown || {}));
                    const pct = max > 0 ? (v / max) * 100 : 0;
                    return (
                      <div key={k} className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1">
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-300 capitalize">{k}</span>
                          <span className="font-mono text-emerald-200">{v} t</span>
                        </div>
                        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full bg-emerald-500/60" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {carbonResult.reductionTips && (
                <ul className="list-disc space-y-0.5 pl-4 text-[10px] text-zinc-400">
                  {carbonResult.reductionTips.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
