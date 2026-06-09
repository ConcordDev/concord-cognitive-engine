'use client';

/**
 * MasonStuff — Mason Stuff App-style trade calculator suite.
 * Four bespoke widgets:
 *
 *  1. MaterialEstimator — square footage + material → units + mortar
 *                        + cost cards with brick-wall visualizer
 *  2. MortarMixReference — application picker → mix recipe card with
 *                         strength + cure-time + temperature limits
 *  3. WallStrengthCheck  — height/thickness/reinforced/load-bearing
 *                         → slenderness ratio gauge with pass/fail
 *  4. JobCosting         — editable job items → labor + materials
 *                         + overhead + profit grand-total breakdown
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Layers, Wrench, Hammer, DollarSign, Plus, Trash2, Loader2,
  AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

async function callMason<T>(action: string, data: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('masonry', action, { input: { artifact: { data } } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

interface MaterialResult { squareFootage?: number; material?: string; units?: number; mortarBags?: number; materialCost?: number; recommendation?: string }
interface MortarResult { application?: string; type?: string; ratio?: string; strength?: string; use?: string; waterRatio?: string; cureTime?: string; temperature?: string }
interface WallResult { heightFeet?: number; thicknessInches?: number; slendernessRatio?: number; maxAllowedRatio?: number; passesSlenderness?: boolean; reinforced?: boolean; loadBearing?: boolean; recommendation?: string }
interface JobItem { name: string; hours: string; rate: string; materialCost: string }
interface JobResult { items?: Array<{ item: string; laborHours: number; laborRate: number; laborCost: number; materialCost: number; totalCost: number }>; subtotalLabor?: number; subtotalMaterials?: number; overhead?: number; profit?: number; grandTotal?: number }

type Material = 'brick' | 'block' | 'stone';
type Application = 'general' | 'structural' | 'high-strength' | 'veneer' | 'repoint';

function MaterialEstimator() {
  const [sqft, setSqft] = useState(0);
  const [material, setMaterial] = useState<Material>('brick');
  const [result, setResult] = useState<MaterialResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callMason<MaterialResult>('materialEstimate', { squareFootage: sqft, material });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-red-700/30 bg-gradient-to-br from-zinc-950 via-red-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-red-700/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-red-400" />
          <span className="text-sm font-semibold text-white">Material estimator</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">masonry.materialEstimate</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-masonry-materials"
            title={`${sqft} sf ${material} — ${result.units} units, $${result.materialCost}`}
            content={`Square footage: ${result.squareFootage}\nMaterial: ${result.material}\nUnits needed (+5% waste): ${result.units}\nMortar bags: ${result.mortarBags}\nMaterial cost: $${result.materialCost}\n${result.recommendation || ''}`}
            extraTags={['masonry', 'material-estimate', material]} rawData={{ sqft, material, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Square footage</span>
            <input type="number" min={0} value={sqft || ''} onChange={(e) => setSqft(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 200" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Material</span>
            <select value={material} onChange={(e) => setMaterial(e.target.value as Material)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="brick">Brick (7/sf)</option>
              <option value="block">CMU block (1.125/sf)</option>
              <option value="stone">Stone (5/sf)</option>
            </select>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || sqft <= 0} className="w-full rounded bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Estimate'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter wall area.</div>}
          {result && (
            <>
              {/* Brick-wall visualizer */}
              <div className="rounded-lg border border-red-700/30 bg-zinc-950/60 p-2">
                <svg viewBox="0 0 280 60" className="w-full">
                  {Array.from({ length: 5 }, (_, row) =>
                    Array.from({ length: row % 2 ? 11 : 10 }, (_, col) => (
                      <rect key={`${row}-${col}`}
                        x={(row % 2 ? -12 : 0) + col * 26 + 4}
                        y={row * 11 + 2}
                        width={22} height={9}
                        fill="#dc2626"
                        stroke="#7f1d1d"
                        strokeWidth="0.5"
                      />
                    ))
                  )}
                </svg>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border-2 border-red-500/40 bg-red-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-red-300">Units</div><div className="font-mono text-2xl text-red-100">{result.units?.toLocaleString()}</div><div className="text-[9px] text-zinc-400">incl. 5% waste</div></div>
                <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-amber-300">Mortar bags</div><div className="font-mono text-2xl text-amber-100">{result.mortarBags}</div></div>
                <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-emerald-300">Cost</div><div className="font-mono text-2xl text-emerald-100">${result.materialCost?.toLocaleString()}</div></div>
              </div>
              {result.recommendation && <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">{result.recommendation}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MortarMixReference() {
  const [application, setApplication] = useState<Application>('general');
  const [result, setResult] = useState<MortarResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callMason<MortarResult>('mortarMix', { application });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-stone-500/30 bg-gradient-to-br from-zinc-950 via-stone-900/20 to-zinc-950">
      <header className="flex items-center justify-between border-b border-stone-500/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-stone-400" />
          <span className="text-sm font-semibold text-white">Mortar mix reference</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">masonry.mortarMix</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-masonry-mortar"
            title={`Mortar ${result.type} — ${result.application}`}
            content={`Application: ${result.application}\nType: ${result.type}\nRatio: ${result.ratio}\nStrength: ${result.strength}\nUse: ${result.use}\nWater: ${result.waterRatio}\nCure: ${result.cureTime}\nTemp: ${result.temperature}`}
            extraTags={['masonry', 'mortar', application]} rawData={{ application, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
          <select value={application} onChange={(e) => setApplication(e.target.value as Application)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            <option value="general">General (Type N)</option>
            <option value="structural">Structural / below-grade (Type S)</option>
            <option value="high-strength">High strength (Type M)</option>
            <option value="veneer">Veneer (Type N)</option>
            <option value="repoint">Repoint historic (Type O)</option>
          </select>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="rounded bg-stone-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Show recipe'}
          </button>
        </div>

        {result && (
          <div className="rounded-lg border-2 border-stone-500/40 bg-stone-500/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-2xl font-bold text-white">{result.type}</span>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-200">{result.strength}</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-sm text-stone-100">{result.ratio}</div>
            <div className="grid gap-1 text-[11px]">
              <div className="text-zinc-300"><span className="text-zinc-400">Use: </span>{result.use}</div>
              <div className="text-zinc-300"><span className="text-zinc-400">Water: </span>{result.waterRatio}</div>
              <div className="text-zinc-300"><span className="text-zinc-400">Cure: </span>{result.cureTime}</div>
              <div className="text-zinc-300"><span className="text-zinc-400">Temp: </span>{result.temperature}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WallStrengthCheck() {
  const [height, setHeight] = useState(0);
  const [thickness, setThickness] = useState(0);
  const [reinforced, setReinforced] = useState(true);
  const [loadBearing, setLoadBearing] = useState(true);
  const [result, setResult] = useState<WallResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callMason<WallResult>('wallStrength', { heightFeet: height, thicknessInches: thickness, reinforced, loadBearing });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-amber-700/30 bg-gradient-to-br from-zinc-950 via-amber-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-amber-700/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Hammer className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Wall strength check</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">masonry.wallStrength</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-masonry-wall"
            title={`Wall ${result.heightFeet}ft × ${result.thicknessInches}" — h/t ${result.slendernessRatio} (${result.passesSlenderness ? 'PASS' : 'FAIL'})`}
            content={`Height: ${result.heightFeet} ft\nThickness: ${result.thicknessInches}"\nReinforced: ${result.reinforced ? 'yes' : 'no'}\nLoad-bearing: ${result.loadBearing ? 'yes' : 'no'}\nSlenderness: ${result.slendernessRatio} (max ${result.maxAllowedRatio})\nPasses: ${result.passesSlenderness ? 'YES' : 'NO'}\n${result.recommendation || ''}`}
            extraTags={['masonry', 'wall-strength']} rawData={{ height, thickness, reinforced, loadBearing, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Height (ft)</span>
            <input type="number" min={0} step="0.5" value={height || ''} onChange={(e) => setHeight(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 8" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Thickness (inches)</span>
            <input type="number" min={0} step="0.5" value={thickness || ''} onChange={(e) => setThickness(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 8" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
            <input type="checkbox" checked={reinforced} onChange={(e) => setReinforced(e.target.checked)} />Reinforced
          </label>
          <label className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
            <input type="checkbox" checked={loadBearing} onChange={(e) => setLoadBearing(e.target.checked)} />Load-bearing
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || height <= 0 || thickness <= 0} className="w-full rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Check wall'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter wall dimensions.</div>}
          {result && (
            <>
              <div className={`rounded-lg border-2 p-3 ${result.passesSlenderness ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-zinc-300">Slenderness ratio</span>
                  {result.passesSlenderness ? <ShieldCheck className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-rose-300" />}
                </div>
                <div className="mt-1 font-mono text-3xl text-white">{result.slendernessRatio} <span className="text-sm text-zinc-400">/ max {result.maxAllowedRatio}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div className={`h-full ${(result.slendernessRatio || 0) > (result.maxAllowedRatio || 1) ? 'bg-rose-500' : (result.slendernessRatio || 0) > (result.maxAllowedRatio || 1) * 0.8 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, ((result.slendernessRatio || 0) / (result.maxAllowedRatio || 1)) * 100)}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-zinc-400">Max allowed = {result.reinforced ? 25 : 20} for {result.reinforced ? 'reinforced' : 'unreinforced'} walls</div>
              </div>
              {result.recommendation && <div className={`rounded border px-2 py-1.5 text-[11px] ${result.passesSlenderness ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>{result.recommendation}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function JobCosting() {
  const [items, setItems] = useState<JobItem[]>([{ name: '', hours: '', rate: '55', materialCost: '' }]);
  const [result, setResult] = useState<JobResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const jobItems = items.filter((i) => i.name.trim()).map((i) => ({
        name: i.name, hours: parseFloat(i.hours) || 0, rate: parseFloat(i.rate) || 55, materialCost: parseFloat(i.materialCost) || 0,
      }));
      const r = await callMason<JobResult>('jobCosting', { items: jobItems });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-green-500/20 bg-gradient-to-br from-zinc-950 via-green-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-green-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-green-400" />
          <span className="text-sm font-semibold text-white">Job costing</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">masonry.jobCosting</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-masonry-cost"
            title={`Job total $${result.grandTotal} (${(result.items || []).length} items)`}
            content={`Subtotal labor: $${result.subtotalLabor}\nSubtotal materials: $${result.subtotalMaterials}\nOverhead (15%): $${result.overhead}\nProfit (10%): $${result.profit}\nGrand total: $${result.grandTotal}\n\nItems:\n${(result.items || []).map((i) => `  ${i.item}: ${i.laborHours}h × $${i.laborRate} = $${i.laborCost} labor + $${i.materialCost} materials = $${i.totalCost}`).join('\n')}`}
            extraTags={['masonry', 'job-costing']} rawData={{ items, result }} />
        )}
      </header>

      <div className="p-4 space-y-2">
        <div className="grid grid-cols-[1fr_70px_70px_90px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
          <span>Item</span><span>Hours</span><span>Rate $/h</span><span>Materials $</span><span></span>
        </div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_70px_90px_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Foundation pour" value={it.name} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
            <input type="number" step="0.5" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={it.hours} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, hours: e.target.value } : x))} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={it.rate} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, rate: e.target.value } : x))} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={it.materialCost} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, materialCost: e.target.value } : x))} />
            <button aria-label="Delete" type="button" onClick={() => setItems((is) => is.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setItems((is) => [...is, { name: '', hours: '', rate: '55', materialCost: '' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-green-500/40"><Plus className="h-3 w-3" />Add item</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || items.filter((i) => i.name.trim()).length === 0} className="rounded bg-green-500 px-3 py-1 text-xs font-semibold text-white hover:bg-green-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Cost out'}
          </button>
        </div>

        {result && (
          <div className="space-y-2 pt-2">
            {result.items?.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_90px] gap-2 rounded border border-green-500/15 bg-zinc-950/40 px-2 py-1 text-[11px]">
                <span className="text-zinc-100 truncate">{it.item}</span>
                <span className="font-mono text-zinc-400">{it.laborHours}h × ${it.laborRate}</span>
                <span className="text-right font-mono text-green-200">${it.totalCost}</span>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="rounded border border-green-500/15 bg-zinc-950/40 px-2 py-1.5 text-[11px]"><span className="text-zinc-400">Labor: </span><span className="font-mono text-green-200">${result.subtotalLabor}</span></div>
              <div className="rounded border border-green-500/15 bg-zinc-950/40 px-2 py-1.5 text-[11px]"><span className="text-zinc-400">Materials: </span><span className="font-mono text-green-200">${result.subtotalMaterials}</span></div>
              <div className="rounded border border-zinc-700 bg-zinc-900/40 px-2 py-1.5 text-[11px]"><span className="text-zinc-400">Overhead (15%): </span><span className="font-mono text-zinc-200">${result.overhead}</span></div>
              <div className="rounded border border-zinc-700 bg-zinc-900/40 px-2 py-1.5 text-[11px]"><span className="text-zinc-400">Profit (10%): </span><span className="font-mono text-zinc-200">${result.profit}</span></div>
            </div>
            <div className="rounded-lg border-2 border-green-500/40 bg-green-500/10 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-green-300">Grand total</div>
              <div className="font-mono text-3xl text-green-100">${result.grandTotal?.toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MasonStuff() {
  return (
    <div className="space-y-4">
      <MaterialEstimator />
      <MortarMixReference />
      <WallStrengthCheck />
      <JobCosting />
    </div>
  );
}
