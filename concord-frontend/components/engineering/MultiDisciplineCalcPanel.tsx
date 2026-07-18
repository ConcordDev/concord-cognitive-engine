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

import { useState } from 'react';
import {
  Building2, Thermometer, Zap, Droplets, Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

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

// ════════════════════════════════════════════════════════════════════════
// Structural — engineering.structuralCheck → { buckling, bending, weld }
// ════════════════════════════════════════════════════════════════════════
function StructuralSection() {
  const [loadKips, setLoadKips] = useState<Num>(50);
  const [lengthFt, setLengthFt] = useState<Num>(12);
  const [modulusE, setModulusE] = useState<Num>(29000000);
  const [momentI, setMomentI] = useState<Num>(82.8);
  const [kFactor, setKFactor] = useState<Num>(1);

  const [windMph, setWindMph] = useState<Num>(110);
  const [wallHeightFt, setWallHeightFt] = useState<Num>(10);
  const [wallThicknessIn, setWallThicknessIn] = useState<Num>(8);
  const [concreteFc, setConcreteFc] = useState<Num>(4000);
  const [rebarSpacingIn, setRebarSpacingIn] = useState<Num>(12);
  const [rebarSize, setRebarSize] = useState('5');

  const [weldSize, setWeldSize] = useState<Num>(0.25);
  const [weldLength, setWeldLength] = useState<Num>(10);
  const [weldMaterial, setWeldMaterial] = useState('e70xx');

  const [result, setResult] = useState<{ buckling: CalcResult; bending: CalcResult; weld: CalcResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ ok: boolean; results: { buckling: CalcResult; bending: CalcResult; weld: CalcResult } }>(
      'engineering', 'structuralCheck',
      {
        loadKips: n(loadKips, 0), lengthFt: n(lengthFt, 1), modulusE: n(modulusE, 1), momentI: n(momentI, 1), kFactor: n(kFactor, 1),
        windMph: n(windMph, 0), wallHeightFt: n(wallHeightFt, 1), wallThicknessIn: n(wallThicknessIn, 1),
        concreteFc: n(concreteFc, 4000), rebarSpacingIn: n(rebarSpacingIn, 12), rebarSize: parseInt(rebarSize, 10),
        weldSize: n(weldSize, 0.25), length: n(weldLength, 1), material: weldMaterial,
      },
    );
    if (r.data.ok && r.data.result) setResult(r.data.result.results);
    else setError(r.data.error || 'Structural check failed');
    setLoading(false);
  };

  // ── Bolted connection (AISC allowable shear) — engineering.connectionCheck ──
  // Real AISC math (R = Fv·Ab·n·planes) previously unreachable at the macro
  // layer (server/lib/compute/engineering-compute.js#boltedConnection existed
  // but no macro called it); wired as its own macro since structuralCheck's
  // field set is a separate server.js registration this pass may not touch.
  const [boltDiameter, setBoltDiameter] = useState<Num>(0.75);
  const [boltGrade, setBoltGrade] = useState('a325');
  const [numBolts, setNumBolts] = useState<Num>(4);
  const [loadType, setLoadType] = useState('single');
  const [connectionResult, setConnectionResult] = useState<CalcResult | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  const runConnection = async () => {
    setConnectionLoading(true); setConnectionError('');
    const r = await lensRun<CalcResult>(
      'engineering', 'connectionCheck',
      { boltDiameter: n(boltDiameter, 0.75), boltGrade, numBolts: n(numBolts, 1), loadType },
    );
    if (r.data.ok && r.data.result) setConnectionResult(r.data.result);
    else setConnectionError(r.data.error || 'Connection check failed');
    setConnectionLoading(false);
  };

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Building2 className="w-4 h-4 text-blue-400" /> Structural — column buckling · concrete shear wall · fillet weld
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Column (Euler buckling)</p>
          <NumField label="Axial load (kips)" value={loadKips} onChange={setLoadKips} />
          <NumField label="Unbraced length (ft)" value={lengthFt} onChange={setLengthFt} />
          <NumField label="Modulus E (psi)" value={modulusE} onChange={setModulusE} />
          <NumField label="Moment of inertia I (in⁴)" value={momentI} onChange={setMomentI} />
          <NumField label="Effective length factor k" value={kFactor} onChange={setKFactor} step="0.1" />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Concrete shear wall</p>
          <NumField label="Design wind (mph)" value={windMph} onChange={setWindMph} />
          <NumField label="Wall height (ft)" value={wallHeightFt} onChange={setWallHeightFt} />
          <NumField label="Wall thickness (in)" value={wallThicknessIn} onChange={setWallThicknessIn} />
          <NumField label="Concrete f'c (psi)" value={concreteFc} onChange={setConcreteFc} />
          <NumField label="Rebar spacing (in)" value={rebarSpacingIn} onChange={setRebarSpacingIn} />
          <SelectField label="Rebar size (#)" value={rebarSize} onChange={setRebarSize} options={['3', '4', '5', '6', '7', '8']} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Fillet weld (AWS D1.1)</p>
          <NumField label="Leg size w (in)" value={weldSize} onChange={setWeldSize} step="0.01" />
          <NumField label="Weld length (in)" value={weldLength} onChange={setWeldLength} />
          <SelectField label="Electrode" value={weldMaterial} onChange={setWeldMaterial} options={['e60xx', 'e70xx', 'e80xx', 'e90xx']} />
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
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <ResultCard title="Column — critical buckling load (Pcr)" result={result.buckling} />
          <ResultCard title="Wall — shear factor of safety" result={result.bending} />
          <ResultCard title="Weld — allowable shear capacity" result={result.weld} />
        </div>
      )}

      <div className="pt-2 border-t border-white/5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold md:col-span-4">
            Bolted connection (AISC allowable shear)
          </p>
          <NumField label="Bolt diameter (in)" value={boltDiameter} onChange={setBoltDiameter} step="0.0625" />
          <SelectField label="Bolt grade" value={boltGrade} onChange={setBoltGrade} options={['a307', 'a325', 'a490']} />
          <NumField label="Number of bolts" value={numBolts} onChange={setNumBolts} step="1" />
          <SelectField label="Load type" value={loadType} onChange={setLoadType} options={['single', 'double']} />
        </div>
        <button
          onClick={runConnection}
          disabled={connectionLoading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-lg text-sm font-semibold hover:bg-blue-500/30 disabled:opacity-50"
        >
          {connectionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
          Check Connection
        </button>
        {connectionError && <p className="text-xs text-red-400">{connectionError}</p>}
        {connectionResult && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <ResultCard title="Connection — allowable shear capacity" result={connectionResult} />
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Thermal — engineering.thermalAnalysis → { heatLoad, ductSize, cooling }
// ════════════════════════════════════════════════════════════════════════
function ThermalSection() {
  const [deltaTemp, setDeltaTemp] = useState<Num>(30);
  const [rValue, setRValue] = useState<Num>(13);

  const [areaSqft, setAreaSqft] = useState<Num>(400);
  const [solarGain, setSolarGain] = useState<Num>(0);

  const [cfm, setCfm] = useState<Num>(400);
  const [velocity, setVelocity] = useState<Num>(1200);

  const [roomSqft, setRoomSqft] = useState<Num>(200);
  const [occupants, setOccupants] = useState<Num>(2);
  const [equipment, setEquipment] = useState<Num>(300);
  const [windows, setWindows] = useState<Num>(2);

  const [result, setResult] = useState<{ heatLoad: CalcResult; ductSize: CalcResult; cooling: CalcResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ ok: boolean; results: { heatLoad: CalcResult; ductSize: CalcResult; cooling: CalcResult } }>(
      'engineering', 'thermalAnalysis',
      {
        areaSqft: n(areaSqft, 1), rValue: n(rValue, 1), deltaTemp: n(deltaTemp, 0), solarGain: n(solarGain, 0),
        cfm: n(cfm, 1), velocity: n(velocity, 1200),
        roomSqft: n(roomSqft, 1), occupants: n(occupants, 0), equipment: n(equipment, 0), windows: n(windows, 0),
      },
    );
    if (r.data.ok && r.data.result) setResult(r.data.result.results);
    else setError(r.data.error || 'Thermal analysis failed');
    setLoading(false);
  };

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Thermometer className="w-4 h-4 text-orange-400" /> Thermal / HVAC — heat load · duct sizing · cooling load
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumField label="Design ΔT (°F, shared)" value={deltaTemp} onChange={setDeltaTemp} />
        <NumField label="Envelope R-value (shared)" value={rValue} onChange={setRValue} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 border-t border-white/5">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">Sensible heat load</p>
          <NumField label="Envelope area (ft²)" value={areaSqft} onChange={setAreaSqft} />
          <NumField label="Solar gain (BTU/h)" value={solarGain} onChange={setSolarGain} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">Duct sizing</p>
          <NumField label="Airflow (CFM)" value={cfm} onChange={setCfm} />
          <NumField label="Target velocity (fpm)" value={velocity} onChange={setVelocity} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">Residential cooling load</p>
          <NumField label="Room area (ft²)" value={roomSqft} onChange={setRoomSqft} />
          <NumField label="Occupants" value={occupants} onChange={setOccupants} />
          <NumField label="Equipment (BTU/h)" value={equipment} onChange={setEquipment} />
          <NumField label="Windows (count)" value={windows} onChange={setWindows} />
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
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <ResultCard title="Sensible heat load" result={result.heatLoad} />
          <ResultCard title="Duct diameter" result={result.ductSize} />
          <ResultCard title="Cooling load" result={result.cooling} />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Electrical — engineering.electricalCheck → { voltageDrop, breakerSize, conduitFill }
// ════════════════════════════════════════════════════════════════════════
const AWG_OPTIONS = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '300', '350', '400', '500'];
const EMT_SIZES = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3'];

function ElectricalSection() {
  const [current, setCurrent] = useState<Num>(20);
  const [vdLength, setVdLength] = useState<Num>(75);
  const [awg, setAwg] = useState('12');
  const [material, setMaterial] = useState('copper');
  const [voltage, setVoltage] = useState<Num>(120);
  const [phase, setPhase] = useState('1');

  const [loadAmps, setLoadAmps] = useState<Num>(16);
  const [continuous, setContinuous] = useState(true);

  const [wireCount, setWireCount] = useState<Num>(3);
  const [wireAWG, setWireAWG] = useState('12');
  const [conduitSize, setConduitSize] = useState('1/2');

  const [result, setResult] = useState<{ voltageDrop: CalcResult; breakerSize: CalcResult; conduitFill: CalcResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ ok: boolean; results: { voltageDrop: CalcResult; breakerSize: CalcResult; conduitFill: CalcResult } }>(
      'engineering', 'electricalCheck',
      {
        current: n(current, 0), length: n(vdLength, 1), awg, material, voltage: n(voltage, 120), phase: parseInt(phase, 10),
        loadAmps: n(loadAmps, 0), continuous,
        wireCount: n(wireCount, 1), wireAWG, conduitSize,
      },
    );
    if (r.data.ok && r.data.result) setResult(r.data.result.results);
    else setError(r.data.error || 'Electrical check failed');
    setLoading(false);
  };

  // ── Transformer sizing (ANSI kVA ladder) — engineering.transformerSizing ──
  // Real ANSI math (required = loadKva·growthFactor → next standard kVA size
  // → primaryAmps) previously unreachable at the macro layer (server/lib/
  // compute/engineering-compute.js#transformerSizing existed but no macro
  // called it); wired as its own macro alongside electricalCheck.
  const [loadKva, setLoadKva] = useState<Num>(100);
  const [xfmrVoltage, setXfmrVoltage] = useState<Num>(480);
  const [xfmrPhase, setXfmrPhase] = useState('3');
  const [powerFactor, setPowerFactor] = useState<Num>(0.9);
  const [growthFactor, setGrowthFactor] = useState<Num>(1.25);
  const [transformerResult, setTransformerResult] = useState<CalcResult | null>(null);
  const [transformerLoading, setTransformerLoading] = useState(false);
  const [transformerError, setTransformerError] = useState('');

  const runTransformer = async () => {
    setTransformerLoading(true); setTransformerError('');
    const r = await lensRun<CalcResult>(
      'engineering', 'transformerSizing',
      {
        loadKva: n(loadKva, 1), voltage: n(xfmrVoltage, 480), phase: parseInt(xfmrPhase, 10),
        powerFactor: n(powerFactor, 0.9), growthFactor: n(growthFactor, 1.25),
      },
    );
    if (r.data.ok && r.data.result) setTransformerResult(r.data.result);
    else setTransformerError(r.data.error || 'Transformer sizing failed');
    setTransformerLoading(false);
  };

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Zap className="w-4 h-4 text-yellow-400" /> Electrical (NEC-aware) — voltage drop · breaker sizing · conduit fill
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold">Voltage drop</p>
          <NumField label="Current (A)" value={current} onChange={setCurrent} />
          <NumField label="One-way run length (ft)" value={vdLength} onChange={setVdLength} />
          <SelectField label="Conductor AWG" value={awg} onChange={setAwg} options={AWG_OPTIONS} />
          <SelectField label="Material" value={material} onChange={setMaterial} options={['copper', 'aluminum']} />
          <NumField label="System voltage (V)" value={voltage} onChange={setVoltage} />
          <SelectField label="Phase" value={phase} onChange={setPhase} options={['1', '3']} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold">Breaker sizing</p>
          <NumField label="Load (A)" value={loadAmps} onChange={setLoadAmps} />
          <label className="flex items-center gap-2 text-[11px] text-gray-300 pt-1">
            <input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} className="accent-yellow-400" />
            Continuous load (×1.25, NEC 210.20)
          </label>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold">Conduit fill (NEC ch. 9)</p>
          <NumField label="Conductor count" value={wireCount} onChange={setWireCount} />
          <SelectField label="Conductor AWG" value={wireAWG} onChange={setWireAWG} options={AWG_OPTIONS} />
          <SelectField label="EMT trade size" value={conduitSize} onChange={setConduitSize} options={EMT_SIZES} />
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
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <ResultCard title="Voltage drop" result={result.voltageDrop} />
          <ResultCard title="Breaker size" result={result.breakerSize} />
          <ResultCard title="Conduit fill" result={result.conduitFill} />
        </div>
      )}

      <div className="pt-2 border-t border-white/5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold md:col-span-3">
            Transformer sizing (ANSI kVA ladder)
          </p>
          <NumField label="Load (kVA)" value={loadKva} onChange={setLoadKva} />
          <NumField label="Secondary voltage (V)" value={xfmrVoltage} onChange={setXfmrVoltage} />
          <SelectField label="Phase" value={xfmrPhase} onChange={setXfmrPhase} options={['1', '3']} />
          <NumField label="Power factor (0–1)" value={powerFactor} onChange={setPowerFactor} step="0.01" />
          <NumField label="Growth factor" value={growthFactor} onChange={setGrowthFactor} step="0.05" />
        </div>
        <button
          onClick={runTransformer}
          disabled={transformerLoading}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 rounded-lg text-sm font-semibold hover:bg-yellow-500/30 disabled:opacity-50"
        >
          {transformerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Size Transformer
        </button>
        {transformerError && <p className="text-xs text-red-400">{transformerError}</p>}
        {transformerResult && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <ResultCard title="Transformer — selected kVA" result={transformerResult} />
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Hydraulic — engineering.hydraulicAnalysis → { pipeSize, pumpHead, pressureLoss }
// ════════════════════════════════════════════════════════════════════════
function HydraulicSection() {
  const [flowGpm, setFlowGpm] = useState<Num>(50);

  const [velocity, setVelocity] = useState<Num>(5);

  const [totalDynamicHead, setTotalDynamicHead] = useState<Num>(80);
  const [efficiency, setEfficiency] = useState<Num>(0.7);
  const [specificGravity, setSpecificGravity] = useState<Num>(1.0);

  const [pipeDiameter, setPipeDiameter] = useState<Num>(2);
  const [plLength, setPlLength] = useState<Num>(100);
  const [roughness, setRoughness] = useState<Num>(0.00015);

  const [result, setResult] = useState<{ pipeSize: CalcResult; pumpHead: CalcResult; pressureLoss: CalcResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ ok: boolean; results: { pipeSize: CalcResult; pumpHead: CalcResult; pressureLoss: CalcResult } }>(
      'engineering', 'hydraulicAnalysis',
      {
        flowGpm: n(flowGpm, 1), velocity: n(velocity, 5),
        totalDynamicHead: n(totalDynamicHead, 1), efficiency: n(efficiency, 0.7), specificGravity: n(specificGravity, 1),
        pipeDiameter: n(pipeDiameter, 1), length: n(plLength, 1), roughness: n(roughness, 0.00015),
      },
    );
    if (r.data.ok && r.data.result) setResult(r.data.result.results);
    else setError(r.data.error || 'Hydraulic analysis failed');
    setLoading(false);
  };

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Droplets className="w-4 h-4 text-cyan-400" /> Hydraulic / Plumbing — pipe sizing · pump BHP · Darcy–Weisbach loss
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <NumField label="Flow rate (GPM, shared)" value={flowGpm} onChange={setFlowGpm} />
        <NumField label="Target velocity (ft/s)" value={velocity} onChange={setVelocity} />
        <NumField label="Total dynamic head (ft)" value={totalDynamicHead} onChange={setTotalDynamicHead} />
        <NumField label="Pump efficiency (0–1)" value={efficiency} onChange={setEfficiency} step="0.01" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1 border-t border-white/5">
        <NumField label="Fluid specific gravity" value={specificGravity} onChange={setSpecificGravity} step="0.01" />
        <NumField label="Pipe diameter (in)" value={pipeDiameter} onChange={setPipeDiameter} />
        <NumField label="Pipe run length (ft)" value={plLength} onChange={setPlLength} />
        <NumField label="Roughness ε (ft)" value={roughness} onChange={setRoughness} step="0.00001" />
      </div>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-lg text-sm font-semibold hover:bg-cyan-500/30 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplets className="w-4 h-4" />}
        Run Hydraulic Analysis
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <ResultCard title="Pipe internal diameter" result={result.pipeSize} />
          <ResultCard title="Pump brake horsepower" result={result.pumpHead} />
          <ResultCard title="Pressure loss (friction)" result={result.pressureLoss} />
        </div>
      )}
    </div>
  );
}

// ── Top-level export ─────────────────────────────────────────────────────────
export function MultiDisciplineCalcPanel() {
  return (
    <div className="space-y-4">
      <StructuralSection />
      <ThermalSection />
      <ElectricalSection />
      <HydraulicSection />
    </div>
  );
}
