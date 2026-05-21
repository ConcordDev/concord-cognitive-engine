'use client';

/**
 * MacroGoalRings — daily calorie + macro goal tracking with progress
 * rings. Goals set via food.nutrition-goal-set; the day's consumed totals
 * come from food.nutrition-day-summary which aggregates the real
 * nutrition log against the goal. No sample data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Target, Loader2, Save, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Goal {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface MacroProgress {
  consumed: number;
  goal: number;
  pct: number;
  remaining: number;
}

interface DaySummary {
  date: string;
  entryCount: number;
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  goal: Goal | null;
  progress: {
    calories: MacroProgress;
    protein_g: MacroProgress;
    carbs_g: MacroProgress;
    fat_g: MacroProgress;
  } | null;
}

const RING = [
  { key: 'calories' as const, label: 'Calories', unit: '', color: '#f97316' },
  { key: 'protein_g' as const, label: 'Protein', unit: 'g', color: '#3b82f6' },
  { key: 'carbs_g' as const, label: 'Carbs', unit: 'g', color: '#eab308' },
  { key: 'fat_g' as const, label: 'Fat', unit: 'g', color: '#ef4444' },
];

function Ring({ pct, color, size = 96 }: { pct: number; color: string; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (clamped / 100) * c}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
}

export function MacroGoalRings({ refreshKey = 0 }: { refreshKey?: number }) {
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Goal>({ calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 });
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<DaySummary>('food', 'nutrition-day-summary', { date: today });
      if (r.data?.ok && r.data.result) {
        setSummary(r.data.result);
        if (r.data.result.goal) setForm(r.data.result.goal);
      }
    } catch (e) {
      console.error('[MacroGoalRings] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function saveGoal() {
    setError(null);
    try {
      const r = await lensRun('food', 'nutrition-goal-set', { ...form });
      if (r.data?.ok) { setEditing(false); await load(); }
      else setError(r.data?.error || 'Failed to save goal');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save goal');
    }
  }

  if (loading) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg p-6 flex items-center justify-center text-xs text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading goals…
      </div>
    );
  }

  const hasGoal = !!summary?.goal;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Target className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Daily Macro Goals</span>
        <span className="ml-auto text-[10px] text-gray-500">
          {summary?.entryCount ? `${summary.entryCount} logged today` : 'nothing logged yet'}
        </span>
        <button
          onClick={() => setEditing((v) => !v)}
          className="text-[10px] px-2 py-0.5 rounded text-cyan-300 hover:bg-cyan-500/10"
        >
          {hasGoal ? 'Edit goals' : 'Set goals'}
        </button>
      </header>

      {editing && (
        <div className="p-3 border-b border-white/10 grid grid-cols-2 gap-2 text-xs">
          {RING.map((m) => (
            <label key={m.key} className="flex flex-col gap-1">
              <span className="text-gray-400">{m.label}{m.unit ? ` (${m.unit})` : ' (kcal)'}</span>
              <input
                type="number" min={0}
                value={form[m.key]}
                onChange={(e) => setForm((f) => ({ ...f, [m.key]: Number(e.target.value) || 0 }))}
                className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white"
              />
            </label>
          ))}
          {error && (
            <div className="col-span-2 flex items-center gap-1.5 text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </div>
          )}
          <button
            onClick={saveGoal}
            className="col-span-2 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 flex items-center justify-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" /> Save goals
          </button>
        </div>
      )}

      <div className="p-3">
        {!hasGoal && !editing ? (
          <div className="py-8 text-center text-xs text-gray-500">
            <Target className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No goals set yet. Set your daily calorie and macro targets to track progress.
          </div>
        ) : summary?.progress ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {RING.map((m) => {
              const p = summary.progress![m.key];
              const over = p.pct > 100;
              return (
                <div key={m.key} className="flex flex-col items-center">
                  <div className="relative">
                    <Ring pct={p.pct} color={over ? '#ef4444' : m.color} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-sm font-bold text-white">{Math.round(p.pct)}%</span>
                      <span className="text-[9px] text-gray-500">{m.label}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 text-center">
                    <div className="text-xs text-white">
                      {p.consumed}<span className="text-gray-600"> / {p.goal}{m.unit}</span>
                    </div>
                    <div className={cn('text-[10px]', p.remaining < 0 ? 'text-red-400' : 'text-gray-500')}>
                      {p.remaining < 0 ? `${Math.abs(p.remaining)}${m.unit} over` : `${p.remaining}${m.unit} left`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MacroGoalRings;
