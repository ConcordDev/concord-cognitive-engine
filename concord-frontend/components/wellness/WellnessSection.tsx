'use client';

/**
 * WellnessSection — Apple Health + Whoop + Oura + Daylio + Habitify
 * 2026 parity. Recovery ring, metric trends, habit grid with streaks,
 * mood journal + correlation, workout log, goals. Wired to wellness.*
 */

import { useCallback, useEffect, useState } from 'react';
import {
  HeartPulse, Loader2, Plus, Trash2, Flame, Activity, Smile, Target,
  TrendingUp, TrendingDown, Minus, Dumbbell, Sparkles, Check,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Tab = 'today' | 'habits' | 'mood' | 'workouts' | 'goals';

interface Recovery { date: string; score: number; band: 'green' | 'yellow' | 'red'; advice: string; inputsUsed: string[]; signals: { sleepHours: number | null; restingHr: number | null; hrvMs: number | null; strainMin: number }; hasEnoughData: boolean }
interface Habit { id: string; name: string; unit: string; target: number; color: string; todayValue: number; doneToday: boolean; streak: number; longestStreak: number; last7: { date: string; value: number; done: boolean }[] }
interface MoodEntry { id: string; mood: string; moodScore: number; activities: string[]; note: string; date: string; at: string }
interface Correlation { activity: string; occurrences: number; avgMood: number; delta: number; effect: string }
interface Workout { id: string; number: string; kind: string; durationMin: number; distanceKm: number | null; intensity: string; date: string }
interface Goal { id: string; number: string; name: string; target: number; current: number; unit: string; status: string }
interface Trend { type: string; series: { date: string; value: number }[]; average: number; latest: number | null; trend: string }
interface Summary { habitCount: number; habitsDoneToday: number; workoutsThisWeek: number; workoutMinThisWeek: number; avgMoodThisWeek: number | null; activeGoals: number; metricEntryCount: number }

const MOODS = [
  { id: 'awful', emoji: '😣', label: 'Awful' },
  { id: 'bad', emoji: '🙁', label: 'Bad' },
  { id: 'meh', emoji: '😐', label: 'Meh' },
  { id: 'good', emoji: '🙂', label: 'Good' },
  { id: 'great', emoji: '😄', label: 'Great' },
];
const TREND_METRICS = [
  { type: 'steps', label: 'Steps' },
  { type: 'weight_kg', label: 'Weight (kg)' },
  { type: 'sleep_hours', label: 'Sleep (h)' },
  { type: 'water_ml', label: 'Water (ml)' },
  { type: 'resting_hr', label: 'Resting HR' },
  { type: 'hrv_ms', label: 'HRV (ms)' },
];
const WORKOUT_KINDS = ['run', 'walk', 'cycle', 'swim', 'strength', 'yoga', 'hiit', 'sport', 'other'];

export function WellnessSection() {
  const [tab, setTab] = useState<Tab>('today');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [trendType, setTrendType] = useState('steps');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [su, rec, hb, md, mc, wo, gl] = await Promise.all([
        lensRun({ domain: 'wellness', action: 'wellness-dashboard-summary', input: {} }),
        lensRun({ domain: 'wellness', action: 'recovery-score', input: {} }),
        lensRun({ domain: 'wellness', action: 'habits-list', input: {} }),
        lensRun({ domain: 'wellness', action: 'mood-list', input: { days: 30 } }),
        lensRun({ domain: 'wellness', action: 'mood-correlate', input: { days: 90 } }),
        lensRun({ domain: 'wellness', action: 'workouts-list', input: { days: 30 } }),
        lensRun({ domain: 'wellness', action: 'goals-list', input: {} }),
      ]);
      setSummary(su.data?.result || null);
      setRecovery(rec.data?.result || null);
      setHabits((hb.data?.result?.habits || []) as Habit[]);
      setMoods((md.data?.result?.moods || []) as MoodEntry[]);
      setCorrelations((mc.data?.result?.correlations || []) as Correlation[]);
      setWorkouts((wo.data?.result?.workouts || []) as Workout[]);
      setGoals((gl.data?.result?.goals || []) as Goal[]);
    } catch (e) { console.error('[Wellness] refresh', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadTrend = useCallback(async (type: string) => {
    try {
      const r = await lensRun({ domain: 'wellness', action: 'metrics-trend', input: { type, days: 30 } });
      setTrend(r.data?.result || null);
    } catch (e) { console.error('[Wellness] trend', e); }
  }, []);
  useEffect(() => { loadTrend(trendType); }, [trendType, loadTrend, summary]);

  async function logMetric() {
    const type = prompt(`Metric type (${TREND_METRICS.map(m => m.type).join(' / ')})?`);
    if (!type) return;
    const value = prompt('Value?');
    if (value === null || value === '') return;
    try {
      const r = await lensRun({ domain: 'wellness', action: 'metrics-log', input: { type: type.trim(), value: Number(value) } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      await refresh();
    } catch (e) { console.error('[Wellness] logMetric', e); }
  }

  async function addHabit() {
    const name = prompt('Habit name?'); if (!name?.trim()) return;
    const unit = prompt('Unit (blank for simple check, e.g. "glasses")') || '';
    const target = unit ? Number(prompt('Daily target?') || '1') : 1;
    try { await lensRun({ domain: 'wellness', action: 'habits-create', input: { name: name.trim(), unit, target } }); await refresh(); }
    catch (e) { console.error('[Wellness] addHabit', e); }
  }
  async function checkinHabit(h: Habit) {
    try {
      if (h.unit === '' && h.target === 1) {
        await lensRun({ domain: 'wellness', action: 'habits-checkin', input: { habitId: h.id, toggle: true } });
      } else {
        const v = prompt(`${h.name} — ${h.unit || 'count'} today? (target ${h.target})`, String(h.todayValue || ''));
        if (v === null) return;
        await lensRun({ domain: 'wellness', action: 'habits-checkin', input: { habitId: h.id, value: Number(v) } });
      }
      await refresh();
    } catch (e) { console.error('[Wellness] checkin', e); }
  }
  async function archiveHabit(id: string) {
    if (!confirm('Archive this habit?')) return;
    try { await lensRun({ domain: 'wellness', action: 'habits-archive', input: { id } }); await refresh(); }
    catch (e) { console.error('[Wellness] archive', e); }
  }

  async function logMood(mood: string) {
    const actStr = prompt('Activities today? (comma-separated — e.g. exercise, friends, work)') || '';
    const note = prompt('Note (optional)?') || '';
    try {
      await lensRun({ domain: 'wellness', action: 'mood-log', input: { mood, activities: actStr.split(',').map(a => a.trim()).filter(Boolean), note } });
      await refresh();
    } catch (e) { console.error('[Wellness] logMood', e); }
  }

  async function logWorkout() {
    const kind = prompt(`Workout kind (${WORKOUT_KINDS.join('/')})?`); if (!kind?.trim()) return;
    const dur = prompt('Duration (minutes)?'); if (!dur) return;
    const intensity = prompt('Intensity (easy/moderate/hard/max)?') || 'moderate';
    try { await lensRun({ domain: 'wellness', action: 'workouts-log', input: { kind: kind.trim(), durationMin: Number(dur), intensity } }); await refresh(); }
    catch (e) { console.error('[Wellness] logWorkout', e); }
  }
  async function delWorkout(id: string) {
    try { await lensRun({ domain: 'wellness', action: 'workouts-delete', input: { id } }); await refresh(); }
    catch (e) { console.error('[Wellness] delWorkout', e); }
  }

  async function addGoal() {
    const name = prompt('Goal name?'); if (!name?.trim()) return;
    const target = prompt('Target value?'); if (!target) return;
    const unit = prompt('Unit?') || '';
    try { await lensRun({ domain: 'wellness', action: 'goals-create', input: { name: name.trim(), target: Number(target), unit } }); await refresh(); }
    catch (e) { console.error('[Wellness] addGoal', e); }
  }
  async function updateGoal(g: Goal) {
    const v = prompt(`${g.name} — current progress (${g.unit})?`, String(g.current));
    if (v === null) return;
    try { await lensRun({ domain: 'wellness', action: 'goals-update-progress', input: { id: g.id, current: Number(v) } }); await refresh(); }
    catch (e) { console.error('[Wellness] updateGoal', e); }
  }
  async function delGoal(id: string) {
    try { await lensRun({ domain: 'wellness', action: 'goals-delete', input: { id } }); await refresh(); }
    catch (e) { console.error('[Wellness] delGoal', e); }
  }

  const recoveryColour = recovery?.band === 'green' ? '#34d399' : recovery?.band === 'yellow' ? '#fbbf24' : '#f43f5e';

  return (
    <div className="bg-[#0d1117] border border-rose-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <HeartPulse className="w-4 h-4 text-rose-400" />
        <span className="text-sm font-semibold text-gray-200">Wellness</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
        <nav className="ml-3 flex items-center gap-1">
          {([['today','Today',Activity],['habits','Habits',Flame],['mood','Mood',Smile],['workouts','Workouts',Dumbbell],['goals','Goals',Target]] as const).map(([id,label,Icon]) => (
            <button key={id} onClick={() => setTab(id)} className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded', tab === id ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30' : 'text-gray-400 hover:text-white border border-transparent')}>
              <Icon className="w-3 h-3" />{label}
            </button>
          ))}
        </nav>
      </header>

      <div className="p-4">
        {/* TODAY */}
        {tab === 'today' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Recovery ring */}
              <div className="rounded border border-white/10 bg-black/30 p-4 flex items-center gap-4">
                {recovery && recovery.hasEnoughData ? (
                  <>
                    <div className="relative w-20 h-20 flex-shrink-0">
                      <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="#ffffff10" strokeWidth="8" />
                        <circle cx="40" cy="40" r="34" fill="none" stroke={recoveryColour} strokeWidth="8" strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 34}`} strokeDashoffset={`${2 * Math.PI * 34 * (1 - recovery.score / 100)}`} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl font-mono font-bold" style={{ color: recoveryColour }}>{recovery.score}</span>
                        <span className="text-[8px] uppercase text-gray-400">recovery</span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold capitalize" style={{ color: recoveryColour }}>{recovery.band}</div>
                      <div className="text-[11px] text-gray-400">{recovery.advice}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {recovery.signals.sleepHours !== null && `${recovery.signals.sleepHours}h sleep · `}
                        {recovery.signals.hrvMs !== null && `HRV ${recovery.signals.hrvMs} · `}
                        {recovery.signals.restingHr !== null && `RHR ${recovery.signals.restingHr}`}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-gray-400">
                    <div className="font-semibold text-gray-400 mb-1">Recovery score</div>
                    Log today&apos;s sleep_hours, hrv_ms, or resting_hr to compute a Whoop-style recovery score.
                    <button onClick={logMetric} className="mt-1.5 block px-2 py-1 text-[11px] rounded bg-rose-500 text-white font-bold hover:bg-rose-400">Log a metric</button>
                  </div>
                )}
              </div>
              {/* Quick stats */}
              {summary && (
                <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <Stat label="Habits today" value={`${summary.habitsDoneToday}/${summary.habitCount}`} />
                  <Stat label="Workouts (wk)" value={String(summary.workoutsThisWeek)} sub={`${summary.workoutMinThisWeek} min`} />
                  <Stat label="Avg mood (wk)" value={summary.avgMoodThisWeek !== null ? MOODS[Math.round(summary.avgMoodThisWeek)]?.emoji || '—' : '—'} />
                  <Stat label="Active goals" value={String(summary.activeGoals)} />
                </div>
              )}
            </div>

            {/* Metric trend chart */}
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Trend</span>
                <select value={trendType} onChange={e => setTrendType(e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
                  {TREND_METRICS.map(m => <option key={m.type} value={m.type}>{m.label}</option>)}
                </select>
                {trend && trend.latest !== null && (
                  <span className="text-xs text-gray-400 inline-flex items-center gap-1">
                    latest <span className="font-mono text-white">{trend.latest}</span> · avg <span className="font-mono text-white">{trend.average}</span>
                    {trend.trend === 'rising' ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : trend.trend === 'falling' ? <TrendingDown className="w-3 h-3 text-rose-400" /> : <Minus className="w-3 h-3 text-gray-400" />}
                  </span>
                )}
                <button onClick={logMetric} className="ml-auto px-2 py-1 text-[11px] rounded bg-rose-500 text-white font-bold hover:bg-rose-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Log metric</button>
              </div>
              {trend && trend.series.length > 0 ? (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend.series} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="wlTrend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#ffffff10" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} interval="preserveStartEnd" tickFormatter={(d) => String(d).slice(5)} />
                      <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
                      <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }} />
                      <Area type="monotone" dataKey="value" stroke="#f43f5e" strokeWidth={1.5} fill="url(#wlTrend)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="py-10 text-center text-xs text-gray-400">No data for this metric yet.</div>
              )}
            </div>
          </div>
        )}

        {/* HABITS */}
        {tab === 'habits' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{habits.length} habit(s)</span>
              <button onClick={addHabit} className="ml-auto px-2.5 py-1 text-xs rounded bg-rose-500 text-white font-semibold hover:bg-rose-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />New habit</button>
            </div>
            {habits.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-400"><Flame className="w-6 h-6 mx-auto mb-2 opacity-30" />No habits yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {habits.map(h => (
                  <li key={h.id} className="rounded border border-white/10 bg-black/30 p-2.5 group">
                    <div className="flex items-center gap-2">
                      <button onClick={() => checkinHabit(h)} className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0', h.doneToday ? '' : 'border border-white/20')} style={{ background: h.doneToday ? h.color : 'transparent' }}>
                        {h.doneToday && <Check className="w-4 h-4 text-black" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white">{h.name}</div>
                        <div className="text-[10px] text-gray-400">
                          {h.unit ? `${h.todayValue}/${h.target} ${h.unit}` : (h.doneToday ? 'done today' : 'not yet')}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-mono inline-flex items-center gap-1" style={{ color: h.streak > 0 ? h.color : '#6b7280' }}>
                          <Flame className="w-3 h-3" />{h.streak}
                        </div>
                        <div className="text-[9px] text-gray-400">best {h.longestStreak}</div>
                      </div>
                      <button aria-label="Delete" onClick={() => archiveHabit(h.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      {h.last7.map(d => (
                        <div key={d.date} title={`${d.date}: ${d.value}`} className="flex-1 h-4 rounded-sm" style={{ background: d.done ? h.color : '#ffffff12' }} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* MOOD */}
        {tab === 'mood' && (
          <div className="space-y-3">
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">How are you feeling?</div>
              <div className="flex items-center gap-2">
                {MOODS.map(m => (
                  <button key={m.id} onClick={() => logMood(m.id)} className="flex-1 py-2 rounded border border-white/10 hover:border-rose-500/40 hover:bg-rose-500/5 flex flex-col items-center gap-1">
                    <span className="text-2xl">{m.emoji}</span>
                    <span className="text-[10px] text-gray-400">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {correlations.length > 0 && (
              <div className="rounded border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2 inline-flex items-center gap-1"><Sparkles className="w-3 h-3 text-rose-400" />What affects your mood</div>
                <ul className="space-y-1">
                  {correlations.map(c => (
                    <li key={c.activity} className="flex items-center gap-2 text-xs">
                      <span className="text-white flex-1 truncate">{c.activity}</span>
                      <span className="text-[10px] text-gray-400">{c.occurrences}×</span>
                      <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded',
                        c.effect === 'lifts mood' ? 'bg-emerald-500/15 text-emerald-300' :
                        c.effect === 'lowers mood' ? 'bg-rose-500/15 text-rose-300' : 'bg-white/5 text-gray-400')}>
                        {c.delta >= 0 ? '+' : ''}{c.delta} · {c.effect}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Recent entries</div>
              {moods.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">No mood entries yet.</div>
              ) : (
                <ul className="space-y-1">
                  {moods.slice(0, 14).map(m => (
                    <li key={m.id} className="flex items-center gap-2 text-xs">
                      <span className="text-lg">{MOODS[m.moodScore]?.emoji}</span>
                      <span className="text-[10px] text-gray-400 font-mono w-20">{m.date}</span>
                      <span className="flex-1 text-gray-300 truncate">{m.activities.join(', ')}{m.note && ` — ${m.note}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* WORKOUTS */}
        {tab === 'workouts' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{workouts.length} workout(s) · 30 days</span>
              <button onClick={logWorkout} className="ml-auto px-2.5 py-1 text-xs rounded bg-rose-500 text-white font-semibold hover:bg-rose-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Log workout</button>
            </div>
            {workouts.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-400"><Dumbbell className="w-6 h-6 mx-auto mb-2 opacity-30" />No workouts logged.</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {workouts.map(w => (
                  <li key={w.id} className="py-2 flex items-center gap-3 group">
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 font-mono w-16 text-center">{w.kind}</span>
                    <span className="text-[10px] text-gray-400 font-mono w-20">{w.date}</span>
                    <div className="flex-1 text-xs text-white">
                      {w.durationMin} min
                      {w.distanceKm !== null && ` · ${w.distanceKm} km`}
                      <span className="text-[10px] text-gray-400"> · {w.intensity}</span>
                    </div>
                    <button aria-label="Delete" onClick={() => delWorkout(w.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-300"><Trash2 className="w-3 h-3" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* GOALS */}
        {tab === 'goals' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{goals.length} goal(s)</span>
              <button onClick={addGoal} className="ml-auto px-2.5 py-1 text-xs rounded bg-rose-500 text-white font-semibold hover:bg-rose-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />New goal</button>
            </div>
            {goals.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-400"><Target className="w-6 h-6 mx-auto mb-2 opacity-30" />No goals set.</div>
            ) : (
              <ul className="space-y-1.5">
                {goals.map(g => {
                  const pct = Math.min(100, Math.round((g.current / g.target) * 100));
                  return (
                    <li key={g.id} className="rounded border border-white/10 bg-black/30 p-2.5 group">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', g.status === 'achieved' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>{g.status}</span>
                        <span className="text-sm text-white flex-1 truncate">{g.name}</span>
                        <span className="text-xs font-mono text-gray-400">{g.current}/{g.target} {g.unit}</span>
                        <button onClick={() => updateGoal(g)} className="px-1.5 py-0.5 text-[10px] rounded border border-white/10 text-gray-300 hover:bg-white/[0.05]">Update</button>
                        <button aria-label="Delete" onClick={() => delGoal(g.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-300"><Trash2 className="w-3 h-3" /></button>
                      </div>
                      <div className="mt-1.5 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className={cn('h-full', g.status === 'achieved' ? 'bg-emerald-400' : 'bg-rose-400')} style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-lg font-mono text-white">{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}

export default WellnessSection;
