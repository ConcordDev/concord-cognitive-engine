'use client';

/**
 * GoalsPanel — per-metric goals with progress rings. Calls self.goals
 * to read current rings, self.setGoal to create/update, self.removeGoal
 * to clear. Each ring shows live progress computed server-side from the
 * real reading ledger. No seed data.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Target, Plus, X, Check } from 'lucide-react';

interface Ring {
  metric: string;
  label: string;
  unit: string;
  period: 'daily' | 'weekly';
  target: number;
  current: number;
  percent: number;
  met: boolean;
}
interface AvailableMetric { label: string; unit: string }

export function GoalsPanel({ refreshKey }: { refreshKey: number }) {
  const [rings, setRings] = useState<Ring[]>([]);
  const [available, setAvailable] = useState<Record<string, AvailableMetric>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [metric, setMetric] = useState('steps');
  const [target, setTarget] = useState('');
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await lensRun<{ goals: Ring[]; available: Record<string, AvailableMetric> }>('self', 'goals', {});
      if (r.data?.ok && r.data.result) {
        setRings(r.data.result.goals ?? []);
        setAvailable(r.data.result.available ?? {});
      }
    } catch { /* surfaced by empty state */ }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const submit = async () => {
    setErr(null);
    const num = Number(target);
    if (!Number.isFinite(num) || num <= 0) { setErr('Enter a positive target'); return; }
    try {
      const r = await lensRun('self', 'setGoal', { metric, target: num, period });
      if (r.data?.ok) { setAdding(false); setTarget(''); void load(); }
      else setErr(r.data?.error ?? 'Failed');
    } catch { setErr('Network error'); }
  };

  const remove = async (m: string) => {
    try {
      const r = await lensRun('self', 'removeGoal', { metric: m });
      if (r.data?.ok) void load();
    } catch { /* no-op */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-rose-200">
          <Target className="h-4 w-4 text-rose-500" aria-hidden /> Goals
        </h3>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded border border-rose-900/40 px-2 py-1 text-xs text-rose-300 hover:text-rose-100"
        >
          <Plus className="h-3 w-3" /> {adding ? 'Cancel' : 'Add goal'}
        </button>
      </div>

      {adding && (
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="rounded border border-rose-900/40 bg-black px-2 py-1.5 text-sm text-rose-100"
              aria-label="Goal metric"
            >
              {Object.entries(available).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <input
              type="number"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="target"
              className="w-28 rounded border border-rose-900/40 bg-black px-2 py-1.5 text-sm text-rose-100 placeholder:text-rose-800"
              aria-label="Target value"
            />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as 'daily' | 'weekly')}
              className="rounded border border-rose-900/40 bg-black px-2 py-1.5 text-sm text-rose-100"
              aria-label="Goal period"
            >
              <option value="daily">per day</option>
              <option value="weekly">per week</option>
            </select>
            <button
              onClick={() => void submit()}
              className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500"
            >
              Save
            </button>
          </div>
          {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
        </div>
      )}

      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
      ) : rings.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {rings.map((g) => (
            <div key={g.metric} className="relative rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
              <button
                onClick={() => void remove(g.metric)}
                className="absolute right-1.5 top-1.5 text-rose-800 hover:text-rose-400"
                aria-label={`Remove ${g.label} goal`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <ProgressRing percent={g.percent} met={g.met} />
              <div className="mt-2 text-sm font-medium text-rose-200">{g.label}</div>
              <div className="text-[11px] text-rose-700">
                {g.current} / {g.target}{g.unit} · {g.period}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded border border-rose-900/30 bg-rose-950/10 px-4 py-8 text-center text-xs text-rose-600">
          No goals set yet. Add a goal to track progress against a daily or weekly target.
        </p>
      )}
    </div>
  );
}

function ProgressRing({ percent, met }: { percent: number; met: boolean }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, percent) / 100) * circ;
  return (
    <div className="relative h-[68px] w-[68px]">
      <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
        <circle cx="34" cy="34" r={r} fill="none" stroke="#4c0519" strokeWidth="7" />
        <circle
          cx="34" cy="34" r={r} fill="none"
          stroke={met ? '#34d399' : '#fb7185'}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {met
          ? <Check className="h-5 w-5 text-emerald-400" aria-label="Goal met" />
          : <span className="font-mono text-sm font-semibold text-rose-200">{percent}%</span>}
      </div>
    </div>
  );
}
