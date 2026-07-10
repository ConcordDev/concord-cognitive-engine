'use client';

/**
 * EnergyGridCalcPanel — one-shot consumption analysis + grid-status
 * calculators wiring energy.consumptionAnalysis + energy.gridStatus,
 * the two energy macros with no prior UI. Distinct from
 * EnergyMonitorSection (persistent device/reading tracking): this is a
 * quick "paste your meter readings" / "what's grid load right now"
 * calculator, the Sense-app-adjacent utility view.
 */

import { useState } from 'react';
import { Activity, Waves } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface Reading { kWh: number }
interface ConsumptionResult {
  totalKWh?: number; avgKWh?: number; peakKWh?: number; readingCount?: number;
  estimatedCost?: number; costPerKWh?: number; peakToAvgRatio?: number; savingsOpportunity?: string;
}
interface GridInput { currentDemandMW: number; totalCapacityMW: number; renewablePercent: number; gridFrequencyHz: number }
interface GridResult {
  currentDemand?: string; totalCapacity?: string; utilization?: number; renewableShare?: string;
  gridFrequency?: string; frequencyStable?: boolean; status?: string; reserves?: string;
}

const statusColour = (status?: string) => {
  if (status === 'critical-load') return 'text-rose-200';
  if (status === 'high-load') return 'text-amber-200';
  if (status === 'low-load') return 'text-sky-200';
  return 'text-emerald-200';
};

export function EnergyGridCalcPanel() {
  const [readingsText, setReadingsText] = useState('28, 31, 26, 45, 29, 33, 27');
  const [costPerKWh, setCostPerKWh] = useState(0.17);
  const [grid, setGrid] = useState<GridInput>({ currentDemandMW: 42000, totalCapacityMW: 55000, renewablePercent: 28, gridFrequencyHz: 60 });

  const readings: Reading[] = readingsText
    .split(',')
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n))
    .map((kWh) => ({ kWh }));

  return (
    <CalcPanel<ConsumptionResult, GridResult>
      title="Consumption analysis + grid status"
      domain="energy"
      icon={<Activity className="h-5 w-5 text-lime-400" />}
      macroBadge="energy.consumptionAnalysis + gridStatus"
      accent="cyan"
      left={{
        macro: 'consumptionAnalysis',
        buildArtifact: () => ({ data: { readings, costPerKWh } }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Activity className="h-3 w-3" />Meter readings (kWh, comma-separated)</div>
            <textarea
              value={readingsText}
              onChange={(e) => setReadingsText(e.target.value)}
              rows={2}
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono"
            />
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Cost per kWh ($)</span>
              <input type="number" min={0} step={0.01} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={costPerKWh} onChange={(e) => setCostPerKWh(Math.max(0, Number(e.target.value) || 0))} /></label>
          </div>
        ),
      }}
      right={{
        macro: 'gridStatus',
        buildArtifact: () => ({ data: grid }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Waves className="h-3 w-3" />Regional grid snapshot</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Demand (MW)</span>
                <input type="number" min={0} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={grid.currentDemandMW} onChange={(e) => setGrid({ ...grid, currentDemandMW: Math.max(0, Number(e.target.value) || 0) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Capacity (MW)</span>
                <input type="number" min={0} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={grid.totalCapacityMW} onChange={(e) => setGrid({ ...grid, totalCapacityMW: Math.max(0, Number(e.target.value) || 0) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Renewable (%)</span>
                <input type="number" min={0} max={100} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={grid.renewablePercent} onChange={(e) => setGrid({ ...grid, renewablePercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Frequency (Hz)</span>
                <input type="number" min={0} step={0.01} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={grid.gridFrequencyHz} onChange={(e) => setGrid({ ...grid, gridFrequencyHz: Number(e.target.value) || 0 })} /></label>
            </div>
          </div>
        ),
      }}
      renderResults={(c, g) => (
        <>
          <div className="rounded-lg border border-lime-500/20 bg-lime-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Activity className="h-3 w-3" />Consumption analysis</div>
            {!c && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {c && (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl text-lime-200">{c.totalKWh}</span>
                  <span className="text-zinc-400">kWh total (${c.estimatedCost})</span>
                </div>
                <div className="text-zinc-400">avg {c.avgKWh} kWh &middot; peak {c.peakKWh} kWh &middot; peak/avg {c.peakToAvgRatio}&times;</div>
                <div className="rounded border border-lime-500/15 bg-zinc-950/40 px-2 py-1 text-[10px] text-zinc-300">{c.savingsOpportunity}</div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Waves className="h-3 w-3" />Grid status</div>
            {!g && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {g && (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-2xl ${statusColour(g.status)}`}>{g.utilization}%</span>
                  <span className="text-zinc-400 uppercase tracking-wide">{g.status}</span>
                </div>
                <div className="text-zinc-400">{g.currentDemand} of {g.totalCapacity} &middot; {g.renewableShare} renewable</div>
                <div className="text-zinc-400">{g.gridFrequency} ({g.frequencyStable ? 'stable' : 'deviating'}) &middot; {g.reserves} reserve</div>
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-energy-grid-calc',
        title: (c, g) => `Consumption ${c.totalKWh ?? '—'} kWh &middot; Grid ${g.utilization ?? '—'}%`,
        content: (c, g) => `Consumption:\n  Total: ${c.totalKWh} kWh ($${c.estimatedCost} @ $${c.costPerKWh}/kWh)\n  Avg: ${c.avgKWh} kWh · Peak: ${c.peakKWh} kWh · Peak/avg: ${c.peakToAvgRatio}x\n  ${c.savingsOpportunity}\n\nGrid:\n  ${g.currentDemand} of ${g.totalCapacity} (${g.utilization}% utilization) — ${g.status}\n  Renewable share: ${g.renewableShare} · Frequency: ${g.gridFrequency} (${g.frequencyStable ? 'stable' : 'deviating'})\n  Reserves: ${g.reserves}`,
        tags: () => ['energy', 'consumption', 'grid-status'],
        rawData: (c, g) => ({ readings, costPerKWh, grid, consumptionResult: c, gridResult: g }),
      }}
    />
  );
}
