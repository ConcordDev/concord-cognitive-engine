'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  FolderKanban, ListTodo, Calendar, Users, DollarSign,
  Plus, Search, X, Trash2, BarChart3,
  AlertTriangle, Milestone,
  Layers, ChevronDown, Gauge, Activity, CircleDot, Zap,
  Loader2, TrendingDown, TrendingUp,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ModeTab = 'projects' | 'tasks' | 'milestones' | 'resources' | 'timeline' | 'risks' | 'budget';
type ArtifactType = 'Project' | 'Task' | 'Milestone' | 'Resource' | 'TimelineItem' | 'Risk' | 'BudgetItem';
type Status = 'planned' | 'active' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled' | 'overdue' | 'at_risk';
type Priority = 'low' | 'medium' | 'high' | 'critical';

interface ProjectArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  priority?: Priority; assignee?: string; startDate?: string; endDate?: string; dueDate?: string;
  progress?: number; budget?: number; spent?: number; estimatedHours?: number;
  actualHours?: number; dependencies?: string[]; tags?: string[];
  projectManager?: string; client?: string; methodology?: string;
  riskLevel?: string; mitigation?: string; impact?: string; probability?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof FolderKanban; artifactType: ArtifactType }[] = [
  { id: 'projects', label: 'Projects', icon: FolderKanban, artifactType: 'Project' },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, artifactType: 'Task' },
  { id: 'milestones', label: 'Milestones', icon: Milestone, artifactType: 'Milestone' },
  { id: 'resources', label: 'Resources', icon: Users, artifactType: 'Resource' },
  { id: 'timeline', label: 'Timeline', icon: Calendar, artifactType: 'TimelineItem' },
  { id: 'risks', label: 'Risks', icon: AlertTriangle, artifactType: 'Risk' },
  { id: 'budget', label: 'Budget', icon: DollarSign, artifactType: 'BudgetItem' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  planned: { label: 'Planned', color: 'gray-400' }, active: { label: 'Active', color: 'green-400' },
  in_progress: { label: 'In Progress', color: 'blue-400' }, on_hold: { label: 'On Hold', color: 'yellow-400' },
  completed: { label: 'Completed', color: 'emerald-400' }, cancelled: { label: 'Cancelled', color: 'red-400' },
  overdue: { label: 'Overdue', color: 'red-400' }, at_risk: { label: 'At Risk', color: 'orange-400' },
};

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Low', color: 'gray-400' }, medium: { label: 'Medium', color: 'yellow-400' },
  high: { label: 'High', color: 'orange-400' }, critical: { label: 'Critical', color: 'red-400' },
};

const METHODOLOGIES = ['Agile', 'Scrum', 'Kanban', 'Waterfall', 'Lean', 'Six Sigma', 'Prince2', 'Hybrid'];

