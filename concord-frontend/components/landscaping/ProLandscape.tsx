'use client';

/**
 * ProLandscape — Pro Landscape-style landscape design suite.
 * Four bespoke widgets:
 *
 *  1. PlantSelector       — zone + sun + soil → suitable plant cards
 *                          with type badges
 *  2. IrrigationCalc      — sqft + plant type → gallons/week, runtime,
 *                          monthly cost
 *  3. SeasonalPlanCalendar — zone → 4-season action list with the
 *                          current season highlighted
 *  4. MaterialEstimator   — sqft + material → cubic yards / bags /
 *                          estimated cost / delivery recommendation
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Leaf, Droplets, CalendarDays, Truck, Loader2,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

async function callLand<T>(action: string, data: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('landscaping', action, { input: { artifact: { data } } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

interface PlantResult { zone?: number; sunExposure?: string; soilType?: string; recommendations?: Array<{ name: string; type: string }>; totalMatches?: number }
interface IrrigationResult { squareFootage?: number; plantType?: string; inchesPerWeek?: number; gallonsPerWeek?: number; gallonsPerMonth?: number; runtimeMinutes?: number; frequency?: string; monthlyCost?: number }
interface SeasonResult { zone?: number; plan?: Record<string, string[]>; currentSeason?: string; immediateActions?: string[] }
interface MaterialResult { material?: string; squareFootage?: number; depthInches?: number; cubicYards?: number; bags?: number; estimatedCost?: number; deliveryNote?: string }

function PlantSelector() {
  const [zone, setZone] = useState(0);
  const [sun, setSun] = useState<'full' | 'partial' | 'shade'>('full');
  const [soil, setSoil] = useState<'loam' | 'clay' | 'sandy'>('loam');
  const [result, setResult] = useState<PlantResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callLand<PlantResult>('plantSelection', { hardnessZone: zone, sunExposure: sun, soilType: soil });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-zinc-950 via-emerald-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-emerald-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Leaf className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">Plant selector</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">landscaping.plantSelection</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-landscape-plants"
            title={`Plants for zone ${result.zone}, ${result.sunExposure} sun, ${result.soilType} soil — ${result.totalMatches} matches`}
            content={`Zone ${result.zone} · ${result.sunExposure} · ${result.soilType}\n\nMatches (${result.totalMatches}):\n${(result.recommendations || []).map((p) => `  ${p.name} (${p.type})`).join('\n')}`}
            extraTags={['landscaping', 'plant-selection', `zone-${zone}`]} rawData={{ zone, sun, soil, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">USDA Hardiness Zone</span>
            <input type="number" min={1} max={13} value={zone || ''} onChange={(e) => setZone(Math.max(1, Math.min(13, Number(e.target.value) || 0)))} placeholder="e.g. 7 (mid-Atlantic)" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Sun exposure</span>
            <select value={sun} onChange={(e) => setSun(e.target.value as typeof sun)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="full">Full sun (6+ hrs)</option>
              <option value="partial">Partial (3-6 hrs)</option>
              <option value="shade">Shade (&lt;3 hrs)</option>
            </select>
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Soil type</span>
            <select value={soil} onChange={(e) => setSoil(e.target.value as typeof soil)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="loam">Loam</option><option value="clay">Clay</option><option value="sandy">Sandy</option>
            </select>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || zone < 1} className="w-full rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Find plants'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter zone + sun + soil.</div>}
          {result && (
            <>
              <div className="text-[11px] text-zinc-400">{result.totalMatches} match{result.totalMatches === 1 ? '' : 'es'} for zone {result.zone}, {result.sunExposure} sun, {result.soilType} soil</div>
              {result.totalMatches === 0 && <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">No matches in the built-in library. Try a different sun or soil combination.</div>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {result.recommendations?.map((p, i) => (
                  <div key={i} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <div className="flex items-center gap-2">
                      <Leaf className="h-3.5 w-3.5 text-emerald-300" />
                      <span className="text-[12px] font-semibold text-white">{p.name}</span>
                    </div>
                    <span className="mt-1 inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] text-emerald-200">{p.type}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function IrrigationCalc() {
  const [sqft, setSqft] = useState(0);
  const [plantType, setPlantType] = useState<'lawn' | 'garden' | 'shrubs' | 'trees' | 'xeriscape'>('lawn');
  const [result, setResult] = useState<IrrigationResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callLand<IrrigationResult>('irrigationCalc', { squareFootage: sqft, plantType });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-zinc-950 via-cyan-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-cyan-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Irrigation calculator</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">landscaping.irrigationCalc</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-landscape-irrigation"
            title={`${result.squareFootage} sf ${result.plantType} — ${result.gallonsPerWeek} gal/wk ($${result.monthlyCost}/mo)`}
            content={`Area: ${result.squareFootage} sf\nPlant type: ${result.plantType}\nWater need: ${result.inchesPerWeek}"/wk\nGallons/week: ${result.gallonsPerWeek}\nGallons/month: ${result.gallonsPerMonth}\nRuntime: ${result.runtimeMinutes} min\nFrequency: ${result.frequency}\nMonthly cost: $${result.monthlyCost}`}
            extraTags={['landscaping', 'irrigation', plantType]} rawData={{ sqft, plantType, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Square footage</span>
            <input type="number" min={0} value={sqft || ''} onChange={(e) => setSqft(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 1500" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Plant type</span>
            <select value={plantType} onChange={(e) => setPlantType(e.target.value as typeof plantType)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="lawn">Lawn (1.0&Prime;/wk)</option>
              <option value="garden">Garden (0.8&Prime;)</option>
              <option value="shrubs">Shrubs (0.6&Prime;)</option>
              <option value="trees">Trees (0.4&Prime;)</option>
              <option value="xeriscape">Xeriscape (0.2&Prime;)</option>
            </select>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || sqft <= 0} className="w-full rounded bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Calculate'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter area + plant type.</div>}
          {result && (
            <>
              <div className="rounded-lg border-2 border-cyan-500/40 bg-cyan-500/10 p-3">
                <div className="text-[10px] uppercase tracking-wider text-cyan-300">Weekly water need</div>
                <div className="font-mono text-3xl text-cyan-100">{result.gallonsPerWeek?.toLocaleString()} <span className="text-sm text-zinc-400">gal/wk</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Runtime</div><div className="font-mono text-cyan-200">{result.runtimeMinutes} min</div></div>
                <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Frequency</div><div className="font-mono text-cyan-200">{result.frequency}</div></div>
                <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5"><div className="text-[9px] text-emerald-300">$/mo</div><div className="font-mono text-emerald-100">${result.monthlyCost}</div></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SeasonalPlanCalendar() {
  const [zone, setZone] = useState(0);
  const [result, setResult] = useState<SeasonResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callLand<SeasonResult>('seasonalPlan', { hardnessZone: zone });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-zinc-950 via-amber-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-amber-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Seasonal plan</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">landscaping.seasonalPlan</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-landscape-season"
            title={`Seasonal plan zone ${result.zone} — current: ${result.currentSeason}`}
            content={`Zone: ${result.zone}\nCurrent season: ${result.currentSeason}\n\nThis season's actions:\n${(result.immediateActions || []).map((a) => `  - ${a}`).join('\n')}\n\nFull plan:\n${Object.entries(result.plan || {}).map(([s, tasks]) => `\n${s.toUpperCase()}:\n${tasks.map((t) => `  - ${t}`).join('\n')}`).join('\n')}`}
            extraTags={['landscaping', 'seasonal-plan']} rawData={{ zone, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
          <input type="number" min={1} max={13} value={zone || ''} onChange={(e) => setZone(Math.max(1, Math.min(13, Number(e.target.value) || 0)))} placeholder="USDA zone (1-13)" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || zone < 1} className="rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Generate'}
          </button>
        </div>

        {result?.plan && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(Object.entries(result.plan)).map(([season, tasks]) => {
              const isCurrent = season === result.currentSeason;
              return (
                <div key={season} className={`rounded-lg border p-3 ${isCurrent ? 'border-amber-500/40 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/40'}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`text-[11px] font-semibold uppercase tracking-wider ${isCurrent ? 'text-amber-200' : 'text-zinc-400'}`}>{season}</span>
                    {isCurrent && <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[9px] text-amber-100">now</span>}
                  </div>
                  <ul className="space-y-1 text-[11px] text-zinc-300">
                    {tasks.map((t, i) => <li key={i}>• {t}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MaterialEstimator() {
  const [sqft, setSqft] = useState(0);
  const [material, setMaterial] = useState<'mulch' | 'gravel' | 'topsoil' | 'compost' | 'sand'>('mulch');
  const [result, setResult] = useState<MaterialResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callLand<MaterialResult>('materialEstimate', { squareFootage: sqft, material });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-stone-500/30 bg-gradient-to-br from-zinc-950 via-stone-900/20 to-zinc-950">
      <header className="flex items-center justify-between border-b border-stone-500/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-stone-400" />
          <span className="text-sm font-semibold text-white">Bulk material estimator</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">landscaping.materialEstimate</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-landscape-material"
            title={`${result.material} — ${result.cubicYards} cu yd ($${result.estimatedCost})`}
            content={`Material: ${result.material}\nArea: ${result.squareFootage} sf\nDepth: ${result.depthInches}"\nCubic yards: ${result.cubicYards}\nBags: ${result.bags}\nCost: $${result.estimatedCost}\n${result.deliveryNote}`}
            extraTags={['landscaping', 'material-estimate', material]} rawData={{ sqft, material, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Coverage area (sf)</span>
            <input type="number" min={0} value={sqft || ''} onChange={(e) => setSqft(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 500" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Material</span>
            <select value={material} onChange={(e) => setMaterial(e.target.value as typeof material)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="mulch">Mulch (3&Prime;)</option><option value="gravel">Gravel (2&Prime;)</option>
              <option value="topsoil">Topsoil (4&Prime;)</option><option value="compost">Compost (2&Prime;)</option>
              <option value="sand">Sand (2&Prime;)</option>
            </select>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || sqft <= 0} className="w-full rounded bg-stone-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Estimate'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter area + material.</div>}
          {result && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border-2 border-stone-500/40 bg-stone-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-stone-300">Cubic yards</div><div className="font-mono text-2xl text-stone-100">{result.cubicYards}</div></div>
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-amber-300">Bags</div><div className="font-mono text-2xl text-amber-100">{result.bags}</div></div>
                <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-emerald-300">Cost</div><div className="font-mono text-2xl text-emerald-100">${result.estimatedCost?.toLocaleString()}</div></div>
              </div>
              {result.deliveryNote && (
                <div className={`flex items-center gap-2 rounded border px-3 py-2 text-[11px] ${result.deliveryNote.toLowerCase().includes('bulk') ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-zinc-800 bg-zinc-950/40 text-zinc-300'}`}>
                  <Truck className="h-3.5 w-3.5" />{result.deliveryNote}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProLandscape() {
  return (
    <div className="space-y-4">
      <PlantSelector />
      <IrrigationCalc />
      <SeasonalPlanCalendar />
      <MaterialEstimator />
    </div>
  );
}
