'use client';

/**
 * ProgressDashboard — gamification surface for vocabulary learning:
 * daily-goal progress, streak count, accumulated points, and mastery
 * badges. All values are real — points are earned by reviewing words
 * and answering quiz questions; streaks are computed from real daily
 * activity. Wires the linguistics.progress-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Flame, Star, Target, Award, Loader2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Badge { id: string; label: string; points: number; earned: boolean }
interface Stats {
  points: number;
  streak: number;
  longestStreak: number;
  dailyGoal: number;
  todayPoints: number;
  goalMet: boolean;
  goalProgress: number;
  badges: Badge[];
  nextBadge: { id: string; label: string; pointsNeeded: number } | null;
}

export function ProgressDashboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('20');

  const refresh = useCallback(async () => {
    const r = await lensRun<Stats>('linguistics', 'progress-stats', {});
    if (r.data?.ok && r.data.result) {
      setStats(r.data.result);
      setGoalInput(String(r.data.result.dailyGoal));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const saveGoal = useCallback(async () => {
    const goal = Number(goalInput);
    if (!Number.isFinite(goal) || goal < 5) return;
    const r = await lensRun('linguistics', 'progress-set-goal', { dailyGoal: goal });
    if (r.data?.ok) {
      setEditingGoal(false);
      await refresh();
    }
  }, [goalInput, refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }
  if (!stats) {
    return <p className="text-xs text-zinc-400 italic">No progress data yet — review a word to begin.</p>;
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Star className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Progress</h3>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-2 text-center">
          <Flame className={cn('w-4 h-4 mx-auto mb-0.5', stats.streak > 0 ? 'text-orange-400' : 'text-zinc-600')} />
          <p className="text-sm font-bold text-zinc-100">{stats.streak}</p>
          <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Day streak</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-2 text-center">
          <Star className="w-4 h-4 mx-auto mb-0.5 text-amber-400" />
          <p className="text-sm font-bold text-zinc-100">{stats.points}</p>
          <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Points</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-2 text-center">
          <Flame className="w-4 h-4 mx-auto mb-0.5 text-zinc-400" />
          <p className="text-sm font-bold text-zinc-100">{stats.longestStreak}</p>
          <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Best streak</p>
        </div>
      </div>

      {/* Daily goal */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2.5 mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-zinc-400 inline-flex items-center gap-1">
            <Target className="w-3 h-3" />
            Daily goal
          </span>
          {editingGoal ? (
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={5}
                max={500}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-xs text-zinc-200"
              />
              <button onClick={saveGoal} className="text-emerald-400 text-xs">save</button>
            </span>
          ) : (
            <button
              onClick={() => setEditingGoal(true)}
              className="text-[11px] text-zinc-300 hover:text-white"
            >
              {stats.todayPoints} / {stats.dailyGoal} pts
            </button>
          )}
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', stats.goalMet ? 'bg-emerald-500' : 'bg-amber-500')}
            style={{ width: `${stats.goalProgress}%` }}
          />
        </div>
        {stats.goalMet && (
          <p className="text-[10px] text-emerald-400 mt-1 inline-flex items-center gap-1">
            <Check className="w-3 h-3" />Daily goal reached
          </p>
        )}
      </div>

      {/* Badges */}
      <div>
        <p className="text-[11px] text-zinc-400 mb-1.5 inline-flex items-center gap-1">
          <Award className="w-3 h-3" />Mastery badges
        </p>
        <div className="flex flex-wrap gap-1.5">
          {stats.badges.map((b) => (
            <span
              key={b.id}
              title={`${b.points} points`}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border',
                b.earned
                  ? 'border-amber-600/50 bg-amber-900/30 text-amber-300'
                  : 'border-zinc-800 bg-zinc-900/40 text-zinc-600',
              )}
            >
              <Award className="w-2.5 h-2.5" />
              {b.label}
            </span>
          ))}
        </div>
        {stats.nextBadge && (
          <p className="text-[10px] text-zinc-400 mt-1.5">
            {stats.nextBadge.pointsNeeded} pts to <span className="text-zinc-300">{stats.nextBadge.label}</span>
          </p>
        )}
      </div>
    </div>
  );
}
