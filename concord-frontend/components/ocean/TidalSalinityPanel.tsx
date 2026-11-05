'use client';

/**
 * TidalSalinityPanel — station tide predictions + depth/salinity/
 * temperature profile builder for the ocean lens. Wires
 * ocean.tidalPrediction + ocean.salinityProfile. tidalPrediction used
 * to be a lunar-phase approximation; the verb now delegates to the
 * real NOAA CO-OPS predictions for a station ID and refuses
 * (NOT_COMPUTED) without one — this panel sends the station and
 * renders the verb's real result shape (next high/low + the
 * prediction rows). (Ocean S4 / F5: the panel previously expected
 * the retired lunar shape, so its values could never render.)
 */

import { useState } from 'react';
import { Moon, Layers3, Plus, Trash2 } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface TideInput { location: string; stationId: string }
interface Reading { depth: number; salinity: number; temperature: number }
interface TidePoint { time: string; height: number; type: string }
interface TideResult {
  location?: string; stationId?: string; beginDate?: string; endDate?: string; count?: number;
  predictions?: TidePoint[]; nextHigh?: TidePoint | null; nextLow?: TidePoint | null;
  status?: string; message?: string;
}
interface SalinityResult {
  readings?: Reading[]; avgSalinity?: number; maxDepth?: number; haloclineDepth?: number | string; waterMass?: string; message?: string;
}

const emptyReading = (): Reading => ({ depth: 0, salinity: 35, temperature: 15 });

export function TidalSalinityPanel() {
  const [tide, setTide] = useState<TideInput>({ location: '', stationId: '' });
  const [readings, setReadings] = useState<Reading[]>([emptyReading(), { depth: 50, salinity: 34.5, temperature: 12 }]);

  const addReading = () => setReadings((rs) => [...rs, emptyReading()]);
  const updateReading = (i: number, key: keyof Reading, value: number) =>
    setReadings((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const removeReading = (i: number) => setReadings((rs) => rs.filter((_, idx) => idx !== i));

  return (
    <CalcPanel<TideResult, SalinityResult>
      title="Station tides & salinity profile"
      domain="ocean"
      icon={<Moon className="h-5 w-5 text-cyan-300" />}
      macroBadge="ocean.tidalPrediction + salinityProfile"
      accent="sky"
      left={{
        macro: 'tidalPrediction',
        buildArtifact: () => ({ data: tide }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Moon className="h-3 w-3" />Station tide predictions</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Location label" value={tide.location} onChange={(e) => setTide({ ...tide, location: e.target.value })} />
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">NOAA station ID</span>
                <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" placeholder="9414290" value={tide.stationId} onChange={(e) => setTide({ ...tide, stationId: e.target.value })} /></label>
            </div>
            <p className="text-[9px] text-zinc-500">Real NOAA CO-OPS predictions for the station (times GMT). Find station IDs at tidesandcurrents.noaa.gov — the Tides tab lists common ones.</p>
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
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Moon className="h-3 w-3" />Tide predictions</div>
            {!tideResult && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {tideResult?.status === 'NOT_COMPUTED' && (
              <div className="text-[11px] text-amber-200/90">{tideResult.message}</div>
            )}
            {tideResult && tideResult.status !== 'NOT_COMPUTED' && (
              <div className="space-y-2 text-[11px]">
                <div className="text-zinc-300">{tideResult.location || tideResult.stationId} · station {tideResult.stationId}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Next high</div><div className="font-mono text-cyan-200">{tideResult.nextHigh ? `${tideResult.nextHigh.height.toFixed(2)} m · ${tideResult.nextHigh.time}` : '—'}</div></div>
                  <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Next low</div><div className="font-mono text-cyan-200">{tideResult.nextLow ? `${tideResult.nextLow.height.toFixed(2)} m · ${tideResult.nextLow.time}` : '—'}</div></div>
                </div>
                <div className="text-[10px] text-zinc-400">{tideResult.count ?? tideResult.predictions?.length ?? 0} predictions · {tideResult.beginDate} → {tideResult.endDate} (GMT, MLLW)</div>
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
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
        title: (t, s) => `Ocean profile — tides at ${t.location ?? t.stationId ?? 'station'} · ${s.waterMass ?? '—'} water mass`,
        content: (t, s) =>
          `Tide predictions (${t.location ?? tide.location}, station ${t.stationId ?? tide.stationId}):\n  Next high: ${t.nextHigh ? `${t.nextHigh.height} m @ ${t.nextHigh.time}` : '—'}\n  Next low: ${t.nextLow ? `${t.nextLow.height} m @ ${t.nextLow.time}` : '—'}\n  ${t.count ?? t.predictions?.length ?? 0} predictions, ${t.beginDate} → ${t.endDate} (GMT, MLLW, NOAA CO-OPS)\n\nSalinity profile:\n  Water mass: ${s.waterMass}\n  Avg salinity: ${s.avgSalinity} PSU\n  Max depth: ${s.maxDepth}m\n  Halocline: ${s.haloclineDepth}\n${(s.readings || []).map((r) => `  ${r.depth}m: ${r.salinity} PSU, ${r.temperature}°C`).join('\n')}`,
        tags: () => ['ocean', 'tide', 'salinity', 'water-column'],
        rawData: (t, s) => ({ tide, readings, tideResult: t, salResult: s }),
      }}
    />
  );
}
