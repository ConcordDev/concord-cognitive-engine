 
'use client';

import { useState, useCallback, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import { Crosshair, Play, Loader2, Plus, Minus, Target } from 'lucide-react';

interface ChainPoint { x: number; y: number; }

interface FKResult {
  points: ChainPoint[];
  endEffector: ChainPoint;
  orientation: number;
  maxReach: number;
  extension: string;
  dof: number;
}

interface IKResult {
  angles: number[];
  points: ChainPoint[];
  endEffector: ChainPoint;
  target: ChainPoint;
  reachable: boolean;
  error: number;
  converged: boolean;
  iterations: number;
}

const VIEW = 460;
const SCALE = 0.9;

/**
 * KinematicsStudio — interactive 2D robot-arm visualizer. Wires
 * robotics.forwardKinematics and robotics.inverseKinematics. Click the
 * canvas in IK mode to set a target; the CCD solver finds joint angles.
 */
export function KinematicsStudio() {
  const [mode, setMode] = useState<'fk' | 'ik'>('fk');
  const [links, setLinks] = useState<number[]>([120, 100, 70]);
  const [angles, setAngles] = useState<number[]>([45, -30, 20]);
  const [fk, setFk] = useState<FKResult | null>(null);
  const [ik, setIk] = useState<IKResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalReach = useMemo(() => links.reduce((a, b) => a + b, 0), [links]);

  const runFK = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await lensRun('robotics', 'forwardKinematics', { links, angles });
    if (r.data?.ok) setFk(r.data.result as FKResult);
    else setErr(r.data?.error || 'Forward kinematics failed');
    setBusy(false);
  }, [links, angles]);

  const runIK = useCallback(async (tx: number, ty: number) => {
    setBusy(true); setErr(null);
    const r = await lensRun('robotics', 'inverseKinematics', { links, targetX: tx, targetY: ty });
    if (r.data?.ok) { setIk(r.data.result as IKResult); setAngles((r.data.result as IKResult).angles); }
    else setErr(r.data?.error || 'Inverse kinematics failed');
    setBusy(false);
  }, [links]);

  // Map robot-space coords → SVG coords (origin centered, y up).
  const toSvg = (p: ChainPoint) => ({
    x: VIEW / 2 + p.x * SCALE,
    y: VIEW / 2 - p.y * SCALE,
  });

  const onCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'ik') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * VIEW;
    const sy = (e.clientY - rect.top) / rect.height * VIEW;
    const rx = (sx - VIEW / 2) / SCALE;
    const ry = -(sy - VIEW / 2) / SCALE;
    runIK(Math.round(rx), Math.round(ry));
  };

  const active = mode === 'fk' ? fk : ik;
  const chainPoints = active?.points || [];

  const addLink = () => { setLinks([...links, 80]); setAngles([...angles, 0]); };
  const removeLink = () => {
    if (links.length <= 1) return;
    setLinks(links.slice(0, -1)); setAngles(angles.slice(0, -1));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Crosshair className="w-4 h-4 text-neon-cyan" /> Kinematics Studio
        </h3>
        <div className="flex gap-1.5">
          {(['fk', 'ik'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${mode === m ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-400 hover:text-white'}`}>
              {m === 'fk' ? 'Forward' : 'Inverse'} Kinematics
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Canvas */}
        <div className="panel p-2 bg-black/40">
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            className={`w-full ${mode === 'ik' ? 'cursor-crosshair' : ''}`}
            onClick={onCanvasClick}
          >
            {/* grid */}
            {Array.from({ length: 9 }).map((_, i) => (
              <g key={i}>
                <line x1={(i + 1) * VIEW / 10} y1={0} x2={(i + 1) * VIEW / 10} y2={VIEW} stroke="#ffffff10" />
                <line x1={0} y1={(i + 1) * VIEW / 10} x2={VIEW} y2={(i + 1) * VIEW / 10} stroke="#ffffff10" />
              </g>
            ))}
            {/* reach envelope */}
            <circle cx={VIEW / 2} cy={VIEW / 2} r={totalReach * SCALE} fill="none" stroke="#22d3ee22" strokeDasharray="4 4" />
            {/* base */}
            <circle cx={VIEW / 2} cy={VIEW / 2} r={9} fill="#0891b2" />
            {/* target marker (IK) */}
            {mode === 'ik' && ik && (() => {
              const t = toSvg(ik.target);
              return <g><circle cx={t.x} cy={t.y} r={8} fill="none" stroke={ik.reachable ? '#22c55e' : '#ef4444'} strokeWidth={2} />
                <line x1={t.x - 11} y1={t.y} x2={t.x + 11} y2={t.y} stroke={ik.reachable ? '#22c55e' : '#ef4444'} />
                <line x1={t.x} y1={t.y - 11} x2={t.x} y2={t.y + 11} stroke={ik.reachable ? '#22c55e' : '#ef4444'} /></g>;
            })()}
            {/* chain links */}
            {chainPoints.length > 1 && chainPoints.map((p, i) => {
              if (i === 0) return null;
              const a = toSvg(chainPoints[i - 1]);
              const b = toSvg(p);
              return <line key={`l${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#22d3ee" strokeWidth={6} strokeLinecap="round" />;
            })}
            {/* joints */}
            {chainPoints.map((p, i) => {
              const c = toSvg(p);
              const isEnd = i === chainPoints.length - 1;
              return <circle key={`j${i}`} cx={c.x} cy={c.y} r={isEnd ? 7 : 5}
                fill={isEnd ? '#f59e0b' : '#0e7490'} stroke="#fff" strokeWidth={isEnd ? 2 : 1} />;
            })}
          </svg>
          {mode === 'ik' && <p className="text-[11px] text-gray-500 text-center pb-1">Click anywhere to set the target — CCD solver runs.</p>}
        </div>

        {/* Controls */}
        <div className="space-y-3">
          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 uppercase tracking-wide">Links ({links.length} DOF)</span>
              <div className="flex gap-1">
                <button onClick={addLink} className="p-1 rounded bg-white/5 hover:bg-white/10" aria-label="Add link"><Plus className="w-3 h-3" /></button>
                <button onClick={removeLink} className="p-1 rounded bg-white/5 hover:bg-white/10" aria-label="Remove link"><Minus className="w-3 h-3" /></button>
              </div>
            </div>
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {links.map((len, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span>Link {i + 1}</span>
                    <span className="font-mono">{len}mm{mode === 'fk' ? ` · ${angles[i] ?? 0}°` : ''}</span>
                  </div>
                  <input type="range" min={20} max={200} value={len}
                    onChange={e => { const n = [...links]; n[i] = parseInt(e.target.value); setLinks(n); }}
                    className="w-full accent-cyan-400" />
                  {mode === 'fk' && (
                    <input type="range" min={-180} max={180} value={angles[i] ?? 0}
                      onChange={e => { const n = [...angles]; n[i] = parseInt(e.target.value); setAngles(n); }}
                      className="w-full accent-amber-400" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {mode === 'fk' ? (
            <button onClick={runFK} disabled={busy}
              className="w-full px-3 py-2 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Solve FK
            </button>
          ) : (
            <button onClick={() => runIK(120, 120)} disabled={busy}
              className="w-full px-3 py-2 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />} Solve to (120,120)
            </button>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}

          {active && (
            <div className="panel p-3 text-xs space-y-1.5">
              <div className="flex justify-between"><span className="text-gray-500">End effector</span>
                <span className="font-mono text-neon-cyan">({active.endEffector.x}, {active.endEffector.y})</span></div>
              {mode === 'fk' && fk && (
                <>
                  <div className="flex justify-between"><span className="text-gray-500">Orientation</span><span className="font-mono">{fk.orientation}°</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Extension</span><span className="font-mono">{fk.extension}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Max reach</span><span className="font-mono">{fk.maxReach}mm</span></div>
                </>
              )}
              {mode === 'ik' && ik && (
                <>
                  <div className="flex justify-between"><span className="text-gray-500">Reachable</span>
                    <span className={ik.reachable ? 'text-green-400' : 'text-red-400'}>{ik.reachable ? 'yes' : 'no'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Converged</span>
                    <span className={ik.converged ? 'text-green-400' : 'text-yellow-400'}>{ik.converged ? 'yes' : 'partial'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Residual error</span><span className="font-mono">{ik.error}mm</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">CCD iterations</span><span className="font-mono">{ik.iterations}</span></div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
