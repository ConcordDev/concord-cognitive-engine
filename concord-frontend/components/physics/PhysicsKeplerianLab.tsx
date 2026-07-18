'use client';

/**
 * PhysicsKeplerianLab — un-shadows domains/physics.js's richer orbital
 * mechanics engine (Keplerian-elements orbit propagation + a real two-burn
 * Hohmann-transfer Δv/time calculation) via the new, additive
 * `physics.orbitalMechanicsAdvanced` macro.
 *
 * WHY A SEPARATE PANEL FROM PhysicsAdvancedLab's "Orbital Mechanics" tab:
 * `physics.orbitalMechanics` (that tab) is a flat, single-point Newtonian
 * two-body calc — F=Gm₁m₂/r², circular v, circular T about a central mass.
 * `server/domains/physics.js` also contains a genuinely richer engine under
 * that SAME macro name, but it's shadowed (dead) — server.js's "Engineering
 * Compute" block re-registers `physics.orbitalMechanics` with the flat
 * handler AFTER domains/index.js loads, winning the last-write-wins
 * LENS_ACTIONS Map (see docs/WAVE4_INVENTORY.md's `physics` row and
 * docs/lens-specs/physics-capability-map.md). Deleting the server.js
 * duplicate to un-shadow it was ruled unsafe — PhysicsAdvancedLab.tsx and
 * server/tests/depth/physics-behavior.test.js both depend, byte-for-byte, on
 * the flat handler winning under that name.
 *
 * Instead, `server/domains/physics.js` now ALSO registers that same rich
 * handler under a new, additive name — `orbitalMechanicsAdvanced` — that
 * nothing else registers, so it stays reachable. This panel is the frontend
 * half of that fix: propagate a full Keplerian orbit (semi-major axis,
 * eccentricity, inclination) into a plottable orbit-point ellipse, and
 * compute a real two-impulse Hohmann transfer (Δv1, Δv2, total Δv, transfer
 * time) to a target orbital radius — see
 * server/tests/depth/physics-orbital-advanced-behavior.test.js for the
 * hand-derived verification of the Hohmann-transfer arithmetic.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Orbit, Loader2, AlertTriangle, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrbitPoint { theta: number; radius: number; x: number; y: number; z: number }
interface HohmannTransfer {
  targetAltitude: number; deltaV1: number; deltaV2: number;
  totalDeltaV: number; transferTime: number;
}
interface KeplerianResult {
  elements: { semiMajorAxis: number; eccentricity: number; inclination: number };
  dynamics: {
    period: number; periodMinutes: number; periapsis: number; apoapsis: number;
    velocityAtPeriapsis: number; velocityAtApoapsis: number; meanMotion: number;
  };
  hohmannTransfer: HohmannTransfer;
  orbitPoints: OrbitPoint[];
}

// ─────────────────────────── shared bits ───────────────────────────

function NumField({
  label, value, onChange, className,
}: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
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
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-xs text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
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

// A simple SVG orbit-point plot — no charting dependency needed for a closed
// 2D ellipse. Projects x/y (ignores z; inclination still visibly narrows the
// ellipse via the handler's y = radius*sin(theta)*cos(inc) term).
function OrbitPlot({ points }: { points: OrbitPoint[] }) {
  if (!points || points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const maxAbs = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 1);
  const size = 240;
  const pad = 16;
  const scale = (size / 2 - pad) / maxAbs;
  const cx = size / 2;
  const cy = size / 2;
  const toXY = (p: OrbitPoint) => [cx + p.x * scale, cy - p.y * scale] as const;
  const pointsAttr = points.map((p) => toXY(p).join(',')).join(' ');

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Orbit path plot"
      className="rounded border border-cyan-500/20 bg-black/40"
    >
      <polygon points={pointsAttr} fill="rgba(34,211,238,0.10)" stroke="#22d3ee" strokeWidth={1.5} />
      {/* central body */}
      <circle cx={cx} cy={cy} r={5} fill="#facc15" />
      {/* periapsis marker — the first orbit point (theta=0) */}
      {points[0] && (
        <circle cx={toXY(points[0])[0]} cy={toXY(points[0])[1]} r={3} fill="#f472b6" />
      )}
    </svg>
  );
}

