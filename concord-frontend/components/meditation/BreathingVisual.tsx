'use client';

/**
 * BreathingVisual — animated expand/contract orb synced to a breathwork
 * pacer. Drives meditation.breathwork for phase timings + meditation.play
 * to log a completed breathwork session. The orb scales between phases
 * (inhale → grow, exhale → shrink, hold → steady).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Wind, Play, Pause, RotateCcw, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Phase { label: string; sec: number }
interface BreathSpec { pattern: string; name: string; phases: Phase[]; cycleSeconds: number; cycles: number; totalSeconds: number }

const PATTERNS: { id: 'box' | '478' | 'coherent'; label: string }[] = [
  { id: 'box', label: 'Box 4-4-4-4' },
  { id: '478', label: '4-7-8' },
  { id: 'coherent', label: 'Coherent 5.5' },
];

const PHASE_SCALE: Record<string, number> = { inhale: 1, hold: 1, exhale: 0.45 };
const PHASE_COLOR: Record<string, string> = { inhale: '#34d399', hold: '#a78bfa', exhale: '#60a5fa' };

export function BreathingVisual() {
  const [pattern, setPattern] = useState<'box' | '478' | 'coherent'>('box');
  const [cycles, setCycles] = useState(6);
  const [spec, setSpec] = useState<BreathSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [cycleNum, setCycleNum] = useState(0);
  const [phaseRemain, setPhaseRemain] = useState(0);
  const [done, setDone] = useState(false);
  const [logged, setLogged] = useState(false);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async (p: 'box' | '478' | 'coherent', c: number) => {
    setLoading(true);
    const r = await lensRun('meditation', 'breathwork', { pattern: p, cycles: c });
    setSpec((r.data?.result as BreathSpec) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(pattern, cycles); }, [pattern, cycles, load]);

  const reset = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    setRunning(false); setPhaseIdx(0); setCycleNum(0); setDone(false); setLogged(false);
    setPhaseRemain(spec?.phases[0]?.sec ?? 0);
  }, [spec]);

  useEffect(() => { reset(); }, [spec, reset]);

  useEffect(() => {
    if (!running || !spec) return;
    timerRef.current = window.setInterval(() => {
      setPhaseRemain((r) => {
        if (r > 1) return r - 1;
        // advance phase
        setPhaseIdx((pi) => {
          const nextPi = pi + 1;
          if (nextPi >= spec.phases.length) {
            setCycleNum((cn0) => {
              const nextCycle = cn0 + 1;
              if (nextCycle >= spec.cycles) {
                setRunning(false);
                setDone(true);
              }
              return nextCycle;
            });
            return 0;
          }
          return nextPi;
        });
        return 0;
      });
    }, 1000);
    return () => { if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; } };
  }, [running, spec]);

  useEffect(() => {
    if (!spec) return;
    setPhaseRemain(Math.ceil(spec.phases[phaseIdx]?.sec ?? 0));
  }, [phaseIdx, spec]);

  const logSession = useCallback(async () => {
    const sid = pattern === '478' ? 'b-478-4' : pattern === 'coherent' ? 'b-coh-6' : 'b-box-5';
    const r = await lensRun('meditation', 'play', { sessionId: sid });
    if (r.data?.ok) setLogged(true);
  }, [pattern]);

  if (loading || !spec) {
    return <div className="flex items-center justify-center py-8 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  const phase = spec.phases[phaseIdx];
  const phaseLabel = phase?.label ?? 'ready';
  const scale = done ? 0.6 : (PHASE_SCALE[phaseLabel] ?? 0.7);
  const color = PHASE_COLOR[phaseLabel] ?? '#a78bfa';
  const transitionSec = phase?.sec ?? 1;

  return (
    <div className="rounded-2xl border border-emerald-900/40 bg-gradient-to-b from-emerald-950/20 to-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wind className="w-4 h-4 text-emerald-300" />
        <h3 className="text-sm font-bold text-zinc-100">Animated Breathing</h3>
        <span className="text-[11px] text-zinc-500">{spec.name}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {PATTERNS.map((p) => (
          <button key={p.id} type="button" onClick={() => setPattern(p.id)}
            className={cn('px-2.5 py-1 text-[11px] rounded', pattern === p.id ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200')}>
            {p.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[10px] text-zinc-500">cycles</span>
          {[4, 6, 8, 12].map((c) => (
            <button key={c} type="button" onClick={() => setCycles(c)}
              className={cn('w-7 h-7 rounded text-[11px]', cycles === c ? 'bg-emerald-600/40 text-emerald-100 ring-1 ring-emerald-500/50' : 'bg-zinc-900 text-zinc-400')}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-56 flex items-center justify-center mb-3">
        <div
          className="rounded-full flex items-center justify-center"
          style={{
            width: 180, height: 180,
            backgroundColor: color + '22',
            border: `2px solid ${color}`,
            transform: `scale(${scale})`,
            transition: `transform ${transitionSec}s ease-in-out, background-color 0.6s, border-color 0.6s`,
          }}
        >
          <div className="text-center">
            <div className="text-2xl font-light capitalize" style={{ color }}>{done ? 'complete' : phaseLabel}</div>
            <div className="text-sm text-zinc-400 font-mono">{done ? '✓' : `${phaseRemain}s`}</div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-zinc-500">
          Cycle {Math.min(cycleNum + (done ? 0 : 1), spec.cycles)} / {spec.cycles}
        </span>
        <span className="text-[11px] text-zinc-500">{spec.totalSeconds}s total</span>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button type="button" onClick={() => setRunning((r) => !r)} disabled={done}
          className={cn('w-12 h-12 rounded-full flex items-center justify-center text-white',
            done ? 'bg-zinc-800 opacity-40 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500')}
          aria-label={running ? 'Pause' : 'Play'}>
          {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        <button type="button" onClick={reset}
          className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300" aria-label="Reset">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {done && (
        <div className="mt-3 text-center">
          {logged
            ? <span className="text-xs text-emerald-300">Breathwork session logged to your practice.</span>
            : <button type="button" onClick={logSession}
                className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white">
                Log this session
              </button>}
        </div>
      )}
    </div>
  );
}
