'use client';

/**
 * MissionPlanningPanel — real deterministic mission-planning calculators
 * that were completely unsurfaced before this rebuild (verified 2026-07-09:
 * zero frontend references to any of the four macros). See
 * docs/lens-specs/space-capability-map.md.
 *
 *   - orbitCalc         → altitude → period/velocity/LEO-MEO-GEO/escape velocity
 *   - deltaVBudget       → maneuver list → total delta-v + feasibility band
 *   - launchWindow       → target orbit + launch latitude → windows/day + dogleg penalty
 *   - reentryAnalysis    → mass + velocity + angle → peak-G, peak-temp, heat shield, corridor
 *
 * Each tool is a real designed form wired to its own macro — the KSP /
 * Delta-V-map shape a spaceflight-planning app is expected to have.
 */

import { useState } from 'react';
import { Loader2, Orbit, Fuel, Rocket, Flame, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Tool = 'orbit' | 'deltav' | 'window' | 'reentry';

const TOOLS: { id: Tool; label: string; icon: typeof Orbit }[] = [
  { id: 'orbit', label: 'Orbit Calculator', icon: Orbit },
  { id: 'deltav', label: 'Delta-V Budget', icon: Fuel },
  { id: 'window', label: 'Launch Window', icon: Rocket },
  { id: 'reentry', label: 'Reentry Analysis', icon: Flame },
];

const inputCls = 'bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
      {label}
      {children}
    </label>
  );
}

interface OrbitResult {
  altitudeKm: number; orbitalRadiusKm: number; periodMinutes: number;
  velocityKmS: number; orbitsPerDay: number; type: string; escapeVelocity: string;
}

function OrbitCalculatorTool() {
  const [altitude, setAltitude] = useState('400');
  const [result, setResult] = useState<OrbitResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const r = await lensRun<OrbitResult>('space', 'orbitCalc', { altitudeKm: Number(altitude) });
    setLoading(false);
    if (r.data.ok !== false) setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">Circular-orbit period, velocity, and zone classification from altitude.</p>
      <div className="flex items-end gap-2">
        <Field label="Altitude (km)">
          <input inputMode="decimal" value={altitude} onChange={(e) => setAltitude(e.target.value)} className={cn(inputCls, 'w-32')} />
        </Field>
        <button type="button" onClick={run} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Orbit className="w-3.5 h-3.5" />} Calculate
        </button>
      </div>
      {result && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          <span className="text-zinc-400">Orbit type</span><span className="text-indigo-300 text-right font-semibold">{result.type}</span>
          <span className="text-zinc-400">Orbital radius</span><span className="text-zinc-100 text-right">{result.orbitalRadiusKm.toLocaleString()} km</span>
          <span className="text-zinc-400">Period</span><span className="text-zinc-100 text-right">{result.periodMinutes} min · {result.orbitsPerDay} orbits/day</span>
          <span className="text-zinc-400">Velocity</span><span className="text-zinc-100 text-right">{result.velocityKmS} km/s</span>
          <span className="text-zinc-400">Escape velocity</span><span className="text-zinc-100 text-right">{result.escapeVelocity}</span>
        </div>
      )}
    </div>
  );
}

interface Maneuver { name: string; deltaV: string }
interface DeltaVResult {
  maneuvers?: { maneuver: string; deltaV: number; percentage: number }[];
  totalDeltaV?: number; unit?: string; feasibility?: string; message?: string;
}

