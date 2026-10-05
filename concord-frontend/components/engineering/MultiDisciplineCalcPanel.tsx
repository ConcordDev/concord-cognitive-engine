'use client';

/**
 * MultiDisciplineCalcPanel — structural / thermal / electrical / hydraulic
 * calculator suite (MechaniCalc / Engineering Toolbox shape).
 *
 * Backs four macros that had zero frontend surface before this pass:
 * `engineering.structuralCheck` (column buckling + reinforced-concrete wall
 * shear + fillet weld strength), `engineering.thermalAnalysis` (sensible
 * heat load + duct sizing + residential cooling load), `engineering.
 * electricalCheck` (voltage drop + breaker sizing + NEC conduit fill), and
 * `engineering.hydraulicAnalysis` (pipe sizing + pump brake horsepower +
 * Darcy–Weisbach pressure loss) — all real, code-reference-cited formulas in
 * `server/lib/compute/engineering-compute.js`, previously reachable only via
 * `POST /api/v1/lens/engineering/<action>` (external API-key docs) or a
 * blind zero-parameter quick-trigger. Each discipline is ONE macro call that
 * always computes all three of its sub-results from one shared params
 * object (that's the backend's own design — see the field-name comments
 * below), so each section below has exactly one "Compute" action and
 * displays the sub-results the macro actually returns, rather than
 * pretending they're three independent server calls.
 *
 * Inputs and the latest results of every section are saved per user
 * (engineering.workspace-save) and restored on open, so a reload or a server
 * restart doesn't lose them. Fields start with typical example values and
 * say so.
 *
 * Also backs two macros added in this pass — `engineering.connectionCheck`
 * (AISC bolted-connection allowable shear) inside the Structural section and
 * `engineering.transformerSizing` (ANSI kVA-ladder sizing) inside the
 * Electrical section — that call `boltedConnection()`/`transformerSizing()`
 * in the same compute module. Those two functions were real but genuinely
 * unreachable at the macro layer before this pass (no registered macro
 * called them); they're wired as their own macro + button per section
 * (not folded into `structuralCheck`/`electricalCheck`, which are a
 * separate server-side registration this pass leaves untouched) rather than
 * a shared "Compute" trigger, since they're independent server calls.
 */

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  Building2, Thermometer, Zap, Droplets, Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useEngWorkspace, WsBadge, computedAt, type WsSaveState } from './useEngWorkspace';

// ── Generic result shape every engineering-compute.js function returns ─────
interface CalcResult {
  value?: number;
  unit?: string;
  formula?: string;
  warnings?: string[];
  error?: string;
  inputs?: Record<string, unknown>;
  [extra: string]: unknown;
}

const RESERVED_KEYS = new Set(['value', 'unit', 'formula', 'warnings', 'error', 'inputs']);

function fmt(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 0.001 || abs > 1e6)) return v.toExponential(3);
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function humanizeKey(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

// ── One sub-result card (buckling / bending / weld / heatLoad / …) ─────────
function ResultCard({ title, result }: { title: string; result: CalcResult | null | undefined }) {
  if (!result) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-gray-500">
        <p className="font-semibold text-gray-400 mb-1">{title}</p>
        Run the calculation to see results.
      </div>
    );
  }
  if (result.error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
        <p className="font-semibold text-red-300 mb-1 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" /> {title}
        </p>
        <p className="text-red-400">{result.error}</p>
      </div>
    );
  }
  const extras = Object.entries(result).filter(([k]) => !RESERVED_KEYS.has(k));
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs space-y-1.5">
      <p className="font-semibold text-gray-300">{title}</p>
      <p className="text-xl font-mono font-bold text-neon-cyan">
        {fmt(result.value)} <span className="text-xs text-gray-400">{result.unit}</span>
      </p>
      {result.formula && <p className="text-[10px] text-gray-500 font-mono">{result.formula}</p>}
      {extras.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1 border-t border-white/5">
          {extras.map(([k, v]) => (
            <p key={k} className="text-[10px] text-gray-400">
              {humanizeKey(k)}: <span className="text-gray-200 font-mono">{typeof v === 'boolean' ? String(v) : fmt(v)}</span>
            </p>
          ))}
        </div>
      )}
      {Array.isArray(result.warnings) && result.warnings.length > 0 && (
        <div className="pt-1 space-y-0.5">
          {result.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
            </p>
          ))}
        </div>
      )}
      {extras.length === 0 && !result.warnings?.length && (
        <p className="text-[10px] text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> within limits
        </p>
      )}
    </div>
  );
}

