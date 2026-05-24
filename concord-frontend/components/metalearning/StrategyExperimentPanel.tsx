'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { FlaskConical, Plus, Loader2 } from 'lucide-react';

interface ArmStats { name: string; n: number; mean: number; stdDev: number; }
interface Experiment {
  id: string;
  title: string;
  hypothesis: string;
  status: string;
  strategyA: { name: string };
  strategyB: { name: string };
  summary: {
    armA: ArmStats;
    armB: ArmStats;
    winner: string | null;
    effectSize: number;
    confidence: string;
  };
}

export function StrategyExperimentPanel() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [strategyA, setStrategyA] = useState('');
  const [strategyB, setStrategyB] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [trial, setTrial] = useState<Record<string, { arm: string; score: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'experimentList', {});
      if (r?.ok === false) { setErr(r.error || 'Failed to load experiments'); return; }
      setExperiments((r?.result || r).experiments || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load experiments');
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!title.trim() || !strategyA.trim() || !strategyB.trim()) return;
    setBusy('create');
    try {
      const { data: r } = await lensRun<any>('metalearning', 'experimentCreate', {
        title, hypothesis, strategyA, strategyB,
      });
      if (r?.ok === false) { setErr(r.error || 'Failed to create experiment'); return; }
      setTitle(''); setHypothesis(''); setStrategyA(''); setStrategyB(''); setShowForm(false);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create experiment');
    } finally { setBusy(null); }
  };

  const recordTrial = async (experimentId: string) => {
    const t = trial[experimentId];
    if (!t || t.score === '') return;
    setBusy(experimentId);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'experimentRecordTrial', {
        experimentId, arm: t.arm || 'A', score: Number(t.score),
      });
      if (r?.ok === false) { setErr(r.error || 'Record trial failed'); return; }
      setTrial((p) => ({ ...p, [experimentId]: { arm: t.arm || 'A', score: '' } }));
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Record trial failed');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <FlaskConical className="w-4 h-4 text-neon-pink" /> Strategy A/B Experiments
          <span className="text-xs text-gray-400 font-normal">{experiments.length}</span>
        </h3>
        <button onClick={() => setShowForm((s) => !s)}
          className="text-xs text-neon-pink hover:underline flex items-center gap-1">
          <Plus className="w-3 h-3" /> {showForm ? 'Cancel' : 'New experiment'}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}
      {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}

      {showForm && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Experiment title" className="input-lattice w-full text-sm" />
          <input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)}
            placeholder="Hypothesis" className="input-lattice w-full text-sm" />
          <div className="flex gap-2">
            <input value={strategyA} onChange={(e) => setStrategyA(e.target.value)}
              placeholder="Strategy A" className="input-lattice flex-1 text-sm" />
            <input value={strategyB} onChange={(e) => setStrategyB(e.target.value)}
              placeholder="Strategy B" className="input-lattice flex-1 text-sm" />
          </div>
          <button onClick={create}
            disabled={!title.trim() || !strategyA.trim() || !strategyB.trim() || busy === 'create'}
            className="btn-neon text-sm w-full disabled:opacity-50">
            {busy === 'create' ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Create Experiment'}
          </button>
        </div>
      )}

      {experiments.length === 0 && !loading && (
        <p className="text-center py-6 text-gray-400 text-sm">No experiments yet.</p>
      )}

      <div className="space-y-3">
        {experiments.map((e) => {
          const s = e.summary;
          const t = trial[e.id] || { arm: 'A', score: '' };
          return (
            <div key={e.id} className="bg-lattice-surface rounded-lg p-3 border border-white/5">
              <p className="text-sm font-semibold">{e.title}</p>
              {e.hypothesis && <p className="text-xs text-gray-400">{e.hypothesis}</p>}
              <div className="grid grid-cols-2 gap-2 mt-2">
                {[s.armA, s.armB].map((arm, i) => (
                  <div key={i} className={`rounded p-2 border ${
                    s.winner === (i === 0 ? 'A' : 'B')
                      ? 'border-neon-green/40 bg-neon-green/5'
                      : 'border-white/5 bg-lattice-deep'
                  }`}>
                    <p className="text-xs font-medium text-gray-200">{i === 0 ? 'A' : 'B'}: {arm.name}</p>
                    <p className="text-[10px] text-gray-400">
                      n={arm.n} · μ={arm.mean} · σ={arm.stdDev}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Winner: <span className="text-neon-cyan">{s.winner || '—'}</span>
                {' · '}effect size {s.effectSize}
                {' · '}<span className="text-neon-purple">{s.confidence}</span>
              </p>
              <div className="flex gap-2 mt-2">
                <select value={t.arm}
                  onChange={(ev) => setTrial((p) => ({ ...p, [e.id]: { ...t, arm: ev.target.value } }))}
                  className="input-lattice text-xs w-16">
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
                <input type="number" value={t.score}
                  onChange={(ev) => setTrial((p) => ({ ...p, [e.id]: { ...t, score: ev.target.value } }))}
                  placeholder="Trial score"
                  className="input-lattice flex-1 text-xs" />
                <button onClick={() => recordTrial(e.id)} disabled={busy === e.id || t.score === ''}
                  className="btn-secondary text-xs px-2 disabled:opacity-50">
                  {busy === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Log trial'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
