'use client';

/**
 * GoalsListPanel — personal goal tracker (artifact type "goal").
 * Owns hero stats, create form, filters, and goal cards.
 * Extracted from lenses/goals/page.tsx.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, CheckCircle2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { type Goal, GOALS_FALLBACK, daysUntil } from '@/components/goals/goals-model';

/** Dispatched by the Goals page chips; detail { weekly?: boolean }. */
export const GOALS_NEW_EVENT = 'concord:goals-new';

export function GoalsListPanel() {
  const [goalFilter, setGoalFilter] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState<Goal['category']>('Career');
  const [newTargetDate, setNewTargetDate] = useState('');
  const [newSubtasks, setNewSubtasks] = useState('');
  const [newXp] = useState(200); // XP still recorded on the goal; no picker in the north-star form
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

  const filteredGoals = useMemo(() => {
    if (goalFilter === 'Active') return goals.filter((g) => g.status === 'active');
    if (goalFilter === 'Completed') return goals.filter((g) => g.status === 'completed');
    return goals;
  }, [goals, goalFilter]);

  // Page chips ("Set a weekly focus") open the create form via this event.
  useEffect(() => {
    const open = (e: Event) => {
      const weekly = (e as CustomEvent<{ weekly?: boolean }>).detail?.weekly;
      if (weekly) {
        setNewTargetDate(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
        setNewCategory('Personal');
      }
      setShowCreate(true);
    };
    window.addEventListener(GOALS_NEW_EVENT, open);
    return () => window.removeEventListener(GOALS_NEW_EVENT, open);
  }, []);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="w-6 h-6 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
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

  const field = 'w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100 placeholder:text-zinc-500 focus:border-white/25 focus:outline-none';

  return (
    <div className="max-w-2xl space-y-3 pb-24">
      {/* Quiet filter — the dashboard (XP / level / streak) is gone per the north star. */}
      <div className="flex gap-4 text-[13px]">
        {['All', 'Active', 'Completed'].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setGoalFilter(f)}
            className={goalFilter === f ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}
            aria-pressed={goalFilter === f}
          >
            {f}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <input autoFocus type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="What do you want to achieve?" aria-label="Goal title" className={`${field} font-vault text-[18px]`} />
              <DraftedTextarea lensId="goals" draftKey="newDescription" initial="" onValueChange={setNewDescription} placeholder="What does success look like? (optional)" className={`${field} h-16 resize-none`} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Goal['category'])} className={field} aria-label="Category">
                  {['Career', 'Health', 'Learning', 'Creative', 'Financial', 'Personal'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as Goal['priority'])} className={field} aria-label="Priority">
                  <option value="low">Low priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="high">High priority</option>
                </select>
                <input type="date" value={newTargetDate} onChange={(e) => setNewTargetDate(e.target.value)} className={field} aria-label="Target date" />
              </div>
              <DraftedTextarea lensId="goals" draftKey="newSubtasks" initial="" onValueChange={setNewSubtasks} placeholder="Steps, one per line — progress follows them" className={`${field} h-16 resize-none`} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-3 py-2 text-[13px] text-zinc-400 hover:text-zinc-100">Cancel</button>
                <button type="button" onClick={handleCreateGoal} disabled={!newTitle || createGoalMutation.isPending} className="rounded-lg bg-teal-400 px-4 py-2 text-[13px] font-medium text-black hover:bg-teal-300 disabled:opacity-50">
                  {createGoalMutation.isPending ? 'Creating…' : 'Create goal'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {filteredGoals.map((goal, i) => {
        const isExpanded = expandedGoal === goal.id;
        const pct = Math.round(Math.min(goal.progress, 1) * 100);
        const bar = i % 2 === 1 ? 'bg-teal-400' : 'bg-violet-400';
        const pctCls = i % 2 === 1 ? 'text-teal-400' : 'text-violet-400';
        const dLeft = daysUntil(goal.targetDate);
        return (
          <div key={goal.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            <button
              type="button"
              onClick={() => setExpandedGoal(isExpanded ? null : goal.id)}
              className="w-full px-5 py-4 text-left"
              aria-expanded={isExpanded}
            >
              <div className="flex items-center gap-2">
                <h3 className="font-vault text-[19px] text-zinc-100">{goal.title}</h3>
                {goal.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-teal-400" aria-label="Completed" />}
              </div>
              <div className="mt-3 flex items-center gap-4">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <motion.div className={`h-full rounded-full ${bar}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
                </div>
                <span className={`w-12 text-[14px] ${pctCls}`}>{pct}%</span>
              </div>
            </button>
            <AnimatePresence>
              {isExpanded && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="space-y-1.5 border-t border-white/[0.06] px-5 py-4">
                    {goal.description && <p className="pb-1 text-[13px] text-zinc-400">{goal.description}</p>}
                    {goal.status === 'active' && goal.targetDate && (
                      <p className={`pb-1 text-[12px] ${dLeft <= 3 ? 'text-rose-400' : 'text-zinc-500'}`}>
                        {dLeft === 0 ? 'Due today' : dLeft < 0 ? `${-dLeft} day${dLeft !== -1 ? 's' : ''} overdue` : `${dLeft} day${dLeft !== 1 ? 's' : ''} left`}
                      </p>
                    )}
                    {goal.subtasks.map((st) => (
                      <button key={st.id} type="button" onClick={() => toggleSubtask(goal.id, st.id)} className="group flex w-full items-center gap-2 text-left text-[14px]">
                        <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${st.done ? 'border-teal-400 bg-teal-400/20 text-teal-300' : 'border-zinc-600 group-hover:border-zinc-400'}`}>
                          {st.done && <CheckCircle2 className="h-3 w-3" />}
                        </span>
                        <span className={st.done ? 'text-zinc-500 line-through' : 'text-zinc-300'}>{st.label}</span>
                      </button>
                    ))}
                    {goal.subtasks.length === 0 && <p className="text-[13px] text-zinc-500">No steps yet — progress moves when steps are checked off.</p>}
                    {goal.status === 'active' && (
                      <button type="button" onClick={() => completeGoalItem(goal.id)} className="mt-2 rounded-lg border border-teal-400/30 px-3 py-1.5 text-[13px] text-teal-300 hover:bg-teal-400/10">
                        Mark complete
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {filteredGoals.length === 0 && !showCreate && (
        <p className="py-8 text-[14px] text-zinc-500">{goals.length === 0 ? 'No goals yet.' : 'Nothing in this filter.'}</p>
      )}

      <button
        type="button"
        onClick={() => setShowCreate(true)}
        className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        aria-label="New goal"
      >
        <Plus className="h-4 w-4" />
        New goal
      </button>
    </div>
  );
}
