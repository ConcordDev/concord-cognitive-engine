'use client';

/**
 * AstroCalculators — real deterministic astronomy calculators that were
 * completely unsurfaced before this rebuild (verified 2026-07-09: zero
 * frontend references to any of the three macros). See
 * docs/lens-specs/astronomy-capability-map.md.
 *
 *   - planObservation   → moon-phase-aware session planner (darkness factor,
 *                          per-target difficulty/priority from magnitude)
 *   - lightTravelTime    → distance (ly / pc / AU) → light-travel-time + lookback
 *   - orbitalMechanics   → Kepler's third law: semi-major axis + eccentricity +
 *                          central mass → period/perihelion/aphelion/velocity
 *
 * Each tool is a real designed form (not a JSON-paste textarea, not a generic
 * macro-button wall) that calls its own macro and renders the actual numbers
 * the CAS-style backend computes.
 */

import { useState } from 'react';
import { Loader2, Moon, Ruler, RotateCw, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Tool = 'plan' | 'light' | 'orbit';

const TOOLS: { id: Tool; label: string; icon: typeof Moon }[] = [
  { id: 'plan', label: 'Session Planner', icon: Moon },
  { id: 'light', label: 'Light-Travel-Time', icon: Ruler },
  { id: 'orbit', label: 'Orbital Mechanics', icon: RotateCw },
];

interface PlanTarget { name: string; type: string; magnitude: string }
interface PlanResult {
  moonIllumination?: string;
  darknessFactor?: string;
  targets?: { name: string; type: string; magnitude: number; difficulty: string; priority: string }[];
  bestTargets?: { name: string }[];
  equipmentNeeded?: string;
  message?: string;
}
interface LightResult {
  object?: string | null;
  distanceLightYears?: number;
  distanceParsecs?: number;
  distanceKm?: string;
  travelTimeLight?: string;
  lookbackTime?: string;
  message?: string;
}
interface OrbitResult {
  object?: string | null;
  semiMajorAxisAU?: number;
  eccentricity?: number;
  periodYears?: number;
  periodDays?: number;
  perihelionAU?: number;
  aphelionAU?: number;
  avgOrbitalVelocityKmS?: number;
  orbitType?: string;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
      {label}
      {children}
    </label>
  );
}

const inputCls = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100';

