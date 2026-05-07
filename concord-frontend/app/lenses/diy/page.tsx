'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Wrench, Plus, Search, Trash2, DollarSign, Clock,
  CheckCircle2, Hammer, Package, Layers, ChevronDown, Ruler, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface ProjectData {
  name: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  status: 'idea' | 'gathering' | 'in-progress' | 'completed';
  estimatedHours: number;
  hoursSpent: number;
  cost: number;
  tools: string[];
  materials: string[];
  steps: string[];
  notes: string;
}

const STATUS_COLORS: Record<string, string> = {
  idea: 'text-gray-400 bg-gray-400/10',
  gathering: 'text-yellow-400 bg-yellow-400/10',
  'in-progress': 'text-neon-cyan bg-neon-cyan/10',
  completed: 'text-neon-green bg-neon-green/10',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: 'text-neon-green',
  intermediate: 'text-yellow-400',
  advanced: 'text-red-400',
};

const CATEGORIES = ['Woodworking', 'Electronics', 'Sewing', 'Metalwork', 'Painting', 'Pottery', 'Leatherwork', '3D Printing', 'Jewelry', 'Other'];

export default function DIYLensPage() {
  useLensNav('diy');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('diy');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [activeTab, setActiveTab] = useState<'projects' | 'tools' | 'materials'>('projects');
  const [newProject, setNewProject] = useState({ name: '', category: 'Woodworking', difficulty: 'beginner' as 'beginner' | 'intermediate' | 'advanced', estimatedHours: 0, cost: 0 });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, remove, deleteMut,
  } = useLensData<ProjectData>('diy', 'project', { seed: [] });

  const projects = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, name: item.title || item.data?.name || 'Untitled Project' }))
      .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.category?.toLowerCase().includes(search.toLowerCase()))
      .filter(p => !statusFilter || p.status === statusFilter),
    [items, search, statusFilter]
  );

  const stats = useMemo(() => ({
    total: projects.length,
    completed: projects.filter(p => p.status === 'completed').length,
    totalHours: projects.reduce((s, p) => s + (p.hoursSpent || 0), 0),
    totalCost: projects.reduce((s, p) => s + (p.cost || 0), 0),
  }), [projects]);

  const handleCreate = useCallback(async () => {
    if (!newProject.name.trim()) return;
    await create({
      title: newProject.name,
      data: {
        name: newProject.name, category: newProject.category,
        difficulty: newProject.difficulty, status: 'idea',
        estimatedHours: newProject.estimatedHours, hoursSpent: 0,
        cost: newProject.cost, tools: [], materials: [], steps: [], notes: '',
      },
    });
    setNewProject({ name: '', category: 'Woodworking', difficulty: 'beginner', estimatedHours: 0, cost: 0 });
    setShowCreate(false);
  }, [newProject, create]);

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  return (
    <div data-lens-theme="diy" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wrench className="w-6 h-6 text-orange-400" />
          <div>
            <h1 className="text-xl font-bold">DIY Lens</h1>
            <p className="text-sm text-gray-400">Projects, crafts & maker space</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="diy" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon">
          <Plus className="w-4 h-4 mr-2 inline" /> New Project
        </button>
      </header>

      <UniversalActions domain="diy" artifactId={items[0]?.id} compact />

      {showCreate && (
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">New DIY Project</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={newProject.name} onChange={e => setNewProject(p => ({ ...p, name: e.target.value }))} placeholder="Project name..." className="input-lattice" />
            <select value={newProject.category} onChange={e => setNewProject(p => ({ ...p, category: e.target.value }))} className="input-lattice">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={newProject.difficulty} onChange={e => setNewProject(p => ({ ...p, difficulty: e.target.value as ProjectData['difficulty'] }))} className="input-lattice">
              <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
            </select>
            <input type="number" value={newProject.estimatedHours || ''} onChange={e => setNewProject(p => ({ ...p, estimatedHours: Number(e.target.value) }))} placeholder="Estimated hours..." className="input-lattice" />
            <input type="number" value={newProject.cost || ''} onChange={e => setNewProject(p => ({ ...p, cost: Number(e.target.value) }))} placeholder="Estimated cost..." className="input-lattice" />
          </div>
          <button onClick={handleCreate} disabled={createMut.isPending || !newProject.name.trim()} className="btn-neon green w-full">
            {createMut.isPending ? 'Creating...' : 'Start Project'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Hammer, value: stats.total, label: 'Projects', color: 'text-orange-400' },
          { icon: CheckCircle2, value: stats.completed, label: 'Completed', color: 'text-neon-green' },
          { icon: Clock, value: `${stats.totalHours}h`, label: 'Hours Spent', color: 'text-neon-cyan' },
          { icon: DollarSign, value: `$${stats.totalCost.toLocaleString()}`, label: 'Total Cost', color: 'text-yellow-400' },
        ].map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="lens-card">
            <card.icon className={cn('w-5 h-5 mb-2', card.color)} />
            <p className="text-2xl font-bold">{card.value}</p>
            <p className="text-sm text-gray-400">{card.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1">
        {([
          { key: 'projects' as const, label: 'Projects', icon: Hammer },
          { key: 'tools' as const, label: 'Tool Inventory', icon: Wrench },
          { key: 'materials' as const, label: 'Materials', icon: Ruler },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
              activeTab === tab.key ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-white')}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
      {activeTab === 'projects' && (
        <motion.div key="projects" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-lattice w-40">
          <option value="">All Status</option>
          <option value="idea">Idea</option><option value="gathering">Gathering</option>
          <option value="in-progress">In Progress</option><option value="completed">Completed</option>
        </select>
      </div>

      <div className="space-y-3 mt-3">
        {isLoading ? (
          <div className="panel p-6 text-center text-gray-400">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="panel p-6 text-center text-gray-400">No DIY projects yet. Start making!</div>
        ) : projects.map((p, i) => (
          <motion.div key={p.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="panel p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-white truncate">{p.name}</h3>
                  <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_COLORS[p.status || 'idea'])}>{p.status}</span>
                  {/* Difficulty Badge */}
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                    p.difficulty === 'beginner' ? 'bg-green-500/20' :
                    p.difficulty === 'intermediate' ? 'bg-amber-500/20' :
                    'bg-red-500/20',
                    DIFFICULTY_COLORS[p.difficulty] || 'text-gray-400'
                  )}>
                    {p.difficulty === 'beginner' ? 'Beginner' : p.difficulty === 'intermediate' ? 'Intermediate' : 'Advanced'}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  {p.category && <span>{p.category}</span>}
                  {p.estimatedHours > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{p.hoursSpent || 0}/{p.estimatedHours}h</span>}
                  {p.cost > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${p.cost}</span>}
                </div>
                {/* Progress Bar */}
                {p.estimatedHours > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-lattice-void rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, ((p.hoursSpent || 0) / p.estimatedHours) * 100)}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className={cn('h-full rounded-full',
                            p.status === 'completed' ? 'bg-neon-green' : 'bg-orange-500'
                          )}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{Math.min(100, Math.round(((p.hoursSpent || 0) / p.estimatedHours) * 100))}%</span>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => remove(p.id)} disabled={deleteMut.isPending} className="text-gray-500 hover:text-red-400 p-1 ml-2">{deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>
            </div>
          </motion.div>
        ))}
      </div>
        </motion.div>
      )}

      {activeTab === 'tools' && (
        <motion.div key="tools" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
          <div className="panel p-4">
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2"><Wrench className="w-4 h-4 text-orange-400" /> Tool Inventory</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {['Table Saw', 'Drill Press', 'Soldering Iron', 'Sewing Machine', 'Heat Gun', '3D Printer', 'Jigsaw', 'Oscilloscope'].map((tool, i) => (
                <motion.div key={tool} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 p-2 bg-lattice-void rounded-lg border border-lattice-border">
                  <Wrench className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-300">{tool}</span>
                  <span className="ml-auto text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Available</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'materials' && (
        <motion.div key="materials" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
          <div className="panel p-4">
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-orange-400" /> Material Stock</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {[
                { name: 'Pine Wood (1x6)', qty: '12 boards', stock: 'good' },
                { name: 'Acrylic Sheet', qty: '3 sheets', stock: 'good' },
                { name: 'PLA Filament', qty: '0.5 kg', stock: 'low' },
                { name: 'Copper Wire (22AWG)', qty: '50m', stock: 'good' },
                { name: 'Sandpaper (220 grit)', qty: '2 sheets', stock: 'low' },
                { name: 'Wood Glue', qty: '1 bottle', stock: 'good' },
              ].map((mat, i) => (
                <motion.div key={mat.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="p-3 bg-lattice-void rounded-lg border border-lattice-border">
                  <p className="text-sm font-medium text-white">{mat.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-400">{mat.qty}</span>
                    <span className={cn('text-xs px-2 py-0.5 rounded',
                      mat.stock === 'good' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
                    )}>{mat.stock === 'good' ? 'In Stock' : 'Low Stock'}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      <RealtimeDataPanel domain="diy" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="diy" /></div>}
      </div>
    </div>
  );
}
