'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dumbbell, Plus, Trash2, Loader2, Play, Pause, RotateCcw, Check } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface WorkoutSet {
  reps: number;
  weight: number;
  rir?: number;
  done: boolean;
}

export interface Exercise {
  id: string;
  name: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  title: string;
  startedAt: string;
  finishedAt?: string;
  exercises: Exercise[];
  notes?: string;
}

export function WorkoutLogger() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [active, setActive] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [restTimer, setRestTimer] = useState<number>(0);
  const [restRunning, setRestRunning] = useState(false);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!restRunning) return;
    const i = setInterval(() => setRestTimer(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(i);
  }, [restRunning]);
  useEffect(() => {
    if (restTimer === 0 && restRunning) {
      setRestRunning(false);
      try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play(); } catch { /* noop */ }
    }
  }, [restTimer, restRunning]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'fitness', action: 'workout-list', input: {} });
      setWorkouts((res.data?.result?.workouts || []) as Workout[]);
    } catch (e) { console.error('[Workout] list failed', e); }
    finally { setLoading(false); }
  }

  function startWorkout() {
    const w: Workout = {
      id: `wo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: 'New workout',
      startedAt: new Date().toISOString(),
      exercises: [],
    };
    setActive(w);
  }

  function addExercise() {
    if (!active) return;
    const name = window.prompt('Exercise name (e.g. Bench Press)') || '';
    if (!name.trim()) return;
    setActive({
      ...active,
      exercises: [...active.exercises, {
        id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        sets: [{ reps: 5, weight: 0, done: false }],
      }],
    });
  }

  function addSet(exId: string) {
    if (!active) return;
    setActive({
      ...active,
      exercises: active.exercises.map(e => e.id === exId
        ? { ...e, sets: [...e.sets, { ...e.sets[e.sets.length - 1] || { reps: 5, weight: 0 }, done: false }] }
        : e),
    });
  }

  function updateSet(exId: string, idx: number, patch: Partial<WorkoutSet>) {
    if (!active) return;
    setActive({
      ...active,
      exercises: active.exercises.map(e => e.id === exId
        ? { ...e, sets: e.sets.map((s, i) => i === idx ? { ...s, ...patch } : s) }
        : e),
    });
  }

  function deleteSet(exId: string, idx: number) {
    if (!active) return;
    setActive({
      ...active,
      exercises: active.exercises.map(e => e.id === exId
        ? { ...e, sets: e.sets.filter((_, i) => i !== idx) }
        : e),
    });
  }

  function completeSet(exId: string, idx: number) {
    updateSet(exId, idx, { done: true });
    setRestTimer(90);
    setRestRunning(true);
  }

  async function finishWorkout() {
    if (!active) return;
    const finished = { ...active, finishedAt: new Date().toISOString() };
    try {
      await api.post('/api/lens/run', { domain: 'fitness', action: 'workout-save', input: { workout: finished } });
      setActive(null);
      await refresh();
    } catch (e) { console.error('[Workout] save failed', e); }
  }

  const totalVolume = useMemo(() => {
    if (!active) return 0;
    return active.exercises.reduce((s, ex) => s + ex.sets.filter(set => set.done).reduce((sa, set) => sa + set.weight * set.reps, 0), 0);
  }, [active]);

  if (!active) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <Dumbbell className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Workouts</span>
          <span className="ml-auto text-[10px] text-gray-500">{workouts.length} logged</span>
          <button onClick={startWorkout} className="ml-2 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">
            <Play className="w-3 h-3 inline mr-1" /> Start workout
          </button>
        </header>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : workouts.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Dumbbell className="w-6 h-6 mx-auto mb-2 opacity-30" /> No workouts yet. Hit Start workout to log one.</div>
        ) : (
          <ul className="divide-y divide-white/5 max-h-96 overflow-y-auto">
            {workouts.map(w => (
              <li key={w.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="text-sm text-white font-medium">{w.title}</div>
                <div className="text-[10px] text-gray-500">{new Date(w.startedAt).toLocaleString()} · {w.exercises.length} exercise{w.exercises.length === 1 ? '' : 's'} · {w.exercises.reduce((s, e) => s + e.sets.length, 0)} sets</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Dumbbell className="w-4 h-4 text-cyan-400" />
        <input
          value={active.title}
          onChange={e => setActive({ ...active, title: e.target.value })}
          className="flex-1 bg-transparent text-sm font-bold text-white outline-none focus:bg-white/5 px-2 py-0.5 rounded"
        />
        <span className="text-[10px] text-gray-500">Vol: {totalVolume.toLocaleString()}</span>
        <button onClick={() => setActive(null)} className="text-xs text-gray-400 hover:text-white">Cancel</button>
        <button onClick={finishWorkout} className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded bg-green-500 text-black font-bold hover:bg-green-400">
          <Check className="w-3 h-3" /> Finish
        </button>
      </header>
      {restTimer > 0 && (
        <div className="px-4 py-2 bg-cyan-500/10 border-b border-cyan-500/30 flex items-center gap-3">
          <span className="text-2xl font-mono font-bold text-cyan-300 tabular-nums">{Math.floor(restTimer / 60)}:{String(restTimer % 60).padStart(2, '0')}</span>
          <span className="text-xs text-gray-400">Rest</span>
          <button onClick={() => setRestRunning(v => !v)} className="ml-auto p-1 text-gray-400 hover:text-white" title={restRunning ? 'Pause' : 'Resume'}>
            {restRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => { setRestTimer(90); setRestRunning(true); }} className="p-1 text-gray-400 hover:text-white" title="Reset to 1:30">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
        {active.exercises.length === 0 ? (
          <div className="text-center py-6 text-xs text-gray-500">No exercises yet. Hit + to add.</div>
        ) : (
          active.exercises.map(ex => (
            <div key={ex.id} className="bg-white/[0.02] border border-white/10 rounded">
              <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
                <span className="text-sm text-white font-medium">{ex.name}</span>
                <span className="ml-auto text-[10px] text-gray-500">{ex.sets.filter(s => s.done).length}/{ex.sets.length} sets</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="w-8 px-2 py-1">#</th>
                    <th className="px-2 py-1 text-left">Reps</th>
                    <th className="px-2 py-1 text-left">Weight</th>
                    <th className="px-2 py-1 text-left">RIR</th>
                    <th className="w-20 px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {ex.sets.map((s, i) => (
                    <tr key={i} className={cn('border-t border-white/5', s.done && 'bg-green-500/[0.05]')}>
                      <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                      <td className="px-2 py-1">
                        <input type="number" value={s.reps} onChange={e => updateSet(ex.id, i, { reps: Number(e.target.value) || 0 })} className="w-12 px-1 bg-lattice-deep border border-white/10 rounded text-white tabular-nums" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" step={0.5} value={s.weight} onChange={e => updateSet(ex.id, i, { weight: Number(e.target.value) || 0 })} className="w-16 px-1 bg-lattice-deep border border-white/10 rounded text-white tabular-nums" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" value={s.rir ?? ''} placeholder="—" onChange={e => updateSet(ex.id, i, { rir: e.target.value ? Number(e.target.value) : undefined })} className="w-10 px-1 bg-lattice-deep border border-white/10 rounded text-white tabular-nums" />
                      </td>
                      <td className="px-2 py-1 text-right">
                        {!s.done ? (
                          <button onClick={() => completeSet(ex.id, i)} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30">
                            ✓ Done
                          </button>
                        ) : (
                          <button onClick={() => updateSet(ex.id, i, { done: false })} className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-white">Undo</button>
                        )}
                        <button onClick={() => deleteSet(ex.id, i)} className="ml-1 p-1 text-gray-500 hover:text-red-400" title="Remove">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-1.5 border-t border-white/5">
                <button onClick={() => addSet(ex.id)} className="text-[10px] text-cyan-300 hover:text-cyan-100">+ add set</button>
              </div>
            </div>
          ))
        )}
        <button onClick={addExercise} className="w-full py-2 rounded border border-dashed border-white/10 text-xs text-gray-400 hover:text-white hover:border-white/30 inline-flex items-center justify-center gap-1">
          <Plus className="w-3.5 h-3.5" /> Add exercise
        </button>
      </div>
    </div>
  );
}

export default WorkoutLogger;
