'use client';

/**
 * PhysicsFieldLab — the richer engines that only answer under their
 * additive names (the base names are re-registered by a flatter handler in
 * server.js, see PhysicsKeplerianLab):
 *   - physics.kinematicsSimAdvanced: several projectiles at once, gravity +
 *     quadratic drag, velocity-Verlet, ground impact; plots each trajectory.
 *   - physics.waveInterferenceAdvanced: point sources on a grid, 1/√r
 *     circular waves superposed; draws the instantaneous field.
 * Every plotted point is the engine's own output.
 */

import { useState } from 'react';
import { Loader2, Plus, Target, Trash2, Waves } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const COLORS = ['#22d3ee', '#f472b6', '#facc15', '#4ade80', '#a78bfa'];
const field = 'w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-white focus:border-cyan-400/50 focus:outline-none';

interface Body { name: string; mass: string; speed: string; angle: string; height: string; cd: string; area: string }
interface TrajPoint { t: number; x: number; y: number; event?: string }
interface BodyResult { name: string; maxHeight: number; range: number | null; flightTime: number; maxSpeed: number; impactVelocity: number | null }
interface KinResult { bodies: BodyResult[]; trajectories: Record<string, TrajPoint[]> }

function ProjectileLab() {
  const [bodies, setBodies] = useState<Body[]>([
    { name: 'No drag', mass: '0.145', speed: '40', angle: '35', height: '1', cd: '0', area: '0' },
    { name: 'Baseball', mass: '0.145', speed: '40', angle: '35', height: '1', cd: '0.35', area: '0.0042' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KinResult | null>(null);
  const upd = (i: number, k: keyof Body, v: string) => setBodies((xs) => xs.map((b, j) => (j === i ? { ...b, [k]: v } : b)));

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun<KinResult>('physics', 'kinematicsSimAdvanced', {
        bodies: bodies.map((b) => {
          const a = ((Number(b.angle) || 0) * Math.PI) / 180;
          const v = Number(b.speed) || 0;
          return {
            name: b.name || 'body', mass: Number(b.mass) || 1,
            position: { x: 0, y: Number(b.height) || 0, z: 0 },
            velocity: { x: v * Math.cos(a), y: v * Math.sin(a), z: 0 },
            dragCoefficient: Number(b.cd) || 0, crossSection: Number(b.area) || 0,
          };
        }),
        dt: 0.005, steps: 6000,
      });
      if (!r.data.ok || !r.data.result) { setResult(null); setError(r.data.error || 'Simulation failed.'); }
      else setResult(r.data.result);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const allPts = result ? Object.values(result.trajectories).flat() : [];
  const maxX = Math.max(1, ...allPts.map((p) => p.x));
  const maxY = Math.max(1, ...allPts.map((p) => p.y));

  return (
    <section className="rounded-xl border border-white/10 bg-black/30 p-4 transition-colors hover:border-white/20">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-100"><Target className="h-4 w-4 text-cyan-300" /> Projectiles with drag</h3>
      <p className="mb-3 mt-1 text-[11px] text-gray-500">Launch several bodies at once. Drag is ½·Cd·A·ρ·v² against the velocity; integration stops at ground impact.</p>
      <div className="space-y-2">
        {bodies.map((b, i) => (
          <div key={i} className="grid grid-cols-4 items-end gap-1.5 sm:grid-cols-[1.3fr_repeat(6,1fr)_auto]">
            <label className="col-span-4 text-[10px] text-gray-500 sm:col-span-1">Name<input aria-label={`Body ${i + 1} name`} value={b.name} onChange={(e) => upd(i, 'name', e.target.value)} className={field} style={{ color: COLORS[i % COLORS.length] }} /></label>
            {([['mass', 'kg'], ['speed', 'm/s'], ['angle', '°'], ['height', 'm'], ['cd', 'Cd'], ['area', 'A m²']] as const).map(([k, l]) => (
              <label key={k} className="text-[10px] text-gray-500">{l}<input aria-label={`Body ${i + 1} ${k}`} type="number" step="any" value={b[k]} onChange={(e) => upd(i, k, e.target.value)} className={field} /></label>
            ))}
            <button type="button" aria-label={`Remove ${b.name}`} onClick={() => setBodies((xs) => xs.filter((_, j) => j !== i))} className="mb-1 p-1 text-gray-500 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {bodies.length < COLORS.length && (
          <button type="button" onClick={() => setBodies((xs) => [...xs, { name: `Body ${xs.length + 1}`, mass: '1', speed: '25', angle: '45', height: '0', cd: '0.47', area: '0.01' }])} className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"><Plus className="h-3 w-3" /> Add body</button>
        )}
        <button type="button" onClick={() => void run()} disabled={busy || bodies.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/30 disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Launch
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-400">{error}</p>}
      {result && (
        <>
          <svg viewBox="0 0 400 160" className="mt-3 h-48 w-full rounded-lg bg-black/40" role="img" aria-label="Trajectories">
            <line x1="0" y1="152" x2="400" y2="152" stroke="currentColor" className="text-white/15" />
            {Object.entries(result.trajectories).map(([name, pts], i) => (
              <polyline key={name} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="1.8"
                points={pts.map((p) => `${((p.x / maxX) * 392 + 4).toFixed(1)},${(152 - (p.y / maxY) * 144).toFixed(1)}`).join(' ')} />
            ))}
            <text x="396" y="148" textAnchor="end" className="fill-gray-500 text-[8px]">{maxX.toFixed(1)} m</text>
            <text x="4" y="12" className="fill-gray-500 text-[8px]">{maxY.toFixed(1)} m</text>
          </svg>
          <table className="mt-2 w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-500"><tr><th className="text-left">Body</th><th className="text-right">Range</th><th className="text-right">Apex</th><th className="text-right">Flight</th><th className="text-right">Max speed</th></tr></thead>
            <tbody>
              {result.bodies.map((b, i) => (
                <tr key={b.name} className="border-t border-white/5">
                  <td style={{ color: COLORS[i % COLORS.length] }}>{b.name}</td>
                  <td className="text-right font-mono text-gray-200">{b.range != null ? `${b.range} m` : 'airborne'}</td>
                  <td className="text-right font-mono text-gray-200">{b.maxHeight} m</td>
                  <td className="text-right font-mono text-gray-200">{b.flightTime} s</td>
                  <td className="text-right font-mono text-gray-200">{b.maxSpeed} m/s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

interface Source { x: string; y: string; frequency: string; amplitude: string; phase: string }
interface WaveResult {
  grid: { size: number; resolution: number; physicalSize: number };
  amplitudeMap: number[][] | string;
  statistics: { maxAmplitude: number; minAmplitude: number; constructivePercent: number; destructivePercent: number; nodalPercent: number };
  sources: Array<{ source: string; frequency: number; wavelength: number }>;
  beatFrequency: number | null;
}

function color(v: number, max: number) {
  const t = Math.max(-1, Math.min(1, v / (max || 1)));
  return t >= 0 ? `rgba(34,211,238,${t.toFixed(3)})` : `rgba(244,114,182,${(-t).toFixed(3)})`;
}

function WaveLab() {
  const [sources, setSources] = useState<Source[]>([
    { x: '-0.4', y: '0', frequency: '1000', amplitude: '1', phase: '0' },
    { x: '0.4', y: '0', frequency: '1000', amplitude: '1', phase: '0' },
  ]);
  const [time, setTime] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WaveResult | null>(null);
  const upd = (i: number, k: keyof Source, v: string) => setSources((xs) => xs.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun<WaveResult>('physics', 'waveInterferenceAdvanced', {
        sources: sources.map((s) => ({ x: Number(s.x) || 0, y: Number(s.y) || 0, frequency: Number(s.frequency) || 1, amplitude: Number(s.amplitude) || 1, phase: Number(s.phase) || 0 })),
        gridSize: 30, resolution: 0.1, time: Number(time) || 0, waveSpeed: 343,
      });
      if (!r.data.ok || !r.data.result) { setResult(null); setError(r.data.error || 'Computation failed.'); }
      else setResult(r.data.result);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const map = result && Array.isArray(result.amplitudeMap) ? result.amplitudeMap : null;
  const peak = result ? Math.max(Math.abs(result.statistics.maxAmplitude), Math.abs(result.statistics.minAmplitude)) : 1;

  return (
    <section className="rounded-xl border border-white/10 bg-black/30 p-4 transition-colors hover:border-white/20">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-100"><Waves className="h-4 w-4 text-pink-300" /> Wave interference field</h3>
      <p className="mb-3 mt-1 text-[11px] text-gray-500">Point sources in air (343 m/s) on a 3 m × 3 m grid. Cyan is positive displacement, pink negative.</p>
      <div className="space-y-1.5">
        {sources.map((s, i) => (
          <div key={i} className="grid grid-cols-5 items-end gap-1.5 sm:grid-cols-[repeat(5,1fr)_auto]">
            {([['x', 'x m'], ['y', 'y m'], ['frequency', 'Hz'], ['amplitude', 'Amp'], ['phase', 'Phase rad']] as const).map(([k, l]) => (
              <label key={k} className="text-[10px] text-gray-500">{l}<input aria-label={`Source ${i + 1} ${k}`} type="number" step="any" value={s[k]} onChange={(e) => upd(i, k, e.target.value)} className={field} /></label>
            ))}
            <button type="button" aria-label={`Remove source ${i + 1}`} onClick={() => setSources((xs) => xs.filter((_, j) => j !== i))} className="mb-1 hidden p-1 text-gray-500 hover:text-rose-300 sm:block"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {sources.length < 5 && <button type="button" onClick={() => setSources((xs) => [...xs, { x: '0', y: '0.6', frequency: '1000', amplitude: '1', phase: '0' }])} className="inline-flex items-center gap-1 text-[11px] text-pink-300 hover:text-pink-200"><Plus className="h-3 w-3" /> Add source</button>}
        <label className="text-[10px] text-gray-500">Snapshot time (s)<input aria-label="Snapshot time" type="number" step="0.0001" value={time} onChange={(e) => setTime(e.target.value)} className={cn(field, 'w-28')} /></label>
        <button type="button" onClick={() => void run()} disabled={busy || sources.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-pink-500/20 px-3 py-1.5 text-xs font-semibold text-pink-200 transition-colors hover:bg-pink-500/30 disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Compute field
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-400">{error}</p>}
      {result && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
          {map && (
            <svg viewBox={`0 0 ${map.length} ${map.length}`} className="h-56 w-56 rounded-lg bg-black" role="img" aria-label="Interference field" shapeRendering="crispEdges">
              {map.map((row, y) => row.map((v, x) => <rect key={`${x}-${y}`} x={x} y={map.length - 1 - y} width="1" height="1" fill={color(v, peak)} />))}
            </svg>
          )}
          <div className="space-y-1 text-xs">
            <p className="text-gray-300">{result.statistics.constructivePercent}% constructive · {result.statistics.destructivePercent}% destructive · {result.statistics.nodalPercent}% near-nodal</p>
            {result.sources.map((s) => <p key={s.source} className="font-mono text-gray-400">{s.source}: {s.frequency} Hz, λ = {s.wavelength} m</p>)}
            {result.beatFrequency != null && <p className="text-gray-300">Beat frequency <span className="font-mono text-pink-200">{result.beatFrequency} Hz</span></p>}
          </div>
        </div>
      )}
    </section>
  );
}

export function PhysicsFieldLab() {
  return (
    <div className="space-y-4">
      <ProjectileLab />
      <WaveLab />
    </div>
  );
}
