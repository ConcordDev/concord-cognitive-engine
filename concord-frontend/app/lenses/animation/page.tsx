'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clapperboard, Plus, Search, Play, Pause, Layers,
  Clock, Eye, X, Save, Upload, Film,
  BarChart3, Sparkles, Grid, Settings,
  ChevronRight, RotateCcw, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type AnimTab = 'projects' | 'timeline' | 'assets' | 'render' | 'stats';
type AnimType = '2d' | '3d' | 'motion-graphics' | 'stop-motion' | 'pixel' | 'vector';

interface AnimProject {
  id: string;
  title: string;
  type: AnimType;
  fps: number;
  duration: number;
  frameCount: number;
  status: 'draft' | 'in-progress' | 'rendering' | 'complete';
  resolution: { width: number; height: number };
  createdAt: string;
}

const ANIM_TYPES: { id: AnimType; label: string }[] = [
  { id: '2d', label: '2D Animation' },
  { id: '3d', label: '3D Animation' },
  { id: 'motion-graphics', label: 'Motion Graphics' },
  { id: 'stop-motion', label: 'Stop Motion' },
  { id: 'pixel', label: 'Pixel Art' },
  { id: 'vector', label: 'Vector Animation' },
];

export default function AnimationPage() {
  useLensNav('animation');
  const queryClient = useQueryClient();
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('animation');
  const { contextDTUs, isLoading: dtusLoading } = useLensDTUs({ lens: 'animation' });

  const { items: projectItems, isLoading, isError, error, refetch, create: createProject, update: updateProject } = useLensData<AnimProject>('animation', 'project', { seed: [] });
  const projects = useMemo(() => projectItems.map(i => ({ ...(i.data as unknown as AnimProject), id: i.id, title: i.title })), [projectItems]);

  const [tab, setTab] = useState<AnimTab>('projects');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<AnimProject | null>(null);

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<AnimType>('2d');
  const [newFps, setNewFps] = useState('24');
  const [newWidth, setNewWidth] = useState('1920');
  const [newHeight, setNewHeight] = useState('1080');

  // Upload asset via media API — with actual file data
  const assetFileRef = useRef<HTMLInputElement>(null);
  const uploadAssetMutation = useMutation({
    mutationFn: async (file: File) => {
      const arrayBuffer = await file.arrayBuffer();
      const base64Data = btoa(new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), ''));
      return api.post('/api/media/upload', {
        title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        mediaType: 'image',
        mimeType: file.type || 'image/png',
        fileSize: file.size,
        originalFilename: file.name,
        tags: ['animation', 'frame'],
        data: base64Data,
      });
    },
    onSuccess: () => refetch(),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    const data: Partial<AnimProject> = {
      title: newTitle,
      type: newType,
      fps: parseInt(newFps) || 24,
      duration: 0,
      frameCount: 0,
      status: 'draft',
      resolution: { width: parseInt(newWidth) || 1920, height: parseInt(newHeight) || 1080 },
      createdAt: new Date().toISOString(),
    };
    await createProject({ title: newTitle, data: data as unknown as Record<string, unknown> });
    setShowCreateModal(false);
    setNewTitle('');
    refetch();
  }, [newTitle, newType, newFps, newWidth, newHeight, createProject, refetch]);

  const TABS: { id: AnimTab; label: string; icon: typeof Clapperboard }[] = [
    { id: 'projects', label: 'Projects', icon: Film },
    { id: 'timeline', label: 'Timeline', icon: Clock },
    { id: 'assets', label: 'Assets', icon: Layers },
    { id: 'render', label: 'Render', icon: Zap },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
  ];

  return (
    <div data-lens-theme="animation" className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clapperboard className="w-6 h-6 text-orange-400" />
            <h1 className="text-2xl font-bold">Animation</h1>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          </div>
          <div className="flex items-center gap-2">
            <DTUExportButton domain="animation" data={{}} compact />
            <button onClick={() => setShowFeatures(!showFeatures)} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Features</button>
            <button onClick={() => setShowCreateModal(true)} className="px-3 py-1.5 text-xs bg-orange-500/20 border border-orange-500/30 rounded-lg hover:bg-orange-500/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> New Project
            </button>
          </div>
        </div>

        {showFeatures && <LensFeaturePanel lensId="animation" />}
        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />

        {/* Stat Cards — keyframe timeline feel */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Projects', value: projects.length, icon: Film, color: 'text-orange-400' },
            { label: 'Total Frames', value: projects.reduce((s, p) => s + (p.frameCount || 0), 0), icon: Layers, color: 'text-cyan-400' },
            { label: 'Avg FPS', value: projects.length > 0 ? Math.round(projects.reduce((s, p) => s + (p.fps || 24), 0) / projects.length) : 24, icon: Zap, color: 'text-yellow-400' },
            { label: 'DTUs', value: contextDTUs.length, icon: Sparkles, color: 'text-purple-400' },
          ].map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="bg-white/5 border border-white/10 rounded-lg p-3 hover:border-orange-500/30 transition-colors">
              <stat.icon className={cn('w-4 h-4 mb-1', stat.color)} />
              <div className="text-xl font-bold">{stat.value}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">{stat.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Mini Keyframe Timeline Hint */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs text-gray-400 font-medium">Keyframe Timeline</span>
          </div>
          <div className="flex items-center gap-0.5 h-6">
            {Array.from({ length: 32 }).map((_, i) => (
              <motion.div key={i} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.4 + i * 0.02 }} className="flex-1 rounded-sm" style={{ height: `${20 + Math.sin(i * 0.5) * 12 + Math.random() * 8}px`, backgroundColor: i % 8 === 0 ? 'rgba(251,146,60,0.5)' : 'rgba(255,255,255,0.08)' }} />
            ))}
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', tab === t.id ? 'bg-orange-500/20 text-orange-400' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {isError && <ErrorState error={error?.message} onRetry={refetch} />}

        {/* Projects */}
        {tab === 'projects' && (
          <div className="space-y-4">
            {projects.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Clapperboard className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No animation projects yet.</p>
                <button onClick={() => setShowCreateModal(true)} className="mt-3 px-4 py-2 text-xs bg-orange-500/20 rounded-lg hover:bg-orange-500/30">Create Project</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {projects.map(proj => (
                  <motion.div key={proj.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-orange-500/30 transition-colors cursor-pointer" onClick={() => { setSelectedProject(proj); setTab('timeline'); }}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-sm">{proj.title}</h3>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', proj.status === 'complete' ? 'bg-green-500/20 text-green-400' : proj.status === 'rendering' ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-500/20 text-gray-400')}>{proj.status || 'draft'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{proj.type}</span>
                      <span>{proj.fps || 24} fps</span>
                      <span>{proj.frameCount || 0} frames</span>
                      {proj.resolution && <span>{proj.resolution.width}x{proj.resolution.height}</span>}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        {tab === 'timeline' && (
          <div className="space-y-4">
            {selectedProject ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{selectedProject.title}</h2>
                  <div className="flex gap-2">
                    <button className="p-2 bg-white/5 rounded hover:bg-white/10"><Play className="w-4 h-4" /></button>
                    <button className="p-2 bg-white/5 rounded hover:bg-white/10"><Pause className="w-4 h-4" /></button>
                    <button className="p-2 bg-white/5 rounded hover:bg-white/10"><RotateCcw className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <div className="h-16 bg-white/5 rounded flex items-center justify-center text-xs text-gray-500">
                    Timeline - {selectedProject.fps || 24} fps - {selectedProject.frameCount || 0} frames
                  </div>
                  <div className="h-32 bg-white/5 rounded mt-2 flex items-center justify-center text-xs text-gray-500">
                    Frame editor - {selectedProject.type} - {selectedProject.resolution?.width}x{selectedProject.resolution?.height}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-16 text-gray-500 text-sm">Select a project to open its timeline.</div>
            )}
          </div>
        )}

        {/* Assets */}
        {tab === 'assets' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Animation Assets</h2>
              <input ref={assetFileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadAssetMutation.mutate(f); }} />
              <button onClick={() => assetFileRef.current?.click()} disabled={uploadAssetMutation.isPending} className="px-3 py-1.5 text-xs bg-orange-500/20 rounded-lg hover:bg-orange-500/30 flex items-center gap-1 disabled:opacity-50">
                <Upload className="w-3 h-3" /> {uploadAssetMutation.isPending ? 'Uploading...' : 'Upload Asset'}
              </button>
            </div>
            <div className="text-center py-12 text-gray-500 text-sm">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Upload sprites, backgrounds, and frame sequences.
            </div>
          </div>
        )}

        {/* Render */}
        {tab === 'render' && (
          <div className="text-center py-16 text-gray-500">
            <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-2">Render Queue</p>
            <p className="text-xs text-gray-600">Export animations as video, GIF, or sprite sheets via the render engine.</p>
          </div>
        )}

        {/* Stats */}
        {tab === 'stats' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Projects</div>
              <div className="text-2xl font-bold">{projects.length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Animation DTUs</div>
              <div className="text-2xl font-bold">{contextDTUs.length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Total Frames</div>
              <div className="text-2xl font-bold">{projects.reduce((s, p) => s + (p.frameCount || 0), 0)}</div>
            </div>
          </div>
        )}

        {/* Create modal */}
        <AnimatePresence>
          {showCreateModal && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">New Animation Project</h3>
                  <button onClick={() => setShowCreateModal(false)}><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Project title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <select value={newType} onChange={e => setNewType(e.target.value as AnimType)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                    {ANIM_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <div className="grid grid-cols-3 gap-2">
                    <input value={newFps} onChange={e => setNewFps(e.target.value)} placeholder="FPS" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                    <input value={newWidth} onChange={e => setNewWidth(e.target.value)} placeholder="Width" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                    <input value={newHeight} onChange={e => setNewHeight(e.target.value)} placeholder="Height" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  </div>
                  <button onClick={handleCreate} disabled={!newTitle.trim()} className="w-full py-2 bg-orange-500/20 rounded-lg text-sm hover:bg-orange-500/30 disabled:opacity-50">Create</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