export default function ProjectsLensPage() {
  useLensNav('projects');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('projects');

  const [activeTab, setActiveTab] = useState<ModeTab>('projects');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<ProjectArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('planned');
  const [formNotes, setFormNotes] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formAssignee, setFormAssignee] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formEstimatedHours, setFormEstimatedHours] = useState('');
  const [formMethodology, setFormMethodology] = useState('Agile');
  const [formClient, setFormClient] = useState('');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Project';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ProjectArtifact>('projects', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('projects');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as ProjectArtifact).description?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as ProjectArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  // --- Domain action state ---
  const [projActionRunning, setProjActionRunning] = useState<string | null>(null);
  const [ganttResult, setGanttResult] = useState<Record<string, unknown> | null>(null);
  const [riskMatrixResult, setRiskMatrixResult] = useState<Record<string, unknown> | null>(null);
  const [burndownResult, setBurndownResult] = useState<Record<string, unknown> | null>(null);
  const [stakeholderMapResult, setStakeholderMapResult] = useState<Record<string, unknown> | null>(null);

  const handleProjAction = async (
    action: string,
    setter: (val: Record<string, unknown> | null) => void
  ) => {
    setProjActionRunning(action);
    try {
      const artifactId = items[0]?.id || 'projects';
      const res = await runAction.mutateAsync({ id: artifactId, action });
      if (res.ok === false) { setter({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` } as Record<string, unknown>); } else { setter((res.result as Record<string, unknown>) || null); }
    } catch (e) {
      console.error(`Projects action ${action} failed:`, e);
    }
    setProjActionRunning(null);
  };

  const openCreate = () => { setEditingItem(null); setFormName(''); setFormDescription(''); setFormStatus('planned'); setFormNotes(''); setFormPriority('medium'); setFormAssignee(''); setFormStartDate(''); setFormEndDate(''); setFormBudget(''); setFormEstimatedHours(''); setFormMethodology('Agile'); setFormClient(''); setEditorOpen(true); };
  const openEdit = (item: LensItem<ProjectArtifact>) => { const d = item.data as unknown as ProjectArtifact; setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || ''); setFormStatus(d.status || 'planned'); setFormNotes(d.notes || ''); setFormPriority(d.priority || 'medium'); setFormAssignee(d.assignee || ''); setFormStartDate(d.startDate || ''); setFormEndDate(d.endDate || ''); setFormBudget(d.budget?.toString() || ''); setFormEstimatedHours(d.estimatedHours?.toString() || ''); setFormMethodology(d.methodology || 'Agile'); setFormClient(d.client || ''); setEditorOpen(true); };

  const handleSave = async () => {
    const data: Record<string, unknown> = { name: formName, type: activeArtifactType, status: formStatus, description: formDescription, notes: formNotes, priority: formPriority, assignee: formAssignee, startDate: formStartDate, endDate: formEndDate, budget: formBudget ? parseFloat(formBudget) : undefined, estimatedHours: formEstimatedHours ? parseFloat(formEstimatedHours) : undefined, methodology: formMethodology, client: formClient };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as ProjectArtifact);
    const totalBudget = all.reduce((s, p) => s + (p.budget || 0), 0);
    const totalSpent = all.reduce((s, p) => s + (p.spent || 0), 0);
    const avgProgress = all.length ? all.reduce((s, p) => s + (p.progress || 0), 0) / all.length : 0;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}><FolderKanban className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>Total Projects</p><p className="text-xl font-bold text-white">{items.length}</p></div>
        <div className={ds.panel}><Gauge className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>Avg Progress</p><p className="text-xl font-bold text-white">{avgProgress.toFixed(0)}%</p></div>
        <div className={ds.panel}><DollarSign className="w-5 h-5 text-yellow-400 mb-2" /><p className={ds.textMuted}>Budget</p><p className="text-xl font-bold text-white">${totalBudget.toLocaleString()}</p><p className={ds.textMuted}>${totalSpent.toLocaleString()} spent</p></div>
        <div className={ds.panel}><AlertTriangle className="w-5 h-5 text-red-400 mb-2" /><p className={ds.textMuted}>At Risk</p><p className="text-xl font-bold text-white">{all.filter(p => p.status === 'at_risk' || p.status === 'overdue').length}</p></div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
        <div className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4"><h3 className={ds.heading3}>{editingItem ? 'Edit' : 'New'} {activeArtifactType}</h3><button onClick={() => setEditorOpen(false)} className={ds.btnGhost}><X className="w-4 h-4" /></button></div>
          <div className="space-y-3">
            <div><label className={ds.label}>Name</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} /></div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={ds.label}>Status</label><select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
              <div><label className={ds.label}>Priority</label><select className={ds.select} value={formPriority} onChange={e => setFormPriority(e.target.value as Priority)}>{Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
            </div>
            <div><label className={ds.label}>Assignee</label><input className={ds.input} value={formAssignee} onChange={e => setFormAssignee(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={ds.label}>Start</label><input type="date" className={ds.input} value={formStartDate} onChange={e => setFormStartDate(e.target.value)} /></div>
              <div><label className={ds.label}>End</label><input type="date" className={ds.input} value={formEndDate} onChange={e => setFormEndDate(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={ds.label}>Budget</label><input type="number" className={ds.input} value={formBudget} onChange={e => setFormBudget(e.target.value)} /></div>
              <div><label className={ds.label}>Est. Hours</label><input type="number" className={ds.input} value={formEstimatedHours} onChange={e => setFormEstimatedHours(e.target.value)} /></div>
            </div>
            <div><label className={ds.label}>Methodology</label><select className={ds.select} value={formMethodology} onChange={e => setFormMethodology(e.target.value)}>{METHODOLOGIES.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
            <div><label className={ds.label}>Client</label><input className={ds.input} value={formClient} onChange={e => setFormClient(e.target.value)} /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button><button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>Save</button></div>
        </div>
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" /><input className={cn(ds.input, 'pl-10')} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
        <select className={cn(ds.select, 'w-auto')} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">All Status</option>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> New</button>
      </div>
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-neon-blue border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><FolderKanban className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as ProjectArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.planned;
        const pc = d.priority ? PRIORITY_CONFIG[d.priority] : null;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><FolderKanban className="w-5 h-5 text-neon-cyan" /><div><p className="text-white font-medium">{d.name || item.title}</p><p className={ds.textMuted}>{d.assignee || ''} {d.methodology ? `(${d.methodology})` : ''}</p></div></div>
              <div className="flex items-center gap-2">
                {pc && <span className={`text-xs text-${pc.color}`}>{pc.label}</span>}
                {d.progress !== undefined && <span className="text-xs text-blue-400">{d.progress}%</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="projects" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><FolderKanban className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>Projects</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Projects, tasks, milestones, resources, timeline, and risk management</p></div>
        </div>
        <div className="flex items-center gap-2"><DTUExportButton domain="projects" data={{}} compact /><button onClick={() => runAction.mutate({ id: items[0]?.id || 'projects', action: 'riskMatrix' }, { onError: (e) => { console.error('Action failed:', e); } })} className={ds.btnSecondary} title="Run risk analysis"><Zap className="w-4 h-4" /> Analyze</button><button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button></div>
      </header>
      <RealtimeDataPanel domain="projects" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* ── Projects Domain Action Panel ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={cn(ds.panel, 'space-y-4')}>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-violet-400" />
          <h2 className="font-semibold text-sm">Project Analysis Engine</h2>
          <span className={cn(ds.textMuted, 'ml-auto text-xs')}>Gantt · Risk · Burndown · Stakeholders</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { action: 'ganttGenerate', label: 'Gantt Chart', setter: setGanttResult, icon: Calendar, color: 'text-violet-400' },
            { action: 'riskMatrix', label: 'Risk Matrix', setter: setRiskMatrixResult, icon: AlertTriangle, color: 'text-red-400' },
            { action: 'burndownCalc', label: 'Burndown', setter: setBurndownResult, icon: TrendingDown, color: 'text-orange-400' },
            { action: 'stakeholderMap', label: 'Stakeholder Map', setter: setStakeholderMapResult, icon: Users, color: 'text-neon-cyan' },
          ].map(({ action, label, setter, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleProjAction(action, setter)}
              disabled={projActionRunning !== null}
              className={cn(ds.btnSecondary, 'flex items-center gap-1.5 justify-center disabled:opacity-40 disabled:cursor-not-allowed text-xs')}
            >
              {projActionRunning === action
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Icon className={cn('w-3.5 h-3.5', color)} />}
              {projActionRunning === action ? 'Running…' : label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Gantt Result */}
          {ganttResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> Gantt Timeline
              </span>
              {'message' in ganttResult ? (
                <p className="text-xs text-gray-400">{String(ganttResult.message)}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className={cn(ds.panel, 'text-center')}>
                      <p className="text-xs text-gray-500">Total Days</p>
                      <p className="text-lg font-bold text-white">{String(ganttResult.totalDays ?? 0)}</p>
                    </div>
                    <div className={cn(ds.panel, 'text-center')}>
                      <p className="text-xs text-gray-500">Total Weeks</p>
                      <p className="text-lg font-bold text-violet-400">{String(ganttResult.totalWeeks ?? 0)}</p>
                    </div>
                  </div>
                  {Array.isArray(ganttResult.tasks) && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 font-medium">Task Timeline</p>
                      {(ganttResult.tasks as Array<Record<string, unknown>>).slice(0, 8).map((task, i) => {
                        const total = Number(ganttResult.totalDays) || 1;
                        const startPct = (Number(task.startDay) / total) * 100;
                        const widthPct = (Number(task.duration) / total) * 100;
                        return (
                          <div key={i} className="space-y-0.5">
                            <div className="flex justify-between text-xs text-gray-400">
                              <span className="truncate max-w-[60%]">{String(task.task)}</span>
                              <span className="text-gray-600 font-mono">d{String(task.startDay)}–{String(task.endDay)}</span>
                            </div>
                            <div className="h-3 bg-black/30 rounded-full relative overflow-hidden">
                              <motion.div
                                initial={{ width: 0, opacity: 0 }}
                                animate={{ width: `${Math.max(widthPct, 2)}%`, opacity: 1 }}
                                transition={{ delay: i * 0.05, duration: 0.4 }}
                                style={{ left: `${startPct}%` }}
                                className="absolute h-full rounded-full bg-violet-500/70"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Risk Matrix Result */}
          {riskMatrixResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Risk Matrix
                </span>
                {'critical' in riskMatrixResult && Number(riskMatrixResult.critical) > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-600/30 text-red-300">
                    {String(riskMatrixResult.critical)} critical
                  </span>
                )}
              </div>
              {'message' in riskMatrixResult ? (
                <p className="text-xs text-gray-400">{String(riskMatrixResult.message)}</p>
              ) : (
                <>
                  {'topRisk' in riskMatrixResult && (
                    <p className="text-xs text-gray-400">Top Risk: <span className="text-orange-400 font-medium">{String(riskMatrixResult.topRisk)}</span></p>
                  )}
                  {Array.isArray(riskMatrixResult.risks) && (
                    <div className="space-y-2">
                      {(riskMatrixResult.risks as Array<Record<string, unknown>>).slice(0, 6).map((risk, i) => (
                        <div key={i} className="space-y-0.5">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="flex-1 text-gray-300 truncate">{String(risk.risk)}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              String(risk.severity) === 'critical' ? 'bg-red-600/30 text-red-300' :
                              String(risk.severity) === 'high' ? 'bg-orange-500/20 text-orange-400' :
                              String(risk.severity) === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>{String(risk.severity)}</span>
                            <span className="text-gray-600 font-mono w-8 text-right">{String(risk.score)}</span>
                          </div>
                          <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Number(risk.score)}%` }}
                              transition={{ delay: i * 0.05, duration: 0.4 }}
                              className={`h-full rounded-full ${
                                String(risk.severity) === 'critical' ? 'bg-red-500' :
                                String(risk.severity) === 'high' ? 'bg-orange-500' :
                                String(risk.severity) === 'medium' ? 'bg-yellow-500' : 'bg-gray-500'
                              }`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Burndown Result */}
          {burndownResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" /> Burndown
                </span>
                {'status' in burndownResult && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    String(burndownResult.status) === 'ahead' ? 'bg-green-500/20 text-green-400' :
                    String(burndownResult.status) === 'on-track' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>{String(burndownResult.status)}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Total Pts', value: String(burndownResult.totalPoints ?? '—'), color: 'text-white' },
                  { label: 'Completed', value: String(burndownResult.completed ?? '—'), color: 'text-green-400' },
                  { label: 'Remaining', value: String(burndownResult.remaining ?? '—'), color: 'text-orange-400' },
                  { label: 'Velocity', value: `${String(burndownResult.actualVelocity ?? '—')} pts/day`, color: 'text-neon-cyan' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={cn(ds.panel, 'text-center')}>
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className={cn('text-sm font-bold font-mono', color)}>{value}</p>
                  </div>
                ))}
              </div>
              {'projectedDaysToFinish' in burndownResult && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">Projected Finish:</span>
                  <span className={`font-mono font-bold ${
                    burndownResult.onTrack ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {burndownResult.projectedDaysToFinish === Infinity || Number(burndownResult.projectedDaysToFinish) > 9999
                      ? 'N/A'
                      : `${String(burndownResult.projectedDaysToFinish)} days`}
                  </span>
                  {burndownResult.onTrack
                    ? <TrendingUp className="w-3 h-3 text-green-400" />
                    : <TrendingDown className="w-3 h-3 text-red-400" />}
                </div>
              )}
              {'idealBurnRate' in burndownResult && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Ideal rate: <span className="text-gray-300 font-mono">{String(burndownResult.idealBurnRate)} pts/day</span></span>
                  <span>Days elapsed: <span className="text-gray-300 font-mono">{String(burndownResult.daysElapsed)}</span></span>
                </div>
              )}
            </motion.div>
          )}

          {/* Stakeholder Map Result */}
          {stakeholderMapResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-neon-cyan uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Stakeholder Map
              </span>
              {'message' in stakeholderMapResult ? (
                <p className="text-xs text-gray-400">{String(stakeholderMapResult.message)}</p>
              ) : (
                <>
                  {'byQuadrant' in stakeholderMapResult && (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: 'manageClosely', label: 'Manage Closely', color: 'text-red-400', bg: 'bg-red-500/10' },
                        { key: 'keepSatisfied', label: 'Keep Satisfied', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
                        { key: 'keepInformed', label: 'Keep Informed', color: 'text-blue-400', bg: 'bg-blue-500/10' },
                        { key: 'monitor', label: 'Monitor', color: 'text-gray-400', bg: 'bg-gray-500/10' },
                      ].map(({ key, label, color, bg }) => (
                        <div key={key} className={cn('rounded-lg p-2 text-center', bg)}>
                          <p className={cn('text-lg font-bold', color)}>
                            {String((stakeholderMapResult.byQuadrant as Record<string, unknown>)[key] ?? 0)}
                          </p>
                          <p className="text-xs text-gray-500">{label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {Array.isArray(stakeholderMapResult.stakeholders) && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-gray-500 font-medium">Stakeholders ({String(stakeholderMapResult.total ?? 0)})</p>
                      {(stakeholderMapResult.stakeholders as Array<Record<string, unknown>>).slice(0, 8).map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 text-gray-300">{String(s.name)}</span>
                          <div className="flex gap-1 text-[10px]">
                            <span className="text-gray-500">P:{String(s.power)}</span>
                            <span className="text-gray-500">I:{String(s.interest)}</span>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            String(s.quadrant) === 'manage-closely' ? 'bg-red-500/20 text-red-400' :
                            String(s.quadrant) === 'keep-satisfied' ? 'bg-yellow-500/20 text-yellow-400' :
                            String(s.quadrant) === 'keep-informed' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {String(s.communication)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>

      <UniversalActions domain="projects" artifactId={items[0]?.id} compact />

      {/* Stats Row */}
      {(() => { const all = items.map(i => i.data as unknown as ProjectArtifact); const inProgress = all.filter(p => p.status === 'in_progress' || p.status === 'active').length; const completed = all.filter(p => p.status === 'completed').length; const total = all.length; const completedRate = total > 0 ? ((completed / total) * 100).toFixed(0) : '0'; return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><FolderKanban className="w-5 h-5 text-violet-400 mb-2" /><p className={ds.textMuted}>Total Projects</p><p className="text-xl font-bold text-white">{total}</p></div>
          <div className={ds.panel}><Activity className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>In Progress</p><p className="text-xl font-bold text-white">{inProgress}</p></div>
          <div className={ds.panel}><CircleDot className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>Completed Rate</p><p className="text-xl font-bold text-white">{completedRate}%</p></div>
          <div className={ds.panel}><AlertTriangle className="w-5 h-5 text-red-400 mb-2" /><p className={ds.textMuted}>At Risk</p><p className="text-xl font-bold text-white">{all.filter(p => p.status === 'at_risk' || p.status === 'overdue').length}</p></div>
        </div>
      ); })()}
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="projects" /></div>}
      </div>
    </div>
  );
}