// ── Small field primitives ──────────────────────────────────────────────────
function NumField({
  label, value, onChange, step = 'any',
}: { label: string; value: number | ''; onChange: (v: number | '') => void; step?: string }) {
  return (
    <div>
      <label className="text-[10px] text-gray-400 block mb-0.5">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs font-mono"
      />
    </div>
  );
}
function SelectField({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-[10px] text-gray-400 block mb-0.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

type Num = number | '';
const n = (v: Num, fb: number) => (v === '' ? fb : v);
type Rec = Record<string, unknown>;

// Bind a NumField / SelectField to one key of a saved section's `inp` object.
function binder<S extends { inp: Rec }>(set: Dispatch<SetStateAction<S>>, sub: 'inp' | 'conn' | 'xfmr' = 'inp') {
  return (k: string) => (v: unknown) =>
    set((s) => ({ ...s, [sub]: { ...((s as unknown as Record<string, Rec>)[sub] || {}), [k]: v } }));
}

function Computed({ at, testId }: { at: string | null | undefined; testId: string }) {
  if (!at) return null;
  return <p data-testid={testId} className="text-[10px] text-zinc-500">Computed {computedAt(at)} · saved with your inputs</p>;
}

function SectionHead({ icon, title, save, testId }: { icon: ReactNode; title: string; save: WsSaveState; testId: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-sm flex items-center gap-2">{icon} {title}</h3>
      <WsBadge state={save} testId={testId} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Structural — engineering.structuralCheck → { buckling, bending, weld }
// ════════════════════════════════════════════════════════════════════════
type StructRes = { buckling: CalcResult; bending: CalcResult; weld: CalcResult };
const STRUCT_DEFAULTS = {
  inp: {
    loadKips: 50 as Num, lengthFt: 12 as Num, modulusE: 29000000 as Num, momentI: 82.8 as Num, kFactor: 1 as Num,
    windMph: 110 as Num, wallHeightFt: 10 as Num, wallThicknessIn: 8 as Num, concreteFc: 4000 as Num, rebarSpacingIn: 12 as Num, rebarSize: '5',
    weldSize: 0.25 as Num, weldLength: 10 as Num, weldMaterial: 'e70xx',
  },
  conn: { boltDiameter: 0.75 as Num, boltGrade: 'a325', numBolts: 4 as Num, loadType: 'single' },
  result: null as StructRes | null,
  resultAt: null as string | null,
  connResult: null as CalcResult | null,
  connAt: null as string | null,
};

function StructuralSection() {
  const [st, setSt, save] = useEngWorkspace('calcs.structural', STRUCT_DEFAULTS);
  const i = st.inp; const c = st.conn;
  const b = binder(setSt); const bc = binder(setSt, 'conn');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ ok: boolean; results: StructRes }>(
      'engineering', 'structuralCheck',
      {
        loadKips: n(i.loadKips, 0), lengthFt: n(i.lengthFt, 1), modulusE: n(i.modulusE, 1), momentI: n(i.momentI, 1), kFactor: n(i.kFactor, 1),
        windMph: n(i.windMph, 0), wallHeightFt: n(i.wallHeightFt, 1), wallThicknessIn: n(i.wallThicknessIn, 1),
        concreteFc: n(i.concreteFc, 4000), rebarSpacingIn: n(i.rebarSpacingIn, 12), rebarSize: parseInt(i.rebarSize, 10),
        weldSize: n(i.weldSize, 0.25), length: n(i.weldLength, 1), material: i.weldMaterial,
      },
    );
    if (r.data.ok && r.data.result) setSt((s) => ({ ...s, result: r.data.result!.results, resultAt: new Date().toISOString() }));
    else setError(r.data.error || 'Structural check failed');
    setLoading(false);
  };

  // ── Bolted connection (AISC allowable shear) — engineering.connectionCheck ──
  const runConnection = async () => {
    setConnectionLoading(true); setConnectionError('');
    const r = await lensRun<CalcResult>(
      'engineering', 'connectionCheck',
      { boltDiameter: n(c.boltDiameter, 0.75), boltGrade: c.boltGrade, numBolts: n(c.numBolts, 1), loadType: c.loadType },
    );
    if (r.data.ok && r.data.result) setSt((s) => ({ ...s, connResult: r.data.result!, connAt: new Date().toISOString() }));
    else setConnectionError(r.data.error || 'Connection check failed');
    setConnectionLoading(false);
  };

  return (
    <div className="panel p-4 space-y-3" data-testid="calc-structural">
      <SectionHead icon={<Building2 className="w-4 h-4 text-blue-400" />} title="Structural — column buckling · concrete shear wall · fillet weld" save={save} testId="calc-structural-save" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Column (Euler buckling)</p>
          <NumField label="Axial load (kips)" value={i.loadKips} onChange={b('loadKips')} />
          <NumField label="Unbraced length (ft)" value={i.lengthFt} onChange={b('lengthFt')} />
          <NumField label="Modulus E (psi)" value={i.modulusE} onChange={b('modulusE')} />
          <NumField label="Moment of inertia I (in⁴)" value={i.momentI} onChange={b('momentI')} />
          <NumField label="Effective length factor k" value={i.kFactor} onChange={b('kFactor')} step="0.1" />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Concrete shear wall</p>
          <NumField label="Design wind (mph)" value={i.windMph} onChange={b('windMph')} />
          <NumField label="Wall height (ft)" value={i.wallHeightFt} onChange={b('wallHeightFt')} />
          <NumField label="Wall thickness (in)" value={i.wallThicknessIn} onChange={b('wallThicknessIn')} />
          <NumField label="Concrete f'c (psi)" value={i.concreteFc} onChange={b('concreteFc')} />
          <NumField label="Rebar spacing (in)" value={i.rebarSpacingIn} onChange={b('rebarSpacingIn')} />
          <SelectField label="Rebar size (#)" value={i.rebarSize} onChange={b('rebarSize')} options={['3', '4', '5', '6', '7', '8']} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Fillet weld (AWS D1.1)</p>
          <NumField label="Leg size w (in)" value={i.weldSize} onChange={b('weldSize')} step="0.01" />
          <NumField label="Weld length (in)" value={i.weldLength} onChange={b('weldLength')} />
          <SelectField label="Electrode" value={i.weldMaterial} onChange={b('weldMaterial')} options={['e60xx', 'e70xx', 'e80xx', 'e90xx']} />
        </div>
      </div>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-lg text-sm font-semibold hover:bg-blue-500/30 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
        Run Structural Check
      </button>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {st.result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <ResultCard title="Column — critical buckling load (Pcr)" result={st.result.buckling} />
            <ResultCard title="Wall — shear factor of safety" result={st.result.bending} />
            <ResultCard title="Weld — allowable shear capacity" result={st.result.weld} />
          </div>
          <Computed at={st.resultAt} testId="calc-structural-at" />
        </>
      )}

      <div className="pt-2 border-t border-white/5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold md:col-span-4">
            Bolted connection (AISC allowable shear)
          </p>
          <NumField label="Bolt diameter (in)" value={c.boltDiameter} onChange={bc('boltDiameter')} step="0.0625" />
          <SelectField label="Bolt grade" value={c.boltGrade} onChange={bc('boltGrade')} options={['a307', 'a325', 'a490']} />
          <NumField label="Number of bolts" value={c.numBolts} onChange={bc('numBolts')} step="1" />
          <SelectField label="Load type" value={c.loadType} onChange={bc('loadType')} options={['single', 'double']} />
        </div>
        <button
          onClick={runConnection}
          disabled={connectionLoading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-lg text-sm font-semibold hover:bg-blue-500/30 disabled:opacity-50"
        >
          {connectionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
          Check Connection
        </button>
        {connectionError && <p role="alert" className="text-xs text-red-400">{connectionError}</p>}
        {st.connResult && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <ResultCard title="Connection — allowable shear capacity" result={st.connResult} />
            </div>
            <Computed at={st.connAt} testId="calc-connection-at" />
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Thermal — engineering.thermalAnalysis → { heatLoad, ductSize, cooling }
// ════════════════════════════════════════════════════════════════════════
type ThermRes = { heatLoad: CalcResult; ductSize: CalcResult; cooling: CalcResult };
const THERM_DEFAULTS = {
  inp: {
    deltaTemp: 30 as Num, rValue: 13 as Num, areaSqft: 400 as Num, solarGain: 0 as Num, cfm: 400 as Num, velocity: 1200 as Num,
    roomSqft: 200 as Num, occupants: 2 as Num, equipment: 300 as Num, windows: 2 as Num,
  },
  result: null as ThermRes | null,
  resultAt: null as string | null,
};

function ThermalSection() {
  const [st, setSt, save] = useEngWorkspace('calcs.thermal', THERM_DEFAULTS);
  const i = st.inp; const b = binder(setSt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ ok: boolean; results: ThermRes }>(
      'engineering', 'thermalAnalysis',
      {
        areaSqft: n(i.areaSqft, 1), rValue: n(i.rValue, 1), deltaTemp: n(i.deltaTemp, 0), solarGain: n(i.solarGain, 0),
        cfm: n(i.cfm, 1), velocity: n(i.velocity, 1200),
        roomSqft: n(i.roomSqft, 1), occupants: n(i.occupants, 0), equipment: n(i.equipment, 0), windows: n(i.windows, 0),
      },
    );
    if (r.data.ok && r.data.result) setSt((s) => ({ ...s, result: r.data.result!.results, resultAt: new Date().toISOString() }));
    else setError(r.data.error || 'Thermal analysis failed');
    setLoading(false);
  };

  return (
    <div className="panel p-4 space-y-3" data-testid="calc-thermal">
      <SectionHead icon={<Thermometer className="w-4 h-4 text-orange-400" />} title="Thermal / HVAC — heat load · duct sizing · cooling load (rule-of-thumb)" save={save} testId="calc-thermal-save" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumField label="Design ΔT (°F, shared)" value={i.deltaTemp} onChange={b('deltaTemp')} />
        <NumField label="Envelope R-value (shared)" value={i.rValue} onChange={b('rValue')} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 border-t border-white/5">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">Sensible heat load</p>
          <NumField label="Envelope area (ft²)" value={i.areaSqft} onChange={b('areaSqft')} />
          <NumField label="Solar gain (BTU/h)" value={i.solarGain} onChange={b('solarGain')} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">Duct sizing</p>
          <NumField label="Airflow (CFM)" value={i.cfm} onChange={b('cfm')} />
          <NumField label="Target velocity (fpm)" value={i.velocity} onChange={b('velocity')} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">Residential cooling load</p>
          <NumField label="Room area (ft²)" value={i.roomSqft} onChange={b('roomSqft')} />
          <NumField label="Occupants" value={i.occupants} onChange={b('occupants')} />
          <NumField label="Equipment (BTU/h)" value={i.equipment} onChange={b('equipment')} />
          <NumField label="Windows (count)" value={i.windows} onChange={b('windows')} />
        </div>
      </div>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-orange-500/20 text-orange-300 border border-orange-500/40 rounded-lg text-sm font-semibold hover:bg-orange-500/30 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Thermometer className="w-4 h-4" />}
        Run Thermal Analysis
      </button>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {st.result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <ResultCard title="Sensible heat load" result={st.result.heatLoad} />
            <ResultCard title="Duct diameter" result={st.result.ductSize} />
            <ResultCard title="Cooling load" result={st.result.cooling} />
          </div>
          <Computed at={st.resultAt} testId="calc-thermal-at" />
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Electrical — engineering.electricalCheck → { voltageDrop, breakerSize, conduitFill }
// ════════════════════════════════════════════════════════════════════════
const AWG_OPTIONS = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '300', '350', '400', '500'];
const EMT_SIZES = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3'];
type ElecRes = { voltageDrop: CalcResult; breakerSize: CalcResult; conduitFill: CalcResult };
const ELEC_DEFAULTS = {
  inp: {
    current: 20 as Num, vdLength: 75 as Num, awg: '12', material: 'copper', voltage: 120 as Num, phase: '1',
    loadAmps: 16 as Num, continuous: true, wireCount: 3 as Num, wireAWG: '12', conduitSize: '1/2',
  },
  xfmr: { loadKva: 100 as Num, voltage: 480 as Num, phase: '3', powerFactor: 0.9 as Num, growthFactor: 1.25 as Num },
  result: null as ElecRes | null,
  resultAt: null as string | null,
  xfmrResult: null as CalcResult | null,
  xfmrAt: null as string | null,
};

function ElectricalSection() {
  const [st, setSt, save] = useEngWorkspace('calcs.electrical', ELEC_DEFAULTS);
  const i = st.inp; const x = st.xfmr;
  const b = binder(setSt); const bx = binder(setSt, 'xfmr');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [transformerLoading, setTransformerLoading] = useState(false);
  const [transformerError, setTransformerError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ ok: boolean; results: ElecRes }>(
      'engineering', 'electricalCheck',
      {
        current: n(i.current, 0), length: n(i.vdLength, 1), awg: i.awg, material: i.material, voltage: n(i.voltage, 120), phase: parseInt(i.phase, 10),
        loadAmps: n(i.loadAmps, 0), continuous: i.continuous,
        wireCount: n(i.wireCount, 1), wireAWG: i.wireAWG, conduitSize: i.conduitSize,
      },
    );
    if (r.data.ok && r.data.result) setSt((s) => ({ ...s, result: r.data.result!.results, resultAt: new Date().toISOString() }));
    else setError(r.data.error || 'Electrical check failed');
    setLoading(false);
  };

  // ── Transformer sizing (ANSI kVA ladder) — engineering.transformerSizing ──
  const runTransformer = async () => {
    setTransformerLoading(true); setTransformerError('');
    const r = await lensRun<CalcResult>(
      'engineering', 'transformerSizing',
      {
        loadKva: n(x.loadKva, 1), voltage: n(x.voltage, 480), phase: parseInt(x.phase, 10),
        powerFactor: n(x.powerFactor, 0.9), growthFactor: n(x.growthFactor, 1.25),
      },
    );
    if (r.data.ok && r.data.result) setSt((s) => ({ ...s, xfmrResult: r.data.result!, xfmrAt: new Date().toISOString() }));
    else setTransformerError(r.data.error || 'Transformer sizing failed');
    setTransformerLoading(false);
  };

  return (
    <div className="panel p-4 space-y-3" data-testid="calc-electrical">
      <SectionHead icon={<Zap className="w-4 h-4 text-yellow-400" />} title="Electrical (NEC-aware) — voltage drop · breaker sizing · conduit fill" save={save} testId="calc-electrical-save" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold">Voltage drop</p>
          <NumField label="Current (A)" value={i.current} onChange={b('current')} />
          <NumField label="One-way run length (ft)" value={i.vdLength} onChange={b('vdLength')} />
          <SelectField label="Conductor AWG" value={i.awg} onChange={b('awg')} options={AWG_OPTIONS} />
          <SelectField label="Material" value={i.material} onChange={b('material')} options={['copper', 'aluminum']} />
          <NumField label="System voltage (V)" value={i.voltage} onChange={b('voltage')} />
          <SelectField label="Phase" value={i.phase} onChange={b('phase')} options={['1', '3']} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold">Breaker sizing</p>
          <NumField label="Load (A)" value={i.loadAmps} onChange={b('loadAmps')} />
          <label className="flex items-center gap-2 text-[11px] text-gray-300 pt-1">
            <input type="checkbox" checked={i.continuous} onChange={(e) => b('continuous')(e.target.checked)} className="accent-yellow-400" />
            Continuous load (×1.25, NEC 210.20)
          </label>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold">Conduit fill (NEC ch. 9)</p>
          <NumField label="Conductor count" value={i.wireCount} onChange={b('wireCount')} />
          <SelectField label="Conductor AWG" value={i.wireAWG} onChange={b('wireAWG')} options={AWG_OPTIONS} />
          <SelectField label="EMT trade size" value={i.conduitSize} onChange={b('conduitSize')} options={EMT_SIZES} />
        </div>
      </div>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 rounded-lg text-sm font-semibold hover:bg-yellow-500/30 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        Run Electrical Check
      </button>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {st.result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <ResultCard title="Voltage drop" result={st.result.voltageDrop} />
            <ResultCard title="Breaker size" result={st.result.breakerSize} />
            <ResultCard title="Conduit fill" result={st.result.conduitFill} />
          </div>
          <Computed at={st.resultAt} testId="calc-electrical-at" />
        </>
      )}

      <div className="pt-2 border-t border-white/5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold md:col-span-3">
            Transformer sizing (ANSI kVA ladder)
          </p>
          <NumField label="Load (kVA)" value={x.loadKva} onChange={bx('loadKva')} />
          <NumField label="Secondary voltage (V)" value={x.voltage} onChange={bx('voltage')} />
          <SelectField label="Phase" value={x.phase} onChange={bx('phase')} options={['1', '3']} />
          <NumField label="Power factor (0–1)" value={x.powerFactor} onChange={bx('powerFactor')} step="0.01" />
          <NumField label="Growth factor" value={x.growthFactor} onChange={bx('growthFactor')} step="0.05" />
        </div>
        <button
          onClick={runTransformer}
          disabled={transformerLoading}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 rounded-lg text-sm font-semibold hover:bg-yellow-500/30 disabled:opacity-50"
        >
          {transformerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Size Transformer
        </button>
        {transformerError && <p role="alert" className="text-xs text-red-400">{transformerError}</p>}
        {st.xfmrResult && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <ResultCard title="Transformer — selected kVA" result={st.xfmrResult} />
            </div>
            <Computed at={st.xfmrAt} testId="calc-transformer-at" />
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Hydraulic — engineering.hydraulicAnalysis → { pipeSize, pumpHead, pressureLoss }
// ════════════════════════════════════════════════════════════════════════
type HydRes = { pipeSize: CalcResult; pumpHead: CalcResult; pressureLoss: CalcResult };
const HYD_DEFAULTS = {
  inp: {
    flowGpm: 50 as Num, velocity: 5 as Num, totalDynamicHead: 80 as Num, efficiency: 0.7 as Num, specificGravity: 1.0 as Num,
    pipeDiameter: 2 as Num, plLength: 100 as Num, roughness: 0.00015 as Num,
  },
  result: null as HydRes | null,
  resultAt: null as string | null,
};

function HydraulicSection() {
  const [st, setSt, save] = useEngWorkspace('calcs.hydraulic', HYD_DEFAULTS);
  const i = st.inp; const b = binder(setSt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ ok: boolean; results: HydRes }>(
      'engineering', 'hydraulicAnalysis',
      {
        flowGpm: n(i.flowGpm, 1), velocity: n(i.velocity, 5),
        totalDynamicHead: n(i.totalDynamicHead, 1), efficiency: n(i.efficiency, 0.7), specificGravity: n(i.specificGravity, 1),
        pipeDiameter: n(i.pipeDiameter, 1), length: n(i.plLength, 1), roughness: n(i.roughness, 0.00015),
      },
    );
    if (r.data.ok && r.data.result) setSt((s) => ({ ...s, result: r.data.result!.results, resultAt: new Date().toISOString() }));
    else setError(r.data.error || 'Hydraulic analysis failed');
    setLoading(false);
  };

  return (
    <div className="panel p-4 space-y-3" data-testid="calc-hydraulic">
      <SectionHead icon={<Droplets className="w-4 h-4 text-cyan-400" />} title="Hydraulic / Plumbing — pipe sizing · pump BHP · Darcy–Weisbach loss" save={save} testId="calc-hydraulic-save" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <NumField label="Flow rate (GPM, shared)" value={i.flowGpm} onChange={b('flowGpm')} />
        <NumField label="Target velocity (ft/s)" value={i.velocity} onChange={b('velocity')} />
        <NumField label="Total dynamic head (ft)" value={i.totalDynamicHead} onChange={b('totalDynamicHead')} />
        <NumField label="Pump efficiency (0–1)" value={i.efficiency} onChange={b('efficiency')} step="0.01" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1 border-t border-white/5">
        <NumField label="Fluid specific gravity" value={i.specificGravity} onChange={b('specificGravity')} step="0.01" />
        <NumField label="Pipe diameter (in)" value={i.pipeDiameter} onChange={b('pipeDiameter')} />
        <NumField label="Pipe run length (ft)" value={i.plLength} onChange={b('plLength')} />
        <NumField label="Roughness ε (ft)" value={i.roughness} onChange={b('roughness')} step="0.00001" />
      </div>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-lg text-sm font-semibold hover:bg-cyan-500/30 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplets className="w-4 h-4" />}
        Run Hydraulic Analysis
      </button>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {st.result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <ResultCard title="Pipe internal diameter" result={st.result.pipeSize} />
            <ResultCard title="Pump brake horsepower" result={st.result.pumpHead} />
            <ResultCard title="Pressure loss (friction)" result={st.result.pressureLoss} />
          </div>
          <Computed at={st.resultAt} testId="calc-hydraulic-at" />
        </>
      )}
    </div>
  );
}

// ── Top-level export ─────────────────────────────────────────────────────────
export function MultiDisciplineCalcPanel() {
  return (
    <div className="space-y-4">
      <p data-testid="calcs-note" className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-400">
        Fields start with typical example values — replace them with yours. Every result is computed by the server from the
        formula shown on its card, and your inputs and latest results are saved to your account.
      </p>
      <StructuralSection />
      <ThermalSection />
      <ElectricalSection />
      <HydraulicSection />
    </div>
  );
}
