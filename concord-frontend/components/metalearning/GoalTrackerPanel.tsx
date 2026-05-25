'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Target, Plus, Loader2, Flag } from 'lucide-react';

interface CheckIn { at: string; value: number; note: string; }
interface Goal {
  id: string;
  title: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  deadline: string | null;
  status: string;
  progress: number;
  checkInCount: number;
  checkIns: CheckIn[];
}

export function GoalTrackerPanel() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [active, setActive] = useState(0);
  const [achieved, setAchieved] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState('');
  const [target, setTarget] = useState('100');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [checkInVal, setCheckInVal] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'goalList', {});
      if (r?.ok === false) { setErr(r.error || 'Failed to load goals'); return; }
      const res = r?.result || r;
      setGoals(res.goals || []);
      setActive(res.active || 0);
      setAchieved(res.achieved || 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load goals');
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!title.trim()) return;
    setBusy('create');
    try {
      const { data: r } = await lensRun<any>('metalearning', 'goalCreate', {
        title, metric, targetValue: Number(target) || 100, deadline: deadline || undefined,
      });
      if (r?.ok === false) { setErr(r.error || 'Failed to create goal'); return; }
      setTitle(''); setMetric(''); setTarget('100'); setDeadline(''); setShowForm(false);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create goal');
    } finally { setBusy(null); }
  };

  const checkIn = async (goalId: string) => {
    const raw = checkInVal[goalId];
    if (raw == null || raw === '') return;
    setBusy(goalId);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'goalCheckIn', { goalId, value: Number(raw) });
      if (r?.ok === false) { setErr(r.error || 'Check-in failed'); return; }
      setCheckInVal((p) => ({ ...p, [goalId]: '' }));
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Check-in failed');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Target className="w-4 h-4 text-yellow-400" /> Learning Goals
          <span className="text-xs text-gray-400 font-normal">
            {active} active · {achieved} achieved
          </span>
        </h3>
        <button onClick={() => setShowForm((s) => !s)}
          className="text-xs text-yellow-400 hover:underline flex items-center gap-1">
          <Plus className="w-3 h-3" /> {showForm ? 'Cancel' : 'New goal'}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}
      {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}

      {showForm && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Goal title" className="input-lattice w-full text-sm" />
          <div className="flex gap-2">
            <input value={metric} onChange={(e) => setMetric(e.target.value)}
              placeholder="Metric (e.g. cards mastered)" className="input-lattice flex-1 text-sm" />
            <input value={target} onChange={(e) => setTarget(e.target.value)}
              type="number" placeholder="Target" className="input-lattice w-24 text-sm" />
          </div>
          <input value={deadline} onChange={(e) => setDeadline(e.target.value)}
            type="date" className="input-lattice w-full text-sm" />
          <button onClick={create} disabled={!title.trim() || busy === 'create'}
            className="btn-neon text-sm w-full disabled:opacity-50">
            {busy === 'create' ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Create Goal'}
          </button>
        </div>
      )}

      {goals.length === 0 && !loading && (
        <p className="text-center py-6 text-gray-400 text-sm">No goals yet.</p>
      )}

      <div className="space-y-2">
        {goals.map((g) => (
          <div key={g.id} className="bg-lattice-surface rounded-lg p-3 border border-white/5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-1">
                {g.status === 'achieved' && <Flag className="w-3 h-3 text-neon-green" />}
                {g.title}
              </p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                g.status === 'achieved' ? 'bg-neon-green/15 text-neon-green'
                  : g.status === 'active' ? 'bg-neon-cyan/15 text-neon-cyan'
                    : 'bg-white/5 text-gray-400'
              }`}>{g.status}</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {g.currentValue} / {g.targetValue} {g.metric}
              {g.deadline && ` · by ${g.deadline}`}
            </p>
            <div className="h-1.5 bg-lattice-void rounded-full overflow-hidden mt-1.5">
              <div className="h-full bg-yellow-400 rounded-full transition-all"
                style={{ width: `${Math.min(100, g.progress * 100)}%` }} />
            </div>
            {g.status === 'active' && (
              <div className="flex gap-2 mt-2">
                <input type="number" value={checkInVal[g.id] || ''}
                  onChange={(e) => setCheckInVal((p) => ({ ...p, [g.id]: e.target.value }))}
                  placeholder="Current value"
                  className="input-lattice flex-1 text-xs" />
                <button onClick={() => checkIn(g.id)} disabled={busy === g.id}
                  className="btn-secondary text-xs px-2 disabled:opacity-50">
                  {busy === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check in'}
                </button>
              </div>
            )}
            {g.checkInCount > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">{g.checkInCount} check-in{g.checkInCount !== 1 ? 's' : ''}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
