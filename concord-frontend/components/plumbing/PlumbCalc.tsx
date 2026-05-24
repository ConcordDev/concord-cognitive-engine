'use client';

/**
 * PlumbCalc — PlumbCalc-Pro-style trade calculator suite for the
 * plumbing lens. Four bespoke widgets, each visually distinct
 * (no shared shell):
 *
 *  1. PipeSizer       — copper/PEX/CPVC chooser + flow/velocity →
 *                       calculated diameter + nominal-size highlight
 *                       on a horizontal pipe-size wheel
 *  2. WaterHeaterSizer — household + simultaneous-fixture sliders →
 *                       side-by-side tank vs tankless cards with
 *                       first-hour rating and kW recommendation
 *  3. DrainSlope      — pipe-size + run-length → ASCII-style cross-
 *                       section showing the slope angle + IPC code ref
 *  4. FixtureSupply   — fixture table with running WSFU total +
 *                       meter-size badge that updates live
 *
 * All four call existing plumbing.* macros (no backend changes).
 * No mock data — every input starts empty or with a clearly-labelled
 * minimum-valid value (e.g. flow=0 prompts "enter flow"). Each
 * widget has its own Save-as-DTU button for its own result.
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Wrench, Droplets, Flame, ArrowDown, Plus, Trash2, Loader2,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

async function callPlumbing<T>(action: string, data: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('plumbing', action, { input: { artifact: { data } } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

interface PipeSizeResult { flowRate?: string; velocity?: string; calculatedDiameter?: string; recommendedSize?: string; material?: string; note?: string }
interface WaterHeaterResult { household?: number; peakDemandGPM?: number; tankRecommendation?: string; tanklessRecommendation?: string; firstHourRating?: number; recommendation?: string }
interface DrainSlopeResult { pipeSize?: string; length?: string; slopePerFoot?: string; totalDrop?: string; ipcCode?: string; tip?: string }
interface Fixture { type: string; count: string }
interface FixtureResult { fixtures?: number; totalWSFU?: number; meterSize?: string; supplyLine?: string; note?: string }

const NOMINAL_SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const FIXTURE_TYPES = ['toilet', 'lavatory', 'bathtub', 'shower', 'kitchen-sink', 'dishwasher', 'washing-machine', 'hose-bib'];

function PipeSizer() {
  const [flowGPM, setFlowGPM] = useState(0);
  const [velocity, setVelocity] = useState(5);
  const [material, setMaterial] = useState<'copper' | 'pex' | 'cpvc' | 'galvanized'>('copper');
  const [result, setResult] = useState<PipeSizeResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callPlumbing<PipeSizeResult>('pipeSize', { flowGPM, velocityFPS: velocity, material });
      setResult(r);
      return r;
    },
  });

  // Extract recommended nominal from result string e.g. "1.25\" nominal"
  const recommendedNominal = useMemo(() => {
    if (!result?.recommendedSize) return null;
    const m = result.recommendedSize.match(/^([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }, [result]);

  return (
    <div className="overflow-hidden rounded-xl border border-blue-500/20 bg-gradient-to-br from-zinc-950 via-blue-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-blue-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-semibold text-white">Pipe sizer</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">plumbing.pipeSize</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-plumbing-pipesize"
            title={`Pipe sizer — ${flowGPM} GPM @ ${velocity} ft/s → ${result.recommendedSize} (${material})`}
            content={`Flow: ${result.flowRate}\nVelocity: ${result.velocity}\nCalculated diameter: ${result.calculatedDiameter}\nRecommended: ${result.recommendedSize}\nMaterial: ${result.material}\nNote: ${result.note}`}
            extraTags={['plumbing', 'pipe-sizing', material]}
            rawData={{ flowGPM, velocity, material, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Flow (GPM)</span>
            <input type="number" min={0} step={0.5} value={flowGPM || ''} onChange={(e) => setFlowGPM(Math.max(0, Number(e.target.value) || 0))} placeholder="Enter flow rate" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Velocity (ft/s)</span>
            <input type="number" min={1} max={15} step={0.5} value={velocity} onChange={(e) => setVelocity(Math.max(1, Math.min(15, Number(e.target.value) || 5)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
            <span className="mt-0.5 block text-[9px] text-zinc-400">8 ft/s ≈ erosion threshold</span>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Material</span>
            <select value={material} onChange={(e) => setMaterial(e.target.value as typeof material)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="copper">Copper (Type L)</option>
              <option value="pex">PEX-B</option>
              <option value="cpvc">CPVC</option>
              <option value="galvanized">Galvanized steel</option>
            </select>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || flowGPM <= 0} className="w-full rounded bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Size pipe'}
          </button>
        </div>

        <div className="space-y-3">
          {/* Pipe-size wheel — horizontal strip with each nominal size as a swatch; recommended is highlighted */}
          <div className="rounded-lg border border-blue-500/15 bg-zinc-950/40 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Nominal sizes</div>
            <div className="flex items-end gap-1">
              {NOMINAL_SIZES.map((size) => {
                const isRec = recommendedNominal === size;
                const heightPx = 14 + size * 16;
                return (
                  <div key={size} className={`flex flex-col items-center gap-1 rounded px-2 pt-2 pb-1 transition ${isRec ? 'bg-blue-500/30 ring-2 ring-blue-400' : 'bg-zinc-900/40'}`}>
                    <div className={`rounded ${isRec ? 'bg-blue-400' : 'bg-zinc-700'}`} style={{ width: heightPx, height: heightPx }} />
                    <span className={`font-mono text-[10px] ${isRec ? 'text-blue-100 font-bold' : 'text-zinc-400'}`}>{size}&Prime;</span>
                  </div>
                );
              })}
            </div>
          </div>

          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter flow rate above and tap "Size pipe".</div>}
          {result && (
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="rounded border border-blue-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Calculated</div><div className="font-mono text-blue-200">{result.calculatedDiameter}</div></div>
              <div className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1.5"><div className="text-[9px] text-blue-300">Recommended</div><div className="font-mono text-blue-100">{result.recommendedSize}</div></div>
              <div className="rounded border border-blue-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Material</div><div className="font-mono text-zinc-300">{result.material}</div></div>
              {result.note && <div className="col-span-3 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-amber-200">{result.note}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WaterHeaterSizer() {
  const [household, setHousehold] = useState(0);
  const [simultaneous, setSimultaneous] = useState(0);
  const [result, setResult] = useState<WaterHeaterResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callPlumbing<WaterHeaterResult>('waterHeaterSize', { household, simultaneousFixtures: simultaneous });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-orange-500/20 bg-gradient-to-br from-zinc-950 via-orange-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-orange-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-semibold text-white">Water heater recommender</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">plumbing.waterHeaterSize</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-plumbing-waterheater"
            title={`Water heater — ${household}p / ${simultaneous}fix → ${result.tankRecommendation} or ${result.tanklessRecommendation}`}
            content={`Household: ${result.household} people\nPeak demand: ${result.peakDemandGPM} GPM\nFirst-hour rating target: ${result.firstHourRating} gal\n\nOption A — Tank: ${result.tankRecommendation}\nOption B — Tankless: ${result.tanklessRecommendation}\n\nNote: ${result.recommendation}`}
            extraTags={['plumbing', 'water-heater']} rawData={{ household, simultaneous, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Household size</span>
            <input type="range" min={1} max={8} value={household} onChange={(e) => setHousehold(Number(e.target.value))} className="mt-1 w-full" />
            <div className="font-mono text-xl text-orange-200">{household || '—'} <span className="text-xs text-zinc-400">people</span></div>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Simultaneous fixtures</span>
            <input type="range" min={1} max={6} value={simultaneous} onChange={(e) => setSimultaneous(Number(e.target.value))} className="mt-1 w-full" />
            <div className="font-mono text-xl text-orange-200">{simultaneous || '—'} <span className="text-xs text-zinc-400">at peak</span></div>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || household < 1 || simultaneous < 1} className="w-full rounded bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Recommend'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Set household + simultaneous-fixtures sliders above.</div>}
          {result && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border-2 border-orange-500/40 bg-orange-500/10 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-orange-300">Tank option</div>
                  <div className="mt-1 font-mono text-xl text-orange-100">{result.tankRecommendation}</div>
                  <div className="mt-1 text-[10px] text-zinc-400">First-hour rating: <span className="font-mono text-orange-200">{result.firstHourRating} gal</span></div>
                </div>
                <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-amber-300">Tankless option</div>
                  <div className="mt-1 font-mono text-xl text-amber-100">{result.tanklessRecommendation}</div>
                  <div className="mt-1 text-[10px] text-zinc-400">Peak demand: <span className="font-mono text-amber-200">{result.peakDemandGPM} GPM</span></div>
                </div>
              </div>
              {result.recommendation && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-200">{result.recommendation}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DrainSlopeCalculator() {
  const [pipeSize, setPipeSize] = useState(0);
  const [length, setLength] = useState(0);
  const [result, setResult] = useState<DrainSlopeResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callPlumbing<DrainSlopeResult>('drainSlope', { pipeSizeInches: pipeSize, lengthFeet: length });
      setResult(r);
      return r;
    },
  });

  // Visualize the slope: pipe shown as right triangle, drop on right
  const dropInches = useMemo(() => {
    if (!result?.totalDrop) return 0;
    const m = result.totalDrop.match(/^([\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  }, [result]);

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-zinc-950 via-emerald-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-emerald-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <ArrowDown className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">Drain slope</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">plumbing.drainSlope</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-plumbing-drainslope"
            title={`Drain slope — ${result.pipeSize} × ${result.length} → ${result.totalDrop} drop`}
            content={`Pipe: ${result.pipeSize}\nRun: ${result.length}\nSlope: ${result.slopePerFoot}\nTotal drop: ${result.totalDrop}\n${result.ipcCode}\n\n${result.tip}`}
            extraTags={['plumbing', 'drain-slope']} rawData={{ pipeSize, length, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Pipe size (inches)</span>
            <input type="number" min={0} step={0.25} value={pipeSize || ''} onChange={(e) => setPipeSize(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 2" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Run length (ft)</span>
            <input type="number" min={0} value={length || ''} onChange={(e) => setLength(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 20" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || pipeSize <= 0 || length <= 0} className="w-full rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Compute slope'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter pipe size + run length above.</div>}
          {result && dropInches > 0 && (
            <>
              {/* Side-view ASCII-style cross-section */}
              <div className="rounded-lg border border-emerald-500/15 bg-zinc-950 p-4">
                <svg viewBox="0 0 280 80" className="w-full" preserveAspectRatio="xMidYMid meet">
                  {/* Pipe drawn as parallelogram showing slope */}
                  <polygon points="20,20 260,40 260,55 20,35" fill="rgba(16, 185, 129, 0.3)" stroke="#10b981" strokeWidth="1.5" />
                  {/* Drop indicator on right side */}
                  <line x1="262" y1="20" x2="262" y2="40" stroke="#fbbf24" strokeWidth="2" />
                  <text x="266" y="32" fill="#fbbf24" fontSize="10" fontFamily="monospace">↓ {dropInches}&Prime;</text>
                  {/* Length label */}
                  <line x1="20" y1="65" x2="260" y2="65" stroke="#71717a" strokeWidth="0.5" strokeDasharray="2,2" />
                  <text x="140" y="76" fill="#71717a" fontSize="9" fontFamily="monospace" textAnchor="middle">{result.length}</text>
                </svg>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Slope</div><div className="font-mono text-emerald-200">{result.slopePerFoot}</div></div>
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1"><div className="text-[9px] text-amber-300">Total drop</div><div className="font-mono text-amber-100">{result.totalDrop}</div></div>
                <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Pipe</div><div className="font-mono text-zinc-300">{result.pipeSize}</div></div>
              </div>
              {result.ipcCode && <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-400">{result.ipcCode}</div>}
              {result.tip && <div className="text-[10px] text-zinc-400">💡 {result.tip}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FixtureSupplyCalc() {
  const [fixtures, setFixtures] = useState<Fixture[]>([{ type: 'toilet', count: '' }]);
  const [result, setResult] = useState<FixtureResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const cleanFixtures = fixtures.filter((f) => f.count.trim() && parseInt(f.count) > 0).map((f) => ({ type: f.type, count: parseInt(f.count) }));
      const r = await callPlumbing<FixtureResult>('fixtureCount', { fixtures: cleanFixtures });
      setResult(r);
      return r;
    },
  });

  const addFixture = () => setFixtures((fs) => [...fs, { type: 'toilet', count: '' }]);
  const updateFixture = (i: number, key: keyof Fixture, value: string) => setFixtures((fs) => fs.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  const removeFixture = (i: number) => setFixtures((fs) => fs.filter((_, idx) => idx !== i));

  const totalFixtures = fixtures.filter((f) => f.count && parseInt(f.count) > 0).length;

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-zinc-950 via-cyan-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-cyan-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Fixture supply (WSFU)</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">plumbing.fixtureCount</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-plumbing-fixturecount"
            title={`Fixture supply — ${result.fixtures} fixtures, ${result.totalWSFU} WSFU, ${result.meterSize} meter`}
            content={`Fixtures: ${result.fixtures}\nTotal WSFU: ${result.totalWSFU}\nMeter size: ${result.meterSize}\nSupply line: ${result.supplyLine}\n${result.note}\n\nBreakdown:\n${fixtures.filter((f) => f.count).map((f) => `  ${f.type} × ${f.count}`).join('\n')}`}
            extraTags={['plumbing', 'wsfu', 'fixture-supply']} rawData={{ fixtures, result }} />
        )}
      </header>

      <div className="p-4">
        <div className="space-y-1.5">
          {fixtures.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_30px] gap-2">
              <select value={f.type} onChange={(e) => updateFixture(i, 'type', e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
                {FIXTURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" min={0} value={f.count} onChange={(e) => updateFixture(i, 'count', e.target.value)} placeholder="0" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono text-right" />
              <button type="button" onClick={() => removeFixture(i)} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={addFixture} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500/40 hover:text-cyan-200"><Plus className="h-3 w-3" />Add fixture</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || totalFixtures === 0} className="rounded bg-cyan-500 px-3 py-1 text-xs font-semibold text-white hover:bg-cyan-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Calculate'}
          </button>
        </div>

        {result && (
          <div className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
            <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Fixtures</div><div className="font-mono text-cyan-200">{result.fixtures}</div></div>
            <div className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1"><div className="text-[9px] text-cyan-300">Total WSFU</div><div className="font-mono text-cyan-100">{result.totalWSFU}</div></div>
            <div className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1"><div className="text-[9px] text-blue-300">Meter</div><div className="font-mono text-blue-100">{result.meterSize}</div></div>
            <div className="rounded border border-cyan-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Supply line</div><div className="font-mono text-cyan-200">{result.supplyLine}</div></div>
            {result.note && <div className="col-span-4 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-400">{result.note}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function PlumbCalc() {
  return (
    <div className="space-y-4">
      <PipeSizer />
      <WaterHeaterSizer />
      <DrainSlopeCalculator />
      <FixtureSupplyCalc />
    </div>
  );
}
