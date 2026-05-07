'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Hammer, Plus, Search, Trash2, DollarSign,
  CheckCircle2, Wrench, Layers, ChevronDown,
  Home, ToggleLeft, ToggleRight, Loader2, BarChart3, Calculator,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

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

interface ProjectData {
  name: string;
  room: string;
  category: string;
  status: 'idea' | 'planning' | 'in-progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  budget: number;
  spent: number;
  contractor: string;
  startDate: string;
  dueDate: string;
  materials: string[];
  notes: string;
}

const STATUS_COLORS: Record<string, string> = {
  idea: 'text-gray-400 bg-gray-400/10',
  planning: 'text-yellow-400 bg-amber-500/10',
  'in-progress': 'text-neon-cyan bg-neon-cyan/10',
  completed: 'text-neon-green bg-neon-green/10',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
};

const ROOMS = ['Kitchen', 'Bathroom', 'Bedroom', 'Living Room', 'Garage', 'Basement', 'Exterior', 'Garden', 'Office', 'Other'];

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
  const [showFeatures, setShowFeatures] = useState(true);
  const [activeTab, setActiveTab] = useState<'projects' | 'budget' | 'contractors'>('projects');
  const [beforeAfterView, setBeforeAfterView] = useState<'before' | 'after'>('before');
  const [newProject, setNewProject] = useState({ name: '', room: 'Kitchen', priority: 'medium' as 'low' | 'medium' | 'high', budget: 0 });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, remove, deleteMut,
  } = useLensData<ProjectData>('home-improvement', 'project', { seed: [] });

  const projects = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, name: item.title || item.data?.name || 'Untitled Project' }))
      .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.room?.toLowerCase().includes(search.toLowerCase()))
      .filter(p => !statusFilter || p.status === statusFilter),
    [items, search, statusFilter]
  );

  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter(p => p.status === 'in-progress').length,
    totalBudget: projects.reduce((s, p) => s + (p.budget || 0), 0),
    totalSpent: projects.reduce((s, p) => s + (p.spent || 0), 0),
    completed: projects.filter(p => p.status === 'completed').length,
  }), [projects]);

  const budgetRemaining = stats.totalBudget - stats.totalSpent;
  const budgetPercent = stats.totalBudget > 0 ? (stats.totalSpent / stats.totalBudget) * 100 : 0;

  // Room-by-room grouping
  const roomGroups = useMemo(() => {
    const groups: Record<string, typeof projects> = {};
    projects.forEach(p => {
      const room = p.room || 'Other';
      if (!groups[room]) groups[room] = [];
      groups[room].push(p);
    });
    return groups;
  }, [projects]);

  // Contractor data
  const contractors = useMemo(() => {
    const map: Record<string, { name: string; projects: number; totalBudget: number }> = {};
    projects.forEach(p => {
      if (p.contractor) {
        if (!map[p.contractor]) map[p.contractor] = { name: p.contractor, projects: 0, totalBudget: 0 };
        map[p.contractor].projects++;
        map[p.contractor].totalBudget += p.budget || 0;
      }
    });
    return Object.values(map);
  }, [projects]);

  const runAction = useRunArtifact('home-improvement');
  const [hiActionResult, setHiActionResult] = useState<{ action: string; data: unknown } | null>(null);

  const handleHiAction = useCallback((action: string) => {
    const artifactId = items[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action, params: {} },
      {
        onSuccess: (res) => setHiActionResult({ action, data: res.result }),
        onError: (e) => {
          console.error(`Action failed:`, e);
          setHiActionResult({ action, data: { error: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` } });
        },
      }
    );
  }, [items, runAction]);

  const handleCreate = useCallback(async () => {
    if (!newProject.name.trim()) return;
    await create({
      title: newProject.name,
      data: {
        name: newProject.name, room: newProject.room, category: '',
        status: 'idea', priority: newProject.priority, budget: newProject.budget,
        spent: 0, contractor: '', startDate: '', dueDate: '',
        materials: [], notes: '',
      },
    });
    setNewProject({ name: '', room: 'Kitchen', priority: 'medium', budget: 0 });
    setShowCreate(false);
  }, [newProject, create]);

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  const tabs = [
    { key: 'projects' as const, label: 'Projects', icon: Hammer },
    { key: 'budget' as const, label: 'Budget', icon: DollarSign },
    { key: 'contractors' as const, label: 'Contractors', icon: Wrench },
  ];

  return (
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

      <UniversalActions domain="home-improvement" artifactId={items[0]?.id} compact />

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
                {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={newProject.priority} onChange={e => setNewProject(p => ({ ...p, priority: e.target.value as ProjectData['priority'] }))} className="input-lattice">
                <option value="low">Low Priority</option><option value="medium">Medium Priority</option><option value="high">High Priority</option>
              </select>
              <input type="number" value={newProject.budget || ''} onChange={e => setNewProject(p => ({ ...p, budget: Number(e.target.value) }))} placeholder="Budget..." className="input-lattice" />
            </div>
            <button onClick={handleCreate} disabled={createMut.isPending || !newProject.name.trim()} className="btn-neon green w-full">
              {createMut.isPending ? 'Creating...' : 'Create Project'}
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

      {/* Tabs */}
      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center',
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
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-lattice w-40">
                <option value="">All Status</option>
                <option value="idea">Idea</option><option value="planning">Planning</option>
                <option value="in-progress">In Progress</option><option value="completed">Completed</option>
              </select>
            </div>

            {/* Room-by-room view */}
            {Object.keys(roomGroups).length > 0 ? (
              Object.entries(roomGroups).map(([room, roomProjects]) => (
                <div key={room} className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                    <Home className="w-3.5 h-3.5 text-amber-400" />
                    {room}
                    <span className="text-xs text-gray-500">({roomProjects.length})</span>
                  </h3>
                  {roomProjects.map((p, i) => (
                    <motion.div
                      key={p.id}
                      custom={i}
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      className="panel p-4 flex items-center justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-white truncate">{p.name}</h3>
                          <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_COLORS[p.status || 'idea'])}>{p.status}</span>
                          <span className={cn('text-xs', PRIORITY_COLORS[p.priority || 'medium'])}>{p.priority}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          {p.budget > 0 && (
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              {p.spent?.toLocaleString() || 0} / {p.budget.toLocaleString()}
                            </span>
                          )}
                          {p.contractor && <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />{p.contractor}</span>}
                        </div>
                        {p.budget > 0 && (
                          <div className="mt-2 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full transition-all', (p.spent || 0) > p.budget ? 'bg-red-400' : 'bg-neon-green')}
                              style={{ width: `${Math.min(100, ((p.spent || 0) / p.budget) * 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <button onClick={() => remove(p.id)} disabled={deleteMut.isPending} className="text-gray-500 hover:text-red-400 p-1 ml-3">{deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>
                    </motion.div>
                  ))}
                </div>
              ))
            ) : (
              <div className="panel p-6 text-center text-gray-400">
                {isLoading ? 'Loading projects...' : 'No home improvement projects yet. Plan your first renovation or repair.'}
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
                  <p className="text-xs text-gray-500 uppercase">Budget</p>
                  <p className="text-xl font-bold text-neon-green">${stats.totalBudget.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 uppercase">Spent</p>
                  <p className="text-xl font-bold text-red-400">${stats.totalSpent.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 uppercase">Remaining</p>
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
              <p className="text-xs text-gray-500 text-right">{budgetPercent.toFixed(1)}% spent</p>
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
                  <p className="text-gray-500 text-sm text-center py-4">No projects with budgets yet.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'contractors' && (
          <motion.div
            key="contractors"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="panel p-6"
          >
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Wrench className="w-4 h-4 text-neon-cyan" />Contractors</h2>
            {contractors.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No contractors assigned yet. Add contractor names to your projects.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {contractors.map((c, i) => (
                  <motion.div
                    key={c.name}
                    custom={i}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    className="lens-card"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-amber-400/20 flex items-center justify-center">
                        <Wrench className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-white">{c.name}</p>
                        <p className="text-xs text-gray-400">{c.projects} project{c.projects !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="text-sm text-gray-400">
                      Total budget: <span className="text-neon-green font-semibold">${c.totalBudget.toLocaleString()}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <RealtimeDataPanel domain="home-improvement" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* AI Actions Panel */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          AI Home Improvement Actions
        </h2>
        {!items[0]?.id && (
          <p className="text-xs text-gray-500">Create a project to run AI actions.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { action: 'projectEstimate', label: 'Project Estimate', icon: Hammer, color: 'text-amber-400' },
            { action: 'roiCalculator', label: 'ROI Calculator', icon: Calculator, color: 'text-neon-green' },
            { action: 'permitCheck', label: 'Permit Check', icon: CheckCircle2, color: 'text-neon-cyan' },
            { action: 'colorPalette', label: 'Color Palette', icon: Home, color: 'text-neon-purple' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleHiAction(action)}
              disabled={runAction.isPending || !items[0]?.id}
              className="flex items-center gap-2 px-4 py-3 bg-lattice-surface border border-lattice-border rounded-lg text-sm font-medium text-white hover:border-amber-400/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {runAction.isPending && hiActionResult?.action !== action ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className={`w-4 h-4 ${color}`} />
              )}
              {label}
            </button>
          ))}
        </div>

        {hiActionResult && !runAction.isPending && (() => {
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
                    <p className="text-xs text-gray-500 mt-1">Timeline: {d.timeline}</p>
                  </div>
                </div>
              </div>
            );
          }
          if (hiActionResult.action === 'roiCalculator') {
            const d = hiActionResult.data as RoiResult;
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
                    <p className="text-xs text-gray-500">Net Gain: ${p.netGain.toLocaleString()}</p>
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
                <p className="text-xs text-gray-500">Palette: {d.palette}</p>
              </div>
            );
          }
          return null;
        })()}
      </div>

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="home-improvement" /></div>}
      </div>
    </div>
  );
}
