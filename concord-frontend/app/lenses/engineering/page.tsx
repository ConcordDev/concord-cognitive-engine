'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, Cog, FileText, Plus, Trash2, Search, Layers, ChevronDown, CheckCircle, AlertTriangle, Settings, ArrowRight, HardHat, FlaskConical } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ProjectStatus = 'planning' | 'design' | 'review' | 'fabrication' | 'testing' | 'complete';

interface EngineeringProject {
  name: string;
  discipline: string;
  status: ProjectStatus;
  specifications: string;
  tolerances: string;
  materials: string[];
  deadline: string;
}

const STATUS_COLORS: Record<ProjectStatus, string> = {
  planning: 'text-blue-400',
  design: 'text-purple-400',
  review: 'text-yellow-400',
  fabrication: 'text-orange-400',
  testing: 'text-cyan-400',
  complete: 'text-green-400',
};

export default function EngineeringLensPage() {
  useLensNav('engineering');

  const [activeTab, setActiveTab] = useState<'projects' | 'specs' | 'standards'>('projects');
  const [showFeatures, setShowFeatures] = useState(false);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('engineering');

  const { items: projectItems, isLoading, isError, error, refetch, create, update, remove } = useLensData<Record<string, unknown>>('engineering', 'project', { seed: [] });
  const { items: specItems, create: createSpec } = useLensData<Record<string, unknown>>('engineering', 'specification', { seed: [] });
  const runAction = useRunArtifact('engineering');

  const projects = projectItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (EngineeringProject & { id: string; title: string })[];

  const stats = useMemo(() => ({
    total: projects.length,
    specs: specItems.length,
    inProgress: projects.filter(p => p.status && p.status !== 'complete').length,
    completed: projects.filter(p => p.status === 'complete').length,
  }), [projects, specItems]);

  const [newProject, setNewProject] = useState({ name: '', discipline: 'mechanical', specifications: '' });

  const addProject = () => {
    if (!newProject.name.trim()) return;
    create({
      title: newProject.name,
      data: {
        name: newProject.name,
        discipline: newProject.discipline,
        status: 'planning' as ProjectStatus,
        specifications: newProject.specifications,
        tolerances: '',
        materials: [],
        deadline: '',
      },
    });
    setNewProject({ name: '', discipline: 'mechanical', specifications: '' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div data-lens-theme="engineering" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wrench className="w-8 h-8 text-neon-cyan" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Engineering Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">Project management, specifications, and engineering standards</p>
          </div>
        </div>
      </header>

      <RealtimeDataPanel domain="engineering" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="engineering" artifactId={undefined} compact />
      <DTUExportButton domain="engineering" data={{}} compact />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Wrench, label: 'Projects', value: stats.total, color: 'text-neon-cyan' },
          { icon: FileText, label: 'Specs', value: stats.specs, color: 'text-purple-400' },
          { icon: Cog, label: 'In Progress', value: stats.inProgress, color: 'text-yellow-400' },
          { icon: CheckCircle, label: 'Completed', value: stats.completed, color: 'text-green-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 mb-2 ${stat.color}`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Project Phase Pipeline */}
      {projects.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <HardHat className="w-4 h-4 text-neon-cyan" /> Project Pipeline
          </h3>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {(['planning', 'design', 'review', 'fabrication', 'testing', 'complete'] as ProjectStatus[]).map((phase, i) => {
              const count = projects.filter(p => (p.status || 'planning') === phase).length;
              return (
                <div key={phase} className="flex items-center">
                  <div className={`px-3 py-2 rounded-lg text-center min-w-[90px] ${count > 0 ? 'bg-neon-cyan/10 border border-neon-cyan/30' : 'bg-lattice-surface border border-lattice-border'}`}>
                    <p className={`text-lg font-bold ${count > 0 ? 'text-neon-cyan' : 'text-gray-600'}`}>{count}</p>
                    <p className="text-xs text-gray-400 capitalize">{phase}</p>
                  </div>
                  {i < 5 && <ArrowRight className="w-4 h-4 text-gray-600 mx-1 shrink-0" />}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['projects', 'specs', 'standards'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-neon-cyan/20 text-neon-cyan border-b-2 border-neon-cyan' : 'text-gray-400 hover:text-white'}`}
          >
            {tab === 'specs' ? 'Specifications' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'projects' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">New Project</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input value={newProject.name} onChange={e => setNewProject({ ...newProject, name: e.target.value })} placeholder="Project name" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <select value={newProject.discipline} onChange={e => setNewProject({ ...newProject, discipline: e.target.value })} className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm">
                <option value="mechanical">Mechanical</option>
                <option value="electrical">Electrical</option>
                <option value="civil">Civil</option>
                <option value="chemical">Chemical</option>
                <option value="software">Software</option>
                <option value="aerospace">Aerospace</option>
              </select>
              <button onClick={addProject} className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30">
                <Plus className="w-4 h-4 inline mr-1" /> Create
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {projects.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No projects yet.</p>
            ) : (
              projects.map((proj, idx) => (
                <motion.div key={proj.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }} className="panel p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Cog className="w-4 h-4 text-neon-cyan" />
                      <span className="font-medium">{proj.name || proj.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded bg-white/10 ${STATUS_COLORS[proj.status as ProjectStatus] || 'text-gray-400'}`}>
                        {proj.status || 'planning'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{proj.discipline} engineering</p>
                  </div>
                  <button onClick={() => remove(proj.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </motion.div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'specs' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-neon-cyan" /> Specifications Library</h3>
          <p className="text-gray-500 text-sm text-center py-4">Create projects to generate specifications.</p>
        </div>
      )}

      {activeTab === 'standards' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Engineering Standards</h3>
          <div className="space-y-2">
            {['ISO 9001 - Quality Management', 'ISO 14001 - Environmental Management', 'ASME B31.3 - Process Piping', 'IEEE 802.11 - Wireless LAN', 'ASTM Standards - Materials Testing', 'NFPA 70 - National Electrical Code'].map(std => (
              <div key={std} className="flex items-center gap-2 p-2 rounded-lg bg-white/5">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-sm">{std}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="engineering" /></div>}
      </div>
    </div>
  );
}
