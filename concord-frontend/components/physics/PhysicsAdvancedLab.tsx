'use client';

/**
 * PhysicsAdvancedLab — bespoke solvers for physics.{kinematicsSim,
 * orbitalMechanics, waveInterference, thermodynamics}.
 *
 * These four macros were previously ONLY reachable through a broken
 * "Physics Analysis" panel (page.tsx) that ran them against a saved 2D
 * canvas-sandbox artifact — a field-shape mismatch (the canvas scene has
 * no `initialVelocity`/`mass1`/`frequency`/`pressure` fields at all), so
 * two of the four buttons always errored and the other two silently
 * returned the same canned default regardless of the saved scene.
 *
 * IMPORTANT — verified against the LIVE handler, not domains/physics.js:
 * `server/domains/physics.js` registers richer multi-body/orbital-element/
 * grid-interference/process bodies for these same four macro names, but
 * `server.js`'s "Engineering Compute" block (~line 41797) re-registers
 * `registerLensAction('physics', <name>, ...)` for all four AFTER
 * domains/physics.js loads, and `registerLensAction` is a last-write-wins
 * Map — so the domains/physics.js bodies for these four are dead code,
 * confirmed via the depth harness (`tests/depth/_harness.js`) and pinned
 * by `server/tests/depth/physics-behavior.test.js`'s own header comment.
 * This panel is wired against the flatter, LIVE server.js contracts:
 *   - kinematicsSim:    { initialVelocity, acceleration, time } → v=u+at, s=ut+½at²
 *   - orbitalMechanics: { mass1, mass2, distance } → Newtonian two-body gravity
 *   - waveInterference: { frequency, waveSpeed, sourceFreq, sourceVel, observerVel }
 *                        → wavelength (λ=v/f) + Doppler shift, computed independently
 *   - thermodynamics:   { pressure, volume, moles, temperatureK, mass, specificHeat,
 *                          deltaTemp, hotK, coldK } → ideal gas law (any 3 of 4) +
 *                        heat transfer (Q=mcΔT) + Carnot efficiency, all three at once
 * (domains/physics.js's PhET-style scene editor macros — scene-save/scene-run/
 * simulate-scene/measure/curriculum-list/curriculum-get/pendulum-period — are
 * NOT shadowed and remain live; those are wired separately in PhysicsLab.tsx.)
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Rocket, Orbit, Waves, Thermometer, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type SolverTab = 'kinematics' | 'orbital' | 'waves' | 'thermo';

// ─────────────────────────── shared bits ───────────────────────────

function NumField({
  label, value, onChange, placeholder, className,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
      />
    </label>
  );
}

function RunButton({ busy, onClick, label = 'Run' }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/15 text-xs text-indigo-100 hover:bg-indigo-500/25 disabled:opacity-50"
    >
      {busy && <Loader2 className="w-3 h-3 animate-spin" />}
      {label}
    </button>
  );
}

function ErrBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">
      <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {text}
    </div>
  );
}

const num = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// ─────────────────────────── Kinematics tab ───────────────────────────

interface KinResult { finalVelocity: number; displacement: number; averageVelocity: number; formula: string; inputs: Record<string, number> }

function KinematicsTab() {
  const [initialVelocity, setInitialVelocity] = useState('2');
  const [acceleration, setAcceleration] = useState('3');
  const [time, setTime] = useState('4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KinResult | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun<KinResult>('physics', 'kinematicsSim', {
        initialVelocity: num(initialVelocity) ?? 0,
        acceleration: num(acceleration) ?? 0,
        time: num(time),
      });
      if (r.data.ok && r.data.result) setResult(r.data.result);
      else { setResult(null); setError(r.data.error || 'time is required.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-400">Single-body 1D kinematics: v = u + at, s = ut + ½at².</p>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField label="u — initial velocity m/s" value={initialVelocity} onChange={setInitialVelocity} />
        <NumField label="a — acceleration m/s²" value={acceleration} onChange={setAcceleration} />
        <NumField label="t — time s (required)" value={time} onChange={setTime} />
      </div>
      <RunButton busy={busy} onClick={run} label="Solve" />
      <ErrBanner text={error} />
      {result && (
        <div className="rounded border border-indigo-500/20 bg-indigo-500/5 p-3 grid grid-cols-3 gap-3 text-xs">
          <p><span className="text-gray-400 block">Final velocity</span><span className="font-mono text-indigo-200 text-base">{result.finalVelocity} m/s</span></p>
          <p><span className="text-gray-400 block">Displacement</span><span className="font-mono text-indigo-200 text-base">{result.displacement} m</span></p>
          <p><span className="text-gray-400 block">Average velocity</span><span className="font-mono text-indigo-200 text-base">{result.averageVelocity} m/s</span></p>
          <p className="col-span-3 text-[10px] text-gray-500 font-mono">{result.formula}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Orbital tab ───────────────────────────

interface OrbitResult { gravitationalForce: number; orbitalVelocity: number; orbitalPeriod: number; formula: string; inputs: Record<string, number> }

function OrbitalTab() {
  const [mass1, setMass1] = useState('5.972e24');
  const [mass2, setMass2] = useState('1000');
  const [distance, setDistance] = useState('7000000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrbitResult | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun<OrbitResult>('physics', 'orbitalMechanics', {
        mass1: num(mass1), mass2: num(mass2), distance: num(distance),
      });
      if (r.data.ok && r.data.result) setResult(r.data.result);
      else { setResult(null); setError(r.data.error || 'mass1, mass2, distance(>0) are required.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-400">Newtonian two-body gravity about a central mass: F = Gm₁m₂/r², circular v = √(GM/r), T = 2π√(r³/GM).</p>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField label="m₁ — central mass kg" value={mass1} onChange={setMass1} />
        <NumField label="m₂ — orbiting mass kg" value={mass2} onChange={setMass2} />
        <NumField label="r — distance m" value={distance} onChange={setDistance} />
      </div>
      <RunButton busy={busy} onClick={run} label="Resolve" />
      <ErrBanner text={error} />
      {result && (
        <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3 grid grid-cols-3 gap-3 text-xs">
          <p><span className="text-gray-400 block">Gravitational force</span><span className="font-mono text-cyan-200 text-base">{result.gravitationalForce.toExponential(4)} N</span></p>
          <p><span className="text-gray-400 block">Orbital velocity</span><span className="font-mono text-cyan-200 text-base">{result.orbitalVelocity.toFixed(2)} m/s</span></p>
          <p><span className="text-gray-400 block">Orbital period</span><span className="font-mono text-cyan-200 text-base">{(result.orbitalPeriod / 3600).toFixed(2)} h</span></p>
          <p className="col-span-3 text-[10px] text-gray-500 font-mono">{result.formula}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Waves tab ───────────────────────────

interface SubCalc { value?: number; unit?: string; error?: string; shiftHz?: number }
interface WaveResult { wavelength: SubCalc; doppler: SubCalc }

function WavesTab() {
  const [frequency, setFrequency] = useState('440');
  const [waveSpeed, setWaveSpeed] = useState('343');
  const [sourceFreq, setSourceFreq] = useState('440');
  const [sourceVel, setSourceVel] = useState('10');
  const [observerVel, setObserverVel] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WaveResult | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun<{ results: WaveResult }>('physics', 'waveInterference', {
        frequency: num(frequency), waveSpeed: num(waveSpeed),
        sourceFreq: num(sourceFreq), sourceVel: num(sourceVel), observerVel: num(observerVel),
      });
      if (r.data.ok && r.data.result?.results) setResult(r.data.result.results);
      else { setResult(null); setError(r.data.error || 'Could not compute.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-400">Wavelength λ = v/f, and Doppler shift f&prime; = f·(v+v<sub>o</sub>)/(v&minus;v<sub>s</sub>) for a moving source/observer in a medium — computed independently.</p>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField label="frequency Hz (λ)" value={frequency} onChange={setFrequency} />
        <NumField label="wave speed m/s" value={waveSpeed} onChange={setWaveSpeed} />
        <div />
        <NumField label="source freq Hz (Doppler)" value={sourceFreq} onChange={setSourceFreq} />
        <NumField label="source velocity m/s" value={sourceVel} onChange={setSourceVel} />
        <NumField label="observer velocity m/s" value={observerVel} onChange={setObserverVel} />
      </div>
      <RunButton busy={busy} onClick={run} label="Compute" />
      <ErrBanner text={error} />
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="rounded border border-fuchsia-500/30 bg-fuchsia-500/5 p-2.5 text-[11px] space-y-1">
            <p className="text-fuchsia-200 font-semibold uppercase tracking-wide text-[10px]">Wavelength</p>
            {result.wavelength.error
              ? <p className="text-red-300">{result.wavelength.error}</p>
              : <p className="text-2xl font-bold text-fuchsia-200">{result.wavelength.value?.toFixed(4)} <span className="text-xs text-zinc-400">{result.wavelength.unit}</span></p>}
          </div>
          <div className="rounded border border-fuchsia-500/30 bg-fuchsia-500/5 p-2.5 text-[11px] space-y-1">
            <p className="text-fuchsia-200 font-semibold uppercase tracking-wide text-[10px]">Doppler-shifted frequency</p>
            {result.doppler.error
              ? <p className="text-red-300">{result.doppler.error}</p>
              : <>
                <p className="text-2xl font-bold text-fuchsia-200">{result.doppler.value?.toFixed(2)} <span className="text-xs text-zinc-400">{result.doppler.unit}</span></p>
                <p className="text-zinc-400">shift: <span className="font-mono text-fuchsia-200">{result.doppler.shiftHz?.toFixed(2)} Hz</span></p>
              </>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Thermo tab ───────────────────────────

interface ThermoResult {
  idealGas: SubCalc & { solvedFor?: string };
  heatTransfer: SubCalc;
  carnot: SubCalc & { percent?: number };
}

function ThermoTab() {
  // Ideal gas — leave exactly one of these four blank to solve for it.
  const [pressure, setPressure] = useState('100000');
  const [volume, setVolume] = useState('');
  const [moles, setMoles] = useState('1');
  const [temperatureK, setTemperatureK] = useState('300');
  // Heat transfer
  const [mass, setMass] = useState('2');
  const [specificHeat, setSpecificHeat] = useState('4184');
  const [deltaTemp, setDeltaTemp] = useState('10');
  // Carnot
  const [hotK, setHotK] = useState('600');
  const [coldK, setColdK] = useState('300');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ThermoResult | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun<{ results: ThermoResult }>('physics', 'thermodynamics', {
        pressure: num(pressure), volume: num(volume), moles: num(moles), temperatureK: num(temperatureK),
        mass: num(mass), specificHeat: num(specificHeat), deltaTemp: num(deltaTemp),
        hotK: num(hotK), coldK: num(coldK),
      });
      if (r.data.ok && r.data.result?.results) setResult(r.data.result.results);
      else { setResult(null); setError(r.data.error || 'Could not compute.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-400">Three independent ideal-gas-family calculations run together: PV = nRT (leave exactly one of P/V/n/T blank to solve it), heat transfer Q = mcΔT, and Carnot efficiency η = 1 − T<sub>c</sub>/T<sub>h</sub>.</p>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">Ideal gas law — PV = nRT</div>
        <div className="grid grid-cols-4 gap-1.5">
          <NumField label="pressure Pa" value={pressure} onChange={setPressure} placeholder="solve" />
          <NumField label="volume m³" value={volume} onChange={setVolume} placeholder="solve" />
          <NumField label="moles mol" value={moles} onChange={setMoles} placeholder="solve" />
          <NumField label="temperature K" value={temperatureK} onChange={setTemperatureK} placeholder="solve" />
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">Heat transfer — Q = mcΔT</div>
        <div className="grid grid-cols-3 gap-1.5">
          <NumField label="mass kg" value={mass} onChange={setMass} />
          <NumField label="specific heat J/(kg·K)" value={specificHeat} onChange={setSpecificHeat} />
          <NumField label="ΔT K" value={deltaTemp} onChange={setDeltaTemp} />
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">Carnot efficiency — η = 1 − T꜀/Tₕ</div>
        <div className="grid grid-cols-2 gap-1.5">
          <NumField label="hot reservoir K" value={hotK} onChange={setHotK} />
          <NumField label="cold reservoir K" value={coldK} onChange={setColdK} />
        </div>
      </div>

      <RunButton busy={busy} onClick={run} label="Solve all three" />
      <ErrBanner text={error} />

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] space-y-1">
            <p className="text-amber-200 font-semibold uppercase tracking-wide text-[10px]">Ideal gas</p>
            {result.idealGas.error
              ? <p className="text-red-300">{result.idealGas.error}</p>
              : <>
                <p className="text-lg font-bold text-amber-200">{result.idealGas.value?.toFixed(3)} <span className="text-xs text-zinc-400">{result.idealGas.unit}</span></p>
                <p className="text-zinc-400">solved for: <span className="font-mono text-amber-200">{result.idealGas.solvedFor}</span></p>
              </>}
          </div>
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] space-y-1">
            <p className="text-amber-200 font-semibold uppercase tracking-wide text-[10px]">Heat transfer</p>
            {result.heatTransfer.error
              ? <p className="text-red-300">{result.heatTransfer.error}</p>
              : <p className="text-lg font-bold text-amber-200">{result.heatTransfer.value?.toFixed(1)} <span className="text-xs text-zinc-400">{result.heatTransfer.unit}</span></p>}
          </div>
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] space-y-1">
            <p className="text-amber-200 font-semibold uppercase tracking-wide text-[10px]">Carnot efficiency</p>
            {result.carnot.error
              ? <p className="text-red-300">{result.carnot.error}</p>
              : <p className="text-lg font-bold text-amber-200">{result.carnot.percent?.toFixed(1)}%</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── shell ───────────────────────────

export function PhysicsAdvancedLab() {
  const [tab, setTab] = useState<SolverTab>('kinematics');

  const tabs: Array<{ id: SolverTab; label: string; icon: typeof Rocket }> = [
    { id: 'kinematics', label: 'Kinematics', icon: Rocket },
    { id: 'orbital', label: 'Orbital Mechanics', icon: Orbit },
    { id: 'waves', label: 'Waves & Doppler', icon: Waves },
    { id: 'thermo', label: 'Thermodynamics', icon: Thermometer },
  ];

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-zinc-950/60">
      <header className="flex items-center gap-2 border-b border-indigo-500/10 px-3 py-2">
        <h3 className="text-sm font-semibold text-white">Advanced Solvers</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">kinematics · orbital · waves · thermo</span>
      </header>
      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1 flex-wrap">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/40' : 'text-gray-400 hover:text-gray-200 border border-transparent')}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>
      {tab === 'kinematics' && <KinematicsTab />}
      {tab === 'orbital' && <OrbitalTab />}
      {tab === 'waves' && <WavesTab />}
      {tab === 'thermo' && <ThermoTab />}
    </div>
  );
}

export default PhysicsAdvancedLab;
