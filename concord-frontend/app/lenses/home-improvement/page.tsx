'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HomeImprovementFeed } from '@/components/home-improvement/HomeImprovementFeed';
import { PhotoGallery } from '@/components/home-improvement/PhotoGallery';
import { IdeaBoards } from '@/components/home-improvement/IdeaBoards';
import { ContractorDirectory } from '@/components/home-improvement/ContractorDirectory';
import { ShoppingList } from '@/components/home-improvement/ShoppingList';
import { HomeInventory } from '@/components/home-improvement/HomeInventory';
import { ProjectGantt } from '@/components/home-improvement/ProjectGantt';
import { MaintenanceReminders } from '@/components/home-improvement/MaintenanceReminders';
import { ProductRecalls } from '@/components/home-improvement/ProductRecalls';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import {
  Hammer, Plus, Search, Trash2, DollarSign,
  CheckCircle2, Wrench, ChevronDown, ChevronRight,
  Home, ToggleLeft, ToggleRight, Loader2, BarChart3, Calculator,
  Camera, Lightbulb, ShoppingCart, Boxes, GanttChartSquare, CalendarClock,
  ListChecks, Receipt, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

const DOMAIN = 'home-improvement';

// ─── Types mirroring the real STATE-backed substrate in
// server/domains/homeimprovement.js exactly (room/status enums, field
// names) — NOT a client-invented shape. See capability map for the
// grep-verified backend contract this was rebuilt against. ─────────────

interface HiTask { id: string; label: string; done: boolean }
interface HiExpense { id: string; label: string; amount: number; kind: 'materials' | 'labor' | 'permit' | 'tools' | 'other'; date: string }
interface HiProject {
  id: string;
  name: string;
  room: string;
  budget: number;
  status: 'planning' | 'in_progress' | 'on_hold' | 'complete';
  notes: string;
  tasks: HiTask[];
  expenses: HiExpense[];
  createdAt: string;
  taskCount: number;
  tasksDone: number;
  spent: number;
  budgetRemaining: number;
}
interface HiDashboard {
  projects: number; activeProjects: number;
  totalBudget: number; totalSpent: number;
  tasks: number; tasksDone: number;
}

interface ProjectEstimateResult {
  projectType: string;
  squareFootage: number;
  materialsCost: number;
  laborCost: number;
  permits: number;
  total: number;
  diyEstimate: number;
  contractorEstimate: number;
  savings: number;
  timeline: string;
}

interface RoiResult {
  projects: { project: string; cost: number; valueAdded: number; roi: number; netGain: number; worthIt: boolean }[];
  bestROI: string;
  worstROI: string;
  totalInvested: number;
  totalValueAdded: number;
  avgROI: number;
  message?: string;
}

interface PermitResult {
  projectType: string;
  requiresPermit: boolean;
  permitType: string;
  estimatedCost: number;
  processingTime: string;
  inspectionsRequired: string[];
  tip: string;
}

interface ColorPaletteResult {
  room: string;
  style: string;
  palette: string;
  wallColor: string;
  trim: string;
  accent: string;
  furniture: string;
  decor: string;
  coverage: string;
}

const ROOM_OPTIONS = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'living_room', label: 'Living Room' },
  { value: 'basement', label: 'Basement' },
  { value: 'garage', label: 'Garage' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'whole_house', label: 'Whole House' },
  { value: 'other', label: 'Other' },
];
const roomLabel = (room: string) => ROOM_OPTIONS.find(r => r.value === room)?.label
  || room.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const STATUS_OPTIONS: { value: HiProject['status']; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'complete', label: 'Complete' },
];
const STATUS_COLORS: Record<string, string> = {
  planning: 'text-yellow-400 bg-amber-500/10',
  in_progress: 'text-neon-cyan bg-neon-cyan/10',
  on_hold: 'text-orange-400 bg-orange-400/10',
  complete: 'text-neon-green bg-neon-green/10',
};
const statusLabel = (s: string) => STATUS_OPTIONS.find(o => o.value === s)?.label || s;