function PlanObservationTool() {
  const [targets, setTargets] = useState<PlanTarget[]>([{ name: '', type: 'star', magnitude: '' }]);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => setTargets((t) => [...t, { name: '', type: 'star', magnitude: '' }]);
  const removeRow = (i: number) => setTargets((t) => t.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<PlanTarget>) =>
    setTargets((t) => t.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const run = async () => {
    setLoading(true); setError(null);
    const cleaned = targets.filter((t) => t.name.trim());
    const r = await lensRun<PlanResult>('astronomy', 'planObservation', {
      targets: cleaned.map((t) => ({ name: t.name.trim(), type: t.type, magnitude: t.magnitude })),
    });
    setLoading(false);
    if (r.data.ok === false) { setError(r.data.error || 'Failed'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Plan tonight&apos;s session — darkness factor from the real lunar-phase cycle, and per-target
        difficulty/priority derived from each object&apos;s magnitude.
      </p>
      <div className="space-y-2">
        {targets.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
            <Field label="Target name">
              <input value={t.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="e.g. M42" className={inputCls} />
            </Field>
            <Field label="Type">
              <select value={t.type} onChange={(e) => updateRow(i, { type: e.target.value })} className={inputCls}>
                {['star', 'planet', 'nebula', 'galaxy', 'cluster', 'double_star'].map((tp) => <option key={tp} value={tp}>{tp}</option>)}
              </select>
            </Field>
            <Field label="Magnitude">
              <input inputMode="decimal" value={t.magnitude} onChange={(e) => updateRow(i, { magnitude: e.target.value })} placeholder="4.5" className={cn(inputCls, 'w-20')} />
            </Field>
            <button type="button" aria-label="Remove row" onClick={() => removeRow(i)} className="text-zinc-600 hover:text-rose-400 pb-2">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow} className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200">
          <Plus className="w-3.5 h-3.5" /> Add target
        </button>
      </div>
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      <button type="button" onClick={run} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Moon className="w-3.5 h-3.5" />} Plan session
      </button>

      {result && (
        result.message ? (
          <p className="text-[11px] text-zinc-400 italic">{result.message}</p>
        ) : (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-zinc-300">Moon illumination: <b className="text-zinc-100">{result.moonIllumination}</b></span>
              <span className="text-zinc-300">Darkness: <b className={cn(
                result.darknessFactor === 'excellent' ? 'text-emerald-400' :
                result.darknessFactor === 'good' ? 'text-lime-400' :
                result.darknessFactor === 'fair' ? 'text-amber-400' : 'text-rose-400',
              )}>{result.darknessFactor}</b></span>
            </div>
            {result.equipmentNeeded && <p className="text-[11px] text-zinc-400">{result.equipmentNeeded}</p>}
            {!!result.targets?.length && (
              <ul className="space-y-1">
                {result.targets.map((t, i) => (
                  <li key={i} className="flex items-center justify-between text-[11px] bg-zinc-950/60 rounded-lg px-2 py-1.5">
                    <span className="text-zinc-200">{t.name} <span className="text-zinc-500 capitalize">· {t.type}</span></span>
                    <span className="flex items-center gap-2">
                      <span className="text-zinc-400">mag {t.magnitude}</span>
                      <span className="text-indigo-300">{t.difficulty}</span>
                      <span className={cn('uppercase text-[10px]', t.priority === 'high' ? 'text-rose-400' : 'text-zinc-500')}>{t.priority}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}
    </div>
  );
}

function LightTravelTimeTool() {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<'ly' | 'pc' | 'au'>('ly');
  const [distance, setDistance] = useState('');
  const [result, setResult] = useState<LightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const n = Number(distance);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a positive distance.'); return; }
    setLoading(true); setError(null);
    const input: Record<string, unknown> = { name: name.trim() || undefined };
    if (unit === 'ly') input.distanceLightYears = n;
    if (unit === 'pc') input.distanceParsecs = n;
    if (unit === 'au') input.distanceAU = n;
    const r = await lensRun<LightResult>('astronomy', 'lightTravelTime', input);
    setLoading(false);
    if (r.data.ok === false) { setError(r.data.error || 'Failed'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        How far away is it, and how long ago is the light you&apos;re seeing? Real light-speed math (299,792.458 km/s).
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Object name (optional)">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Andromeda" className={inputCls} />
        </Field>
        <Field label="Unit">
          <select value={unit} onChange={(e) => setUnit(e.target.value as 'ly' | 'pc' | 'au')} className={inputCls}>
            <option value="ly">Light-years</option>
            <option value="pc">Parsecs</option>
            <option value="au">Astronomical units</option>
          </select>
        </Field>
        <Field label="Distance">
          <input inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="2,500,000" className={inputCls} />
        </Field>
      </div>
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      <button type="button" onClick={run} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ruler className="w-3.5 h-3.5" />} Calculate
      </button>

      {result && (
        result.message ? (
          <p className="text-[11px] text-zinc-400 italic">{result.message}</p>
        ) : (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            {result.object && <div className="col-span-2 text-sm font-semibold text-zinc-100">{result.object}</div>}
            <span className="text-zinc-400">Distance</span><span className="text-zinc-100 text-right">{result.distanceLightYears?.toLocaleString()} ly · {result.distanceParsecs?.toLocaleString()} pc</span>
            <span className="text-zinc-400">Distance (km)</span><span className="text-zinc-100 text-right font-mono">{result.distanceKm}</span>
            <span className="text-zinc-400">Travel time</span><span className="text-indigo-300 text-right">{result.travelTimeLight}</span>
            <span className="col-span-2 text-zinc-400 italic mt-1">{result.lookbackTime}</span>
          </div>
        )
      )}
    </div>
  );
}

function OrbitalMechanicsTool() {
  const [name, setName] = useState('');
  const [semiMajor, setSemiMajor] = useState('1');
  const [eccentricity, setEccentricity] = useState('0');
  const [centralMass, setCentralMass] = useState('1');
  const [result, setResult] = useState<OrbitResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    const r = await lensRun<OrbitResult>('astronomy', 'orbitalMechanics', {
      name: name.trim() || undefined,
      semiMajorAxis: Number(semiMajor),
      eccentricity: Number(eccentricity),
      centralMass: Number(centralMass),
    });
    setLoading(false);
    if (r.data.ok === false) { setError(r.data.error || 'Failed'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Kepler&apos;s third law: orbital period, perihelion/aphelion, and average velocity from
        semi-major axis, eccentricity, and central mass.
      </p>
      <div className="grid grid-cols-4 gap-2">
        <Field label="Object name (optional)">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mars" className={inputCls} />
        </Field>
        <Field label="Semi-major axis (AU)">
          <input inputMode="decimal" value={semiMajor} onChange={(e) => setSemiMajor(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Eccentricity (0–0.99)">
          <input inputMode="decimal" value={eccentricity} onChange={(e) => setEccentricity(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Central mass (M☉)">
          <input inputMode="decimal" value={centralMass} onChange={(e) => setCentralMass(e.target.value)} className={inputCls} />
        </Field>
      </div>
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      <button type="button" onClick={run} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />} Calculate orbit
      </button>

      {result && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          {result.object && <div className="col-span-2 text-sm font-semibold text-zinc-100">{result.object}</div>}
          <span className="text-zinc-400">Orbital period</span><span className="text-zinc-100 text-right">{result.periodYears} yr ({result.periodDays} days)</span>
          <span className="text-zinc-400">Perihelion / Aphelion</span><span className="text-zinc-100 text-right">{result.perihelionAU} / {result.aphelionAU} AU</span>
          <span className="text-zinc-400">Avg. orbital velocity</span><span className="text-zinc-100 text-right">{result.avgOrbitalVelocityKmS} km/s</span>
          <span className="text-zinc-400">Orbit type</span><span className="text-indigo-300 text-right capitalize">{result.orbitType?.replace(/-/g, ' ')}</span>
        </div>
      )}
    </div>
  );
}

export function AstroCalculators() {
  const [tool, setTool] = useState<Tool>('plan');

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-indigo-600/15 to-transparent">
        <RotateCw className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-bold text-zinc-100">Calculators</h2>
        <span className="text-[11px] text-zinc-400">Real deterministic astronomy math — not an LLM guess</span>
      </header>
      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = tool === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTool(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-indigo-500',
                active ? 'bg-zinc-900 text-indigo-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>
      <div className="p-4">
        {tool === 'plan' && <PlanObservationTool />}
        {tool === 'light' && <LightTravelTimeTool />}
        {tool === 'orbit' && <OrbitalMechanicsTool />}
      </div>
    </div>
  );
}
