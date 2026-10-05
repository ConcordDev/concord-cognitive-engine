'use client';

/**
 * Multi-physics bench: runs the engineering domain's thermal, wind, combined,
 * circuit and non-Newtonian flow solvers. The structural checks all run on the
 * SAME model the Model/Loads tabs edit, so a ΔT or wind case is a second look
 * at the user's own frame, not a separate toy. Every number shown is the
 * solver's own output; a refused solve shows the solver's own reason.
 *
 * Inputs, the circuit and the latest result of each check are saved per user
 * (engineering.workspace-save, key "physics") and restored on open. The
 * circuit starts empty (it used to be pre-filled with a sample divider).
 */

import { useState, type ReactNode } from 'react';
import { CircuitBoard, Droplets, Download, Flame, Layers, Loader2, Plus, Trash2, Wind } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useEngineeringFea } from './EngineeringFeaProvider';
import { useEngWorkspace, WsBadge, computedAt } from './useEngWorkspace';

// The lens model is imperial (in, in², in⁴, psi, lbf); the thermal/wind gates
// compute in SI (σ = E·α·ΔT in Pa, F = q·Cd·A in N). The solver is unit-agnostic,
// so the structural model is converted to one consistent SI set before the
// gate runs; utilization is dimensionless and reads the same either way.
const IN = 0.0254, PSI = 6894.757, LBF = 4.448222;
type AnyRec = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
function toSI(model: { nodes: AnyRec[]; members: AnyRec[]; loads: AnyRec[]; supports: AnyRec[] }) {
  const scale = (v: unknown, k: number) => (num(v) === undefined ? v : (v as number) * k);
  return {
    nodes: model.nodes.map((n) => ({ ...n, x: scale(n.x, IN), y: scale(n.y, IN), z: scale(n.z ?? 0, IN) })),
    members: model.members.map((m) => ({
      ...m,
      area: scale(m.area, IN * IN),
      momentI: scale(m.momentI, IN ** 4),
      elasticModulus: scale(m.elasticModulus, PSI),
      allowableStress: scale(m.allowableStress, PSI),
    })),
    loads: model.loads.map((l) => ({
      ...l,
      Fx: scale(l.Fx, LBF), Fy: scale(l.Fy, LBF), Fz: scale(l.Fz, LBF),
      Mx: scale(l.Mx, LBF * IN), My: scale(l.My, LBF * IN), Mz: scale(l.Mz, LBF * IN),
    })),
    supports: model.supports,
  };
}

type Run<T> = { loading: boolean; error: string | null; result: T | null };
const idle = { loading: false, error: null, result: null };
type RunState = { loading: boolean; error: string | null };
const idleRun: RunState = { loading: false, error: null };

interface GateResult {
  ok: boolean;
  mechanicalOnlyUtilization: number;
  combinedUtilization?: number;
  simultaneousUtilization?: number;
  thermalStressByMember?: Record<string, number | null>;
  dragForceByMember?: Record<string, number | null>;
  dynamicPressurePa?: number;
  approximationCaveat?: string;
}
interface BundleResult {
  allPass: boolean;
  legs: { thermal?: GateResult & { reason?: string }; aero?: GateResult & { reason?: string } };
  simultaneous?: GateResult & { reason?: string };
}
interface CircuitResult {
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
  powerByElement: Record<string, number>;
}
interface FlowResult {
  flowRate: number;
  meanVelocity: number;
  reynolds: { value: number; regime: string } | null;
  honestBoundary?: string;
}
type ElType = 'resistor' | 'voltage_source' | 'current_source';
interface CircuitEl { id: string; type: ElType; nodeA: string; nodeB: string; value: number }

const fmt = (n: number | undefined | null, d = 3) =>
  typeof n === 'number' && Number.isFinite(n) ? (Math.abs(n) >= 1e4 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3) ? n.toExponential(d) : n.toFixed(d)) : '—';

