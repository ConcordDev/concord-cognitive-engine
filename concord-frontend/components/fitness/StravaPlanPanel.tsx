'use client';

/**
 * StravaPlanPanel — training-plan calendar with adaptive rescheduling.
 * Plans + sessions are created via fitness.plan-create, surfaced with
 * computed adherence via fitness.plan-list, and missed sessions slide
 * forward via fitness.plan-reschedule.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, CalendarDays, Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Clock, Bed,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PlanSession {
  id: string;
  date: string;
  type: string;
  title: string | null;
  targetDistanceKm: number;
  targetDurationMin: number;
  status: string;
  actualDistanceKm?: number;
  rescheduled?: boolean;
}
interface TrainingPlan {
  id: string;
  name: string;
  goalRace: string | null;
  goalDate: string | null;
  sessions: PlanSession[];
  adherence: { completed: number; missed: number; upcoming: number; rate: number };
}

const SESSION_TYPES = ['easy', 'long', 'tempo', 'intervals', 'recovery', 'race', 'rest', 'strength', 'cross'];
const TYPE_TONE: Record<string, string> = {
  easy: 'text-emerald-300 border-emerald-800/60 bg-emerald-950/30',
  long: 'text-sky-300 border-sky-800/60 bg-sky-950/30',
  tempo: 'text-amber-300 border-amber-800/60 bg-amber-950/30',
  intervals: 'text-rose-300 border-rose-800/60 bg-rose-950/30',
  recovery: 'text-zinc-300 border-zinc-700 bg-zinc-900/60',
  race: 'text-orange-300 border-orange-800/60 bg-orange-950/30',
  rest: 'text-zinc-400 border-zinc-800 bg-zinc-950',
  strength: 'text-violet-300 border-violet-800/60 bg-violet-950/30',
  cross: 'text-cyan-300 border-cyan-800/60 bg-cyan-950/30',
};

interface DraftSession { date: string; type: string; title: string; targetDistanceKm: string }

const emptyDraft = (): DraftSession => ({
  date: new Date().toISOString().slice(0, 10),
  type: 'easy',
  title: '',
  targetDistanceKm: '',
});

export function StravaPlanPanel() {
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [goalRace, setGoalRace] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [drafts, setDrafts] = useState<DraftSession[]>([emptyDraft()]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fitness', 'plan-list', {});
    if (r.data?.ok) setPlans(r.data.result?.plans || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) { setError('Plan name is required.'); return; }
    const sessions = drafts
      .filter((d) => d.date)
      .map((d) => ({
        date: d.date,
        type: d.type,
        title: d.title.trim() || undefined,
        targetDistanceKm: Number(d.targetDistanceKm) || 0,
      }));
    if (sessions.length === 0) { setError('Add at least one session with a date.'); return; }
    setError(null);
    setBusy(true);
    const r = await lensRun('fitness', 'plan-create', {
      name: name.trim(),
      goalRace: goalRace.trim() || undefined,
      goalDate: goalDate || undefined,
      sessions,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not create plan'); return; }
    setName(''); setGoalRace(''); setGoalDate(''); setDrafts([emptyDraft()]);
    setShowForm(false);
    await refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await lensRun('fitness', 'plan-delete', { id });
    setBusy(false);
    await refresh();
  };

  const reschedule = async (planId: string) => {
    setBusy(true);
    const r = await lensRun('fitness', 'plan-reschedule', { planId, shiftDays: 1 });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Reschedule failed'); return; }
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <CalendarDays className="w-4 h-4 text-orange-400" />
          <span><span className="text-zinc-100 font-semibold">{plans.length}</span> training plan{plans.length === 1 ? '' : 's'}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
        >
          <Plus className="w-3.5 h-3.5" /> New plan
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showForm && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Plan name" value={name} onChange={(e) => setName(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Goal race (optional)" value={goalRace} onChange={(e) => setGoalRace(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          </div>
          <p className="text-[11px] text-zinc-400 pt-1">Sessions</p>
          {drafts.map((d, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_0.7fr_auto] gap-2 items-center">
              <input type="date" value={d.date}
                onChange={(e) => setDrafts(drafts.map((x, j) => j === i ? { ...x, date: e.target.value } : x))}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <select value={d.type}
                onChange={(e) => setDrafts(drafts.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                {SESSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="Title" value={d.title}
                onChange={(e) => setDrafts(drafts.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="km" inputMode="decimal" value={d.targetDistanceKm}
                onChange={(e) => setDrafts(drafts.map((x, j) => j === i ? { ...x, targetDistanceKm: e.target.value } : x))}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button aria-label="Delete" type="button"
                onClick={() => setDrafts(drafts.length > 1 ? drafts.filter((_, j) => j !== i) : drafts)}
                className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setDrafts([...drafts, emptyDraft()])}
              className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add session
            </button>
            <button type="button" onClick={create} disabled={busy}
              className="ml-auto flex items-center gap-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-3 py-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Create plan
            </button>
          </div>
        </div>
      )}

      {plans.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No training plans yet. Build a plan and track your sessions on a calendar.
        </div>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{p.name}</p>
                  {p.goalRace && (
                    <p className="text-[11px] text-zinc-400">
                      Goal: {p.goalRace}{p.goalDate ? ` · ${p.goalDate}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {p.adherence.missed > 0 && (
                    <button type="button" onClick={() => reschedule(p.id)} disabled={busy}
                      className="flex items-center gap-1 text-[11px] text-amber-300 hover:text-amber-200 disabled:opacity-50 border border-amber-800/60 rounded-lg px-2 py-1">
                      <RefreshCw className="w-3 h-3" /> Reschedule {p.adherence.missed} missed
                    </button>
                  )}
                  <button aria-label="Delete" type="button" onClick={() => remove(p.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {p.adherence.completed} done
                </span>
                <span className="text-rose-400 flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> {p.adherence.missed} missed
                </span>
                <span className="text-zinc-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {p.adherence.upcoming} upcoming
                </span>
                <span className="ml-auto text-zinc-300">{p.adherence.rate}% adherence</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full bg-orange-500" style={{ width: `${p.adherence.rate}%` }} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {p.sessions.map((s) => (
                  <div key={s.id}
                    className={cn('rounded-lg border px-2 py-1.5 text-[11px]', TYPE_TONE[s.type] || TYPE_TONE.easy)}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.date.slice(5)}</span>
                      {s.type === 'rest' ? <Bed className="w-3 h-3" />
                        : s.status === 'completed' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        : s.status === 'missed' ? <XCircle className="w-3 h-3 text-rose-400" />
                        : <Clock className="w-3 h-3 opacity-60" />}
                    </div>
                    <p className="capitalize truncate">{s.title || s.type}</p>
                    {s.targetDistanceKm > 0 && (
                      <p className="text-zinc-400">
                        {s.status === 'completed' && s.actualDistanceKm != null
                          ? `${Math.round(s.actualDistanceKm * 10) / 10}/${s.targetDistanceKm} km`
                          : `${s.targetDistanceKm} km`}
                      </p>
                    )}
                    {s.rescheduled && <p className="text-amber-400/80">moved</p>}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
