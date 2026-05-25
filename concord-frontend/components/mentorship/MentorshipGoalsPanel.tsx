'use client';

/**
 * MentorshipGoalsPanel — shared goal-tracking workspace. Create goals with a
 * target date, log progress check-ins, and watch a rollup chart. All data
 * from `mentorship` macros: goal-create, goal-checkin, goal-list.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Target, Plus, X, CheckCircle2, ChevronLeft, MessageSquarePlus,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { cn } from '@/lib/utils';

interface CheckIn { id: string; note: string; progress: number; at: string }
interface MentorshipGoal {
  id: string;
  partnerId: string;
  title: string;
  detail: string;
  targetDate: string;
  progress: number;
  status: 'active' | 'done' | 'paused';
  checkIns: CheckIn[];
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'text-neon-cyan bg-neon-cyan/10',
  done: 'text-neon-green bg-neon-green/10',
  paused: 'text-zinc-400 bg-zinc-400/10',
};

export function MentorshipGoalsPanel() {
  const [goals, setGoals] = useState<MentorshipGoal[]>([]);
  const [summary, setSummary] = useState({ count: 0, active: 0, done: 0, avgProgress: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', detail: '', targetDate: '', partnerId: '' });

  const [selected, setSelected] = useState<MentorshipGoal | null>(null);
  const [checkInDraft, setCheckInDraft] = useState({ note: '', progress: 0 });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mentorship', 'goal-list', {});
    if (r.data?.ok === false) { setError(r.data.error || 'Failed to load goals.'); }
    else {
      const res = r.data?.result || {};
      setGoals(res.goals || []);
      setSummary({ count: res.count || 0, active: res.active || 0, done: res.done || 0, avgProgress: res.avgProgress || 0 });
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.title.trim()) { setError('Goal title is required.'); return; }
    setBusy(true);
    const r = await lensRun('mentorship', 'goal-create', {
      title: form.title, detail: form.detail, targetDate: form.targetDate, partnerId: form.partnerId,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Create failed.'); return; }
    setShowCreate(false);
    setForm({ title: '', detail: '', targetDate: '', partnerId: '' });
    void refresh();
  };

  const checkIn = async () => {
    if (!selected) return;
    setBusy(true);
    const r = await lensRun('mentorship', 'goal-checkin', {
      goalId: selected.id, note: checkInDraft.note, progress: checkInDraft.progress,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Check-in failed.'); return; }
    if (r.data?.result?.goal) setSelected(r.data.result.goal as MentorshipGoal);
    setCheckInDraft({ note: '', progress: 0 });
    void refresh();
  };

  const setStatus = async (status: 'active' | 'paused' | 'done') => {
    if (!selected) return;
    setBusy(true);
    const r = await lensRun('mentorship', 'goal-checkin', { goalId: selected.id, status });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Update failed.'); return; }
    if (r.data?.result?.goal) setSelected(r.data.result.goal as MentorshipGoal);
    void refresh();
  };

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
          <ChevronLeft className="w-4 h-4" /> Back to goals
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{selected.title}</h3>
            <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_STYLE[selected.status])}>{selected.status}</span>
          </div>
          {selected.detail && <p className="text-sm text-zinc-300">{selected.detail}</p>}
          {selected.targetDate && <p className="text-xs text-zinc-400">Target: {selected.targetDate}</p>}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 bg-lattice-deep rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full', selected.progress >= 80 ? 'bg-neon-green' : selected.progress >= 40 ? 'bg-neon-cyan' : 'bg-amber-400')} style={{ width: `${selected.progress}%` }} />
            </div>
            <span className="text-xs font-mono text-zinc-300 w-10 text-right">{selected.progress}%</span>
          </div>
          <div className="flex gap-2">
            {(['active', 'paused', 'done'] as const).map((st) => (
              <button key={st} onClick={() => setStatus(st)} disabled={busy || selected.status === st}
                className={cn('text-xs px-2 py-1 rounded border transition-colors',
                  selected.status === st ? 'border-neon-cyan text-neon-cyan' : 'border-zinc-700 text-zinc-400 hover:text-white')}>
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Progress chart from check-ins */}
        {selected.checkIns.length > 0 && (
          <div className="panel p-4">
            <h4 className="font-semibold text-sm mb-2">Progress trend</h4>
            <ChartKit
              kind="area"
              xKey="step"
              data={selected.checkIns.map((c, i) => ({ step: `#${i + 1}`, progress: c.progress }))}
              series={[{ key: 'progress', label: 'Progress %' }]}
            />
          </div>
        )}

        {/* Check-ins */}
        <div className="panel p-4 space-y-2">
          <h4 className="font-semibold text-sm flex items-center gap-2"><MessageSquarePlus className="w-4 h-4 text-neon-blue" /> Check-ins</h4>
          {selected.checkIns.length === 0 ? (
            <p className="text-xs text-zinc-400">No check-ins yet.</p>
          ) : selected.checkIns.slice().reverse().map((c) => (
            <div key={c.id} className="lens-card text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">{c.note}</span>
                <span className="text-xs text-neon-cyan font-mono">{c.progress}%</span>
              </div>
              <p className="text-[10px] text-zinc-400">{new Date(c.at).toLocaleString()}</p>
            </div>
          ))}
          <div className="border-t border-zinc-800 pt-2 space-y-2">
            <input value={checkInDraft.note} onChange={(e) => setCheckInDraft((p) => ({ ...p, note: e.target.value }))} placeholder="What progress did you make?" className="input-lattice w-full" />
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={100} value={checkInDraft.progress} onChange={(e) => setCheckInDraft((p) => ({ ...p, progress: Number(e.target.value) }))} className="flex-1" />
              <span className="text-xs font-mono text-zinc-300 w-10">{checkInDraft.progress}%</span>
              <button onClick={checkIn} disabled={busy} className="btn-neon text-xs">
                {busy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Log'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-neon-green" /> Goal Workspace</h3>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon text-sm">
          {showCreate ? <X className="w-4 h-4 inline" /> : <Plus className="w-4 h-4 inline" />} {showCreate ? 'Cancel' : 'New goal'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {showCreate && (
        <div className="panel p-4 space-y-2">
          <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Goal title *" className="input-lattice w-full" />
          <textarea value={form.detail} onChange={(e) => setForm((p) => ({ ...p, detail: e.target.value }))} placeholder="Detail" rows={2} className="input-lattice w-full" />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={form.targetDate} onChange={(e) => setForm((p) => ({ ...p, targetDate: e.target.value }))} className="input-lattice" />
            <input value={form.partnerId} onChange={(e) => setForm((p) => ({ ...p, partnerId: e.target.value }))} placeholder="Partner ID (optional)" className="input-lattice" />
          </div>
          <button onClick={create} disabled={busy} className="btn-neon green w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Create goal'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: summary.count, color: 'text-neon-blue' },
          { label: 'Active', value: summary.active, color: 'text-neon-cyan' },
          { label: 'Avg progress', value: `${summary.avgProgress}%`, color: 'text-neon-green' },
        ].map((s) => (
          <div key={s.label} className="lens-card text-center">
            <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
            <p className="text-xs text-zinc-400">{s.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
      ) : goals.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-8">No goals yet. Create one to start tracking.</p>
      ) : (
        <div className="space-y-2">
          {goals.map((g) => (
            <button key={g.id} onClick={() => { setSelected(g); setCheckInDraft({ note: '', progress: g.progress }); }} className="lens-card text-left w-full hover:border-neon-green transition-colors">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm flex items-center gap-1.5">
                  {g.status === 'done' && <CheckCircle2 className="w-4 h-4 text-neon-green" />}
                  {g.title}
                </span>
                <span className={cn('text-[10px] px-2 py-0.5 rounded', STATUS_STYLE[g.status])}>{g.status}</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', g.progress >= 80 ? 'bg-neon-green' : g.progress >= 40 ? 'bg-neon-cyan' : 'bg-amber-400')} style={{ width: `${g.progress}%` }} />
                </div>
                <span className="text-[10px] font-mono text-zinc-400">{g.progress}%</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
