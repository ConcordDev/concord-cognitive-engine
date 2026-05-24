'use client';

/**
 * MissionPlanner — phased operation timeline with task dependencies.
 * Backed by defense.mission-task-add / mission-task-update /
 * mission-task-delete / mission-plan macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Loader2, ListChecks, AlertTriangle, Activity } from 'lucide-react';

interface MissionTask {
  id: string;
  name: string;
  phase: 'shaping' | 'decisive' | 'sustainment' | 'transition';
  status: 'pending' | 'in_progress' | 'complete' | 'blocked';
  dependsOn: string[];
  owner: string;
  startOffset: number;
  durationHours: number;
  earliestStart?: number;
  finish?: number;
}

interface MissionPlanResult {
  tasks: MissionTask[];
  phases: { phase: string; count: number; complete: number }[];
  criticalPath: string[];
  blocked: { id: string; name: string }[];
  totalDurationHours: number;
  completionPct: number;
}

const PHASES = ['shaping', 'decisive', 'sustainment', 'transition'] as const;
const STATUSES = ['pending', 'in_progress', 'complete', 'blocked'] as const;

const STATUS_TONE: Record<string, TimelineEvent['tone']> = {
  pending: 'default',
  in_progress: 'info',
  complete: 'good',
  blocked: 'bad',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-zinc-400',
  in_progress: 'text-cyan-400',
  complete: 'text-green-400',
  blocked: 'text-red-400',
};

export function MissionPlanner() {
  const [plan, setPlan] = useState<MissionPlanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [phase, setPhase] = useState<typeof PHASES[number]>('shaping');
  const [owner, setOwner] = useState('');
  const [duration, setDuration] = useState('24');
  const [dependsOn, setDependsOn] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<MissionPlanResult>('defense', 'mission-plan', {});
    if (r.data?.ok && r.data.result) setPlan(r.data.result);
    else setError(r.data?.error || 'Failed to load mission plan');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTask = useCallback(async () => {
    if (!name.trim()) {
      setError('Task name is required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('defense', 'mission-task-add', {
      name: name.trim(),
      phase,
      owner: owner.trim(),
      durationHours: Number(duration) || 24,
      dependsOn,
    });
    if (r.data?.ok) {
      setName('');
      setOwner('');
      setDependsOn([]);
      await refresh();
    } else {
      setError(r.data?.error || 'Failed to add task');
    }
    setBusy(false);
  }, [name, phase, owner, duration, dependsOn, refresh]);

  const cycleStatus = useCallback(async (task: MissionTask) => {
    const idx = STATUSES.indexOf(task.status);
    const next = STATUSES[(idx + 1) % STATUSES.length];
    setBusy(true);
    const r = await lensRun('defense', 'mission-task-update', { id: task.id, status: next });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to update task');
    setBusy(false);
  }, [refresh]);

  const removeTask = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'mission-task-delete', { id });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to delete task');
    setBusy(false);
  }, [refresh]);

  const toggleDep = (id: string) => {
    setDependsOn((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };

  const tasks = plan?.tasks || [];
  const criticalSet = new Set(plan?.criticalPath || []);

  // Timeline: each task plotted at its earliest start (hours → epoch-ish ms).
  const baseMs = Date.now();
  const timelineEvents: TimelineEvent[] = tasks.map((t) => ({
    id: t.id,
    label: t.name,
    time: baseMs + (t.earliestStart ?? 0) * 3_600_000,
    tone: STATUS_TONE[t.status] || 'default',
    detail: `${t.phase} · ${t.durationHours}h · ${criticalSet.has(t.id) ? 'critical path' : t.status}`,
  }));

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Mission Planner</h3>
        </div>
        {plan && (
          <div className="flex gap-3 text-[11px]">
            <span className="text-zinc-400">
              <Activity className="w-3 h-3 inline mr-1" />
              {plan.completionPct}% complete
            </span>
            <span className="text-zinc-400">{plan.totalDurationHours}h total</span>
            {plan.blocked.length > 0 && (
              <span className="text-red-400">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                {plan.blocked.length} blocked
              </span>
            )}
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          {tasks.length > 0 && (
            <>
              <TimelineView events={timelineEvents} height={110} />
              {/* Phase rollup */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(plan?.phases || []).map((p) => (
                  <div
                    key={p.phase}
                    className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-zinc-400">{p.phase}</div>
                    <div className="text-sm text-white">
                      {p.complete}/{p.count} done
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Task list */}
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {tasks.map((t) => (
              <div
                key={t.id}
                className={`flex items-center justify-between rounded border px-2.5 py-1.5 ${
                  criticalSet.has(t.id)
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-zinc-800 bg-zinc-900/60'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => cycleStatus(t)}
                    disabled={busy}
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 ${STATUS_COLOR[t.status]} disabled:opacity-50`}
                    title="Cycle status"
                  >
                    {t.status}
                  </button>
                  <span className="text-xs text-white truncate">{t.name}</span>
                  <span className="text-[10px] text-zinc-400 shrink-0">{t.phase}</span>
                  {t.owner && <span className="text-[10px] text-zinc-400 shrink-0">@{t.owner}</span>}
                  <span className="text-[10px] text-zinc-400 shrink-0 font-mono">
                    +{t.earliestStart ?? 0}h / {t.durationHours}h
                  </span>
                  {t.dependsOn.length > 0 && (
                    <span className="text-[10px] text-indigo-400 shrink-0">
                      ⛓ {t.dependsOn.length} dep
                    </span>
                  )}
                  {criticalSet.has(t.id) && (
                    <span className="text-[10px] text-amber-400 shrink-0">★ critical</span>
                  )}
                </div>
                <button
                  onClick={() => removeTask(t.id)}
                  disabled={busy}
                  aria-label="Delete task"
                  className="p-1 text-zinc-400 hover:text-red-400 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {tasks.length === 0 && (
              <div className="text-center py-6 text-xs text-zinc-400">
                No mission tasks. Add a phased task below to build the plan.
              </div>
            )}
          </div>
        </>
      )}

      {/* New task */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 border-t border-zinc-800 pt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Task name"
          className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        />
        <select
          value={phase}
          onChange={(e) => setPhase(e.target.value as typeof phase)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        >
          {PHASES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="Owner"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        />
        <input
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="Hours"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono"
        />
      </div>
      {tasks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-zinc-400 self-center mr-1">Depends on:</span>
          {tasks.map((t) => (
            <button
              key={t.id}
              onClick={() => toggleDep(t.id)}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                dependsOn.includes(t.id)
                  ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={addTask}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        Add Task
      </button>
    </section>
  );
}
