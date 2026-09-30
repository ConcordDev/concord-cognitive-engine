'use client';

/**
 * GoalsListPanel — personal goal tracker (artifact type "goal").
 * Owns hero stats, create form, filters, and goal cards.
 * Extracted from lenses/goals/page.tsx.
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Target, Plus, CheckCircle2, Clock, Flame, Zap, Star, ChevronDown, ChevronUp,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import {
  type Goal,
  GOALS_FALLBACK,
  categoryColors,
  categoryDotColors,
  priorityFlame,
  daysUntil,
  getLevel,
  ProgressRing,
  XpLevelBar,
  WeeklyActivityBar,
} from '@/components/goals/goals-model';

export function GoalsListPanel() {
  const [goalFilter, setGoalFilter] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState<Goal['category']>('Career');
  const [newTargetDate, setNewTargetDate] = useState('');
  const [newSubtasks, setNewSubtasks] = useState('');
  const [newXp, setNewXp] = useState(200);
  const [newPriority, setNewPriority] = useState<Goal['priority']>('medium');

  const { isLoading, isError, error, refetch, items: goalItems, create: createGoalItem, update: updateGoalItem } = useLensData<Record<string, unknown>>('goals', 'goal', {
    seed: GOALS_FALLBACK.map(g => ({ title: g.title, data: g as unknown as Record<string, unknown> })),
  });

  const goals = useMemo(
    () => goalItems.map(item => ({ id: item.id, ...item.data, completedAt: item.updatedAt } as unknown as Goal)),
    [goalItems]
  );

  const createGoalMutation = useMutation({
    mutationFn: async () => {
      await createGoalItem({
        title: newTitle,
        data: {
          title: newTitle, description: newDescription, category: newCategory,
          progress: 0, priority: newPriority, targetDate: newTargetDate,
          subtasks: newSubtasks.split('\n').filter(Boolean).map((s, i) => ({ id: `st-${i}`, label: s, done: false })),
          xp: newXp, milestones: [], status: 'active',
        } as unknown as Record<string, unknown>,
      });
    },
    onSuccess: () => { setShowCreate(false); setNewTitle(''); setNewDescription(''); setNewSubtasks(''); },
    onError: (err) => {
      console.error('Failed to create goal:', err instanceof Error ? err.message : err);
    },
  });

  const totalXp = useMemo(
    () => goals.filter((g) => g.status === 'completed').reduce((s, g) => s + g.xp, 0),
    [goals]
  );
  const level = getLevel(totalXp);
  const completedGoals = useMemo(
    () => goals.filter((g) => g.status === 'completed').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
    [goals]
  );
  const completedThisMonth = useMemo(() => {
    const now = new Date();
    return completedGoals.filter((g) => {
      if (!g.completedAt) return false;
      const d = new Date(g.completedAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }, [completedGoals]);

  const overallProgress = useMemo(() => {
    const active = goals.filter((g) => g.status === 'active');
    if (!active.length) return 0;
    return active.reduce((s, g) => s + g.progress, 0) / active.length;
  }, [goals]);

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

  const filteredGoals = useMemo(() => {
    if (goalFilter === 'All') return goals;
    if (goalFilter === 'Active') return goals.filter((g) => g.status === 'active');
    if (goalFilter === 'Completed') return goals.filter((g) => g.status === 'completed');
    return goals.filter((g) => g.category === goalFilter);
  }, [goals, goalFilter]);

  const categoryBreakdown = useMemo(() => {
    const cats = ['Career', 'Health', 'Learning', 'Creative', 'Financial', 'Personal'] as const;
    return cats.map((cat) => ({
      name: cat,
      count: goals.filter((g) => g.category === cat).length,
      completed: goals.filter((g) => g.category === cat && g.status === 'completed').length,
    }));
  }, [goals]);

  const toggleSubtask = (goalId: string, subtaskId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    const updated = (goal.subtasks || []).map((st) =>
      st.id === subtaskId ? { ...st, done: !st.done } : st
    );
    const doneCount = updated.filter((st) => st.done).length;
    const progress = updated.length > 0 ? Math.round((doneCount / updated.length) * 100) / 100 : 0;
    updateGoalItem(goalId, { data: { ...goal, subtasks: updated, progress } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to update goal subtask:', err instanceof Error ? err.message : err));
  };

  const completeGoalItem = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    updateGoalItem(goalId, { data: { ...goal, status: 'completed', progress: 1 } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to complete goal:', err instanceof Error ? err.message : err));
  };

  const handleCreateGoal = () => { createGoalMutation.mutate(); };
  const filterPills = ['All', 'Active', 'Completed', 'Career', 'Health', 'Learning', 'Creative', 'Financial', 'Personal'];

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
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-1.5 bg-orange-500/15 text-orange-400 px-3 py-1.5 rounded-full text-sm font-semibold">
          <Flame className="w-4 h-4" />
          <span>{streakDays} day streak</span>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-neon purple flex items-center gap-1 text-sm"
        >
          <Plus className="w-3.5 h-3.5" /> New Goal
        </button>
      </div>

      {/* ---- Hero Stats Bar ---- */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="lens-card flex flex-col items-center justify-center col-span-1 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <ProgressRing radius={36} stroke={5} progress={overallProgress} size={72} color="#22d3ee" />
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-cyan-400">{Math.round(overallProgress * 100)}%</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">Overall Progress</p>
          {/* Milestone markers */}
          <div className="flex items-center gap-1 mt-1.5">
            {[25, 50, 75, 100].map((m) => (
              <motion.div
                key={m}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: m * 0.005, type: 'spring', stiffness: 300 }}
                className={`w-2 h-2 rounded-full ${Math.round(overallProgress * 100) >= m ? 'bg-cyan-400' : 'bg-white/10'}`}
                title={`${m}% milestone`}
              />
            ))}
          </div>
        </motion.div>
        {[
          { icon: Flame, iconCls: 'text-orange-400', value: streakDays, label: 'Day Streak', delay: 0.05, glow: 'from-orange-500/5' },
          { icon: CheckCircle2, iconCls: 'text-green-400', value: completedThisMonth, label: 'Completed', delay: 0.1, glow: 'from-green-500/5' },
          { icon: Zap, iconCls: 'text-yellow-400', value: totalXp.toLocaleString(), label: 'XP Earned', delay: 0.15, glow: 'from-yellow-500/5' },
        ].map((s) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: s.delay }} className="lens-card flex flex-col items-center justify-center relative overflow-hidden group" whileHover={{ scale: 1.02, y: -2 }}>
            <div className={`absolute inset-0 bg-gradient-to-br ${s.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity`} />
            <s.icon className={`w-6 h-6 ${s.iconCls} mb-1`} />
            <motion.p className="text-2xl font-bold text-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: s.delay + 0.2 }}>{s.value}</motion.p>
            <p className="text-xs text-gray-400">{s.label}</p>
          </motion.div>
        ))}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lens-card flex flex-col items-center justify-center relative overflow-hidden" whileHover={{ scale: 1.02 }}>
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <Star className="w-6 h-6 text-purple-400 mb-1" />
          <p className={`text-lg font-bold ${level.color}`}>{level.label}</p>
          <p className="text-xs text-gray-400">Level</p>
        </motion.div>
      </div>

      {/* XP Level Progress + Weekly Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-4 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Level Progress</p>
          <XpLevelBar xp={totalXp} />
        </div>
        <div className="panel p-4 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Weekly Activity</p>
          <WeeklyActivityBar goals={goals} />
        </div>
      </div>


      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="panel p-5 space-y-4">
              <h2 className="font-semibold text-white flex items-center gap-2"><Plus className="w-4 h-4 text-purple-400" /> Create New Goal</h2>
              <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Goal title..." className="input-lattice w-full" />
              <DraftedTextarea lensId="goals" draftKey="newDescription" initial="" onValueChange={setNewDescription} placeholder="Describe your goal and what success looks like..." className="input-lattice w-full h-16 resize-none" />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Goal['category'])} className="input-lattice">
                  {['Career', 'Health', 'Learning', 'Creative', 'Financial', 'Personal'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as Goal['priority'])} className="input-lattice">
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                </select>
                <input type="date" value={newTargetDate} onChange={(e) => setNewTargetDate(e.target.value)} className="input-lattice" />
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <input type="number" value={newXp} onChange={(e) => setNewXp(Number(e.target.value))} min={50} max={2000} step={50} className="input-lattice w-full" placeholder="XP" />
                </div>
                <button onClick={handleCreateGoal} disabled={!newTitle || createGoalMutation.isPending} className="btn-neon purple disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500">{createGoalMutation.isPending ? 'Creating...' : 'Create Goal'}</button>
              </div>
              <DraftedTextarea lensId="goals" draftKey="newSubtasks" initial="" onValueChange={setNewSubtasks} placeholder="Subtasks (one per line)..." className="input-lattice w-full h-16 resize-none text-sm" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

        <div className="space-y-4">
          {/* Category breakdown mini-bar */}
          <div className="flex gap-3 flex-wrap">
            {categoryBreakdown.map((cb) => (
              <div key={cb.name} className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className={`w-2 h-2 rounded-full ${categoryDotColors[cb.name]}`} />
                <span>{cb.name}</span>
                <span className="text-gray-600">
                  {cb.completed}/{cb.count}
                </span>
              </div>
            ))}
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap gap-2">
            {filterPills.map((f) => (
              <button
                key={f}
                onClick={() => setGoalFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  goalFilter === f
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Goal cards */}
          <div className="space-y-3">
            {filteredGoals.map((goal, i) => {
              const isExpanded = expandedGoal === goal.id;
              const dLeft = daysUntil(goal.targetDate);
              const subtasksDone = goal.subtasks.filter((st) => st.done).length;

              return (
                <motion.div
                  key={goal.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="panel p-4 space-y-3"
                >
                  <div className="flex items-start gap-4">
                    {/* Progress ring */}
                    <div className="relative flex-shrink-0">
                      <ProgressRing
                        radius={24}
                        stroke={4}
                        progress={goal.progress}
                        size={48}
                        color={goal.status === 'completed' ? '#4ade80' : '#a78bfa'}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
                        {Math.round(goal.progress * 100)}%
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white truncate">{goal.title}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${categoryColors[goal.category]}`}>
                          {goal.category}
                        </span>
                        <Flame className={`w-3.5 h-3.5 ${priorityFlame[goal.priority]}`} />
                        {goal.status === 'completed' && (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{goal.description}</p>

                      {/* Progress bar with milestone markers */}
                      <div className="relative mt-2 h-2 bg-white/10 rounded-full overflow-visible">
                        <motion.div
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(goal.progress * 100, 100)}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                        {goal.milestones.map((m) => (
                          <div
                            key={m}
                            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-white/40 bg-gray-800"
                            style={{ left: `${m}%` }}
                            title={`Milestone at ${m}%`}
                          />
                        ))}
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        {goal.status === 'active' && (
                          <span className={`flex items-center gap-1 ${dLeft <= 3 ? 'text-red-400' : ''}`}>
                            <Clock className="w-3 h-3" />
                            {dLeft === 0 ? 'Due today' : `${dLeft} day${dLeft !== 1 ? 's' : ''} left`}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-yellow-400">
                          <Zap className="w-3 h-3" />{goal.xp} XP
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {subtasksDone}/{goal.subtasks.length} tasks
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setExpandedGoal(isExpanded ? null : goal.id)}
                      className="text-gray-400 hover:text-gray-300 p-1 transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Expanded subtasks */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-white/5 pt-3 space-y-1.5">
                          {goal.subtasks.map((st) => (
                            <button
                              key={st.id}
                              onClick={() => toggleSubtask(goal.id, st.id)}
                              className="flex items-center gap-2 w-full text-left text-sm group"
                            >
                              <span
                                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                  st.done
                                    ? 'bg-green-500/30 border-green-500 text-green-400'
                                    : 'border-gray-600 group-hover:border-gray-400'
                                }`}
                              >
                                {st.done && <CheckCircle2 className="w-3 h-3" />}
                              </span>
                              <span className={st.done ? 'text-gray-400 line-through' : 'text-gray-300'}>
                                {st.label}
                              </span>
                            </button>
                          ))}
                          {goal.status === 'active' && (
                            <button
                              onClick={() => completeGoalItem(goal.id)}
                              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/20"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Mark Complete (+{goal.xp} XP)
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}

            {filteredGoals.length === 0 && (
              <div className="panel p-12 text-center text-gray-400">
                <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No goals match this filter.</p>
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
