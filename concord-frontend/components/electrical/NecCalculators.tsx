'use client';

/**
 * NecCalculators — three stateless NEC compute widgets:
 *   1. ConduitFillCalc — conductor list → recommended conduit size + fill %
 *   2. BoxFillCalc     — NEC 314.16 box-fill volume verification
 *   3. WireSizeCalc    — load → ampacity wire + breaker + voltage-drop upsize
 *
 * Every value rendered is returned by an electrical.* macro. No mock data.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Cable, Box, Ruler, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const AWG_LIST = [14, 12, 10, 8, 6, 4, 3, 2, 1];

interface ConductorRow { awg: number; count: string }
interface ConduitFillResult {
  message?: string;
  conductors?: Array<{ awg: string; count: number; areaTotal: number }>;
  totalConductors?: number;
  totalConductorArea?: number;
  conduitType?: string;
  necFillLimitPercent?: number;
  fillRule?: string;
  recommendedConduitSize?: string;
  recommendedActualFillPercent?: number;
  requested?: { size: string; actualFillPercent: number; allowedFillPercent: number; pass: boolean } | null;
}
interface BoxFillResult {
  message?: string;
  largestConductor?: string;
  volumePerConductor?: number;
  breakdown?: Array<{ item: string; equivalents: number }>;
  totalConductorEquivalents?: number;
  requiredBoxVolume?: number;
  providedBoxVolume?: number;
  pass?: boolean | null;
  verdict?: string;
}
interface WireSizeResult {
  message?: string;
  loadAmps?: number;
  continuous?: boolean;
  designAmps?: number;
  ampacityRequiredWire?: string;
  minBreaker?: string;
  recommendedWire?: string;
  recommendedAmpacity?: number;
  voltageDropAtRecommended?: string;
  upsizedForVoltageDrop?: boolean;
  basis?: string;
}

function ConduitFillCalc() {
  const [conductorType, setConductorType] = useState('EMT');
  const [conduitSize, setConduitSize] = useState('');
  const [rows, setRows] = useState<ConductorRow[]>([{ awg: 12, count: '3' }]);
  const [result, setResult] = useState<ConduitFillResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const conductors = rows
        .filter((r) => (parseInt(r.count) || 0) > 0)
        .map((r) => ({ awg: r.awg, count: parseInt(r.count) || 0 }));
      const r = await lensRun<ConduitFillResult>('electrical', 'conduitFill', {
        conductors,
        conduitType: conductorType,
        conduitSize: conduitSize || undefined,
      });
      setResult(r.data.result);
      return r.data.result;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-sky-500/20 bg-gradient-to-br from-zinc-950 via-sky-950/10 to-zinc-950">
      <header className="flex items-center gap-2 border-b border-sky-500/20 bg-zinc-900/40 px-4 py-2">
        <Cable className="h-4 w-4 text-sky-400" />
        <span className="text-sm font-semibold text-white">Conduit fill calculator</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.conduitFill</span>
      </header>
      <div className="space-y-2 p-4">
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Conduit type</span>
            <select value={conductorType} onChange={(e) => setConductorType(e.target.value)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
              <option value="EMT">EMT</option><option value="PVC">PVC Sch 40</option><option value="RMC">Rigid (RMC)</option>
            </select>
          </label>
          <label className="flex-1">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Verify size (optional)</span>
            <select value={conduitSize} onChange={(e) => setConduitSize(e.target.value)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono">
              <option value="">Auto-recommend</option>
              {['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3'].map((s) => <option key={s} value={s}>{s}&quot;</option>)}
            </select>
          </label>
        </div>
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_1fr_30px] gap-2 text-[9px] uppercase tracking-wider text-zinc-400">
            <span>Conductor AWG</span><span>Count</span><span></span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_30px] gap-2">
              <select value={r.awg} onChange={(e) => setRows((rs) => rs.map((x, idx) => idx === i ? { ...x, awg: Number(e.target.value) } : x))} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono">
                {AWG_LIST.map((g) => <option key={g} value={g}>{g} AWG THHN</option>)}
              </select>
              <input type="number" min={0} value={r.count} onChange={(e) => setRows((rs) => rs.map((x, idx) => idx === i ? { ...x, count: e.target.value } : x))} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" />
              <button aria-label="Delete" type="button" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setRows((rs) => [...rs, { awg: 12, count: '1' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-sky-500/40"><Plus className="h-3 w-3" />Add conductor</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="rounded bg-sky-500 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Size conduit'}
          </button>
        </div>
        {result?.message && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-400">{result.message}</div>}
        {result && !result.message && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1.5"><div className="text-[9px] text-sky-300">Recommended</div><div className="font-mono text-lg text-sky-100">{result.recommendedConduitSize}</div></div>
              <div className="rounded border border-sky-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Actual fill</div><div className="font-mono text-lg text-zinc-200">{result.recommendedActualFillPercent}%</div></div>
              <div className="rounded border border-sky-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">NEC limit</div><div className="font-mono text-lg text-zinc-200">{result.necFillLimitPercent}%</div></div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-400">{result.fillRule} · {result.totalConductors} conductors · {result.totalConductorArea} in&sup2;</div>
            {result.requested && (
              <div className={`rounded border px-2 py-1.5 text-[11px] ${result.requested.pass ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`}>
                {result.requested.size}&quot; conduit: {result.requested.actualFillPercent}% fill ({result.requested.allowedFillPercent}% allowed) — {result.requested.pass ? 'PASS' : 'FAIL — too full'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BoxFillCalc() {
  const [f, setF] = useState({ largestAwg: 14, currentCarrying: '4', groundConductors: '2', devices: '1', internalClamps: true, supportFittings: '0', boxVolumeCubicInches: '' });
  const [result, setResult] = useState<BoxFillResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await lensRun<BoxFillResult>('electrical', 'boxFill', {
        largestAwg: f.largestAwg,
        currentCarrying: parseInt(f.currentCarrying) || 0,
        groundConductors: parseInt(f.groundConductors) || 0,
        devices: parseInt(f.devices) || 0,
        internalClamps: f.internalClamps,
        supportFittings: parseInt(f.supportFittings) || 0,
        boxVolumeCubicInches: parseFloat(f.boxVolumeCubicInches) || 0,
      });
      setResult(r.data.result);
      return r.data.result;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-zinc-950 via-amber-950/10 to-zinc-950">
      <header className="flex items-center gap-2 border-b border-amber-500/20 bg-zinc-900/40 px-4 py-2">
        <Box className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-semibold text-white">Box fill calculator</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.boxFill</span>
      </header>
      <div className="grid grid-cols-2 gap-2 p-4">
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Largest conductor</span>
          <select value={f.largestAwg} onChange={(e) => setF({ ...f, largestAwg: Number(e.target.value) })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono">
            {[18, 16, 14, 12, 10, 8, 6].map((g) => <option key={g} value={g}>{g} AWG</option>)}
          </select></label>
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Current-carrying conductors</span>
          <input type="number" min={0} value={f.currentCarrying} onChange={(e) => setF({ ...f, currentCarrying: e.target.value })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" /></label>
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Ground conductors</span>
          <input type="number" min={0} value={f.groundConductors} onChange={(e) => setF({ ...f, groundConductors: e.target.value })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" /></label>
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Devices / yokes (&times;2)</span>
          <input type="number" min={0} value={f.devices} onChange={(e) => setF({ ...f, devices: e.target.value })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" /></label>
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Support fittings</span>
          <input type="number" min={0} value={f.supportFittings} onChange={(e) => setF({ ...f, supportFittings: e.target.value })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" /></label>
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Box volume (in&sup3;)</span>
          <input type="number" min={0} step="0.1" value={f.boxVolumeCubicInches} onChange={(e) => setF({ ...f, boxVolumeCubicInches: e.target.value })} placeholder="e.g. 18" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" /></label>
        <label className="col-span-2 flex items-center gap-2 text-[11px] text-zinc-300">
          <input type="checkbox" checked={f.internalClamps} onChange={(e) => setF({ ...f, internalClamps: e.target.checked })} />Internal cable clamps present
        </label>
        <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="col-span-2 rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
          {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Verify box fill'}
        </button>
        {result && !result.message && (
          <div className="col-span-2 space-y-1.5">
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="rounded border border-amber-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Equivalents</div><div className="font-mono text-amber-200">{result.totalConductorEquivalents}</div></div>
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5"><div className="text-[9px] text-amber-300">Required vol</div><div className="font-mono text-amber-100">{result.requiredBoxVolume} in&sup3;</div></div>
              <div className="rounded border border-amber-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Provided</div><div className="font-mono text-zinc-200">{result.providedBoxVolume} in&sup3;</div></div>
            </div>
            {result.breakdown && result.breakdown.map((b, i) => (
              <div key={i} className="flex justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-[10px]">
                <span className="text-zinc-300">{b.item}</span><span className="font-mono text-amber-200">{b.equivalents}</span>
              </div>
            ))}
            <div className={`rounded border-2 px-2 py-1.5 text-center text-[12px] font-semibold ${result.pass === true ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : result.pass === false ? 'border-rose-500/40 bg-rose-500/10 text-rose-100' : 'border-zinc-700 bg-zinc-900/40 text-zinc-300'}`}>{result.verdict}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function WireSizeCalc() {
  const [f, setF] = useState({ loadAmps: '', continuous: true, distanceFeet: '50', voltage: 120 });
  const [result, setResult] = useState<WireSizeResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await lensRun<WireSizeResult>('electrical', 'wireSize', {
        loadAmps: parseFloat(f.loadAmps) || 0,
        continuous: f.continuous,
        distanceFeet: parseFloat(f.distanceFeet) || 0,
        voltage: f.voltage,
      });
      setResult(r.data.result);
      return r.data.result;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-zinc-950 via-emerald-950/10 to-zinc-950">
      <header className="flex items-center gap-2 border-b border-emerald-500/20 bg-zinc-900/40 px-4 py-2">
        <Ruler className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-semibold text-white">Wire-size calculator</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.wireSize</span>
      </header>
      <div className="grid grid-cols-2 gap-2 p-4">
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Load (amps)</span>
          <input type="number" min={0} value={f.loadAmps} onChange={(e) => setF({ ...f, loadAmps: e.target.value })} placeholder="e.g. 40" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" /></label>
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">One-way distance (ft)</span>
          <input type="number" min={0} value={f.distanceFeet} onChange={(e) => setF({ ...f, distanceFeet: e.target.value })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" /></label>
        <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Voltage</span>
          <select value={f.voltage} onChange={(e) => setF({ ...f, voltage: Number(e.target.value) })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono">
            <option value={120}>120V</option><option value={240}>240V</option><option value={208}>208V</option><option value={480}>480V</option>
          </select></label>
        <label className="flex items-center gap-2 self-end pb-1 text-[11px] text-zinc-300">
          <input type="checkbox" checked={f.continuous} onChange={(e) => setF({ ...f, continuous: e.target.checked })} />Continuous load (125%)
        </label>
        <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || !f.loadAmps} className="col-span-2 rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-50">
          {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Size wire'}
        </button>
        {result && !result.message && (
          <div className="col-span-2 space-y-1.5">
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5"><div className="text-[9px] text-emerald-300">Recommended wire</div><div className="font-mono text-lg text-emerald-100">{result.recommendedWire}</div></div>
              <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Min breaker</div><div className="font-mono text-lg text-zinc-200">{result.minBreaker}</div></div>
              <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">V-drop</div><div className="font-mono text-lg text-zinc-200">{result.voltageDropAtRecommended}</div></div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[10px] text-zinc-400">
              Design load {result.designAmps}A · ampacity wire {result.ampacityRequiredWire} ({result.recommendedAmpacity}A)
              {result.upsizedForVoltageDrop && <span className="text-amber-300"> · upsized for voltage drop</span>}
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[9px] text-zinc-400">{result.basis}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function NecCalculators() {
  return (
    <div className="space-y-4">
      <ConduitFillCalc />
      <div className="grid gap-4 lg:grid-cols-2">
        <BoxFillCalc />
        <WireSizeCalc />
      </div>
    </div>
  );
}
