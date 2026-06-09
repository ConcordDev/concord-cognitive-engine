'use client';

/**
 * NecCodeCalc — NEC Code Calc / Mike Holt-style electrical
 * calculator suite for the electrical lens. Four bespoke widgets,
 * each visually distinct:
 *
 *  1. PanelLoadCalc   — editable circuit table → totalled load,
 *                       panel size, utilization meter, NEC 80%
 *                       rule pass/fail badge
 *  2. VoltageDropChart — wire gauge picker + amps/distance/voltage
 *                       → graphical SVG drop-vs-distance line with
 *                       3% NEC limit threshold
 *  3. CircuitMap      — panel/circuit/room/breaker grid showing
 *                       circuit layout per panel
 *  4. SafetyChecklist — code-item table with pass/fail + critical
 *                       toggle → overall verdict with PASS/FAIL/
 *                       CONDITIONAL stamp
 *
 * All four call existing electrical.* macros. No mock data — every
 * input starts empty.
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Zap, AlertTriangle, Cpu, ShieldCheck, Plus, Trash2, Loader2,
  TrendingDown,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

async function callElec<T>(action: string, data: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('electrical', action, { input: { artifact: { data } } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

interface Circuit { name: string; watts: string; voltage: string }
interface LoadResult { circuits?: Array<{ name: string; watts: number; voltage: number; amps: number; breakerSize: number; wireGauge: string }>; totalWatts?: number; totalAmps?: number; panelSizeRecommended?: string; utilization?: number; safetyMargin?: number; nec80PercentRule?: string }
interface VoltageDropResult { wireGauge?: string; distance?: string; current?: string; voltage?: string; voltageDrop?: string; dropPercent?: string; acceptable?: boolean; necLimit?: string; recommendation?: string }
interface CircuitMapRow { name: string; panel: string; breaker: string; room: string; devices: string; wireRunFeet: string }
interface CircuitMapResult { panels?: number; totalCircuits?: number; circuitMap?: Array<{ circuit: string; panel: string; breaker: string; room: string; devices: string[]; wireRun: number }>; unassigned?: number; avgDevicesPerCircuit?: number }
interface InspectionItem { name: string; necCode: string; passed: boolean; critical: boolean; notes: string }
interface InspectionResult { results?: Array<{ item: string; code: string; passed: boolean; severity: string; notes: string }>; total?: number; passed?: number; failed?: number; criticalFailures?: number; passRate?: number; overallResult?: string }

const AWG_OPTIONS = [14, 12, 10, 8, 6, 4, 2];

function PanelLoadCalc() {
  const [circuits, setCircuits] = useState<Circuit[]>([{ name: '', watts: '', voltage: '120' }]);
  const [result, setResult] = useState<LoadResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const cleanCircuits = circuits.filter((c) => c.name.trim() && parseFloat(c.watts) > 0).map((c) => ({
        name: c.name.trim(), watts: parseFloat(c.watts) || 0, voltage: parseFloat(c.voltage) || 120,
      }));
      const r = await callElec<LoadResult>('loadCalculation', { circuits: cleanCircuits });
      setResult(r);
      return r;
    },
  });

  const validCount = circuits.filter((c) => c.name && parseFloat(c.watts) > 0).length;

  return (
    <div className="overflow-hidden rounded-xl border border-yellow-500/20 bg-gradient-to-br from-zinc-950 via-yellow-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-yellow-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-yellow-400" />
          <span className="text-sm font-semibold text-white">Panel load calc</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.loadCalculation</span>
        </div>
        {result && result.totalAmps != null && (
          <SaveAsDtuButton compact apiSource="concord-electrical-load"
            title={`Panel load — ${result.totalAmps}A / ${result.panelSizeRecommended} (${result.nec80PercentRule})`}
            content={`Circuits: ${result.circuits?.length}\nTotal: ${result.totalWatts}W / ${result.totalAmps}A\nPanel size: ${result.panelSizeRecommended}\nUtilization: ${result.utilization}%\nSafety margin: ${result.safetyMargin}%\nNEC 80% rule: ${result.nec80PercentRule}\n\nPer-circuit:\n${(result.circuits || []).map((c) => `  ${c.name}: ${c.watts}W / ${c.amps}A / ${c.breakerSize}A breaker / ${c.wireGauge}`).join('\n')}`}
            extraTags={['electrical', 'load-calc', 'nec']}
            rawData={{ circuits, result }} />
        )}
      </header>

      <div className="p-4">
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_90px_90px_30px] gap-2 text-[9px] uppercase tracking-wider text-zinc-400">
            <span>Circuit</span><span>Watts</span><span>Voltage</span><span></span>
          </div>
          {circuits.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_90px_30px] gap-2">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="e.g. Kitchen receptacles" value={c.name} onChange={(e) => setCircuits((cs) => cs.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
              <input type="number" min={0} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={c.watts} onChange={(e) => setCircuits((cs) => cs.map((x, idx) => idx === i ? { ...x, watts: e.target.value } : x))} />
              <select className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={c.voltage} onChange={(e) => setCircuits((cs) => cs.map((x, idx) => idx === i ? { ...x, voltage: e.target.value } : x))}>
                <option value="120">120V</option><option value="240">240V</option>
              </select>
              <button aria-label="Delete" type="button" onClick={() => setCircuits((cs) => cs.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={() => setCircuits((cs) => [...cs, { name: '', watts: '', voltage: '120' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-yellow-500/40"><Plus className="h-3 w-3" />Add circuit</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || validCount === 0} className="rounded bg-yellow-500 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Calculate load'}
          </button>
        </div>

        {result && result.totalAmps != null && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-4 gap-2 text-[11px]">
              <div className="rounded border border-yellow-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Total amps</div><div className="font-mono text-lg text-yellow-200">{result.totalAmps}A</div></div>
              <div className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1.5"><div className="text-[9px] text-yellow-300">Panel size</div><div className="font-mono text-lg text-yellow-100">{result.panelSizeRecommended}</div></div>
              <div className="rounded border border-yellow-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Total W</div><div className="font-mono text-lg text-zinc-200">{result.totalWatts}</div></div>
              <div className={`rounded border px-2 py-1.5 ${result.nec80PercentRule === 'PASS' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'}`}><div className={`text-[9px] ${result.nec80PercentRule === 'PASS' ? 'text-emerald-300' : 'text-rose-300'}`}>NEC 80%</div><div className={`font-mono text-lg ${result.nec80PercentRule === 'PASS' ? 'text-emerald-100' : 'text-rose-100'}`}>{result.nec80PercentRule}</div></div>
            </div>
            {/* Utilization meter */}
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">Utilization</span>
                <span className={`font-mono ${result.utilization && result.utilization > 80 ? 'text-rose-300' : result.utilization && result.utilization > 60 ? 'text-amber-300' : 'text-emerald-300'}`}>{result.utilization}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div className={`h-full ${result.utilization && result.utilization > 80 ? 'bg-rose-500' : result.utilization && result.utilization > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, result.utilization || 0)}%` }} />
              </div>
              {/* 80% rule marker */}
              <div className="relative h-0">
                <div className="absolute -top-2 h-3 w-[1px] bg-rose-400/60" style={{ left: '80%' }} />
                <div className="absolute -top-3 text-[8px] text-rose-400 -translate-x-1/2" style={{ left: '80%' }}>80%</div>
              </div>
            </div>
            {result.circuits && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">Per-circuit breakdown</div>
                {result.circuits.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_70px_90px] gap-2 rounded border border-yellow-500/10 bg-zinc-950/40 px-2 py-1 text-[10px]">
                    <span className="text-zinc-100 truncate">{c.name}</span>
                    <span className="font-mono text-yellow-200">{c.amps}A</span>
                    <span className="font-mono text-zinc-400">{c.breakerSize}A bkr</span>
                    <span className="font-mono text-zinc-400">{c.wireGauge}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VoltageDropChart() {
  const [amps, setAmps] = useState(0);
  const [distance, setDistance] = useState(0);
  const [wireGauge, setWireGauge] = useState(12);
  const [voltage, setVoltage] = useState(120);
  const [result, setResult] = useState<VoltageDropResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callElec<VoltageDropResult>('voltageDropCalc', { amps, distanceFeet: distance, wireGauge, voltage });
      setResult(r);
      return r;
    },
  });

  // Compute drop-vs-distance curve client-side for visualization
  const curvePoints = useMemo(() => {
    if (amps <= 0) return [];
    const resistancePerFt: Record<number, number> = { 14: 0.00252, 12: 0.00159, 10: 0.001, 8: 0.000628, 6: 0.000395, 4: 0.000249, 2: 0.000156 };
    const rPerFt = resistancePerFt[wireGauge] || 0.00159;
    const maxDist = Math.max(distance * 1.5, 200);
    return Array.from({ length: 21 }, (_, i) => {
      const d = (maxDist / 20) * i;
      const drop = amps * rPerFt * d * 2;
      const pct = (drop / voltage) * 100;
      return { d, pct };
    });
  }, [amps, wireGauge, voltage, distance]);

  return (
    <div className="overflow-hidden rounded-xl border border-red-500/20 bg-gradient-to-br from-zinc-950 via-red-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-red-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-red-400" />
          <span className="text-sm font-semibold text-white">Voltage drop chart</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.voltageDropCalc</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-electrical-voltagedrop"
            title={`V-drop ${result.dropPercent} @ ${result.distance}, ${result.wireGauge}`}
            content={`Wire: ${result.wireGauge}\nDistance: ${result.distance}\nCurrent: ${result.current}\nVoltage: ${result.voltage}\nDrop: ${result.voltageDrop} (${result.dropPercent})\nAcceptable: ${result.acceptable ? 'YES' : 'NO'}\nNEC limit: ${result.necLimit}\nRecommendation: ${result.recommendation}`}
            extraTags={['electrical', 'voltage-drop']} rawData={{ amps, distance, wireGauge, voltage, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Amps</span>
            <input type="number" min={0} value={amps || ''} onChange={(e) => setAmps(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 15" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Distance (one-way ft)</span>
            <input type="number" min={0} value={distance || ''} onChange={(e) => setDistance(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 100" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Wire (AWG)</span>
            <select value={wireGauge} onChange={(e) => setWireGauge(Number(e.target.value))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono">
              {AWG_OPTIONS.map((g) => <option key={g} value={g}>{g} AWG</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Source voltage</span>
            <select value={voltage} onChange={(e) => setVoltage(Number(e.target.value))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono">
              <option value={120}>120V</option><option value={240}>240V</option><option value={208}>208V</option><option value={480}>480V</option>
            </select>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || amps <= 0 || distance <= 0} className="w-full rounded bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Calculate drop'}
          </button>
        </div>

        <div className="space-y-2">
          {/* Chart */}
          {curvePoints.length > 0 && (
            <div className="rounded-lg border border-red-500/15 bg-zinc-950/60 p-3">
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="uppercase tracking-wider text-zinc-400">Drop % vs distance</span>
                <span className="text-rose-400">3% NEC limit</span>
              </div>
              <svg viewBox="0 0 300 100" className="w-full" preserveAspectRatio="none">
                {/* 3% threshold line */}
                {(() => {
                  const maxPct = Math.max(...curvePoints.map((p) => p.pct), 5);
                  const yAt3 = 100 - (3 / maxPct) * 90;
                  return (<>
                    <line x1={0} y1={yAt3} x2={300} y2={yAt3} stroke="#f43f5e" strokeWidth={0.8} strokeDasharray="3,2" />
                    <text x={296} y={yAt3 - 2} fill="#fb7185" fontSize="8" textAnchor="end" fontFamily="monospace">3%</text>
                  </>);
                })()}
                {/* Curve */}
                {(() => {
                  const maxPct = Math.max(...curvePoints.map((p) => p.pct), 5);
                  const maxD = curvePoints[curvePoints.length - 1].d;
                  const pts = curvePoints.map((p) => `${(p.d / maxD) * 290 + 5},${100 - (p.pct / maxPct) * 90}`).join(' ');
                  return <polyline points={pts} fill="none" stroke="#dc2626" strokeWidth={1.5} />;
                })()}
                {/* Current-distance marker */}
                {distance > 0 && (() => {
                  const maxPct = Math.max(...curvePoints.map((p) => p.pct), 5);
                  const maxD = curvePoints[curvePoints.length - 1].d;
                  const point = curvePoints.find((p) => p.d >= distance) || curvePoints[curvePoints.length - 1];
                  const x = (distance / maxD) * 290 + 5;
                  const y = 100 - (point.pct / maxPct) * 90;
                  return (<>
                    <circle cx={x} cy={y} r={3} fill="#fbbf24" />
                    <line x1={x} y1={100} x2={x} y2={y} stroke="#fbbf24" strokeWidth={0.5} strokeDasharray="1,1" />
                  </>);
                })()}
              </svg>
              <div className="mt-1 flex justify-between font-mono text-[9px] text-zinc-400">
                <span>0 ft</span><span>{Math.round(curvePoints[curvePoints.length - 1].d)} ft</span>
              </div>
            </div>
          )}

          {!result && amps <= 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter amps + distance.</div>}
          {result && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded border border-red-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">V-drop</div><div className="font-mono text-red-200">{result.voltageDrop}</div></div>
                <div className={`rounded border px-2 py-1.5 ${result.acceptable ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}><div className={`text-[9px] ${result.acceptable ? 'text-emerald-300' : 'text-rose-300'}`}>% drop</div><div className={`font-mono ${result.acceptable ? 'text-emerald-100' : 'text-rose-100'}`}>{result.dropPercent}</div></div>
                <div className="rounded border border-red-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Wire</div><div className="font-mono text-red-200">{result.wireGauge}</div></div>
              </div>
              {result.recommendation && (
                <div className={`rounded border px-2 py-1 text-[10px] ${result.acceptable ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>{result.recommendation}</div>
              )}
              <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-400">{result.necLimit}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CircuitMap() {
  const [rows, setRows] = useState<CircuitMapRow[]>([{ name: '', panel: 'Main', breaker: '20A', room: '', devices: '', wireRunFeet: '' }]);
  const [result, setResult] = useState<CircuitMapResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const circuits = rows.filter((r) => r.name.trim()).map((r) => ({
        name: r.name, panel: r.panel, breaker: r.breaker, room: r.room,
        devices: r.devices.split(',').map((d) => d.trim()).filter(Boolean),
        wireRunFeet: parseInt(r.wireRunFeet) || 0,
      }));
      const r = await callElec<CircuitMapResult>('circuitTrace', { circuits });
      setResult(r);
      return r;
    },
  });

  const panels = useMemo(() => {
    const m = new Map<string, CircuitMapRow[]>();
    for (const r of rows) {
      if (!r.name.trim()) continue;
      if (!m.has(r.panel)) m.set(r.panel, []);
      m.get(r.panel)!.push(r);
    }
    return Array.from(m.entries());
  }, [rows]);

  return (
    <div className="overflow-hidden rounded-xl border border-purple-500/20 bg-gradient-to-br from-zinc-950 via-purple-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-purple-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">Circuit map</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.circuitTrace</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-electrical-circuit-map"
            title={`Circuit map — ${result.totalCircuits} circuits across ${result.panels} panel(s)`}
            content={`Panels: ${result.panels}\nTotal circuits: ${result.totalCircuits}\nUnassigned: ${result.unassigned}\nAvg devices/circuit: ${result.avgDevicesPerCircuit}\n\n${(result.circuitMap || []).map((c) => `${c.panel} / ${c.breaker} / ${c.circuit}\n  Room: ${c.room || '—'}\n  Devices: ${c.devices.join(', ') || '—'}\n  Run: ${c.wireRun} ft`).join('\n\n')}`}
            extraTags={['electrical', 'circuit-map']} rawData={{ rows, result }} />
        )}
      </header>

      <div className="p-4 space-y-2">
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_70px_100px_1fr_80px_30px] gap-1.5">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Circuit #1" value={r.name} onChange={(e) => setRows((rs) => rs.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
              <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Main" value={r.panel} onChange={(e) => setRows((rs) => rs.map((x, idx) => idx === i ? { ...x, panel: e.target.value } : x))} />
              <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="20A" value={r.breaker} onChange={(e) => setRows((rs) => rs.map((x, idx) => idx === i ? { ...x, breaker: e.target.value } : x))} />
              <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Kitchen" value={r.room} onChange={(e) => setRows((rs) => rs.map((x, idx) => idx === i ? { ...x, room: e.target.value } : x))} />
              <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="receptacles, lights" value={r.devices} onChange={(e) => setRows((rs) => rs.map((x, idx) => idx === i ? { ...x, devices: e.target.value } : x))} />
              <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="ft" value={r.wireRunFeet} onChange={(e) => setRows((rs) => rs.map((x, idx) => idx === i ? { ...x, wireRunFeet: e.target.value } : x))} />
              <button aria-label="Delete" type="button" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setRows((rs) => [...rs, { name: '', panel: 'Main', breaker: '20A', room: '', devices: '', wireRunFeet: '' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-purple-500/40"><Plus className="h-3 w-3" />Add circuit</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || rows.filter((r) => r.name.trim()).length === 0} className="rounded bg-purple-500 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Map circuits'}
          </button>
        </div>

        {/* Live panel-grouped preview */}
        {panels.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {panels.map(([panelName, panelCircuits]) => (
              <div key={panelName} className="rounded-lg border border-purple-500/15 bg-zinc-950/40 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold text-purple-200">{panelName} panel</span>
                  <span className="text-[10px] text-zinc-400">{panelCircuits.length} circuit{panelCircuits.length === 1 ? '' : 's'}</span>
                </div>
                {panelCircuits.map((c, i) => (
                  <div key={i} className="grid grid-cols-[60px_1fr_1fr] gap-1 border-t border-zinc-800 py-1 text-[10px]">
                    <span className="font-mono text-amber-300">{c.breaker}</span>
                    <span className="text-zinc-100 truncate">{c.name}</span>
                    <span className="text-zinc-400 truncate">{c.room || '—'}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className="grid grid-cols-4 gap-2 text-[11px]">
            <div className="rounded border border-purple-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Panels</div><div className="font-mono text-purple-200">{result.panels}</div></div>
            <div className="rounded border border-purple-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Circuits</div><div className="font-mono text-purple-200">{result.totalCircuits}</div></div>
            <div className="rounded border border-amber-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Unassigned</div><div className="font-mono text-amber-200">{result.unassigned}</div></div>
            <div className="rounded border border-purple-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Avg devices</div><div className="font-mono text-purple-200">{result.avgDevicesPerCircuit}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}

function SafetyChecklist() {
  const [items, setItems] = useState<InspectionItem[]>([{ name: '', necCode: '', passed: true, critical: false, notes: '' }]);
  const [result, setResult] = useState<InspectionResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const inspectionItems = items.filter((i) => i.name.trim()).map((i) => ({
        name: i.name, necCode: i.necCode, passed: i.passed, critical: i.critical, notes: i.notes,
      }));
      const r = await callElec<InspectionResult>('safetyInspection', { inspectionItems });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-zinc-950 via-emerald-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-emerald-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">Safety checklist</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.safetyInspection</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-electrical-safety"
            title={`Safety — ${result.passed}/${result.total} passed (${result.overallResult})`}
            content={`Total items: ${result.total}\nPassed: ${result.passed}\nFailed: ${result.failed}\nCritical failures: ${result.criticalFailures}\nPass rate: ${result.passRate}%\nOverall: ${result.overallResult}\n\n${(result.results || []).map((r) => `${r.passed ? '✓' : '✗'} ${r.item} [${r.code}]${r.severity !== 'ok' ? ` (${r.severity})` : ''}${r.notes ? `\n  ${r.notes}` : ''}`).join('\n')}`}
            extraTags={['electrical', 'safety', 'nec-inspection']}
            rawData={{ items, result }} />
        )}
      </header>

      <div className="p-4 space-y-2">
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className={`grid grid-cols-[1fr_100px_60px_60px_30px] gap-1.5 rounded border px-2 py-1.5 ${item.passed ? 'border-emerald-500/15 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
              <div className="space-y-1">
                <input className="w-full rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-xs text-white" placeholder="Inspection item" value={item.name} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                <input className="w-full rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400" placeholder="Notes" value={item.notes} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, notes: e.target.value } : x))} />
              </div>
              <input className="self-start rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-xs text-white font-mono" placeholder="NEC 210.8" value={item.necCode} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, necCode: e.target.value } : x))} />
              <label className="flex items-center justify-center gap-1 self-start rounded border border-zinc-800 bg-zinc-950 px-1 py-1 text-[10px] text-zinc-300">
                <input type="checkbox" checked={item.passed} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, passed: e.target.checked } : x))} />Pass
              </label>
              <label className="flex items-center justify-center gap-1 self-start rounded border border-zinc-800 bg-zinc-950 px-1 py-1 text-[10px] text-rose-300">
                <input type="checkbox" checked={item.critical} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, critical: e.target.checked } : x))} />Crit
              </label>
              <button aria-label="Delete" type="button" onClick={() => setItems((is) => is.filter((_, idx) => idx !== i))} className="self-start rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setItems((is) => [...is, { name: '', necCode: '', passed: true, critical: false, notes: '' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500/40"><Plus className="h-3 w-3" />Add item</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || items.filter((i) => i.name.trim()).length === 0} className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Run inspection'}
          </button>
        </div>

        {result && (
          <div className={`rounded-lg border-2 p-3 text-center ${result.overallResult === 'PASS' ? 'border-emerald-500/40 bg-emerald-500/10' : result.overallResult?.startsWith('FAIL') ? 'border-rose-500/40 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
            <div className={`font-mono text-2xl font-bold ${result.overallResult === 'PASS' ? 'text-emerald-100' : result.overallResult?.startsWith('FAIL') ? 'text-rose-100' : 'text-amber-100'}`}>{result.overallResult}</div>
            <div className="mt-1 text-[11px] text-zinc-300">{result.passed}/{result.total} items passed ({result.passRate}%)</div>
            {result.criticalFailures && result.criticalFailures > 0 ? (
              <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-rose-300">
                <AlertTriangle className="h-3 w-3" />{result.criticalFailures} critical failure{result.criticalFailures === 1 ? '' : 's'}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function NecCodeCalc() {
  return (
    <div className="space-y-4">
      <PanelLoadCalc />
      <VoltageDropChart />
      <CircuitMap />
      <SafetyChecklist />
    </div>
  );
}
