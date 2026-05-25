'use client';

/**
 * FocusToolkit — Sunsama / Motion–class focus-tool surface for the attention lens.
 * Wires the per-user STATE-backed macros in server/domains/attention.js:
 *   pomodoro{Start,Status,Interrupt,Complete,Stats}
 *   planner{Get,AddTask,MoveTask,RemoveTask}
 *   distraction{Log,Summary}
 *   focusAnalytics
 *   focusMode{Get,Set}
 *   calendar{Reserve,Blocks,Release}
 *   energyTag · peakHours
 * Every value rendered comes from a real macro call — no mock/seed data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Timer, Play, Square, AlertTriangle, CalendarDays, CalendarClock,
  BellOff, Bell, Activity, Zap, Loader2, Plus, Trash2, CheckCircle2,
  TrendingUp, TrendingDown, Minus, Gauge,
} from 'lucide-react';

// ── shared types ──
interface PomTimer {
  id: string; mode: string; durationMinutes: number; startedAt: number; endsAt: number;
  taskId: string | null; taskName: string | null; status: string; interruptions: number;
}
interface FocusSession {
  id: string; taskName: string | null; startedAt: string; endedAt: string;
  plannedMinutes: number; actualMinutes: number; interruptions: number;
  completed: boolean; deepWork: boolean; energy: string | null; mood: string | null;
}
interface PomStats {
  totalSessions: number; completedSessions: number; deepWorkSessions: number;
  totalFocusMinutes: number; totalFocusHours: number; totalInterruptions: number;
  completionRate: number; today: { sessions: number; minutes: number; deepWork: number };
  recentSessions: FocusSession[];
}
interface PlannerTask {
  id: string; name: string; startMinute: number; durationMinutes: number;
  priority: number; color: string; done: boolean;
}
interface PlannerDay { date: string; dayStartMinute: number; dayEndMinute: number; tasks: PlannerTask[]; }
interface DistractionEntry { id: string; source: string; kind: string; durationMinutes: number; note: string | null; loggedAt: string; }
interface DistractionSummary {
  total: number; todayCount: number; lostMinutes: number;
  byKind: Record<string, number>; topSources: Array<{ source: string; count: number }>;
  recent: DistractionEntry[];
}
interface AnalyticsDay { date: string; label: string; focusHours: number; deepWorkHours: number; sessions: number; interruptions: number; }
interface Analytics {
  windowDays: number; daily: AnalyticsDay[];
  weekly: Array<{ label: string; focusHours: number; deepWorkHours: number; sessions: number }>;
  totals: { focusHours: number; deepWorkHours: number; avgFocusHoursPerActiveDay: number; activeDays: number };
  deepWorkTrend: string; trendSlope: number;
}
interface FocusMode { enabled: boolean; label: string | null; mutedChannels: string[]; enabledAt: string | null; }
interface CalBlock { id: string; date: string; startMinute: number; durationMinutes: number; endMinute: number; title: string; }
interface PeakHour { hour: number; label: string; sessions: number; deepWork: number; focusMinutes: number; avgEnergy: number; performanceIndex: number; }
interface PeakHours { hourly: PeakHour[]; peakHours: PeakHour[]; lowHours: PeakHour[]; taggedSessions: number; moodBreakdown: Record<string, number>; }

const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const todayKey = () => new Date().toISOString().slice(0, 10);

export function FocusToolkit() {
  // ── pomodoro ──
  const [timer, setTimer] = useState<PomTimer | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [pomStats, setPomStats] = useState<PomStats | null>(null);
  const [pomMode, setPomMode] = useState<'focus' | 'short-break' | 'long-break'>('focus');
  const [pomTaskName, setPomTaskName] = useState('');
  const [pomEnergy, setPomEnergy] = useState<'low' | 'medium' | 'high'>('medium');
  // ── planner ──
  const [day, setDay] = useState<PlannerDay | null>(null);
  const [plannerStats, setPlannerStats] = useState<{ plannedMinutes: number; capacityMinutes: number; remainingMinutes: number; overbooked: boolean } | null>(null);
  const [taskName, setTaskName] = useState('');
  const [taskStart, setTaskStart] = useState('540');
  const [taskDuration, setTaskDuration] = useState('60');
  // ── distractions ──
  const [distractions, setDistractions] = useState<DistractionSummary | null>(null);
  const [dxSource, setDxSource] = useState('');
  const [dxKind, setDxKind] = useState('notification');
  const [dxDuration, setDxDuration] = useState('2');
  // ── analytics / peak ──
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [peak, setPeak] = useState<PeakHours | null>(null);
  // ── focus mode ──
  const [focusMode, setFocusMode] = useState<FocusMode | null>(null);
  // ── calendar ──
  const [calBlocks, setCalBlocks] = useState<CalBlock[]>([]);
  const [calStart, setCalStart] = useState('600');
  const [calDuration, setCalDuration] = useState('90');
  const [calTitle, setCalTitle] = useState('');
  const [calError, setCalError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async <T,>(action: string, input: Record<string, unknown> = {}): Promise<T | null> => {
    const r = await lensRun<T>('attention', action, input);
    if (r.data?.ok === false) return null;
    return (r.data?.result ?? null) as T | null;
  }, []);

  // ── loaders ──
  const refreshPomodoro = useCallback(async () => {
    const st = await run<{ timer: PomTimer | null; remainingSeconds: number }>('pomodoroStatus');
    setTimer(st?.timer ?? null);
    setRemaining(st?.remainingSeconds ?? 0);
    const stats = await run<PomStats>('pomodoroStats');
    if (stats) setPomStats(stats);
  }, [run]);

  const refreshPlanner = useCallback(async () => {
    const r = await run<{ day: PlannerDay; plannedMinutes: number; capacityMinutes: number; remainingMinutes: number; overbooked: boolean }>('plannerGet', { date: todayKey() });
    if (r) { setDay(r.day); setPlannerStats({ plannedMinutes: r.plannedMinutes, capacityMinutes: r.capacityMinutes, remainingMinutes: r.remainingMinutes, overbooked: r.overbooked }); }
  }, [run]);

  const refreshDistractions = useCallback(async () => {
    const r = await run<DistractionSummary>('distractionSummary');
    if (r) setDistractions(r);
  }, [run]);

  const refreshAnalytics = useCallback(async () => {
    const r = await run<Analytics>('focusAnalytics', { days: 14 });
    if (r) setAnalytics(r);
    const p = await run<PeakHours>('peakHours');
    if (p) setPeak(p);
  }, [run]);

  const refreshFocusMode = useCallback(async () => {
    const r = await run<{ mode: FocusMode }>('focusModeGet');
    if (r) setFocusMode(r.mode);
  }, [run]);

  const refreshCalendar = useCallback(async () => {
    const r = await run<{ blocks: CalBlock[] }>('calendarBlocks', { date: todayKey() });
    if (r) setCalBlocks(r.blocks);
  }, [run]);

  useEffect(() => {
    refreshPomodoro();
    refreshPlanner();
    refreshDistractions();
    refreshAnalytics();
    refreshFocusMode();
    refreshCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live countdown — derived from server endsAt, not a fake clock
  useEffect(() => {
    if (!timer || timer.status !== 'running') return;
    const id = setInterval(() => {
      const rem = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
      setRemaining(rem);
      if (rem <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [timer]);

  // ── pomodoro actions ──
  const startTimer = async () => {
    setBusy('pom-start');
    const r = await run<{ timer: PomTimer }>('pomodoroStart', {
      mode: pomMode,
      taskName: pomTaskName || undefined,
    });
    if (r) { setTimer(r.timer); setRemaining(r.timer.durationMinutes * 60); }
    setBusy(null);
  };
  const interruptTimer = async () => {
    setBusy('pom-int');
    await run('pomodoroInterrupt');
    await refreshPomodoro();
    setBusy(null);
  };
  const completeTimer = async (abandoned: boolean) => {
    setBusy('pom-done');
    await run<{ session: FocusSession | null }>('pomodoroComplete', { abandoned, energy: pomEnergy });
    setTimer(null);
    setRemaining(0);
    await refreshPomodoro();
    await refreshAnalytics();
    setBusy(null);
  };

  // ── planner actions ──
  const addPlannerTask = async () => {
    if (!taskName.trim()) return;
    setBusy('plan-add');
    await run('plannerAddTask', {
      date: todayKey(), name: taskName.trim(),
      startMinute: Number(taskStart), durationMinutes: Number(taskDuration),
    });
    setTaskName('');
    await refreshPlanner();
    setBusy(null);
  };
  const toggleTaskDone = async (t: PlannerTask) => {
    await run('plannerMoveTask', { date: todayKey(), taskId: t.id, done: !t.done });
    await refreshPlanner();
  };
  const shiftTask = async (t: PlannerTask, deltaMin: number) => {
    await run('plannerMoveTask', { date: todayKey(), taskId: t.id, startMinute: Math.max(0, Math.min(1439, t.startMinute + deltaMin)) });
    await refreshPlanner();
  };
  const removePlannerTask = async (id: string) => {
    await run('plannerRemoveTask', { date: todayKey(), taskId: id });
    await refreshPlanner();
  };

  // ── distraction actions ──
  const logDistraction = async () => {
    if (!dxSource.trim()) return;
    setBusy('dx-log');
    await run('distractionLog', { source: dxSource.trim(), kind: dxKind, durationMinutes: Number(dxDuration) });
    setDxSource('');
    await refreshDistractions();
    await refreshAnalytics();
    setBusy(null);
  };

  // ── focus mode ──
  const toggleFocusMode = async () => {
    setBusy('fm');
    const r = await run<{ mode: FocusMode }>('focusModeSet', { enabled: !focusMode?.enabled });
    if (r) setFocusMode(r.mode);
    setBusy(null);
  };

  // ── calendar ──
  const reserveBlock = async () => {
    setBusy('cal-add');
    setCalError(null);
    const r = await lensRun('attention', 'calendarReserve', {
      date: todayKey(), startMinute: Number(calStart), durationMinutes: Number(calDuration),
      title: calTitle || undefined,
    });
    if (r.data?.ok === false) setCalError(r.data?.error === 'time_conflict' ? 'That slot overlaps an existing block.' : (r.data?.error || 'Reservation failed.'));
    else { setCalTitle(''); await refreshCalendar(); }
    setBusy(null);
  };
  const releaseBlock = async (id: string) => {
    await run('calendarRelease', { blockId: id });
    await refreshCalendar();
  };

  // ── energy tag (tags most-recent untagged session) ──
  const tagEnergy = async (sessionId: string, energy: 'low' | 'medium' | 'high') => {
    await run('energyTag', { sessionId, energy });
    await refreshPomodoro();
    await refreshAnalytics();
  };

  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const analyticsChart = useMemo(
    () => (analytics?.daily ?? []).map((d) => ({ label: d.label, focusHours: d.focusHours, deepWorkHours: d.deepWorkHours })),
    [analytics],
  );
  const peakChart = useMemo(
    () => (peak?.hourly ?? []).filter((h) => h.sessions > 0).map((h) => ({ label: h.label, performance: Math.round(h.performanceIndex * 100) })),
    [peak],
  );

  return (
    <div className="space-y-6">
      {/* ── Pomodoro Timer ── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Timer className="h-4 w-4 text-neon-cyan" /> Focus Timer (Pomodoro)
        </h3>
        {timer ? (
          <div className="flex flex-wrap items-center gap-6">
            <div className="text-center">
              <div className={`font-mono text-5xl font-bold ${timer.mode === 'focus' ? 'text-neon-cyan' : 'text-neon-green'}`}>{mmss}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-gray-400">
                {timer.mode.replace('-', ' ')}{timer.taskName ? ` · ${timer.taskName}` : ''}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" /> {timer.interruptions} interruption{timer.interruptions !== 1 ? 's' : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={interruptTimer} disabled={busy === 'pom-int'} className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-50">
                  Log interruption
                </button>
                <button onClick={() => completeTimer(false)} disabled={busy === 'pom-done'} className="flex items-center gap-1 rounded border border-neon-green/30 bg-neon-green/10 px-3 py-1.5 text-xs text-neon-green hover:bg-neon-green/20 disabled:opacity-50">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                </button>
                <button onClick={() => completeTimer(true)} disabled={busy === 'pom-done'} className="flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50">
                  <Square className="h-3.5 w-3.5" /> Abandon
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-gray-400">
              Mode
              <select value={pomMode} onChange={(e) => setPomMode(e.target.value as typeof pomMode)} className="input-lattice">
                <option value="focus">Focus (25m)</option>
                <option value="short-break">Short break (5m)</option>
                <option value="long-break">Long break (15m)</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-gray-400" style={{ minWidth: 160 }}>
              Task
              <input value={pomTaskName} onChange={(e) => setPomTaskName(e.target.value)} placeholder="What are you focusing on?" className="input-lattice" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-400">
              End energy
              <select value={pomEnergy} onChange={(e) => setPomEnergy(e.target.value as typeof pomEnergy)} className="input-lattice">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <button onClick={startTimer} disabled={busy === 'pom-start'} className="flex items-center gap-1.5 rounded-lg bg-neon-cyan/15 px-4 py-2 text-sm font-medium text-neon-cyan ring-1 ring-neon-cyan/30 hover:bg-neon-cyan/25 disabled:opacity-50">
              {busy === 'pom-start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start
            </button>
          </div>
        )}
        {pomStats && (
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-zinc-800 pt-3 sm:grid-cols-5">
            <Stat label="Today" value={`${pomStats.today.sessions} sess`} />
            <Stat label="Today focus" value={`${Math.round(pomStats.today.minutes)}m`} />
            <Stat label="Deep work" value={`${pomStats.deepWorkSessions}`} />
            <Stat label="Total hours" value={`${pomStats.totalFocusHours}h`} />
            <Stat label="Completion" value={`${pomStats.completionRate}%`} />
          </div>
        )}
        {/* energy tagging of recent untagged sessions */}
        {pomStats && pomStats.recentSessions.filter((s) => !s.energy).length > 0 && (
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <p className="mb-2 text-xs text-gray-400">Tag energy on recent sessions (find your peak hours)</p>
            <div className="space-y-1">
              {pomStats.recentSessions.filter((s) => !s.energy).slice(0, 4).map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs">
                  <span className="truncate text-gray-300">{s.taskName || 'Untitled'} · {Math.round(s.actualMinutes)}m</span>
                  <span className="flex gap-1">
                    {(['low', 'medium', 'high'] as const).map((e) => (
                      <button key={e} onClick={() => tagEnergy(s.id, e)} className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] capitalize text-gray-400 hover:border-neon-purple/40 hover:text-neon-purple">
                        {e}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Daily Planner ── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarDays className="h-4 w-4 text-neon-purple" /> Daily Attention Planner
          </h3>
          {plannerStats && (
            <span className={`text-xs ${plannerStats.overbooked ? 'text-red-400' : 'text-gray-400'}`}>
              {Math.round(plannerStats.plannedMinutes / 60 * 10) / 10}h / {Math.round(plannerStats.capacityMinutes / 60)}h planned
              {plannerStats.overbooked && ' · overbooked'}
            </span>
          )}
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="Task name" className="input-lattice flex-1" style={{ minWidth: 140 }} />
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Start
            <input type="time" value={minToHHMM(Number(taskStart))} onChange={(e) => { const [h, m] = e.target.value.split(':'); setTaskStart(String(Number(h) * 60 + Number(m))); }} className="input-lattice" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Minutes
            <input type="number" min={5} max={720} value={taskDuration} onChange={(e) => setTaskDuration(e.target.value)} className="input-lattice w-20" />
          </label>
          <button onClick={addPlannerTask} disabled={busy === 'plan-add' || !taskName.trim()} className="flex items-center gap-1 rounded bg-neon-purple/15 px-3 py-2 text-xs text-neon-purple ring-1 ring-neon-purple/30 hover:bg-neon-purple/25 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        <div className="space-y-1.5">
          {(day?.tasks ?? []).map((t) => (
            <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${t.done ? 'border-zinc-800 bg-zinc-900/40 opacity-60' : 'border-zinc-800 bg-zinc-950'}`}>
              <button onClick={() => toggleTaskDone(t)} className="flex-shrink-0" aria-label="Toggle done">
                <CheckCircle2 className={`h-4 w-4 ${t.done ? 'text-neon-green' : 'text-gray-600'}`} />
              </button>
              <span className="w-12 flex-shrink-0 font-mono text-xs text-gray-400">{minToHHMM(t.startMinute)}</span>
              <span className={`flex-1 truncate text-sm ${t.done ? 'text-gray-400 line-through' : 'text-gray-200'}`}>{t.name}</span>
              <span className="flex-shrink-0 text-xs text-gray-400">{t.durationMinutes}m</span>
              <button onClick={() => shiftTask(t, -30)} className="rounded px-1 text-xs text-gray-400 hover:text-neon-cyan" title="-30m">&minus;</button>
              <button onClick={() => shiftTask(t, 30)} className="rounded px-1 text-xs text-gray-400 hover:text-neon-cyan" title="+30m">+</button>
              <button onClick={() => removePlannerTask(t.id)} className="flex-shrink-0 text-gray-600 hover:text-red-400" aria-label="Remove task">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {(!day || day.tasks.length === 0) && (
            <p className="rounded border border-dashed border-zinc-800 py-4 text-center text-xs text-gray-400">No tasks timeboxed for today.</p>
          )}
        </div>
      </section>

      {/* ── Focus Mode + Calendar ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Focus Mode */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            {focusMode?.enabled ? <BellOff className="h-4 w-4 text-neon-green" /> : <Bell className="h-4 w-4 text-gray-400" />}
            Do-Not-Disturb / Focus Mode
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${focusMode?.enabled ? 'text-neon-green' : 'text-gray-400'}`}>
                {focusMode?.enabled ? (focusMode.label || 'Deep Work') : 'Notifications on'}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {focusMode?.enabled
                  ? `Muting: ${focusMode.mutedChannels.join(', ') || 'none'}`
                  : 'Toggle to mute chat, world, marketplace & system notifications.'}
              </p>
            </div>
            <button onClick={toggleFocusMode} disabled={busy === 'fm'} className={`rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              focusMode?.enabled ? 'bg-neon-green/20 text-neon-green ring-1 ring-neon-green/40' : 'bg-zinc-800 text-gray-400 ring-1 ring-zinc-700'
            }`}>
              {busy === 'fm' ? <Loader2 className="h-4 w-4 animate-spin" /> : focusMode?.enabled ? 'On' : 'Off'}
            </button>
          </div>
        </section>

        {/* Calendar focus blocks */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarClock className="h-4 w-4 text-neon-blue" /> Reserved Focus Blocks
          </h3>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              Start
              <input type="time" value={minToHHMM(Number(calStart))} onChange={(e) => { const [h, m] = e.target.value.split(':'); setCalStart(String(Number(h) * 60 + Number(m))); }} className="input-lattice" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              Minutes
              <input type="number" min={15} max={480} value={calDuration} onChange={(e) => setCalDuration(e.target.value)} className="input-lattice w-20" />
            </label>
            <input value={calTitle} onChange={(e) => setCalTitle(e.target.value)} placeholder="Block title" className="input-lattice flex-1" style={{ minWidth: 100 }} />
            <button onClick={reserveBlock} disabled={busy === 'cal-add'} className="rounded bg-neon-blue/15 px-3 py-2 text-xs text-neon-blue ring-1 ring-neon-blue/30 hover:bg-neon-blue/25 disabled:opacity-50">
              Reserve
            </button>
          </div>
          {calError && <p className="mb-2 text-xs text-red-400">{calError}</p>}
          <div className="space-y-1">
            {calBlocks.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs">
                <span className="text-gray-300">
                  <span className="font-mono text-neon-blue">{minToHHMM(b.startMinute)}–{minToHHMM(b.endMinute)}</span> · {b.title}
                </span>
                <button onClick={() => releaseBlock(b.id)} className="text-gray-600 hover:text-red-400" aria-label="Release block">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {calBlocks.length === 0 && <p className="rounded border border-dashed border-zinc-800 py-3 text-center text-xs text-gray-400">No focus blocks reserved today.</p>}
          </div>
        </section>
      </div>

      {/* ── Distraction Log ── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <AlertTriangle className="h-4 w-4 text-yellow-400" /> Distraction Log
          </h3>
          {distractions && (
            <span className="text-xs text-gray-400">{distractions.todayCount} today · {Math.round(distractions.lostMinutes)}m lost</span>
          )}
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <input value={dxSource} onChange={(e) => setDxSource(e.target.value)} placeholder="What interrupted you?" className="input-lattice flex-1" style={{ minWidth: 140 }} />
          <select value={dxKind} onChange={(e) => setDxKind(e.target.value)} className="input-lattice">
            <option value="notification">Notification</option>
            <option value="person">Person</option>
            <option value="self">Self</option>
            <option value="meeting">Meeting</option>
            <option value="other">Other</option>
          </select>
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Minutes lost
            <input type="number" min={0} max={480} value={dxDuration} onChange={(e) => setDxDuration(e.target.value)} className="input-lattice w-20" />
          </label>
          <button onClick={logDistraction} disabled={busy === 'dx-log' || !dxSource.trim()} className="rounded bg-yellow-500/15 px-3 py-2 text-xs text-yellow-300 ring-1 ring-yellow-500/30 hover:bg-yellow-500/25 disabled:opacity-50">
            Log
          </button>
        </div>
        {distractions && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-gray-400">Top sources</p>
              <div className="space-y-1">
                {distractions.topSources.length > 0 ? distractions.topSources.map((s) => (
                  <div key={s.source} className="flex items-center justify-between text-xs">
                    <span className="truncate text-gray-300">{s.source}</span>
                    <span className="font-mono text-yellow-400">{s.count}</span>
                  </div>
                )) : <p className="text-xs text-gray-400">No distractions logged.</p>}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs text-gray-400">By kind</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(distractions.byKind).map(([k, n]) => (
                  <span key={k} className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] capitalize text-gray-300">{k}: {n}</span>
                ))}
                {Object.keys(distractions.byKind).length === 0 && <span className="text-xs text-gray-400">—</span>}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Focus Analytics ── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-neon-green" /> Focus Analytics — Deep Work Trends
          </h3>
          {analytics && (
            <span className={`flex items-center gap-1 text-xs ${
              analytics.deepWorkTrend === 'improving' ? 'text-neon-green' :
              analytics.deepWorkTrend === 'declining' ? 'text-red-400' : 'text-gray-400'
            }`}>
              {analytics.deepWorkTrend === 'improving' ? <TrendingUp className="h-3.5 w-3.5" /> :
               analytics.deepWorkTrend === 'declining' ? <TrendingDown className="h-3.5 w-3.5" /> :
               <Minus className="h-3.5 w-3.5" />}
              {analytics.deepWorkTrend}
            </span>
          )}
        </div>
        {analytics && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Focus (14d)" value={`${analytics.totals.focusHours}h`} />
              <Stat label="Deep work (14d)" value={`${analytics.totals.deepWorkHours}h`} />
              <Stat label="Avg / active day" value={`${analytics.totals.avgFocusHoursPerActiveDay}h`} />
              <Stat label="Active days" value={`${analytics.totals.activeDays}`} />
            </div>
            <ChartKit
              kind="bar"
              data={analyticsChart}
              xKey="label"
              series={[
                { key: 'focusHours', label: 'Focus hrs', color: '#06b6d4' },
                { key: 'deepWorkHours', label: 'Deep-work hrs', color: '#22c55e' },
              ]}
              height={220}
            />
          </>
        )}
        {!analytics && <p className="py-6 text-center text-xs text-gray-400">Complete a focus session to build analytics.</p>}
      </section>

      {/* ── Peak Hours ── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Zap className="h-4 w-4 text-neon-yellow" /> Peak Performance Hours
        </h3>
        {peak && peak.taggedSessions > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {peak.peakHours.map((h) => (
                <span key={h.hour} className="flex items-center gap-1 rounded bg-neon-yellow/10 px-2 py-1 text-xs text-neon-yellow ring-1 ring-neon-yellow/30">
                  <Gauge className="h-3 w-3" /> {h.label} · idx {Math.round(h.performanceIndex * 100)}
                </span>
              ))}
            </div>
            <ChartKit
              kind="area"
              data={peakChart}
              xKey="label"
              series={[{ key: 'performance', label: 'Performance index', color: '#f59e0b' }]}
              height={180}
            />
          </>
        ) : (
          <p className="py-6 text-center text-xs text-gray-400">
            Tag energy on completed focus sessions above to discover your peak hours.
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-center">
      <div className="font-mono text-lg text-neon-cyan">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  );
}
