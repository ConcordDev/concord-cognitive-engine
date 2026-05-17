'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clapperboard, Plus, Play, Pause, Layers,
  Clock, X, Upload, Film,
  BarChart3, Sparkles, RotateCcw, Zap,
  Loader2, XCircle, Spline, Timer, Monitor, BookOpen, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { AnimationReference } from '@/components/animation/AnimationReference';

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

  // Backend action wiring
  const runAction = useRunArtifact('animation');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleAnimAction = async (action: string) => {
    const targetId = selectedProject?.id || projectItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };
  const projects = useMemo(() => projectItems.map(i => ({ ...(i.data as unknown as AnimProject), id: i.id, title: i.title })), [projectItems]);

  const [tab, setTab] = useState<AnimTab>('projects');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<AnimProject | null>(null);

  // Lens-scoped keyboard commands. After Effects / Blender idiom:
  // single-letter tab jumps, n new project.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: 'tab-projects', keys: 'p', description: 'Projects', category: 'navigation', action: () => setTab('projects') },
      { id: 'tab-timeline', keys: 't', description: 'Timeline', category: 'navigation', action: () => setTab('timeline') },
      { id: 'tab-assets', keys: 'a', description: 'Assets', category: 'navigation', action: () => setTab('assets') },
      { id: 'tab-render', keys: 'r', description: 'Render', category: 'navigation', action: () => setTab('render') },
      { id: 'tab-stats', keys: 's', description: 'Stats', category: 'navigation', action: () => setTab('stats') },
      { id: 'new-project', keys: 'n', description: 'New project', category: 'actions', action: () => setShowCreateModal(true) },      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },

    ],
    { lensId: 'animation' }
  );

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<AnimType>('2d');
  const [newFps, setNewFps] = useState('24');
  const [newWidth, setNewWidth] = useState('1920');
  const [newHeight, setNewHeight] = useState('1080');

  // Canvas animation engine
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const currentFrameRef = useRef(0);
  const isPlayingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);

  // Animation rendering engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedProject) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const proj = selectedProject;
    const fps = proj.fps || 24;
    const w = canvas.width;
    const h = canvas.height;
    const frameDuration = 1000 / fps;
    let lastFrameTime = 0;

    // Bouncing shapes state
    const shapes = [
      { type: 'circle' as const, x: w * 0.25, y: h * 0.4, vx: 2.5, vy: 1.8, r: 22, color: 'rgba(251,146,60,0.85)' },
      { type: 'circle' as const, x: w * 0.6, y: h * 0.6, vx: -1.8, vy: 2.2, r: 16, color: 'rgba(34,211,238,0.8)' },
      { type: 'rect' as const, x: w * 0.5, y: h * 0.3, vx: 1.5, vy: -2.0, r: 28, color: 'rgba(168,85,247,0.7)' },
      { type: 'rect' as const, x: w * 0.75, y: h * 0.7, vx: -2.2, vy: 1.5, r: 18, color: 'rgba(74,222,128,0.7)' },
      { type: 'circle' as const, x: w * 0.15, y: h * 0.8, vx: 3.0, vy: -1.2, r: 12, color: 'rgba(251,191,36,0.8)' },
    ];

    function stepShapes() {
      for (const s of shapes) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.x - s.r < 0) { s.x = s.r; s.vx = Math.abs(s.vx); }
        if (s.x + s.r > w) { s.x = w - s.r; s.vx = -Math.abs(s.vx); }
        if (s.y - s.r < 0) { s.y = s.r; s.vy = Math.abs(s.vy); }
        if (s.y + s.r > h) { s.y = h - s.r; s.vy = -Math.abs(s.vy); }
      }
    }

    function drawFrame(frame: number) {
      if (!ctx) return;
      // Background
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 40) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += 40) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }

      // Shapes
      for (const s of shapes) {
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 12;
        if (s.type === 'circle') {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r + Math.sin(frame * 0.1) * 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const pulse = Math.sin(frame * 0.08) * 4;
          const halfR = s.r + pulse;
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(frame * 0.02);
          ctx.fillRect(-halfR / 2, -halfR / 2, halfR, halfR);
          ctx.restore();
        }
        ctx.shadowBlur = 0;
      }

      // Motion trail lines connecting shapes
      ctx.strokeStyle = 'rgba(251,146,60,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(shapes[0].x, shapes[0].y);
      for (let i = 1; i < shapes.length; i++) {
        ctx.lineTo(shapes[i].x, shapes[i].y);
      }
      ctx.stroke();

      // Frame counter overlay
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(8, 8, 130, 44);
      ctx.strokeStyle = 'rgba(251,146,60,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(8, 8, 130, 44);
      ctx.fillStyle = 'rgba(251,146,60,0.9)';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`Frame: ${frame}`, 16, 26);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '10px monospace';
      ctx.fillText(`${fps} fps | ${proj.type}`, 16, 42);
    }

    // Draw initial frame immediately
    drawFrame(currentFrameRef.current);

    function tick(timestamp: number) {
      if (!isPlayingRef.current) {
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      if (timestamp - lastFrameTime >= frameDuration) {
        lastFrameTime = timestamp;
        stepShapes();
        const next = currentFrameRef.current + 1;
        currentFrameRef.current = next;
        setCurrentFrame(next);
        drawFrame(next);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [selectedProject]);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const handleResetTimeline = useCallback(() => {
    setIsPlaying(false);
    setCurrentFrame(0);
    currentFrameRef.current = 0;
    // Redraw at frame 0
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('Frame: 0 (Reset)', 16, 26);
      }
    }
  }, []);

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
    <LensShell lensId="animation" asMain={false}>
      <ManifestActionBar />
      <DepthBadge lensId="animation" size="sm" className="ml-2" />
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
            <button onClick={() => { queryClient.invalidateQueries({ queryKey: ['lens-data', 'animation'] }); refetch(); }} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10" title="Refresh">
              <RotateCcw className="w-3 h-3" />
            </button>
            <button onClick={() => setShowFeatures(!showFeatures)} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Features</button>
            <button onClick={() => setShowCreateModal(true)} className="px-3 py-1.5 text-xs bg-orange-500/20 border border-orange-500/30 rounded-lg hover:bg-orange-500/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> New Project
            </button>
          </div>
        </div>

        {showFeatures && <LensFeaturePanel lensId="animation" />}
        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />
      <UniversalActions domain="animation" artifactId={null} compact />

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

        {(isLoading || dtusLoading) && (
          <div className="flex items-center justify-center py-4">
            <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-gray-400">Loading...</span>
          </div>
        )}

        {isError && <ErrorState error={error?.message} onRetry={refetch} />}

        {/* Projects */}
        {tab === 'projects' && (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <input
                ref={searchInputRef}
              value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search projects..."
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-3 pr-8 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:border-orange-500/30"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {projects.filter(p => !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.type?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Clapperboard className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No animation projects yet.</p>
                <button onClick={() => setShowCreateModal(true)} className="mt-3 px-4 py-2 text-xs bg-orange-500/20 rounded-lg hover:bg-orange-500/30">Create Project</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {projects.filter(p => !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.type?.toLowerCase().includes(searchQuery.toLowerCase())).map(proj => (
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
                      <button
                        onClick={e => { e.stopPropagation(); const nextStatus = proj.status === 'draft' ? 'in-progress' : proj.status === 'in-progress' ? 'rendering' : proj.status === 'rendering' ? 'complete' : 'draft'; updateProject(proj.id, { data: { status: nextStatus } as unknown as Record<string, unknown> }).then(() => refetch()); }}
                        className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        title="Advance status"
                      >
                        Advance
                      </button>
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
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 font-mono tabular-nums">
                      Frame {currentFrame} | {selectedProject.fps || 24} fps | {selectedProject.resolution?.width}x{selectedProject.resolution?.height}
                    </span>
                    <div className="flex gap-1">
                      <button onClick={handlePlayPause} className={cn('p-2 rounded transition-colors', isPlaying ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30' : 'bg-white/5 text-white hover:bg-white/10')}>
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button onClick={handleResetTimeline} className="p-2 bg-white/5 rounded hover:bg-white/10" aria-label="Rotate ccw"><RotateCcw className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <canvas
                    ref={canvasRef}
                    width={640}
                    height={320}
                    className="w-full rounded border border-white/5"
                    style={{ imageRendering: 'auto', background: '#0a0a0f' }}
                  />
                  {/* Scrub bar */}
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-[10px] text-gray-500 font-mono w-16 tabular-nums">F {currentFrame}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-orange-500/50 rounded-full transition-[width] duration-100" style={{ width: `${Math.min(100, (currentFrame % 240) / 2.4)}%` }} />
                    </div>
                    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', isPlaying ? 'text-orange-400 bg-orange-500/10' : 'text-gray-500 bg-white/5')}>
                      {isPlaying ? 'PLAYING' : 'PAUSED'}
                    </span>
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

        {/* Render & Computational Actions */}
        {tab === 'render' && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-semibold">Animation Compute Actions</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button onClick={() => handleAnimAction('interpolateKeyframes')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-cyan-500/50 transition-colors disabled:opacity-50">
                  {isRunning === 'interpolateKeyframes' ? <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" /> : <Spline className="w-5 h-5 text-cyan-400" />}
                  <span className="text-xs text-gray-300">Interpolate Keyframes</span>
                </button>
                <button onClick={() => handleAnimAction('timingAnalysis')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-purple-500/50 transition-colors disabled:opacity-50">
                  {isRunning === 'timingAnalysis' ? <Loader2 className="w-5 h-5 text-purple-400 animate-spin" /> : <Timer className="w-5 h-5 text-purple-400" />}
                  <span className="text-xs text-gray-300">Timing Analysis</span>
                </button>
                <button onClick={() => handleAnimAction('optimizeFPS')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-green-500/50 transition-colors disabled:opacity-50">
                  {isRunning === 'optimizeFPS' ? <Loader2 className="w-5 h-5 text-green-400 animate-spin" /> : <Monitor className="w-5 h-5 text-green-400" />}
                  <span className="text-xs text-gray-300">Optimize FPS</span>
                </button>
                <button onClick={() => handleAnimAction('storyboardSequence')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-orange-500/50 transition-colors disabled:opacity-50">
                  {isRunning === 'storyboardSequence' ? <Loader2 className="w-5 h-5 text-orange-400 animate-spin" /> : <BookOpen className="w-5 h-5 text-orange-400" />}
                  <span className="text-xs text-gray-300">Storyboard Sequence</span>
                </button>
              </div>
            </div>

            {/* Action Result Display */}
            {actionResult && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-orange-400" /> Result</h3>
                  <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white" aria-label="Xcircle"><XCircle className="w-4 h-4" /></button>
                </div>

                {/* Interpolate Keyframes Result */}
                {actionResult.totalFrames !== undefined && actionResult.sampleFrames !== undefined && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-cyan-400">{actionResult.keyframeCount as number}</p><p className="text-[10px] text-gray-500">Keyframes</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-orange-400">{actionResult.fps as number}</p><p className="text-[10px] text-gray-500">FPS</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-purple-400">{actionResult.totalFrames as number}</p><p className="text-[10px] text-gray-500">Total Frames</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-green-400">{actionResult.durationSeconds as number}s</p><p className="text-[10px] text-gray-500">Duration</p></div>
                    </div>
                    {(actionResult.sampleFrames as Array<{ frame: number; time: number; value: number }>)?.length > 0 && (
                      <div className="flex items-end gap-1 h-16">
                        {(actionResult.sampleFrames as Array<{ frame: number; time: number; value: number }>).map((f, i) => (
                          <div key={i} className="flex-1 bg-cyan-400/30 rounded-t" style={{ height: `${Math.max(10, Math.min(100, Math.abs(f.value) * 2))}%` }} title={`Frame ${f.frame}: ${f.value}`} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Timing Analysis Result */}
                {actionResult.totalDuration !== undefined && actionResult.sequences !== undefined && !actionResult.sampleFrames && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-purple-400">{actionResult.totalDuration as number}s</p><p className="text-[10px] text-gray-500">Total Duration</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-cyan-400">{actionResult.totalFrames as number}</p><p className="text-[10px] text-gray-500">Total Frames</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-orange-400">{actionResult.overlappingPairs as number}</p><p className="text-[10px] text-gray-500">Overlaps</p></div>
                    </div>
                    {(actionResult.sequences as Array<{ name: string; duration: number; delay: number; easing: string }>)?.map((seq, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 bg-white/5 rounded text-xs">
                        <span className="text-white font-medium w-24 truncate">{seq.name}</span>
                        <span className="text-gray-400">{seq.duration}s</span>
                        <span className="text-gray-500">delay: {seq.delay}s</span>
                        <span className="text-purple-400 ml-auto">{seq.easing}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Optimize FPS Result */}
                {actionResult.recommendedFPS !== undefined && actionResult.frameTimeMs !== undefined && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-gray-400">{actionResult.currentFPS as number}</p><p className="text-[10px] text-gray-500">Current FPS</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-green-400">{actionResult.recommendedFPS as number}</p><p className="text-[10px] text-gray-500">Recommended</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-cyan-400">{actionResult.frameTimeMs as number}ms</p><p className="text-[10px] text-gray-500">Frame Time</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-orange-400">{actionResult.targetDevice as string}</p><p className="text-[10px] text-gray-500">Target</p></div>
                    </div>
                    <div className={cn('flex items-center gap-2 text-xs p-2 rounded', (actionResult.withinBudget as boolean) ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400')}>
                      {(actionResult.withinBudget as boolean) ? <Sparkles className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      {(actionResult.withinBudget as boolean) ? 'Within performance budget' : 'Over complexity budget'}
                    </div>
                    {(actionResult.tips as string[])?.map((tip, i) => (
                      <div key={i} className="text-xs text-gray-400 flex items-center gap-2"><span className="text-orange-400">-</span> {tip}</div>
                    ))}
                  </div>
                )}

                {/* Storyboard Sequence Result */}
                {actionResult.scenes !== undefined && actionResult.sceneCount !== undefined && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-orange-400">{actionResult.sceneCount as number}</p><p className="text-[10px] text-gray-500">Scenes</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-cyan-400">{actionResult.totalDuration as number}s</p><p className="text-[10px] text-gray-500">Total</p></div>
                      <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-purple-400">{actionResult.avgSceneDuration as number}s</p><p className="text-[10px] text-gray-500">Avg Scene</p></div>
                    </div>
                    {(actionResult.scenes as Array<{ scene: number; name: string; startTime: number; duration: number; description: string }>)?.map((s) => (
                      <div key={s.scene} className="flex items-center gap-3 p-2 bg-white/5 rounded text-xs">
                        <span className="text-orange-400 font-bold w-6 text-center">{s.scene}</span>
                        <span className="text-white font-medium flex-1 truncate">{s.name}</span>
                        <span className="text-gray-500">{s.startTime}s</span>
                        <span className="text-gray-400">{s.duration}s</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Fallback */}
                {!!actionResult.message && !actionResult.totalFrames && !actionResult.sequences && !actionResult.recommendedFPS && !actionResult.scenes && (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                )}
              </motion.div>
            )}

            <div className="text-center py-8 text-gray-500">
              <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs text-gray-600">Export animations as video, GIF, or sprite sheets via the render engine.</p>
            </div>
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
                  <button onClick={() => setShowCreateModal(false)} aria-label="Close"><X className="w-4 h-4" /></button>
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
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <AnimationReference />
      </section>
    </div>
    </LensShell>
  );
}
