'use client';

/**
 * TidalSalinityPanel — approximate lunar-phase tide estimator +
 * depth/salinity/temperature profile builder for the ocean lens.
 * Wires ocean.tidalPrediction + ocean.salinityProfile — the two
 * pure-compute macros that shipped with the domain but had zero UI
 * (every other ocean macro already has a bespoke component: NOAA tides
 * are covered by NoaaTidesPanel/TideActionStack, live marine data by
 * LiveMarinePanel). tidalPrediction is explicitly an *approximation*
 * (its own result carries a "use official tide tables" note) — kept
 * distinct from the real NOAA station lookups elsewhere on the lens.
 */

import { useState } from 'react';
import { Moon, Layers3, Plus, Trash2 } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface TideInput { location: string; tidalRangeMeters: number }
interface Reading { depth: number; salinity: number; temperature: number }
interface TideResult {
  location?: string; lunarPhase?: string; springOrNeap?: string; estimatedCurrentHeight?: string;
  tidalRange?: string; nextHigh?: string; nextLow?: string; note?: string;
}
interface SalinityResult {
  readings?: Reading[]; avgSalinity?: number; maxDepth?: number; haloclineDepth?: number | string; waterMass?: string; message?: string;
}

const emptyReading = (): Reading => ({ depth: 0, salinity: 35, temperature: 15 });

export function TidalSalinityPanel() {
  const [tide, setTide] = useState<TideInput>({ location: '', tidalRangeMeters: 2 });
  const [readings, setReadings] = useState<Reading[]>([emptyReading(), { depth: 50, salinity: 34.5, temperature: 12 }]);

  const addReading = () => setReadings((rs) => [...rs, emptyReading()]);
  const updateReading = (i: number, key: keyof Reading, value: number) =>
    setReadings((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const removeReading = (i: number) => setReadings((rs) => rs.filter((_, idx) => idx !== i));

  return (
    <CalcPanel<TideResult, SalinityResult>
      title="Tidal phase & salinity profile"
      domain="ocean"
      icon={<Moon className="h-5 w-5 text-cyan-300" />}
      macroBadge="ocean.tidalPrediction + salinityProfile"
      accent="sky"
      left={{
        macro: 'tidalPrediction',
        buildArtifact: () => ({ data: tide }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Moon className="h-3 w-3" />Lunar-phase estimate</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Location label" value={tide.location} onChange={(e) => setTide({ ...tide, location: e.target.value })} />
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Tidal range (m)</span>
                <input type="number" step={0.1} min={0} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={tide.tidalRangeMeters} onChange={(e) => setTide({ ...tide, tidalRangeMeters: Number(e.target.value) || 0 })} /></label>
            </div>
            <p className="text-[9px] text-zinc-500">Approximate — computed from the current lunar day, not station data. For real predictions use the Tides tab.</p>
          </div>
        ),
      }}
      right={{
        macro: 'salinityProfile',
        buildArtifact: () => ({ data: { readings } }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Layers3 className="h-3 w-3" />Depth / salinity / temperature readings</div>
            <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {readings.map((r, i) => (
                <div key={i} className="grid grid-cols-[70px_70px_70px_28px] gap-1.5">
                  <input type="number" step={1} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" placeholder="depth m" value={r.depth} onChange={(e) => updateReading(i, 'depth', Number(e.target.value) || 0)} />
                  <input type="number" step={0.1} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" placeholder="PSU" value={r.salinity} onChange={(e) => updateReading(i, 'salinity', Number(e.target.value) || 0)} />
                  <input type="number" step={0.1} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" placeholder="°C" value={r.temperature} onChange={(e) => updateReading(i, 'temperature', Number(e.target.value) || 0)} />
                  <button type="button" onClick={() => removeReading(i)} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label="Remove reading"><Trash2 className="mx-auto h-3 w-3" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addReading} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-sky-500/40 hover:text-sky-200"><Plus className="h-3 w-3" />Add reading</button>
          </div>
        ),
      }}
      renderResults={(tideResult, salResult) => (
        <>
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Moon className="h-3 w-3" />Tidal estimate</div>
            {!tideResult && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {tideResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-[10px] text-cyan-200 capitalize">{tideResult.lunarPhase?.replace(/-/g, ' ')}</span>
                  <span className="text-zinc-300 capitalize">{tideResult.springOrNeap?.replace(/-/g, ' ')}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Est. height</div><div className="font-mono text-cyan-200">{tideResult.estimatedCurrentHeight}</div></div>
                  <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Range</div><div className="font-mono text-cyan-200">{tideResult.tidalRange}</div></div>
                </div>
                <div className="text-[10px] text-amber-300/80">{tideResult.note}</div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Layers3 className="h-3 w-3" />Water column</div>
            {!salResult && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {salResult?.message && <div className="text-[11px] text-zinc-400">{salResult.message}</div>}
            {salResult && !salResult.message && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-lg text-emerald-200 capitalize">{salResult.waterMass}</span>
                  <span className="text-zinc-400">water mass</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Avg PSU</div><div className="font-mono text-emerald-200">{salResult.avgSalinity}</div></div>
                  <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Max depth</div><div className="font-mono text-emerald-200">{salResult.maxDepth}m</div></div>
                  <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Halocline</div><div className="font-mono text-emerald-200">{salResult.haloclineDepth}</div></div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-ocean-tide-salinity',
        title: (t, s) => `Ocean profile — ${t.lunarPhase ?? '—'} tide · ${s.waterMass ?? '—'} water mass`,
        content: (t, s) =>
          `Tidal estimate (${t.location ?? tide.location}):\n  Phase: ${t.lunarPhase} (${t.springOrNeap})\n  Height: ${t.estimatedCurrentHeight} of ${t.tidalRange} range\n  ${t.note}\n\nSalinity profile:\n  Water mass: ${s.waterMass}\n  Avg salinity: ${s.avgSalinity} PSU\n  Max depth: ${s.maxDepth}m\n  Halocline: ${s.haloclineDepth}\n${(s.readings || []).map((r) => `  ${r.depth}m: ${r.salinity} PSU, ${r.temperature}°C`).join('\n')}`,
        tags: () => ['ocean', 'tide', 'salinity', 'water-column'],
        rawData: (t, s) => ({ tide, readings, tideResult: t, salResult: s }),
      }}
    />
  );
}
