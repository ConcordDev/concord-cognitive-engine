'use client';

/**
 * Projects panel — real project/task/expense substrate
 * (project-list / project-add / project-status / project-delete /
 * task-add / task-toggle / expense-log / home-improvement-dashboard).
 * Extracted from page.tsx; macros preserved.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { lensRun } from '@/lib/api/client';
import {
  Hammer, Plus, Search, Trash2, DollarSign,
  CheckCircle2, Wrench, ChevronDown,
  Home, ToggleLeft, ToggleRight, Loader2,
  ListChecks, Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DOMAIN, ROOM_OPTIONS, roomLabel, STATUS_OPTIONS, STATUS_COLORS, statusLabel,
  EXPENSE_KINDS, cardVariants,
  type HiProject, type HiDashboard, type HiExpense,
} from './hi-shared';

export function HiStatsHeader() {
  const [projects, setProjects] = useState<HiProject[]>([]);
  const [dashboard, setDashboard] = useState<HiDashboard | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: list }, { data: dash }] = await Promise.all([
        lensRun<{ projects: HiProject[] }>(DOMAIN, 'project-list', {}),
        lensRun<HiDashboard>(DOMAIN, 'home-improvement-dashboard', {}),
      ]);
      if (list.ok && list.result) setProjects(list.result.projects || []);
      if (dash.ok && dash.result) setDashboard(dash.result);
    })();
  }, []);

  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter(p => p.status === 'in_progress').length,
    totalBudget: projects.reduce((s, p) => s + (p.budget || 0), 0),
    completed: projects.filter(p => p.status === 'complete').length,
  }), [projects]);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Hammer, color: 'text-amber-400', value: stats.total, label: 'Projects' },
          { icon: Wrench, color: 'text-neon-cyan', value: stats.active, label: 'In Progress' },
          { icon: DollarSign, color: 'text-neon-green', value: `$${stats.totalBudget.toLocaleString()}`, label: 'Total Budget' },
          { icon: CheckCircle2, color: 'text-neon-purple', value: stats.completed, label: 'Completed' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>
      {dashboard && dashboard.tasks > 0 && (
        <p className="text-xs text-gray-400 -mt-3 flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5 text-neon-cyan" />
          {dashboard.tasksDone}/{dashboard.tasks} tasks done across all projects
        </p>
      )}
    </>
  );
}

export function ProjectsPanel() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [beforeAfterView, setBeforeAfterView] = useState<'before' | 'after'>('before');
  const [newProject, setNewProject] = useState({ name: '', room: 'kitchen', budget: 0, notes: '' });
  const [projects, setProjects] = useState<HiProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState('');
  const [expenseDraft, setExpenseDraft] = useState({ label: '', amount: '', kind: 'materials' as HiExpense['kind'] });

  const loadProjects = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<{ projects: HiProject[] }>(DOMAIN, 'project-list', {});
    if (data.ok && data.result) setProjects(data.result.projects || []);
    setLoading(false);
  }, []);

  const refreshAll = useCallback(async () => { await loadProjects(); }, [loadProjects]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshAll(); }, []);

  const filteredProjects = useMemo(() =>
    projects
      .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || roomLabel(p.room).toLowerCase().includes(search.toLowerCase()))
      .filter(p => !statusFilter || p.status === statusFilter),
    [projects, search, statusFilter]
  );

  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter(p => p.status === 'in_progress').length,
    totalBudget: projects.reduce((s, p) => s + (p.budget || 0), 0),
    totalSpent: projects.reduce((s, p) => s + (p.spent || 0), 0),
    completed: projects.filter(p => p.status === 'complete').length,
  }), [projects]);

  const roomGroups = useMemo(() => {
    const groups: Record<string, HiProject[]> = {};
    filteredProjects.forEach(p => {
      const room = p.room || 'other';
      if (!groups[room]) groups[room] = [];
      groups[room].push(p);
    });
    return groups;
  }, [filteredProjects]);

  const createProject = useCallback(async () => {
    if (!newProject.name.trim()) return;
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'project-add', newProject);
    setBusy(false);
    if (data.ok) {
      setNewProject({ name: '', room: 'kitchen', budget: 0, notes: '' });
      setShowCreate(false);
      await refreshAll();
    }
  }, [newProject, refreshAll]);

  const setStatus = useCallback(async (id: string, status: HiProject['status']) => {
    setBusy(true);
    await lensRun(DOMAIN, 'project-status', { id, status });
    setBusy(false);
    await refreshAll();
  }, [refreshAll]);

  const deleteProject = useCallback(async (id: string) => {
    setBusy(true);
    await lensRun(DOMAIN, 'project-delete', { id });
    setBusy(false);
    if (expandedId === id) setExpandedId(null);
    await refreshAll();
  }, [refreshAll, expandedId]);

  const addTask = useCallback(async (projectId: string) => {
    if (!taskDraft.trim()) return;
    setBusy(true);
    await lensRun(DOMAIN, 'task-add', { projectId, label: taskDraft });
    setTaskDraft('');
    setBusy(false);
    await refreshAll();
  }, [taskDraft, refreshAll]);

  const toggleTask = useCallback(async (projectId: string, taskId: string) => {
    setBusy(true);
    await lensRun(DOMAIN, 'task-toggle', { projectId, taskId });
    setBusy(false);
    await refreshAll();
  }, [refreshAll]);

  const logExpense = useCallback(async (projectId: string) => {
    if (!expenseDraft.label.trim() || !expenseDraft.amount) return;
    setBusy(true);
    await lensRun(DOMAIN, 'expense-log', { projectId, label: expenseDraft.label, amount: Number(expenseDraft.amount), kind: expenseDraft.kind });
    setExpenseDraft({ label: '', amount: '', kind: 'materials' });
    setBusy(false);
    await refreshAll();
  }, [expenseDraft, refreshAll]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon">
          <Plus className="w-4 h-4 mr-2 inline" /> New Project
        </button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="panel p-4 space-y-3 overflow-hidden"
          >
            <h3 className="font-semibold">New Home Project</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={newProject.name} onChange={e => setNewProject(p => ({ ...p, name: e.target.value }))} placeholder="Project name..." className="input-lattice" />
              <select value={newProject.room} onChange={e => setNewProject(p => ({ ...p, room: e.target.value }))} className="input-lattice">
                {ROOM_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <input type="number" value={newProject.budget || ''} onChange={e => setNewProject(p => ({ ...p, budget: Number(e.target.value) }))} placeholder="Budget..." className="input-lattice" />
              <input value={newProject.notes} onChange={e => setNewProject(p => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)..." className="input-lattice" />
            </div>
            <button onClick={createProject} disabled={busy || !newProject.name.trim()} className="btn-neon green w-full focus:outline-none focus:ring-2 focus:ring-amber-500">
              {busy ? 'Creating...' : 'Create Project'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-lattice w-40">
          <option value="">All Status</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {Object.keys(roomGroups).length > 0 ? (
        Object.entries(roomGroups).map(([room, roomProjects]) => (
          <div key={room} className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Home className="w-3.5 h-3.5 text-amber-400" />
              {roomLabel(room)}
              <span className="text-xs text-gray-400">({roomProjects.length})</span>
            </h3>
            {roomProjects.map((p, i) => {
              const expanded = expandedId === p.id;
              return (
                <motion.div
                  key={p.id}
                  custom={i}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  className="panel p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setExpandedId(expanded ? null : p.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white truncate">{p.name}</h3>
                        <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_COLORS[p.status])}>{statusLabel(p.status)}</span>
                        {p.taskCount > 0 && (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <ListChecks className="w-3 h-3" />{p.tasksDone}/{p.taskCount}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-400">
                        {p.budget > 0 && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            {p.spent?.toLocaleString() || 0} / {p.budget.toLocaleString()}
                          </span>
                        )}
                        {p.notes && <span className="truncate max-w-xs">{p.notes}</span>}
                      </div>
                      {p.budget > 0 && (
                        <div className="mt-2 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all', (p.spent || 0) > p.budget ? 'bg-red-400' : 'bg-neon-green')}
                            style={{ width: `${Math.min(100, ((p.spent || 0) / p.budget) * 100)}%` }}
                          />
                        </div>
                      )}
                    </button>
                    <div className="flex items-center gap-1 ml-3">
                      <ChevronDown className={cn('w-4 h-4 text-gray-500 transition-transform', expanded && 'rotate-180')} onClick={() => setExpandedId(expanded ? null : p.id)} />
                      <button onClick={() => deleteProject(p.id)} disabled={busy} className="text-gray-400 hover:text-red-400 p-1">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {expanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden border-t border-lattice-border pt-3 space-y-3"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-400">Status:</span>
                          {STATUS_OPTIONS.map(o => (
                            <button
                              key={o.value}
                              onClick={() => setStatus(p.id, o.value)}
                              disabled={busy}
                              className={cn(
                                'text-xs px-2 py-1 rounded border transition-colors',
                                p.status === o.value
                                  ? cn(STATUS_COLORS[o.value], 'border-current')
                                  : 'text-gray-500 border-lattice-border hover:text-white'
                              )}
                            >{o.label}</button>
                          ))}
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-gray-300 flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" />Tasks</p>
                          {p.tasks.length === 0 && <p className="text-xs text-gray-500">No tasks yet.</p>}
                          {p.tasks.map(t => (
                            <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={t.done} onChange={() => toggleTask(p.id, t.id)} disabled={busy} className="accent-neon-green" />
                              <span className={cn(t.done ? 'text-gray-500 line-through' : 'text-gray-200')}>{t.label}</span>
                            </label>
                          ))}
                          <div className="flex gap-2 pt-1">
                            <input
                              value={taskDraft} onChange={e => setTaskDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') addTask(p.id); }}
                              placeholder="Add a task..." className="input-lattice text-xs flex-1"
                            />
                            <button onClick={() => addTask(p.id)} disabled={busy || !taskDraft.trim()} className="btn-neon text-xs px-3 disabled:opacity-50">Add</button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-gray-300 flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" />Expenses</p>
                          {p.expenses.length === 0 && <p className="text-xs text-gray-500">No expenses logged yet.</p>}
                          {p.expenses.map(ex => (
                            <div key={ex.id} className="flex items-center justify-between text-xs text-gray-300">
                              <span>{ex.label} <span className="text-gray-500">({ex.kind})</span></span>
                              <span className="text-neon-green">${ex.amount.toLocaleString()}</span>
                            </div>
                          ))}
                          <div className="grid grid-cols-4 gap-2 pt-1">
                            <input
                              value={expenseDraft.label} onChange={e => setExpenseDraft(d => ({ ...d, label: e.target.value }))}
                              placeholder="Item" className="input-lattice text-xs col-span-2"
                            />
                            <input
                              value={expenseDraft.amount} onChange={e => setExpenseDraft(d => ({ ...d, amount: e.target.value }))}
                              type="number" placeholder="$" className="input-lattice text-xs"
                            />
                            <select value={expenseDraft.kind} onChange={e => setExpenseDraft(d => ({ ...d, kind: e.target.value as HiExpense['kind'] }))} className="input-lattice text-xs">
                              {EXPENSE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          </div>
                          <button onClick={() => logExpense(p.id)} disabled={busy || !expenseDraft.label.trim() || !expenseDraft.amount} className="btn-neon green text-xs w-full disabled:opacity-50">Log expense</button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        ))
      ) : (
        <div className="panel p-6 text-center text-gray-400">
          {loading ? 'Loading projects...' : 'No home improvement projects yet. Plan your first renovation or repair.'}
        </div>
      )}

      {stats.completed > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Home className="w-4 h-4 text-amber-400" /> Project Snapshot
            </h3>
            <button
              onClick={() => setBeforeAfterView(v => v === 'before' ? 'after' : 'before')}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              {beforeAfterView === 'before' ? <ToggleLeft className="w-5 h-5" /> : <ToggleRight className="w-5 h-5 text-neon-green" />}
              {beforeAfterView === 'before' ? 'Before' : 'After'}
            </button>
          </div>
          <div className={cn(
            'p-4 rounded-lg text-center text-sm border',
            beforeAfterView === 'before'
              ? 'bg-red-400/5 border-red-400/20 text-gray-400'
              : 'bg-neon-green/5 border-neon-green/20 text-neon-green'
          )}>
            {beforeAfterView === 'before'
              ? `${stats.completed} project(s) were in ${Object.keys(roomGroups).length} rooms awaiting renovation`
              : `${stats.completed} project(s) completed! $${stats.totalSpent.toLocaleString()} invested in your home`}
          </div>
        </motion.div>
      )}
    </div>
  );
}