function DeltaVBudgetTool() {
  const [maneuvers, setManeuvers] = useState<Maneuver[]>([{ name: 'Launch to LEO', deltaV: '9.4' }]);
  const [result, setResult] = useState<DeltaVResult | null>(null);
  const [loading, setLoading] = useState(false);

  const addRow = () => setManeuvers((m) => [...m, { name: '', deltaV: '' }]);
  const removeRow = (i: number) => setManeuvers((m) => m.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<Maneuver>) => setManeuvers((m) => m.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const run = async () => {
    setLoading(true);
    const cleaned = maneuvers.filter((m) => m.name.trim() && m.deltaV.trim());
    const r = await lensRun<DeltaVResult>('space', 'deltaVBudget', {
      maneuvers: cleaned.map((m) => ({ name: m.name.trim(), deltaV: m.deltaV })),
    });
    setLoading(false);
    if (r.data.ok !== false) setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">Total delta-v budget across a maneuver plan, with a chemical/efficient/advanced-propulsion feasibility band.</p>
      <div className="space-y-2">
        {maneuvers.map((m, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
            <Field label="Maneuver">
              <input value={m.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="e.g. Trans-lunar injection" className={inputCls} />
            </Field>
            <Field label="Δv (km/s)">
              <input inputMode="decimal" value={m.deltaV} onChange={(e) => updateRow(i, { deltaV: e.target.value })} className={cn(inputCls, 'w-24')} />
            </Field>
            <button type="button" aria-label="Remove maneuver" onClick={() => removeRow(i)} className="text-zinc-600 hover:text-rose-400 pb-2">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow} className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200">
          <Plus className="w-3.5 h-3.5" /> Add maneuver
        </button>
      </div>
      <button type="button" onClick={run} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fuel className="w-3.5 h-3.5" />} Compute budget
      </button>
      {result && (
        result.message ? (
          <p className="text-[11px] text-zinc-400 italic">{result.message}</p>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">Total Δv: <b className="text-zinc-100">{result.totalDeltaV} {result.unit}</b></span>
              <span className={cn('capitalize', result.feasibility === 'achievable-with-chemical' ? 'text-emerald-400' : result.feasibility === 'requires-efficient-propulsion' ? 'text-amber-400' : 'text-rose-400')}>
                {result.feasibility?.replace(/-/g, ' ')}
              </span>
            </div>
            {!!result.maneuvers?.length && (
              <ul className="space-y-1">
                {result.maneuvers.map((m, i) => (
                  <li key={i} className="flex items-center justify-between text-[11px] bg-zinc-950/60 rounded-lg px-2 py-1.5">
                    <span className="text-zinc-200">{m.maneuver}</span>
                    <span className="text-zinc-400">{m.deltaV} km/s · {m.percentage}%</span>
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

interface LaunchWindowResult {
  targetOrbit: string; launchLatitude: number; orbitalInclination: number;
  windowsPerDay: number; windowDuration: string; nextWindowApprox: string; inclinationPenalty: string;
}

function LaunchWindowTool() {
  const [targetOrbit, setTargetOrbit] = useState('LEO');
  const [latitude, setLatitude] = useState('28.5');
  const [inclination, setInclination] = useState('28.5');
  const [result, setResult] = useState<LaunchWindowResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const r = await lensRun<LaunchWindowResult>('space', 'launchWindow', {
      targetOrbit, launchLatitude: Number(latitude), inclination: Number(inclination),
    });
    setLoading(false);
    if (r.data.ok !== false) setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">Launch windows per day for a target orbit, plus the dogleg-maneuver penalty when the site latitude doesn&apos;t match the target inclination.</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Target orbit">
          <select value={targetOrbit} onChange={(e) => setTargetOrbit(e.target.value)} className={inputCls}>
            {['LEO', 'MEO', 'GEO'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Launch site latitude (°)">
          <input inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Target inclination (°)">
          <input inputMode="decimal" value={inclination} onChange={(e) => setInclination(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <button type="button" onClick={run} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />} Find window
      </button>
      {result && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          <span className="text-zinc-400">Windows / day</span><span className="text-zinc-100 text-right">{result.windowsPerDay}</span>
          <span className="text-zinc-400">Window duration</span><span className="text-zinc-100 text-right">{result.windowDuration}</span>
          <span className="text-zinc-400">Inclination penalty</span><span className={cn('text-right', result.inclinationPenalty.startsWith('Dogleg') ? 'text-amber-400' : 'text-emerald-400')}>{result.inclinationPenalty}</span>
          <span className="col-span-2 text-zinc-500 italic">{result.nextWindowApprox}</span>
        </div>
      )}
    </div>
  );
}

interface ReentryResult {
  massKg: number; entryVelocity: string; entryAngle: string; kineticEnergyGJ: number;
  peakDeceleration: string; peakTemperature: string; heatShieldRequired: string; survivability: string;
}

function ReentryAnalysisTool() {
  const [mass, setMass] = useState('1000');
  const [velocity, setVelocity] = useState('7.8');
  const [angle, setAngle] = useState('6');
  const [result, setResult] = useState<ReentryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const r = await lensRun<ReentryResult>('space', 'reentryAnalysis', {
      massKg: Number(mass), velocityKmS: Number(velocity), reentryAngleDeg: Number(angle),
    });
    setLoading(false);
    if (r.data.ok !== false) setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">Peak deceleration, peak heating, and reentry-corridor survivability from mass, velocity, and entry angle.</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Mass (kg)">
          <input inputMode="decimal" value={mass} onChange={(e) => setMass(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Entry velocity (km/s)">
          <input inputMode="decimal" value={velocity} onChange={(e) => setVelocity(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Entry angle (°)">
          <input inputMode="decimal" value={angle} onChange={(e) => setAngle(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <button type="button" onClick={run} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />} Analyze reentry
      </button>
      {result && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          <span className="text-zinc-400">Kinetic energy</span><span className="text-zinc-100 text-right">{result.kineticEnergyGJ} GJ</span>
          <span className="text-zinc-400">Peak deceleration</span><span className="text-zinc-100 text-right">{result.peakDeceleration}</span>
          <span className="text-zinc-400">Peak temperature</span><span className="text-zinc-100 text-right">{result.peakTemperature}</span>
          <span className="text-zinc-400">Heat shield</span><span className="text-zinc-100 text-right capitalize">{result.heatShieldRequired}</span>
          <span className="text-zinc-400">Corridor</span>
          <span className={cn('text-right capitalize', result.survivability === 'nominal-corridor' ? 'text-emerald-400' : 'text-rose-400')}>
            {result.survivability.replace(/-/g, ' ')}
          </span>
        </div>
      )}
    </div>
  );
}

export function MissionPlanningPanel() {
  const [tool, setTool] = useState<Tool>('orbit');

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-indigo-900/20 to-transparent">
        <Orbit className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-bold text-white">Mission Planning</h2>
        <span className="text-[11px] text-gray-500">Real orbital-mechanics math — not an LLM guess</span>
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
        {tool === 'orbit' && <OrbitCalculatorTool />}
        {tool === 'deltav' && <DeltaVBudgetTool />}
        {tool === 'window' && <LaunchWindowTool />}
        {tool === 'reentry' && <ReentryAnalysisTool />}
      </div>
    </div>
  );
}