function Card({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4 transition-colors hover:border-white/20">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">{icon}{title}</h3>
      <p className="mb-3 mt-1 text-xs text-zinc-500">{hint}</p>
      {children}
    </section>
  );
}

function Num({ label, value, onChange, step = 'any', unit }: { label: string; value: number; onChange: (v: number) => void; step?: string; unit?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
      <span>{label}{unit ? <span className="text-zinc-600"> ({unit})</span> : null}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-sm text-zinc-100 focus:border-teal-400/50 focus:outline-none"
      />
    </label>
  );
}

function RunButton({ onClick, loading, children, disabled }: { onClick: () => void; loading: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex items-center gap-2 rounded-full bg-teal-400/15 px-4 py-1.5 text-sm font-medium text-teal-200 transition-colors hover:bg-teal-400/25 disabled:opacity-50"
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

function Err({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">The solver refused: {msg.replace(/_/g, ' ')}</p>;
}

function UtilBar({ label, value }: { label: string; value: number | undefined }) {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const pct = Math.min(100, v * 100);
  const tone = v > 1 ? 'bg-rose-400' : v > 0.8 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-zinc-400"><span>{label}</span><span className="font-mono text-zinc-200">{(v * 100).toFixed(1)}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5"><div className={`h-full ${tone} transition-all duration-500`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function memberRows(map: Record<string, number | null> | undefined) {
  return Object.entries(map ?? {}).map(([id, v]) => ({ id, v: typeof v === 'number' ? v : NaN }));
}

async function run<T>(action: string, input: Record<string, unknown>, set: (r: RunState) => void, onResult: (r: T) => void) {
  set({ loading: true, error: null });
  try {
    const r = await lensRun<T>('engineering', action, input);
    if (!r.data.ok || !r.data.result) set({ loading: false, error: r.data.error || 'no result' });
    else { onResult(r.data.result); set({ loading: false, error: null }); }
  } catch (e) {
    set({ loading: false, error: (e as Error).message });
  }
}

type Stamped<T> = { value: T; at: string; model?: string } | null;
const PHYSICS_DEFAULTS = {
  deltaT: 40, material: 'steel-a36',
  velocity: 30, dirDeg: 0, cd: 1.2, area: 0.05,
  els: [] as CircuitEl[],
  ground: 'GND',
  fluidModel: 'powerLaw' as 'powerLaw' | 'carreau',
  flowIn: { diameter: 0.05, lengthM: 10, pressureDropPa: 20000, n: 0.6, K: 0.8, mu0: 1.0, muInf: 0.001, lambda: 2, density: 1000 },
  thermal: null as Stamped<GateResult>,
  aero: null as Stamped<GateResult>,
  bundle: null as Stamped<BundleResult>,
  circuit: null as Stamped<CircuitResult>,
  flow: null as Stamped<FlowResult>,
};

function Stamp({ s, testId }: { s: { at: string; model?: string } | null; testId: string }) {
  if (!s) return null;
  return <p data-testid={testId} className="mt-2 text-[10px] text-zinc-500">Computed {computedAt(s.at)}{s.model ? ` on your model (${s.model})` : ''} · saved</p>;
}

export function MultiPhysicsPanel() {
  const { model, libMaterials } = useEngineeringFea();
  const hasModel = model.nodes.length > 0 && model.members.length > 0;

  const [ws, setWs, wsSave] = useEngWorkspace('physics', PHYSICS_DEFAULTS);
  const { deltaT, material, velocity, dirDeg, cd, area, els, ground, fluidModel, flowIn } = ws;
  const field = <K extends keyof typeof PHYSICS_DEFAULTS>(k: K) => (v: (typeof PHYSICS_DEFAULTS)[K]) => setWs((s) => ({ ...s, [k]: v }));
  const setDeltaT = field('deltaT'); const setMaterial = field('material');
  const setVelocity = field('velocity'); const setDirDeg = field('dirDeg'); const setCd = field('cd'); const setArea = field('area');
  const setGround = field('ground'); const setFluidModel = field('fluidModel');
  const setEls = (f: (xs: CircuitEl[]) => CircuitEl[]) => setWs((s) => ({ ...s, els: f(s.els) }));
  const setFlowIn = (f: (x: typeof PHYSICS_DEFAULTS.flowIn) => typeof PHYSICS_DEFAULTS.flowIn) => setWs((s) => ({ ...s, flowIn: f(s.flowIn) }));
  const modelSig = `${model.nodes.length} nodes, ${model.members.length} members`;
  const stamp = <K extends 'thermal' | 'aero' | 'bundle' | 'circuit' | 'flow'>(k: K, withModel: boolean) =>
    (value: NonNullable<(typeof PHYSICS_DEFAULTS)[K]>['value']) =>
      setWs((s) => ({ ...s, [k]: { value, at: new Date().toISOString(), ...(withModel ? { model: modelSig } : {}) } }));

  const [thermalRun, setThermalRun] = useState<RunState>(idleRun);
  const [aeroRun, setAeroRun] = useState<RunState>(idleRun);
  const [bundleRun, setBundleRun] = useState<RunState>(idleRun);
  const [circuitRun, setCircuitRun] = useState<RunState>(idleRun);
  const [flowRun, setFlowRun] = useState<RunState>(idleRun);
  const thermal: Run<GateResult> = { ...thermalRun, result: ws.thermal?.value ?? null };
  const aero: Run<GateResult> = { ...aeroRun, result: ws.aero?.value ?? null };
  const bundle: Run<BundleResult> = { ...bundleRun, result: ws.bundle?.value ?? null };
  const circuit: Run<CircuitResult> = { ...circuitRun, result: ws.circuit?.value ?? null };
  const flow: Run<FlowResult> = { ...flowRun, result: ws.flow?.value ?? null };
  void idle;

  const [exporting, setExporting] = useState(false);

  const structural = { model: toSI(model as unknown as Parameters<typeof toSI>[0]) };
  const aeroOpts = { velocity, direction: (dirDeg * Math.PI) / 180, defaultCd: cd, defaultArea: area };

  const exportScene = async () => {
    setExporting(true);
    try {
      const r = await lensRun<Record<string, unknown>>('engineering', 'feaScene', { model });
      if (!r.data.ok || !r.data.result) throw new Error(r.data.error || 'The solve failed.');
      const blob = new Blob([JSON.stringify(r.data.result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'concord-fea-scene.json';
      a.click();
      URL.revokeObjectURL(url);
      useUIStore.getState().addToast({ type: 'success', message: '3D scene exported (geometry + solved stresses).' });
    } catch (e) {
      useUIStore.getState().addToast({ type: 'error', message: (e as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const circuitNodes = Array.from(new Set(els.flatMap((e) => [e.nodeA, e.nodeB]).filter(Boolean))).map((id) => ({ id }));
  const updEl = (i: number, patch: Partial<CircuitEl>) => setEls((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const prefix: Record<ElType, string> = { resistor: 'R', voltage_source: 'V', current_source: 'I' };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#111] p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-300">
          Thermal and wind checks run on your current model, converted from inches/psi/lb to SI: <span className="font-mono text-teal-200">{model.nodes.length}</span> nodes,{' '}
          <span className="font-mono text-teal-200">{model.members.length}</span> members, <span className="font-mono text-teal-200">{model.loads.length}</span> loads,{' '}
          <span className="font-mono text-teal-200">{model.supports.length}</span> supports.
          <span className="mt-1 block"><WsBadge state={wsSave} testId="physics-save" /></span>
          <span className="mt-1 block text-[11px] text-zinc-500">Wind, flow and ΔT fields start with example values — replace them with yours.</span>
        </p>
        <RunButton onClick={() => void exportScene()} loading={exporting} disabled={!hasModel}>
          <Download className="h-3.5 w-3.5" /> Export 3D scene
        </RunButton>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card icon={<Flame className="h-4 w-4 text-orange-400" />} title="Thermal stress" hint="Fully-restrained σ = E·α·ΔT per member, then a real mechanical vs combined FEA solve. A conservative screening bound.">
          <div className="grid grid-cols-2 gap-3">
            <Num label="Temperature swing ΔT" unit="°C" value={deltaT} onChange={setDeltaT} />
            <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
              <span>Material</span>
              <select value={material} onChange={(e) => setMaterial(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-zinc-100">
                {(libMaterials.length ? libMaterials : [{ id: 'steel-a36', label: 'ASTM A36 Structural Steel' }]).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3"><RunButton onClick={() => void run<GateResult>('thermalStressCheck', { ...structural, deltaT, material }, setThermalRun, stamp('thermal', true))} loading={thermal.loading} disabled={!hasModel}>Check thermal</RunButton></div>
          <Err msg={thermal.error} />
          {thermal.result && (
            <div className="mt-3 space-y-2">
              <UtilBar label="Mechanical only" value={thermal.result.mechanicalOnlyUtilization} />
              <UtilBar label={`With ΔT ${deltaT}°C`} value={thermal.result.combinedUtilization} />
              <ul className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-400 sm:grid-cols-3">
                {memberRows(thermal.result.thermalStressByMember).map((m) => (
                  <li key={m.id} className="rounded bg-black/20 px-2 py-1 font-mono">{m.id}: {fmt(m.v / 1e6, 1)} MPa</li>
                ))}
              </ul>
              <Stamp s={ws.thermal} testId="physics-thermal-at" />
            </div>
          )}
        </Card>

        <Card icon={<Wind className="h-4 w-4 text-sky-400" />} title="Wind load" hint="Dynamic pressure q = ½ρv², drag F = q·Cd·A per member, superposed onto your loads in one solve. Uniform free stream; not CFD.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Num label="Velocity" unit="m/s" value={velocity} onChange={setVelocity} />
            <Num label="Direction" unit="°" value={dirDeg} onChange={setDirDeg} />
            <Num label="Drag coeff. Cd" value={cd} onChange={setCd} />
            <Num label="Area / member" unit="m²" value={area} onChange={setArea} />
          </div>
          <div className="mt-3"><RunButton onClick={() => void run<GateResult>('aeroLoadCheck', { ...structural, ...aeroOpts }, setAeroRun, stamp('aero', true))} loading={aero.loading} disabled={!hasModel}>Check wind</RunButton></div>
          <Err msg={aero.error} />
          {aero.result && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-zinc-400">Dynamic pressure <span className="font-mono text-zinc-100">{fmt(aero.result.dynamicPressurePa, 1)} Pa</span></p>
              <UtilBar label="Mechanical only" value={aero.result.mechanicalOnlyUtilization} />
              <UtilBar label={`With ${velocity} m/s wind`} value={aero.result.combinedUtilization} />
              <ul className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-400 sm:grid-cols-3">
                {memberRows(aero.result.dragForceByMember).map((m) => (
                  <li key={m.id} className="rounded bg-black/20 px-2 py-1 font-mono">{m.id}: {fmt(m.v, 1)} N</li>
                ))}
              </ul>
              <Stamp s={ws.aero} testId="physics-aero-at" />
            </div>
          )}
        </Card>
      </div>

      <Card icon={<Layers className="h-4 w-4 text-violet-400" />} title="Thermal + wind together" hint="Runs both legs independently, then one simultaneous solve with mechanical, thermal and wind loads superposed. Uses the inputs above.">
        <RunButton
          onClick={() => void run<BundleResult>('multiPhysicsCheck', { ...structural, legs: { thermal: { deltaT, material }, aero: aeroOpts }, simultaneous: true }, setBundleRun, stamp('bundle', true))}
          loading={bundle.loading}
          disabled={!hasModel}
        >
          Run combined case
        </RunButton>
        <Err msg={bundle.error} />
        {bundle.result && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(['thermal', 'aero'] as const).map((leg) => {
              const r = bundle.result!.legs[leg];
              return (
                <div key={leg} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">{leg === 'aero' ? 'Wind leg' : 'Thermal leg'}</p>
                  {r?.reason ? <p className="text-xs text-rose-300">{r.reason.replace(/_/g, ' ')}</p> : <UtilBar label="Combined" value={r?.combinedUtilization} />}
                </div>
              );
            })}
            <div className="rounded-xl border border-violet-400/30 bg-violet-500/5 p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-violet-300">Simultaneous</p>
              {bundle.result.simultaneous?.reason
                ? <p className="text-xs text-rose-300">{bundle.result.simultaneous.reason.replace(/_/g, ' ')}</p>
                : <UtilBar label={bundle.result.simultaneous?.ok ? 'Passes' : 'Fails'} value={bundle.result.simultaneous?.simultaneousUtilization} />}
            </div>
          </div>
        )}
        <Stamp s={ws.bundle} testId="physics-bundle-at" />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card icon={<CircuitBoard className="h-4 w-4 text-yellow-300" />} title="DC circuit" hint="Nodal analysis (KCL) over resistors and sources. Voltage sources must touch the ground node.">
          <div className="space-y-2" data-testid="circuit-elements">
            {els.length === 0 && <p className="text-xs text-zinc-500">No elements yet. Add a source and resistors with the buttons below, then solve.</p>}
            {els.map((el, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2 sm:grid-cols-[4rem_1fr_1fr_1fr_1fr_auto]">
                <input aria-label="Element id" value={el.id} onChange={(e) => updEl(i, { id: e.target.value })} className="hidden rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs sm:block" />
                <select aria-label="Element type" value={el.type} onChange={(e) => updEl(i, { type: e.target.value as ElType })} className="rounded-lg border border-white/10 bg-black/30 px-1 py-1 text-xs">
                  <option value="resistor">Resistor Ω</option>
                  <option value="voltage_source">Voltage V</option>
                  <option value="current_source">Current A</option>
                </select>
                <input aria-label="Node A" value={el.nodeA} onChange={(e) => updEl(i, { nodeA: e.target.value })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs" />
                <input aria-label="Node B" value={el.nodeB} onChange={(e) => updEl(i, { nodeB: e.target.value })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs" />
                <input aria-label="Value" type="number" value={el.value} onChange={(e) => updEl(i, { value: parseFloat(e.target.value) })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs" />
                <button type="button" aria-label={`Remove ${el.id}`} onClick={() => setEls((xs) => xs.filter((_, j) => j !== i))} className="rounded p-1 text-zinc-500 transition-colors hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(['resistor', 'voltage_source', 'current_source'] as ElType[]).map((t) => (
              <button key={t} type="button" onClick={() => setEls((xs) => [...xs, { id: `${prefix[t]}${xs.filter((x) => x.type === t).length + 1}`, type: t, nodeA: 'N1', nodeB: ground, value: t === 'resistor' ? 100 : 1 }])} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300 transition-colors hover:border-white/25">
                <Plus className="h-3 w-3" />{prefix[t]}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400">Ground
              <input value={ground} onChange={(e) => setGround(e.target.value)} className="w-16 rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs" />
            </label>
          </div>
          <div className="mt-3"><RunButton onClick={() => void run<CircuitResult>('circuitSolve', { model: { nodes: circuitNodes, elements: els, groundNodeId: ground } }, setCircuitRun, stamp('circuit', false))} loading={circuit.loading} disabled={els.length === 0}>Solve circuit</RunButton></div>
          <Err msg={circuit.error} />
          {circuit.result && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">Node voltages</p>
                {Object.entries(circuit.result.nodeVoltages).map(([k, v]) => <p key={k} className="font-mono text-xs text-zinc-200">{k}: {fmt(v)} V</p>)}
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">Current / power</p>
                {Object.entries(circuit.result.branchCurrents).map(([k, v]) => (
                  <p key={k} className="font-mono text-xs text-zinc-200">{k}: {fmt(v * 1000, 2)} mA · {fmt(circuit.result!.powerByElement[k], 3)} W</p>
                ))}
              </div>
            </div>
          )}
          <Stamp s={ws.circuit} testId="physics-circuit-at" />
        </Card>

        <Card icon={<Droplets className="h-4 w-4 text-cyan-300" />} title="Non-Newtonian pipe flow" hint="Laminar flow of a shear-thinning fluid: power-law closed form or Carreau numeric, with generalized Reynolds number.">
          <div className="mb-3 inline-flex rounded-full border border-white/10 p-0.5">
            {(['powerLaw', 'carreau'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={fluidModel === m} onClick={() => setFluidModel(m)} className={`rounded-full px-3 py-1 text-xs transition-colors ${fluidModel === m ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200'}`}>
                {m === 'powerLaw' ? 'Power law' : 'Carreau'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Num label="Diameter" unit="m" value={flowIn.diameter} onChange={(v) => setFlowIn((f) => ({ ...f, diameter: v }))} />
            <Num label="Length" unit="m" value={flowIn.lengthM} onChange={(v) => setFlowIn((f) => ({ ...f, lengthM: v }))} />
            <Num label="Pressure drop" unit="Pa" value={flowIn.pressureDropPa} onChange={(v) => setFlowIn((f) => ({ ...f, pressureDropPa: v }))} />
            <Num label="Flow index n" value={flowIn.n} onChange={(v) => setFlowIn((f) => ({ ...f, n: v }))} />
            {fluidModel === 'powerLaw' ? (
              <Num label="Consistency K" unit="Pa·sⁿ" value={flowIn.K} onChange={(v) => setFlowIn((f) => ({ ...f, K: v }))} />
            ) : (
              <>
                <Num label="μ₀" unit="Pa·s" value={flowIn.mu0} onChange={(v) => setFlowIn((f) => ({ ...f, mu0: v }))} />
                <Num label="μ∞" unit="Pa·s" value={flowIn.muInf} onChange={(v) => setFlowIn((f) => ({ ...f, muInf: v }))} />
                <Num label="λ" unit="s" value={flowIn.lambda} onChange={(v) => setFlowIn((f) => ({ ...f, lambda: v }))} />
              </>
            )}
            <Num label="Density" unit="kg/m³" value={flowIn.density} onChange={(v) => setFlowIn((f) => ({ ...f, density: v }))} />
          </div>
          <div className="mt-3"><RunButton onClick={() => void run<FlowResult>('nonNewtonianFlow', { fluidModel, ...flowIn }, setFlowRun, stamp('flow', false))} loading={flow.loading}>Compute flow</RunButton></div>
          <Err msg={flow.error} />
          {flow.result && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-black/20 p-2"><p className="font-mono text-sm text-cyan-200">{fmt(flow.result.flowRate * 1000, 3)}</p><p className="text-[10px] text-zinc-500">L/s</p></div>
              <div className="rounded-lg bg-black/20 p-2"><p className="font-mono text-sm text-cyan-200">{fmt(flow.result.meanVelocity, 3)}</p><p className="text-[10px] text-zinc-500">m/s mean</p></div>
              <div className="rounded-lg bg-black/20 p-2"><p className="font-mono text-sm text-cyan-200">{flow.result.reynolds ? fmt(flow.result.reynolds.value, 1) : '—'}</p><p className="text-[10px] text-zinc-500">{flow.result.reynolds?.regime ?? 'Re'}</p></div>
            </div>
          )}
          <Stamp s={ws.flow} testId="physics-flow-at" />
        </Card>
      </div>
    </div>
  );
}
