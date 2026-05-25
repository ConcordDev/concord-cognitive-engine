'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Loader2, Radio, Calendar, LogIn, LogOut, Play, Square } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Cohort {
  id: string; title: string; instructor: string; courseId: string | null;
  scheduledAt: string; durationMin: number; capacity: number;
  status: 'scheduled' | 'live' | 'ended'; roster: string[]; agenda: string;
}

const STATUS_STYLE: Record<Cohort['status'], string> = {
  scheduled: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  live: 'bg-red-500/15 text-red-300 border-red-500/30',
  ended: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

/**
 * Live cohort / classroom sessions with an instructor. Learners
 * join/leave the roster; the instructor transitions a session
 * scheduled -> live -> ended.
 */
export function LiveCohorts() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: '', instructor: '', scheduledAt: '', durationMin: '60', capacity: '30', agenda: '',
  });
  const [learnerName, setLearnerName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('education', 'cohorts-list', {});
      if (r.data?.ok) setCohorts((r.data.result as { cohorts: Cohort[] }).cohorts || []);
    } catch (e) { console.error('[Cohorts] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    if (!form.title.trim() || !form.instructor.trim()) return;
    try {
      const r = await lensRun('education', 'cohorts-create', {
        title: form.title.trim(),
        instructor: form.instructor.trim(),
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
        durationMin: Number(form.durationMin) || 60,
        capacity: Number(form.capacity) || 30,
        agenda: form.agenda.trim(),
      });
      if (r.data?.ok) {
        setForm({ title: '', instructor: '', scheduledAt: '', durationMin: '60', capacity: '30', agenda: '' });
        setCreating(false);
        await refresh();
      }
    } catch (e) { console.error('[Cohorts] create failed', e); }
  }

  async function action(act: string, input: Record<string, unknown>) {
    try {
      const r = await lensRun('education', act, input);
      if (r.data?.ok) await refresh();
      else if (r.data?.error) console.warn('[Cohorts]', act, r.data.error);
    } catch (e) { console.error('[Cohorts] action failed', e); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <Users className="w-4 h-4 text-purple-400" /> Live cohorts
        </h3>
        <button
          onClick={() => setCreating(c => !c)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold"
        >
          <Plus className="w-3.5 h-3.5" /> {creating ? 'Cancel' : 'New session'}
        </button>
      </div>

      {creating && (
        <div className="panel p-4 space-y-3 border border-purple-500/20 rounded-lg">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Session title"
              className="px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white"
            />
            <input
              value={form.instructor} onChange={e => setForm(f => ({ ...f, instructor: e.target.value }))}
              placeholder="Instructor name"
              className="px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white"
            />
            <input
              type="datetime-local"
              value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
              className="px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
            />
            <div className="flex gap-2">
              <input
                type="number" min={1} value={form.durationMin}
                onChange={e => setForm(f => ({ ...f, durationMin: e.target.value }))}
                placeholder="Duration (min)"
                className="flex-1 px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
              />
              <input
                type="number" min={1} value={form.capacity}
                onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                placeholder="Capacity"
                className="flex-1 px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
              />
            </div>
          </div>
          <textarea
            value={form.agenda} onChange={e => setForm(f => ({ ...f, agenda: e.target.value }))}
            rows={2} placeholder="Agenda (optional)"
            className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white resize-none"
          />
          <button
            onClick={create}
            disabled={!form.title.trim() || !form.instructor.trim()}
            className="text-xs px-3 py-1.5 rounded bg-purple-500 text-white font-bold disabled:opacity-40"
          >
            Schedule session
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-gray-400">Join as</label>
        <input
          value={learnerName} onChange={e => setLearnerName(e.target.value)}
          placeholder="Your name (blank = your account)"
          className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs text-white w-56"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-6">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sessions…
        </div>
      ) : cohorts.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No live sessions scheduled yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cohorts.map(c => (
            <div key={c.id} className="panel p-4 space-y-3 border border-white/10 rounded-lg">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-white truncate">{c.title}</h4>
                  <p className="text-[11px] text-gray-400">Instructor: {c.instructor}</p>
                </div>
                <span className={cn('text-[10px] px-2 py-0.5 rounded border font-bold uppercase shrink-0 flex items-center gap-1', STATUS_STYLE[c.status])}>
                  {c.status === 'live' && <Radio className="w-2.5 h-2.5" />}
                  {c.status}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(c.scheduledAt).toLocaleString()}
                </span>
                <span>{c.durationMin} min</span>
                <span>{c.roster.length}/{c.capacity} seats</span>
              </div>
              {c.agenda && <p className="text-xs text-gray-400">{c.agenda}</p>}
              {c.roster.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {c.roster.map((r, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{r}</span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {c.status !== 'ended' && (
                  <>
                    <button
                      onClick={() => action('cohorts-join', { id: c.id, learner: learnerName.trim() || undefined })}
                      disabled={c.roster.length >= c.capacity}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-neon-green/20 text-neon-green border border-neon-green/30 font-bold disabled:opacity-40"
                    >
                      <LogIn className="w-3 h-3" /> Join
                    </button>
                    <button
                      onClick={() => action('cohorts-leave', { id: c.id, learner: learnerName.trim() || undefined })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border border-white/10 text-gray-400 hover:bg-white/5"
                    >
                      <LogOut className="w-3 h-3" /> Leave
                    </button>
                  </>
                )}
                {c.status === 'scheduled' && (
                  <button
                    onClick={() => action('cohorts-set-status', { id: c.id, status: 'live' })}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-red-500/20 text-red-300 border border-red-500/30 font-bold"
                  >
                    <Play className="w-3 h-3" /> Go live
                  </button>
                )}
                {c.status === 'live' && (
                  <button
                    onClick={() => action('cohorts-set-status', { id: c.id, status: 'ended' })}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-gray-500/20 text-gray-300 border border-gray-500/30 font-bold"
                  >
                    <Square className="w-3 h-3" /> End session
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LiveCohorts;