const EXPENSE_KINDS: HiExpense['kind'][] = ['materials', 'labor', 'permit', 'tools', 'other'];

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' } }),
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } },
};

export default function HomeImprovementLensPage() {
  useLensNav('home-improvement');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('home-improvement');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'projects' | 'budget' | 'timeline' | 'gallery' | 'ideas' | 'pros' | 'shopping' | 'inventory' | 'maintenance'
  >('projects');
  const [showHomeImprovementFeed, setShowHomeImprovementFeed] = useState(false);

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-projects', keys: 'p', description: 'Projects', category: 'navigation', action: () => setActiveTab('projects') },
      { id: 'tab-budget', keys: 'b', description: 'Budget', category: 'navigation', action: () => setActiveTab('budget') },
      { id: 'tab-timeline', keys: 't', description: 'Timeline', category: 'navigation', action: () => setActiveTab('timeline') },
      { id: 'tab-gallery', keys: 'g', description: 'Gallery', category: 'navigation', action: () => setActiveTab('gallery') },
      { id: 'tab-ideas', keys: 'i', description: 'Idea boards', category: 'navigation', action: () => setActiveTab('ideas') },
      { id: 'tab-pros', keys: 'c', description: 'Contractors', category: 'navigation', action: () => setActiveTab('pros') },
      { id: 'tab-shopping', keys: 's', description: 'Shopping list', category: 'navigation', action: () => setActiveTab('shopping') },
      { id: 'tab-inventory', keys: 'v', description: 'Home inventory', category: 'navigation', action: () => setActiveTab('inventory') },
      { id: 'tab-maintenance', keys: 'm', description: 'Maintenance', category: 'navigation', action: () => setActiveTab('maintenance') },
    ],
    { lensId: 'home-improvement' }
  );
  const [beforeAfterView, setBeforeAfterView] = useState<'before' | 'after'>('before');
  const [newProject, setNewProject] = useState({ name: '', room: 'kitchen', budget: 0, notes: '' });

  // ─── Real project/task/expense substrate (project-list / project-add /
  // project-status / project-delete / task-add / task-toggle / expense-log /
  // home-improvement-dashboard) — replaces a generic `useLensData('home-
  // improvement','project',...)` artifact store that had zero backing
  // macros and diverged in every field name from this real system. ──────
  const [projects, setProjects] = useState<HiProject[]>([]);
  const [dashboard, setDashboard] = useState<HiDashboard | null>(null);
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

  const loadDashboard = useCallback(async () => {
    const { data } = await lensRun<HiDashboard>(DOMAIN, 'home-improvement-dashboard', {});
    if (data.ok && data.result) setDashboard(data.result);
  }, []);

  const refreshAll = useCallback(async () => { await Promise.all([loadProjects(), loadDashboard()]); }, [loadProjects, loadDashboard]);

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

  const budgetRemaining = stats.totalBudget - stats.totalSpent;
  const budgetPercent = stats.totalBudget > 0 ? (stats.totalSpent / stats.totalBudget) * 100 : 0;

  // Room-by-room grouping
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

  // ─── Planning calculators (projectEstimate / roiCalculator / permitCheck
  // / colorPalette) — real handlers, called directly through the virtual-
  // artifact `lensRun` path with real input forms instead of the previous
  // useRunArtifact() flow, which required a persisted "project" artifact
  // that never existed and left the whole panel permanently disabled. ───
  const [calcPending, setCalcPending] = useState<string | null>(null);
  const [hiActionResult, setHiActionResult] = useState<{ action: string; data: unknown } | null>(null);
  const [estimateForm, setEstimateForm] = useState({ squareFootage: '400', projectType: 'kitchen' });
  const [permitForm, setPermitForm] = useState({ projectType: 'deck' });
  const [paletteForm, setPaletteForm] = useState({ room: 'living room', style: 'modern', squareFootage: '' });
  const [roiRows, setRoiRows] = useState([{ name: '', cost: '', valueAdded: '' }]);

  const runCalc = useCallback(async (action: string, params: Record<string, unknown>) => {
    setCalcPending(action);
    const { data } = await lensRun(DOMAIN, action, params);
    setCalcPending(null);
    if (data.ok) setHiActionResult({ action, data: data.result });
    else setHiActionResult({ action, data: { error: data.error || 'Action failed' } });
  }, []);

  const tabs = [
    { key: 'projects' as const, label: 'Projects', icon: Hammer },
    { key: 'budget' as const, label: 'Budget', icon: DollarSign },
    { key: 'timeline' as const, label: 'Timeline', icon: GanttChartSquare },
    { key: 'gallery' as const, label: 'Gallery', icon: Camera },
    { key: 'ideas' as const, label: 'Ideas', icon: Lightbulb },
    { key: 'pros' as const, label: 'Contractors', icon: Wrench },
    { key: 'shopping' as const, label: 'Shopping', icon: ShoppingCart },
    { key: 'inventory' as const, label: 'Inventory', icon: Boxes },
    { key: 'maintenance' as const, label: 'Maintenance', icon: CalendarClock },
  ];

  return (
    <LensShell lensId="home-improvement" asMain={false}>
      <FirstRunTour lensId="home-improvement" />
      <ManifestActionBar />
      <DepthBadge lensId="home-improvement" size="sm" className="ml-2" />
    <div data-lens-theme="home-improvement" className="p-6 space-y-6">
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Home className="w-6 h-6 text-amber-400" />
          <div>
            <h1 className="text-xl font-bold">Home Improvement Lens</h1>
            <p className="text-sm text-gray-400">Renovation & improvement projects</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="home-improvement" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon">
          <Plus className="w-4 h-4 mr-2 inline" /> New Project
        </button>
      </motion.header>

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

      {/* Stat Cards */}
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all justify-center',
              activeTab === tab.key
                ? 'bg-amber-400/20 text-amber-400 border border-amber-400/30'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'projects' && (
          <motion.div
            key="projects"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
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

            {/* Room-by-room view */}
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
                            {/* Status */}
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

                            {/* Tasks */}
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

                            {/* Expenses */}
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

            {/* Before/After Toggle */}
            {stats.completed > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="panel p-4"
              >
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
          </motion.div>
        )}

        {activeTab === 'budget' && (
          <motion.div
            key="budget"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            {/* Budget overview */}
            <div className="panel p-6">
              <h2 className="font-semibold mb-4 flex items-center gap-2"><DollarSign className="w-4 h-4 text-neon-green" />Budget Overview</h2>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center">
                  <p className="text-xs text-gray-400 uppercase">Budget</p>
                  <p className="text-xl font-bold text-neon-green">${stats.totalBudget.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400 uppercase">Spent</p>
                  <p className="text-xl font-bold text-red-400">${stats.totalSpent.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400 uppercase">Remaining</p>
                  <p className={cn('text-xl font-bold', budgetRemaining >= 0 ? 'text-neon-cyan' : 'text-red-400')}>
                    ${Math.abs(budgetRemaining).toLocaleString()}{budgetRemaining < 0 ? ' over' : ''}
                  </p>
                </div>
              </div>
              <div className="h-4 bg-lattice-deep rounded-full overflow-hidden mb-2">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(budgetPercent, 100)}%` }}
                  transition={{ duration: 0.8 }}
                  className={cn('h-full rounded-full', budgetPercent > 100 ? 'bg-red-400' : budgetPercent > 80 ? 'bg-yellow-400' : 'bg-neon-green')}
                />
              </div>
              <p className="text-xs text-gray-400 text-right">{budgetPercent.toFixed(1)}% spent</p>
            </div>

            {/* Budget vs Actual per project */}
            <div className="panel p-4">
              <h3 className="font-semibold mb-4">Budget vs Actual by Project</h3>
              <div className="space-y-3">
                {projects.filter(p => p.budget > 0).map((p, i) => {
                  const pct = (p.spent || 0) / p.budget * 100;
                  return (
                    <motion.div
                      key={p.id}
                      custom={i}
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                    >
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-white truncate">{p.name}</span>
                        <span className="text-xs text-gray-400">${(p.spent || 0).toLocaleString()} / ${p.budget.toLocaleString()}</span>
                      </div>
                      <div className="h-2.5 bg-lattice-deep rounded-full overflow-hidden relative">
                        <div className="absolute inset-0 bg-neon-green/10 rounded-full" style={{ width: '100%' }} />
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(pct, 100)}%` }}
                          transition={{ duration: 0.6, delay: i * 0.1 }}
                          className={cn('h-full rounded-full relative z-10', pct > 100 ? 'bg-red-400' : pct > 80 ? 'bg-yellow-400' : 'bg-neon-green')}
                        />
                      </div>
                    </motion.div>
                  );
                })}
                {projects.filter(p => p.budget > 0).length === 0 && (
                  <p className="text-gray-400 text-sm text-center py-4">No projects with budgets yet.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'timeline' && (
          <motion.div key="timeline" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="panel p-4">
            <ProjectGantt />
          </motion.div>
        )}

        {activeTab === 'gallery' && (
          <motion.div key="gallery" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="panel p-4">
            <PhotoGallery />
          </motion.div>
        )}

        {activeTab === 'ideas' && (
          <motion.div key="ideas" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="panel p-4">
            <IdeaBoards />
          </motion.div>
        )}

        {activeTab === 'pros' && (
          <motion.div key="pros" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="panel p-4">
            <ContractorDirectory />
          </motion.div>
        )}

        {activeTab === 'shopping' && (
          <motion.div key="shopping" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="panel p-4">
            <ShoppingList />
          </motion.div>
        )}

        {activeTab === 'inventory' && (
          <motion.div key="inventory" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="panel p-4">
            <HomeInventory />
          </motion.div>
        )}

        {activeTab === 'maintenance' && (
          <motion.div key="maintenance" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="panel p-4">
            <MaintenanceReminders />
          </motion.div>
        )}
      </AnimatePresence>

      <RealtimeDataPanel domain="home-improvement" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* Planning calculators */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          Planning Calculators
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Project estimate */}
          <div className="lens-card space-y-2">
            <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5"><Hammer className="w-3.5 h-3.5" />Project Estimate</p>
            <div className="flex gap-2">
              <input type="number" value={estimateForm.squareFootage} onChange={e => setEstimateForm(f => ({ ...f, squareFootage: e.target.value }))} placeholder="Sq ft" className="input-lattice text-xs flex-1" />
              <select value={estimateForm.projectType} onChange={e => setEstimateForm(f => ({ ...f, projectType: e.target.value }))} className="input-lattice text-xs flex-1">
                {['kitchen', 'bathroom', 'flooring', 'painting', 'roofing', 'deck', 'basement', 'addition', 'general'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button onClick={() => runCalc('projectEstimate', estimateForm)} disabled={calcPending === 'projectEstimate'} className="btn-neon text-xs w-full disabled:opacity-50">
              {calcPending === 'projectEstimate' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Estimate'}
            </button>
          </div>

          {/* Permit check */}
          <div className="lens-card space-y-2">
            <p className="text-xs font-semibold text-neon-cyan flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />Permit Check</p>
            <input value={permitForm.projectType} onChange={e => setPermitForm({ projectType: e.target.value })} placeholder="e.g. deck, electrical, painting" className="input-lattice text-xs w-full" />
            <button onClick={() => runCalc('permitCheck', permitForm)} disabled={calcPending === 'permitCheck' || !permitForm.projectType.trim()} className="btn-neon text-xs w-full disabled:opacity-50">
              {calcPending === 'permitCheck' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Check permit'}
            </button>
          </div>

          {/* Color palette */}
          <div className="lens-card space-y-2">
            <p className="text-xs font-semibold text-neon-purple flex items-center gap-1.5"><Home className="w-3.5 h-3.5" />Color Palette</p>
            <div className="flex gap-2">
              <input value={paletteForm.room} onChange={e => setPaletteForm(f => ({ ...f, room: e.target.value }))} placeholder="Room" className="input-lattice text-xs flex-1" />
              <select value={paletteForm.style} onChange={e => setPaletteForm(f => ({ ...f, style: e.target.value }))} className="input-lattice text-xs flex-1">
                {['modern', 'farmhouse', 'coastal', 'traditional', 'minimalist'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button onClick={() => runCalc('colorPalette', paletteForm)} disabled={calcPending === 'colorPalette'} className="btn-neon text-xs w-full disabled:opacity-50">
              {calcPending === 'colorPalette' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Suggest palette'}
            </button>
          </div>

          {/* ROI calculator */}
          <div className="lens-card space-y-2">
            <p className="text-xs font-semibold text-neon-green flex items-center gap-1.5"><Calculator className="w-3.5 h-3.5" />ROI Calculator</p>
            {roiRows.map((row, i) => (
              <div key={i} className="flex gap-1.5">
                <input value={row.name} onChange={e => setRoiRows(rows => rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} placeholder="Project" className="input-lattice text-xs flex-1 min-w-0" />
                <input value={row.cost} onChange={e => setRoiRows(rows => rows.map((r, j) => j === i ? { ...r, cost: e.target.value } : r))} type="number" placeholder="Cost" className="input-lattice text-xs w-16" />
                <input value={row.valueAdded} onChange={e => setRoiRows(rows => rows.map((r, j) => j === i ? { ...r, valueAdded: e.target.value } : r))} type="number" placeholder="Value+" className="input-lattice text-xs w-16" />
                {roiRows.length > 1 && (
                  <button onClick={() => setRoiRows(rows => rows.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400" aria-label={`Remove ROI row${row.name.trim() ? ` "${row.name.trim()}"` : ''}`}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={() => setRoiRows(rows => [...rows, { name: '', cost: '', valueAdded: '' }])} className="text-xs text-gray-400 hover:text-white">+ row</button>
              <button
                onClick={() => runCalc('roiCalculator', { projects: roiRows.filter(r => r.name.trim()).map(r => ({ name: r.name, cost: r.cost, valueAdded: r.valueAdded })) })}
                disabled={calcPending === 'roiCalculator' || roiRows.every(r => !r.name.trim())}
                className="btn-neon text-xs flex-1 disabled:opacity-50"
              >
                {calcPending === 'roiCalculator' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Calculate ROI'}
              </button>
            </div>
          </div>
        </div>

        {hiActionResult && !calcPending && (() => {
          if ((hiActionResult.data as { error?: string })?.error) {
            return <p className="text-xs text-red-400 pt-2 border-t border-lattice-border">{(hiActionResult.data as { error: string }).error}</p>;
          }
          if (hiActionResult.action === 'projectEstimate') {
            const d = hiActionResult.data as ProjectEstimateResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-amber-400">Project Estimate — {d.projectType}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Materials', value: `$${(d.materialsCost || 0).toLocaleString()}`, color: 'text-neon-cyan' },
                    { label: 'Labor', value: `$${(d.laborCost || 0).toLocaleString()}`, color: 'text-neon-purple' },
                    { label: 'Permits', value: `$${(d.permits || 0).toLocaleString()}`, color: 'text-yellow-400' },
                    { label: 'Total', value: `$${(d.total || 0).toLocaleString()}`, color: 'text-neon-green' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="lens-card">
                    <p className="text-xs text-gray-400 mb-1">DIY Estimate</p>
                    <p className="text-lg font-bold text-neon-cyan">${(d.diyEstimate || 0).toLocaleString()}</p>
                    <p className="text-xs text-neon-green mt-1">Save ${(d.savings || 0).toLocaleString()}</p>
                  </div>
                  <div className="lens-card">
                    <p className="text-xs text-gray-400 mb-1">Contractor Estimate</p>
                    <p className="text-lg font-bold text-neon-purple">${(d.contractorEstimate || 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-400 mt-1">Timeline: {d.timeline}</p>
                  </div>
                </div>
              </div>
            );
          }
          if (hiActionResult.action === 'roiCalculator') {
            const d = hiActionResult.data as RoiResult;
            if (d.message) return <p className="text-xs text-gray-400 pt-2 border-t border-lattice-border">{d.message}</p>;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-green">ROI Calculator</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-green">{(d.avgROI || 0).toFixed(1)}%</p>
                    <p className="text-xs text-gray-400">Avg ROI</p>
                  </div>
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-cyan">${(d.totalInvested || 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-400">Total Invested</p>
                  </div>
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-purple">${(d.totalValueAdded || 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-400">Value Added</p>
                  </div>
                </div>
                {d.bestROI && <p className="text-xs text-neon-green">Best ROI: {d.bestROI}</p>}
                {d.worstROI && <p className="text-xs text-red-400">Worst ROI: {d.worstROI}</p>}
                {(d.projects || []).map((p, i) => (
                  <div key={i} className="lens-card space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white">{p.project}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${p.worthIt ? 'bg-neon-green/20 text-neon-green' : 'bg-red-400/20 text-red-400'}`}>
                        {p.worthIt ? 'Worth It' : 'Marginal'} · {p.roi.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${p.roi >= 0 ? 'bg-neon-green' : 'bg-red-400'}`} style={{ width: `${Math.min(100, Math.abs(p.roi))}%` }} />
                    </div>
                    <p className="text-xs text-gray-400">Net Gain: ${p.netGain.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            );
          }
          if (hiActionResult.action === 'permitCheck') {
            const d = hiActionResult.data as PermitResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-cyan">Permit Check — {d.projectType}</h3>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${d.requiresPermit ? 'bg-yellow-400/20 text-yellow-400' : 'bg-neon-green/20 text-neon-green'}`}>
                    {d.requiresPermit ? 'Permit Required' : 'No Permit Needed'}
                  </span>
                  {d.permitType && <span className="text-sm text-gray-300">{d.permitType}</span>}
                </div>
                {d.requiresPermit && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="lens-card">
                      <p className="text-xs text-gray-400">Estimated Cost</p>
                      <p className="text-lg font-bold text-neon-cyan">${(d.estimatedCost || 0).toLocaleString()}</p>
                    </div>
                    <div className="lens-card">
                      <p className="text-xs text-gray-400">Processing Time</p>
                      <p className="text-sm font-semibold text-white">{d.processingTime}</p>
                    </div>
                  </div>
                )}
                {(d.inspectionsRequired || []).length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-2">Inspections Required</p>
                    <div className="flex flex-wrap gap-2">
                      {d.inspectionsRequired.map((ins, i) => (
                        <span key={i} className="text-xs px-2 py-1 bg-neon-purple/10 text-neon-purple rounded border border-neon-purple/20">{ins}</span>
                      ))}
                    </div>
                  </div>
                )}
                {d.tip && <p className="text-xs text-gray-400 italic p-3 bg-lattice-deep rounded-lg">{d.tip}</p>}
              </div>
            );
          }
          if (hiActionResult.action === 'colorPalette') {
            const d = hiActionResult.data as ColorPaletteResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-purple">Color Palette — {d.room} ({d.style})</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {[
                    { label: 'Wall Color', value: d.wallColor, color: 'text-amber-400' },
                    { label: 'Trim', value: d.trim, color: 'text-gray-300' },
                    { label: 'Accent', value: d.accent, color: 'text-neon-cyan' },
                    { label: 'Furniture', value: d.furniture, color: 'text-neon-purple' },
                    { label: 'Decor', value: d.decor, color: 'text-neon-green' },
                  ].map(c => (
                    <div key={c.label} className="lens-card">
                      <p className="text-xs text-gray-400">{c.label}</p>
                      <p className={`text-sm font-semibold ${c.color}`}>{c.value}</p>
                    </div>
                  ))}
                </div>
                {d.coverage && <p className="text-xs text-gray-400">Coverage: {d.coverage}</p>}
                <p className="text-xs text-gray-400">Palette: {d.palette}</p>
              </div>
            );
          }
          return null;
        })()}
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowHomeImprovementFeed(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showHomeImprovementFeed ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Discussion (external reference)
        </button>
        {showHomeImprovementFeed && (
          <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <HomeImprovementFeed />
          </section>
        )}
      </div>
    </div>
          <section className="mt-4"><ProductRecalls /></section>
          <RecentMineCard domain="home-improvement" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="home-improvement" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="home-improvement" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
