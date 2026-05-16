'use client';

/**
 * SolarCarbonPanel — residential solar sizing + carbon footprint
 * surface for the energy lens. Wires energy.solarEstimate +
 * energy.carbonFootprint.
 *
 * Refactored to use `CalcPanel` primitive. See
 * `concord-frontend/components/lens-primitives/CalcPanel.tsx`.
 */

import { useState } from 'react';
import { Sun, Leaf, Zap } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface SolarInput { roofAreaSqFt: number; peakSunHours: number; monthlyUsageKWh: number }
interface CarbonInput { electricityKWh: number; naturalGasTherms: number; gasolineGallons: number; flightMiles: number }
interface SolarResult { roofArea?: number; maxPanels?: number; systemSizeKW?: number; monthlyProductionKWh?: number; coveragePercent?: number; estimatedCost?: number; afterTaxCredit?: number; annualSavings?: number; paybackYears?: number; recommendation?: string }
interface CarbonResult { breakdown?: Record<string, number>; totalMetricTons?: number; annualEstimate?: number; vsUSAverage?: string; topSource?: string; reductionTips?: string[] }

const coverageColour = (pct?: number) => {
  if (!pct) return 'text-zinc-400';
  if (pct >= 100) return 'text-emerald-200';
  if (pct >= 60) return 'text-amber-200';
  return 'text-rose-200';
};

export function SolarCarbonPanel() {
  const [solar, setSolar] = useState<SolarInput>({ roofAreaSqFt: 0, peakSunHours: 0, monthlyUsageKWh: 0 });
  const [carbon, setCarbon] = useState<CarbonInput>({ electricityKWh: 0, naturalGasTherms: 0, gasolineGallons: 0, flightMiles: 0 });

  return (
    <CalcPanel<SolarResult, CarbonResult>
      title="Solar + carbon footprint"
      domain="energy"
      icon={<Zap className="h-5 w-5 text-yellow-400" />}
      macroBadge="energy.solarEstimate + carbonFootprint"
      accent="yellow"
      left={{
        macro: 'solarEstimate',
        buildArtifact: () => ({ data: solar }),
        render: (
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
        ),
      }}
      right={{
        macro: 'carbonFootprint',
        buildArtifact: () => ({ data: carbon }),
        render: (
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
        ),
      }}
      renderResults={(solarResult, carbonResult) => (
        <>
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
        </>
      )}
      dtu={{
        apiSource: 'concord-energy-solar-carbon',
        title: (s, c) => `Solar ${s.systemSizeKW ?? '—'} kW · Carbon ${c.annualEstimate ?? '—'} t/yr`,
        content: (s, c) => `Solar:\n  ${s.recommendation}\n  System: ${s.systemSizeKW} kW (${s.maxPanels} panels)\n  Monthly production: ${s.monthlyProductionKWh} kWh\n  Cost: $${s.estimatedCost?.toLocaleString()} (after 30% credit: $${s.afterTaxCredit?.toLocaleString()})\n  Savings: $${s.annualSavings}/yr · Payback: ${s.paybackYears} years\n\nCarbon:\n  Monthly: ${c.totalMetricTons} tons CO2 | Annual: ${c.annualEstimate} tons\n  vs US avg: ${c.vsUSAverage}\n  Top source: ${c.topSource}\n  Breakdown:\n${Object.entries(c.breakdown || {}).map(([k, v]) => `    ${k}: ${v} t`).join('\n')}\n  Tips:\n${(c.reductionTips || []).map((t) => `    • ${t}`).join('\n')}`,
        tags: () => ['energy', 'solar', 'carbon'],
        rawData: (s, c) => ({ solar, carbon, solarResult: s, carbonResult: c }),
      }}
    />
  );
}
