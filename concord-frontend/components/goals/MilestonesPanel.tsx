'use client';

/**
 * MilestonesPanel — completed-goal timeline + deterministic badges.
 * Derived from real goal/challenge artifacts (no empty milestone artifact type).
 * Extracted from lenses/goals/page.tsx.
 */

import { useMemo } from 'react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { motion } from 'framer-motion';
import { CheckCircle2, Zap, Unlock, Calendar, Target } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import {
  type Goal,
  type Challenge,
  GOALS_FALLBACK,
  CHALLENGES_FALLBACK,
  categoryColors,
  resolveIcon,
} from '@/components/goals/goals-model';

export function MilestonesPanel() {
  const { isLoading, isError, error, refetch, items: goalItems } = useLensData<Record<string, unknown>>('goals', 'goal', {
    seed: GOALS_FALLBACK.map(g => ({ title: g.title, data: g as unknown as Record<string, unknown> })),
  });
  const { items: challengeItems } = useLensData<Record<string, unknown>>('goals', 'challenge', {
    seed: CHALLENGES_FALLBACK.map(c => ({ title: c.title, data: c as unknown as Record<string, unknown> })),
  });

  const goals = useMemo(
    () => goalItems.map(item => ({ id: item.id, ...item.data, completedAt: item.updatedAt } as unknown as Goal)),
    [goalItems]
  );
  const challenges = useMemo(() => challengeItems.map(item => ({ id: item.id, ...item.data } as unknown as Challenge)), [challengeItems]);

  const totalXp = useMemo(
    () => goals.filter((g) => g.status === 'completed').reduce((s, g) => s + g.xp, 0),
    [goals]
  );
  const completedGoals = useMemo(
    () => goals.filter((g) => g.status === 'completed').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
    [goals]
  );
  const acceptedChallengeCount = challenges.filter((c) => c.accepted).length;

  const streakDays = useMemo(() => {
    const days = new Set(completedGoals.filter((g) => g.completedAt).map((g) => g.completedAt!.slice(0, 10)));
    let streak = 0;
    const cursor = new Date();
    for (;;) {
      const key = cursor.toISOString().slice(0, 10);
      if (!days.has(key)) break;
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }, [completedGoals]);

  const badges = useMemo(() => {
    const categoriesCompleted = new Set(completedGoals.map((g) => g.category)).size;
    return [
      { id: 'first-steps', title: 'First Steps', description: 'Create your first goal.', icon: 'target', unlocked: goals.length >= 1 },
      { id: 'momentum', title: 'Momentum', description: 'Complete a goal.', icon: 'flame', unlocked: completedGoals.length >= 1 },
      { id: 'high-achiever', title: 'High Achiever', description: 'Complete 5 goals.', icon: 'trophy', unlocked: completedGoals.length >= 5 },
      { id: 'well-rounded', title: 'Well Rounded', description: 'Complete goals in 3+ categories.', icon: 'sparkles', unlocked: categoriesCompleted >= 3 },
      { id: 'on-a-roll', title: 'On a Roll', description: '3-day completion streak.', icon: 'zap', unlocked: streakDays >= 3 },
      { id: 'challenger', title: 'Challenger', description: 'Accept a challenge.', icon: 'award', unlocked: acceptedChallengeCount >= 1 },
    ];
  }, [goals.length, completedGoals, streakDays, acceptedChallengeCount]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <ErrorState error={error?.message} onRetry={() => { refetch(); }} />
      </div>
    );
  }

  return (
        <div className="space-y-6">
          {/* Badges — deterministic function of real counts, no fabricated
              unlock dates or server rarity. */}
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Badges</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {badges.map((b, i) => {
                const IconComp = resolveIcon(b.icon);
                return (
                  <motion.div
                    key={b.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className={`panel p-4 flex flex-col items-center text-center space-y-2 border ${
                      b.unlocked ? 'bg-cyan-500/10 border-cyan-500/20' : 'opacity-40 grayscale border-transparent'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${b.unlocked ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700/50 text-gray-600'}`}>
                      <IconComp className="w-5 h-5" />
                    </div>
                    <h4 className={`text-sm font-semibold ${b.unlocked ? 'text-white' : 'text-gray-400'}`}>{b.title}</h4>
                    <p className="text-[10px] text-gray-400 leading-tight">{b.description}</p>
                    {b.unlocked && (
                      <span className="text-[10px] text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Unlocked
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Completed-goal timeline */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Completed goals</h3>
              <div className="flex items-center gap-1 text-xs text-yellow-400">
                <Zap className="w-3 h-3" /> {totalXp.toLocaleString()} XP earned
              </div>
            </div>
            <div className="relative pl-8">
              <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gradient-to-b from-cyan-500/50 via-purple-500/50 to-transparent" />
              <div className="space-y-4">
                {completedGoals.map((g, i) => (
                  <motion.div key={g.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative">
                    <div className="absolute -left-8 top-3 w-6 h-6 rounded-full flex items-center justify-center border-2 bg-cyan-500/20 border-cyan-500 text-cyan-400">
                      <Unlock className="w-3 h-3" />
                    </div>
                    <div className="panel p-4 border-white/10">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-cyan-500/15">
                          <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-white">{g.title}</h3>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${categoryColors[g.category]}`}>{g.category}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {g.completedAt && (
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {new Date(g.completedAt).toLocaleDateString()}
                            </span>
                          )}
                          <span className="text-[10px] text-yellow-400 flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" /> +{g.xp} XP
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
                {completedGoals.length === 0 && (
                  <p className="text-sm text-gray-400 pl-1">No goals completed yet — mark one complete from the Goals tab to start your timeline.</p>
                )}
              </div>
            </div>
          </div>
        </div>
  );
}