export function PhysicsKeplerianLab() {
  const [semiMajorAxis, setSemiMajorAxis] = useState('6678000');   // 300 km altitude LEO, meters
  const [eccentricity, setEccentricity] = useState('0');
  const [inclination, setInclination] = useState('0');
  const [centralBodyMass, setCentralBodyMass] = useState('5.972e24'); // Earth default
  const [targetAltitude, setTargetAltitude] = useState('42164000');   // GEO radius, meters

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KeplerianResult | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun<KeplerianResult>('physics', 'orbitalMechanicsAdvanced', {
        orbit: {
          semiMajorAxis: num(semiMajorAxis),
          eccentricity: num(eccentricity) ?? 0,
          inclination: num(inclination) ?? 0,
          centralBodyMass: num(centralBodyMass),
        },
        targetAltitude: num(targetAltitude),
        points: 90,
      });
      if (r.data.ok && r.data.result) setResult(r.data.result);
      else { setResult(null); setError(r.data.error || 'Could not compute orbit.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 px-3 py-2">
        <Orbit className="w-4 h-4 text-cyan-300" />
        <h3 className="text-sm font-semibold text-white">Keplerian Orbit &amp; Hohmann Transfer</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          orbitalMechanicsAdvanced
        </span>
      </header>

      <div className="p-3 space-y-3">
        <p className="text-[11px] text-gray-400">
          Propagates a full Keplerian orbit from its elements and computes a real
          two-burn Hohmann transfer to a target orbital radius: Δv₁ at the transfer
          ellipse&apos;s periapsis, Δv₂ to circularize at apoapsis, transfer time = half
          the transfer ellipse&apos;s period.
        </p>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-cyan-400 font-semibold">Starting orbit (Keplerian elements)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
            <NumField label="semi-major axis a (m)" value={semiMajorAxis} onChange={setSemiMajorAxis} />
            <NumField label="eccentricity e (0–1)" value={eccentricity} onChange={setEccentricity} />
            <NumField label="inclination (deg)" value={inclination} onChange={setInclination} />
            <NumField label="central body mass (kg)" value={centralBodyMass} onChange={setCentralBodyMass} />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-cyan-400 font-semibold">Hohmann transfer target</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
            <NumField label="target orbital radius (m)" value={targetAltitude} onChange={setTargetAltitude} />
          </div>
        </div>

        <RunButton busy={busy} onClick={run} label="Propagate orbit" />
        <ErrBanner text={error} />

        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-2.5 text-[11px] space-y-1.5">
                <p className="text-cyan-200 font-semibold uppercase tracking-wide text-[10px]">Orbit dynamics</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
                  <p><span className="text-gray-400">Period</span> {(result.dynamics.period / 3600).toFixed(3)} h</p>
                  <p><span className="text-gray-400">Periapsis</span> {(result.dynamics.periapsis / 1000).toFixed(1)} km</p>
                  <p><span className="text-gray-400">Apoapsis</span> {(result.dynamics.apoapsis / 1000).toFixed(1)} km</p>
                  <p><span className="text-gray-400">v at peri</span> {result.dynamics.velocityAtPeriapsis.toFixed(2)} m/s</p>
                  <p><span className="text-gray-400">v at apo</span> {result.dynamics.velocityAtApoapsis.toFixed(2)} m/s</p>
                  <p><span className="text-gray-400">Mean motion</span> {result.dynamics.meanMotion.toExponential(3)} rad/s</p>
                </div>
              </div>

              <div className="rounded border border-fuchsia-500/30 bg-fuchsia-500/5 p-2.5 text-[11px] space-y-1.5">
                <p className="text-fuchsia-200 font-semibold uppercase tracking-wide text-[10px] flex items-center gap-1">
                  <Rocket className="w-3 h-3" /> Hohmann transfer
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
                  <p><span className="text-gray-400">Δv₁ (departure)</span> {(result.hohmannTransfer.deltaV1).toFixed(2)} m/s</p>
                  <p><span className="text-gray-400">Δv₂ (arrival)</span> {(result.hohmannTransfer.deltaV2).toFixed(2)} m/s</p>
                  <p className="col-span-2 text-base text-fuchsia-200 font-bold">
                    Total Δv: {(result.hohmannTransfer.totalDeltaV).toFixed(2)} m/s
                  </p>
                  <p className="col-span-2"><span className="text-gray-400">Transfer time</span> {(result.hohmannTransfer.transferTime / 3600).toFixed(3)} h</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide self-start">Orbit path (x-y projection)</p>
              <OrbitPlot points={result.orbitPoints} />
              <p className="text-[9px] text-gray-600">yellow = central body · pink = periapsis (θ=0)</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PhysicsKeplerianLab;
