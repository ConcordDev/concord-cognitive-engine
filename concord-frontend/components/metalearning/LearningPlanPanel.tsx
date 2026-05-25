'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Map as MapIcon, Plus, Loader2, CheckSquare, Square, Clock } from 'lucide-react';

interface PlanStep {
  id: string;
  order: number;
  name: string;
  estimatedHours: number;
  milestone: string;
  done: boolean;
}
interface Plan {
  id: string;
  title: string;
  goal: string;
  topics: PlanStep[];
  progress: number;
  stepsDone: number;
  stepsTotal: number;
  totalHours: number;
  remainingHours: number;
}

export function LearningPlanPanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [topicsRaw, setTopicsRaw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'planList', {});
      if (r?.ok === false) { setErr(r.error || 'Failed to load plans'); return; }
      setPlans((r?.result || r).plans || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load plans');
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!title.trim()) return;
    // Each line: "Topic name | hours | milestone"
    const topics = topicsRaw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, hours, milestone] = l.split('|').map((p) => p.trim());
      return { name, estimatedHours: Number(hours) || 4, milestone: milestone || '' };
    });
    setBusy('create');
    try {
      const { data: r } = await lensRun<any>('metalearning', 'planCreate', { title, goal, topics });
      if (r?.ok === false) { setErr(r.error || 'Failed to create plan'); return; }
      setTitle(''); setGoal(''); setTopicsRaw(''); setShowForm(false);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create plan');
    } finally { setBusy(null); }
  };

  const toggle = async (planId: string, stepId: string) => {
    setBusy(stepId);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'planToggleStep', { planId, stepId });
      if (r?.ok === false) { setErr(r.error || 'Toggle failed'); return; }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Toggle failed');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <MapIcon className="w-4 h-4 text-neon-purple" /> Learning Plans
          <span className="text-xs text-gray-400 font-normal">{plans.length}</span>
        </h3>
        <button onClick={() => setShowForm((s) => !s)}
          className="text-xs text-neon-purple hover:underline flex items-center gap-1">
          <Plus className="w-3 h-3" /> {showForm ? 'Cancel' : 'New plan'}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}
      {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}

      {showForm && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Plan title" className="input-lattice w-full text-sm" />
          <input value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal / outcome" className="input-lattice w-full text-sm" />
          <textarea value={topicsRaw} onChange={(e) => setTopicsRaw(e.target.value)}
            rows={4} placeholder="One topic per line — name | hours | milestone"
            className="input-lattice w-full text-sm font-mono" />
          <button onClick={create} disabled={!title.trim() || busy === 'create'}
            className="btn-neon purple text-sm w-full disabled:opacity-50">
            {busy === 'create' ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Create Plan'}
          </button>
        </div>
      )}

      {plans.length === 0 && !loading && (
        <p className="text-center py-6 text-gray-400 text-sm">No learning plans yet.</p>
      )}

      <div className="space-y-3">
        {plans.map((p) => (
          <div key={p.id} className="bg-lattice-surface rounded-lg p-3 border border-white/5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{p.title}</p>
              <span className="text-[10px] text-gray-400">
                {p.stepsDone}/{p.stepsTotal} · {p.remainingHours}h left
              </span>
            </div>
            {p.goal && <p className="text-xs text-gray-400 mt-0.5">{p.goal}</p>}
            <div className="h-1.5 bg-lattice-void rounded-full overflow-hidden mt-2">
              <div className="h-full bg-neon-purple rounded-full transition-all"
                style={{ width: `${p.progress * 100}%` }} />
            </div>
            <div className="space-y-1 mt-2">
              {p.topics.map((t) => (
                <button key={t.id} onClick={() => toggle(p.id, t.id)} disabled={busy === t.id}
                  className="flex items-start gap-2 w-full text-left hover:bg-white/5 rounded px-1 py-0.5 disabled:opacity-50">
                  {t.done
                    ? <CheckSquare className="w-3.5 h-3.5 text-neon-green flex-shrink-0 mt-0.5" />
                    : <Square className="w-3.5 h-3.5 text-gray-600 flex-shrink-0 mt-0.5" />}
                  <span className="flex-1 min-w-0">
                    <span className={`text-xs ${t.done ? 'line-through text-gray-600' : 'text-gray-300'}`}>
                      {t.order}. {t.name}
                    </span>
                    {t.milestone && (
                      <span className="block text-[10px] text-neon-cyan">🏁 {t.milestone}</span>
                    )}
                  </span>
                  <span className="text-[10px] text-gray-400 flex items-center gap-0.5 flex-shrink-0">
                    <Clock className="w-2.5 h-2.5" />{t.estimatedHours}h
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
