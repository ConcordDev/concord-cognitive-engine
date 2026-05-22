'use client';

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Gamepad2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ChevronsUp, ChevronsDown, Home, Square, Loader2 } from 'lucide-react';
import type { RobotRow } from './FleetManager';

interface Pose { x: number; y: number; z: number }
interface TrailEntry { t: string; command: string; position: Pose }
interface TeleopResult { robotId: string; command: string; position: Pose; trail: TrailEntry[] }

/**
 * TeleopConsole — manual drive / jog interface. Wires robotics.teleop;
 * integrates the robot pose and renders a top-down path trail.
 */
export function TeleopConsole({ robot }: { robot: RobotRow | null }) {
  const [pose, setPose] = useState<Pose>({ x: 0, y: 0, z: 0 });
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [step, setStep] = useState('0.5');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const drive = useCallback(async (command: string) => {
    if (!robot) return;
    setBusy(command); setErr(null);
    const r = await lensRun('robotics', 'teleop', {
      robotId: robot.id, command, step: parseFloat(step) || 0.5,
    });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as TeleopResult;
      setPose(res.position);
      setTrail(res.trail || []);
    } else setErr(r.data?.error || 'Teleop command failed');
    setBusy(null);
  }, [robot, step]);

  if (!robot) {
    return <p className="text-gray-500 text-sm text-center py-6">Select a robot to enable teleoperation.</p>;
  }

  // Top-down trail viz — map x,y trail to a 200x200 SVG centered on origin.
  const VIEW = 220;
  const SC = 14;
  const toSvg = (p: Pose) => ({ x: VIEW / 2 + p.x * SC, y: VIEW / 2 - p.y * SC });
  const trailPts = trail.map(e => toSvg(e.position));
  const cur = toSvg(pose);

  const Btn = ({ cmd, icon: Icon, label }: { cmd: string; icon: typeof ArrowUp; label: string }) => (
    <button onClick={() => drive(cmd)} disabled={!!busy} aria-label={label}
      className="p-2.5 rounded-lg bg-white/5 hover:bg-neon-cyan/20 hover:text-neon-cyan disabled:opacity-40 flex items-center justify-center transition-colors">
      {busy === cmd ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
    </button>
  );

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Gamepad2 className="w-4 h-4 text-neon-cyan" /> Teleoperation · {robot.name}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Drive pad */}
        <div className="panel p-3 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-400 uppercase tracking-wide">Jog step</label>
            <input value={step} onChange={e => setStep(e.target.value)} type="number" step="0.1" min="0.01" max="10"
              className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs font-mono w-20" />
            <span className="text-[11px] text-gray-500">units</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 w-44 mx-auto">
            <div /><Btn cmd="forward" icon={ArrowUp} label="Forward" /><div />
            <Btn cmd="left" icon={ArrowLeft} label="Left" />
            <Btn cmd="stop" icon={Square} label="Stop" />
            <Btn cmd="right" icon={ArrowRight} label="Right" />
            <Btn cmd="up" icon={ChevronsUp} label="Up" />
            <Btn cmd="back" icon={ArrowDown} label="Back" />
            <Btn cmd="down" icon={ChevronsDown} label="Down" />
          </div>
          <button onClick={() => drive('home')} disabled={!!busy}
            className="w-full px-3 py-1.5 bg-white/5 text-gray-300 rounded text-sm hover:bg-white/10 disabled:opacity-40 flex items-center justify-center gap-1.5">
            <Home className="w-4 h-4" /> Return Home
          </button>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis} className="p-2 rounded bg-black/30">
                <p className="text-gray-500 uppercase">{axis}</p>
                <p className="font-mono text-neon-cyan">{pose[axis]}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trail viz */}
        <div className="panel p-2 bg-black/40">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide px-1 pt-1 pb-1">Top-down trail (X/Y)</p>
          <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full">
            {Array.from({ length: 7 }).map((_, i) => (
              <g key={i}>
                <line x1={(i + 1) * VIEW / 8} y1={0} x2={(i + 1) * VIEW / 8} y2={VIEW} stroke="#ffffff10" />
                <line x1={0} y1={(i + 1) * VIEW / 8} x2={VIEW} y2={(i + 1) * VIEW / 8} stroke="#ffffff10" />
              </g>
            ))}
            <circle cx={VIEW / 2} cy={VIEW / 2} r={4} fill="#0891b2" />
            {trailPts.length > 1 && (
              <polyline points={trailPts.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none" stroke="#22d3ee" strokeWidth={2} strokeLinejoin="round" />
            )}
            {trailPts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={2} fill="#22d3ee88" />
            ))}
            <circle cx={cur.x} cy={cur.y} r={6} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
          </svg>
        </div>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
