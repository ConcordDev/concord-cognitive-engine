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
import { Plus, CheckCircle2, Pencil, Trash2, Target } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { KeepRecordActions } from '@/components/lens/KeepRecordActions';
import { goalKeepRecord } from '@/components/lens/recordKeep';
import { type Goal, GOALS_FALLBACK, daysUntil, completionRecord } from '@/components/goals/goals-model';

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
  // S1 lifecycle state (F1): inline edit form + two-step delete + undo.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState<Goal['category']>('Career');
  const [editPriority, setEditPriority] = useState<Goal['priority']>('medium');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [editSteps, setEditSteps] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [undoGoal, setUndoGoal] = useState<{ title: string; data: Record<string, unknown> } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [showFocusPicker, setShowFocusPicker] = useState(false);

  const { isLoading, isError, error, refetch, items: goalItems, create: createGoalItem, update: updateGoalItem, remove: removeGoalItem } = useLensData<Record<string, unknown>>('goals', 'goal', {
    seed: GOALS_FALLBACK.map(g => ({ title: g.title, data: g as unknown as Record<string, unknown> })),
  });

  const goals = useMemo(
    () => goalItems.map(item => ({ id: item.id, ...item.data, createdAt: item.createdAt, completedAt: item.updatedAt } as unknown as Goal)),
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
        // S13 (F14): "Set a weekly focus" opens the focus picker — a
        // real control — not the create form wearing a due date.
        setShowFocusPicker(true);
        return;
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

  // S13 (F14/§3b 4): the weekly focus is a property of the goal the
  // user chose — exactly one goal wears it; choosing another moves it.
  const setWeeklyFocus = (goalId: string | null) => {
    goals.forEach((g) => {
      const shouldBe = g.id === goalId;
      if (!!g.weeklyFocus !== shouldBe) {
        updateGoalItem(g.id, { data: { ...g, weeklyFocus: shouldBe } as unknown as Record<string, unknown> })
          .catch((err) => console.error('Failed to set weekly focus:', err instanceof Error ? err.message : err));
      }
    });
    setShowFocusPicker(false);
  };

  // S1 (F1): the namesake object gets its lifecycle — edit + delete.
  const startEdit = (goal: Goal) => {
    setEditingId(goal.id);
    setEditTitle(goal.title);
    setEditDescription(goal.description || '');
    setEditCategory(goal.category);
    setEditPriority(goal.priority);
    setEditTargetDate(goal.targetDate || '');
    setEditSteps((goal.subtasks || []).map((st) => st.label).join('\n'));
    setConfirmDeleteId(null);
  };

  const saveEdit = (goal: Goal) => {
    if (!editTitle.trim()) return;
    // Steps edited as lines; a step that keeps its label keeps its
    // done flag, so editing a title never silently resets progress.
    const oldByLabel = new Map((goal.subtasks || []).map((st) => [st.label, st.done]));
    const subtasks = editSteps.split('\n').map((s) => s.trim()).filter(Boolean)
      .map((label, i) => ({ id: `st-${i}`, label, done: oldByLabel.get(label) ?? false }));
    const doneCount = subtasks.filter((st) => st.done).length;
    const progress = goal.status === 'completed' ? 1
      : subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) / 100 : 0;
    updateGoalItem(goal.id, {
      title: editTitle.trim(),
      data: {
        ...goal, title: editTitle.trim(), description: editDescription,
        category: editCategory, priority: editPriority, targetDate: editTargetDate,
        subtasks, progress,
      } as unknown as Record<string, unknown>,
    }).then(() => setEditingId(null))
      .catch((err) => console.error('Failed to edit goal:', err instanceof Error ? err.message : err));
  };

  // Delete is two-step and recoverable: the snapshot re-creates the
  // goal on Undo. The generic store has no trash, so the restored
  // goal is a new artifact carrying the same content.
  const deleteGoal = (goal: Goal) => {
    setDeleteError('');
    removeGoalItem(goal.id).then(() => {
      setUndoGoal({
        title: goal.title,
        data: {
          title: goal.title, description: goal.description, category: goal.category,
          progress: goal.progress, priority: goal.priority, targetDate: goal.targetDate,
          subtasks: goal.subtasks, xp: goal.xp, milestones: goal.milestones, status: goal.status, weeklyFocus: goal.weeklyFocus,
        } as unknown as Record<string, unknown>,
      });
      setConfirmDeleteId(null);
      if (expandedGoal === goal.id) setExpandedGoal(null);
    }).catch(() => setDeleteError('Could not delete that goal — it is still in your list.'));
  };

  const undoDelete = () => {
    if (!undoGoal) return;
    const snap = undoGoal;
    setUndoGoal(null);
    createGoalItem({ title: snap.title, data: snap.data })
      .catch(() => setDeleteError('Undo failed — the goal was not restored.'));
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
      {showFocusPicker && (
        <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.04] px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] text-zinc-100">Set a weekly focus</h3>
            <button type="button" onClick={() => setShowFocusPicker(false)} className="text-[13px] text-zinc-400 hover:text-zinc-200">Cancel</button>
          </div>
          <p className="mt-1 text-[12px] text-zinc-500">One goal wears the focus line until you change it.</p>
          <div className="mt-3 space-y-1.5">
            {goals.filter((g) => g.status === 'active').map((g) => (
              <button key={g.id} type="button" aria-label={`Set ${g.title} as weekly focus`} onClick={() => setWeeklyFocus(g.id)} className="flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-left text-[14px] text-zinc-200 hover:bg-white/5">
                <span>{g.title}</span>
                {g.weeklyFocus && <span className="text-[12px] text-violet-300">This week's focus</span>}
              </button>
            ))}
            {goals.filter((g) => g.status === 'active').length === 0 && (
              <p className="text-[13px] text-zinc-500">No active goals yet — create a goal first, then set it as your focus.</p>
            )}
          </div>
          {goals.some((g) => g.weeklyFocus) && (
            <button type="button" onClick={() => setWeeklyFocus(null)} className="mt-3 text-[13px] text-zinc-400 hover:text-zinc-200">Clear focus</button>
          )}
        </div>
      )}

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

      {(undoGoal || deleteError) && (
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[13px] text-zinc-300" role="status">
          {deleteError
            ? <span className="text-rose-300">{deleteError}</span>
            : <span>Deleted "{undoGoal?.title}".</span>}
          {undoGoal && (
            <button type="button" onClick={undoDelete} className="text-teal-300 hover:text-teal-200">Undo</button>
          )}
          <button type="button" onClick={() => { setUndoGoal(null); setDeleteError(''); }} className="ml-auto text-zinc-500 hover:text-zinc-300">Dismiss</button>
        </div>
      )}

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

      {editingId && (() => {
        const goal = goals.find((g) => g.id === editingId);
        if (!goal) return null;
        return (
          <div className="space-y-3 rounded-2xl border border-teal-400/25 bg-white/[0.02] p-5">
            <p className="text-[13px] font-medium text-zinc-200">Edit goal</p>
            <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="Edit goal title" className={`${field} font-vault text-[18px]`} />
            <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="What does success look like? (optional)" aria-label="Edit goal description" className={`${field} h-16 resize-none`} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as Goal['category'])} className={field} aria-label="Edit category">
                {['Career', 'Health', 'Learning', 'Creative', 'Financial', 'Personal'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as Goal['priority'])} className={field} aria-label="Edit priority">
                <option value="low">Low priority</option>
                <option value="medium">Medium priority</option>
                <option value="high">High priority</option>
              </select>
              <input type="date" value={editTargetDate} onChange={(e) => setEditTargetDate(e.target.value)} className={field} aria-label="Edit target date" />
            </div>
            {/* Plain textarea on purpose: the edit path must not pass
                through the drafted-text layer while F2 is open. */}
            <textarea value={editSteps} onChange={(e) => setEditSteps(e.target.value)} placeholder="Steps, one per line — progress follows them" aria-label="Edit steps" className={`${field} h-16 resize-none`} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditingId(null)} className="rounded-lg px-3 py-2 text-[13px] text-zinc-400 hover:text-zinc-100">Cancel</button>
              <button type="button" onClick={() => saveEdit(goal)} disabled={!editTitle.trim()} className="rounded-lg bg-teal-400 px-4 py-2 text-[13px] font-medium text-black hover:bg-teal-300 disabled:opacity-50">Save changes</button>
            </div>
          </div>
        );
      })()}

      {filteredGoals.map((goal, i) => {
        const isExpanded = expandedGoal === goal.id;
        const pct = Math.round(Math.min(goal.progress, 1) * 100);
        const bar = i % 2 === 1 ? 'bg-teal-400' : 'bg-violet-400';
        const pctCls = i % 2 === 1 ? 'text-teal-400' : 'text-violet-400';
        const dLeft = daysUntil(goal.targetDate);
        const kept = goalKeepRecord(goal);
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
              {goal.weeklyFocus && (
                <p className="mt-1 flex items-center gap-1 text-[12px] text-violet-300"><Target className="h-3 w-3" /> This week's focus</p>
              )}
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
                    {goal.status === 'completed' && completionRecord(goal) && (
                      <p className="pb-1 text-[12px] text-zinc-500">Completed — {completionRecord(goal)}</p>
                    )}
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
                    {goal.status === 'active' && !goal.weeklyFocus && (
                      <button type="button" onClick={() => setWeeklyFocus(goal.id)} className="mt-2 ml-2 rounded-lg border border-violet-400/30 px-3 py-1.5 text-[13px] text-violet-300 hover:bg-violet-400/10">
                        Set as weekly focus
                      </button>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <button type="button" onClick={() => startEdit(goal)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-zinc-300 hover:bg-white/5">
                        <Pencil className="h-3.5 w-3.5" /> Edit goal
                      </button>
                      {confirmDeleteId === goal.id ? (
                        <>
                          <button type="button" onClick={() => deleteGoal(goal)} className="rounded-lg bg-rose-500/90 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-rose-400">Confirm delete</button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-[13px] text-zinc-400 hover:text-zinc-200">Cancel</button>
                          <span className="text-[12px] text-zinc-500">You can undo after deleting.</span>
                        </>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(goal.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 px-3 py-1.5 text-[13px] text-rose-300 hover:bg-rose-400/10">
                          <Trash2 className="h-3.5 w-3.5" /> Delete goal
                        </button>
                      )}
                    </div>
                    <div className="pt-3">
                      <KeepRecordActions key={kept?.body} record={kept} />
                    </div>
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
