'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Layers, GitBranch, Infinity, Plus, Search, Trash2, X,
  BarChart3, Zap, ChevronDown,
  Sparkles, Eye, Settings2, Activity,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ModeTab = 'patterns' | 'nodes' | 'generators' | 'iterations' | 'exports';
type ArtifactType = 'Pattern' | 'Node' | 'Generator' | 'Iteration' | 'Export';
type Status = 'active' | 'converged' | 'evolving' | 'archived' | 'pending' | 'completed';

interface FractalArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  depth?: number; complexity?: number; dimensions?: number; symmetry?: string;
  algorithm?: string; seed?: string; scale?: number; iterations?: number;
  nodeType?: string; children?: number; parentId?: string; weight?: number;
  formula?: string; parameters?: string; colorScheme?: string;
  format?: string; resolution?: string; exportDate?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Layers; artifactType: ArtifactType }[] = [
  { id: 'patterns', label: 'Patterns', icon: Sparkles, artifactType: 'Pattern' },
  { id: 'nodes', label: 'Nodes', icon: GitBranch, artifactType: 'Node' },
  { id: 'generators', label: 'Generators', icon: Settings2, artifactType: 'Generator' },
  { id: 'iterations', label: 'Iterations', icon: Infinity, artifactType: 'Iteration' },
  { id: 'exports', label: 'Exports', icon: Eye, artifactType: 'Export' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'green-400' }, converged: { label: 'Converged', color: 'neon-cyan' },
  evolving: { label: 'Evolving', color: 'neon-purple' }, archived: { label: 'Archived', color: 'gray-400' },
  pending: { label: 'Pending', color: 'yellow-400' }, completed: { label: 'Completed', color: 'emerald-400' },
};

const ALGORITHMS = ['Mandelbrot', 'Julia', 'Sierpinski', 'Koch', 'Dragon Curve', 'Barnsley Fern', 'L-System', 'IFS', 'Cellular Automata', 'Custom'];
const SYMMETRY_TYPES = ['Rotational', 'Reflective', 'Translational', 'Scale', 'Fractal', 'None'];
const COLOR_SCHEMES = ['Spectral', 'Viridis', 'Plasma', 'Inferno', 'Magma', 'Grayscale', 'Rainbow', 'Custom'];

export default function FractalLensPage() {
  useLensNav('fractal');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('fractal');

  const [activeTab, setActiveTab] = useState<ModeTab>('patterns');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<FractalArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formDepth, setFormDepth] = useState('');
  const [formComplexity, setFormComplexity] = useState('');
  const [formDimensions, setFormDimensions] = useState('2');
  const [formSymmetry, setFormSymmetry] = useState(SYMMETRY_TYPES[0]);
  const [formAlgorithm, setFormAlgorithm] = useState(ALGORITHMS[0]);
  const [formSeed, setFormSeed] = useState('');
  const [formScale, setFormScale] = useState('1');
  const [formIterations, setFormIterations] = useState('');
  const [formFormula, setFormFormula] = useState('');
  const [formParameters, setFormParameters] = useState('');
  const [formColorScheme, setFormColorScheme] = useState(COLOR_SCHEMES[0]);
  const [formNodeType, setFormNodeType] = useState('');
  const [formChildren, setFormChildren] = useState('');
  const [formFormat, setFormFormat] = useState('PNG');
  const [formResolution, setFormResolution] = useState('1920x1080');

  // --- Fractal canvas rendering state ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fractalCenter, setFractalCenter] = useState<[number, number]>([-0.5, 0]);
  const [fractalZoom, setFractalZoom] = useState(200);
  const [isRendering, setIsRendering] = useState(false);
  const renderIdRef = useRef(0);

  const fractalIterations = useMemo(() => {
    const v = parseInt(formIterations);
    return v > 0 ? Math.min(v, 1000) : 100;
  }, [formIterations]);

  // Mandelbrot rendering effect — renders in chunked rows to avoid blocking UI
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size canvas to its CSS container
    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width * (window.devicePixelRatio || 1));
    const height = Math.floor(rect.height * (window.devicePixelRatio || 1));
    if (width === 0 || height === 0) return;
    canvas.width = width;
    canvas.height = height;

    const maxIter = fractalIterations;
    const cx = fractalCenter[0];
    const cy = fractalCenter[1];
    const zoom = fractalZoom;

    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    const currentRenderId = ++renderIdRef.current;
    setIsRendering(true);

    // Chunked row rendering via requestAnimationFrame
    let row = 0;
    const ROWS_PER_CHUNK = 16;

    const renderChunk = () => {
      if (currentRenderId !== renderIdRef.current) return; // superseded
      const endRow = Math.min(row + ROWS_PER_CHUNK, height);

      for (let py = row; py < endRow; py++) {
        for (let px = 0; px < width; px++) {
          const x0 = (px - width / 2) / zoom + cx;
          const y0 = (py - height / 2) / zoom + cy;
          let x = 0, y = 0, iter = 0;
          while (x * x + y * y <= 4 && iter < maxIter) {
            const xTemp = x * x - y * y + x0;
            y = 2 * x * y + y0;
            x = xTemp;
            iter++;
          }

          const idx = (py * width + px) * 4;
          if (iter === maxIter) {
            data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
          } else {
            // Smooth coloring
            const t = iter / maxIter;
            data[idx]     = Math.floor(9 * (1 - t) * t * t * t * 255);     // R
            data[idx + 1] = Math.floor(15 * (1 - t) * (1 - t) * t * t * 255); // G
            data[idx + 2] = Math.floor(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255); // B
            data[idx + 3] = 255;
          }
        }
      }

      // Put partial results
      ctx.putImageData(imgData, 0, 0);
      row = endRow;

      if (row < height) {
        requestAnimationFrame(renderChunk);
      } else {
        setIsRendering(false);
      }
    };

    requestAnimationFrame(renderChunk);

    return () => {
      // Bump the latest render id to invalidate any in-flight chunked render.
      // Reading the latest ref value here is intentional, not a stale-closure bug.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      renderIdRef.current++;
    };
  }, [fractalCenter, fractalZoom, fractalIterations]);

  // Zoom on click: left-click zooms in (2x), right-click zooms out (0.5x)
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = (e.clientX - rect.left) * dpr;
    const py = (e.clientY - rect.top) * dpr;
    const newCx = (px - canvas.width / 2) / fractalZoom + fractalCenter[0];
    const newCy = (py - canvas.height / 2) / fractalZoom + fractalCenter[1];
    setFractalCenter([newCx, newCy]);
    setFractalZoom(z => z * 2);
  }, [fractalZoom, fractalCenter]);

  const handleCanvasRightClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setFractalZoom(z => Math.max(z / 2, 25));
  }, []);

  const handleResetView = useCallback(() => {
    setFractalCenter([-0.5, 0]);
    setFractalZoom(200);
  }, []);

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Pattern';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<FractalArtifact>('fractal', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('fractal');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as FractalArtifact).description?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as FractalArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try { await runAction.mutateAsync({ id: targetId, action }); } catch (err) { console.error('Action failed:', err); }
  }, [filtered, runAction]);

  const resetForm = () => {
    setFormName(''); setFormDescription(''); setFormStatus('active'); setFormNotes('');
    setFormDepth(''); setFormComplexity(''); setFormDimensions('2');
    setFormSymmetry(SYMMETRY_TYPES[0]); setFormAlgorithm(ALGORITHMS[0]);
    setFormSeed(''); setFormScale('1'); setFormIterations('');
    setFormFormula(''); setFormParameters(''); setFormColorScheme(COLOR_SCHEMES[0]);
    setFormNodeType(''); setFormChildren(''); setFormFormat('PNG'); setFormResolution('1920x1080');
  };

  const openCreate = () => { setEditingItem(null); resetForm(); setEditorOpen(true); };
  const openEdit = (item: LensItem<FractalArtifact>) => {
    const d = item.data as unknown as FractalArtifact;
    setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || '');
    setFormStatus(d.status || 'active'); setFormNotes(d.notes || '');
    setFormDepth(d.depth?.toString() || ''); setFormComplexity(d.complexity?.toString() || '');
    setFormDimensions(d.dimensions?.toString() || '2'); setFormSymmetry(d.symmetry || SYMMETRY_TYPES[0]);
    setFormAlgorithm(d.algorithm || ALGORITHMS[0]); setFormSeed(d.seed || '');
    setFormScale(d.scale?.toString() || '1'); setFormIterations(d.iterations?.toString() || '');
    setFormFormula(d.formula || ''); setFormParameters(d.parameters || '');
    setFormColorScheme(d.colorScheme || COLOR_SCHEMES[0]);
    setFormNodeType(d.nodeType || ''); setFormChildren(d.children?.toString() || '');
    setFormFormat(d.format || 'PNG'); setFormResolution(d.resolution || '1920x1080');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus,
      description: formDescription, notes: formNotes,
      depth: formDepth ? parseInt(formDepth) : undefined,
      complexity: formComplexity ? parseFloat(formComplexity) : undefined,
      dimensions: formDimensions ? parseInt(formDimensions) : undefined,
      symmetry: formSymmetry, algorithm: formAlgorithm, seed: formSeed,
      scale: formScale ? parseFloat(formScale) : undefined,
      iterations: formIterations ? parseInt(formIterations) : undefined,
      formula: formFormula, parameters: formParameters, colorScheme: formColorScheme,
      nodeType: formNodeType, children: formChildren ? parseInt(formChildren) : undefined,
      format: formFormat, resolution: formResolution,
    };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as FractalArtifact);
    const totalIterations = all.reduce((s, p) => s + (p.iterations || 0), 0);
    const maxDepth = all.reduce((m, p) => Math.max(m, p.depth || 0), 0);
    const avgComplexity = all.filter(p => p.complexity).length > 0
      ? all.filter(p => p.complexity).reduce((s, p) => s + (p.complexity || 0), 0) / all.filter(p => p.complexity).length : 0;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}><Sparkles className="w-5 h-5 text-neon-purple mb-2" /><p className={ds.textMuted}>Total Patterns</p><p className="text-xl font-bold text-white">{items.length}</p></div>
        <div className={ds.panel}><Infinity className="w-5 h-5 text-neon-cyan mb-2" /><p className={ds.textMuted}>Total Iterations</p><p className="text-xl font-bold text-white">{totalIterations.toLocaleString()}</p></div>
        <div className={ds.panel}><Layers className="w-5 h-5 text-neon-green mb-2" /><p className={ds.textMuted}>Max Depth</p><p className="text-xl font-bold text-white">{maxDepth}</p></div>
        <div className={ds.panel}><Activity className="w-5 h-5 text-neon-pink mb-2" /><p className={ds.textMuted}>Avg Complexity</p><p className="text-xl font-bold text-white">{avgComplexity.toFixed(2)}</p></div>
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
            <div><label className={ds.label}>Status</label><select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>

            {(activeArtifactType === 'Pattern' || activeArtifactType === 'Generator') && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Algorithm</label><select className={ds.select} value={formAlgorithm} onChange={e => setFormAlgorithm(e.target.value)}>{ALGORITHMS.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                <div><label className={ds.label}>Color Scheme</label><select className={ds.select} value={formColorScheme} onChange={e => setFormColorScheme(e.target.value)}>{COLOR_SCHEMES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Depth</label><input type="number" className={ds.input} value={formDepth} onChange={e => setFormDepth(e.target.value)} /></div>
                <div><label className={ds.label}>Iterations</label><input type="number" className={ds.input} value={formIterations} onChange={e => setFormIterations(e.target.value)} /></div>
                <div><label className={ds.label}>Scale</label><input type="number" step="0.1" className={ds.input} value={formScale} onChange={e => setFormScale(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Symmetry</label><select className={ds.select} value={formSymmetry} onChange={e => setFormSymmetry(e.target.value)}>{SYMMETRY_TYPES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label className={ds.label}>Dimensions</label><input type="number" className={ds.input} value={formDimensions} onChange={e => setFormDimensions(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Formula</label><input className={ds.input} value={formFormula} onChange={e => setFormFormula(e.target.value)} placeholder="z = z^2 + c" /></div>
              <div><label className={ds.label}>Seed Value</label><input className={ds.input} value={formSeed} onChange={e => setFormSeed(e.target.value)} /></div>
              <div><label className={ds.label}>Parameters (JSON)</label><textarea className={ds.textarea} rows={2} value={formParameters} onChange={e => setFormParameters(e.target.value)} placeholder='{"re": -0.7, "im": 0.27}' /></div>
            </>)}

            {activeArtifactType === 'Node' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Node Type</label><input className={ds.input} value={formNodeType} onChange={e => setFormNodeType(e.target.value)} placeholder="Branch, Leaf, Root..." /></div>
                <div><label className={ds.label}>Children</label><input type="number" className={ds.input} value={formChildren} onChange={e => setFormChildren(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Depth</label><input type="number" className={ds.input} value={formDepth} onChange={e => setFormDepth(e.target.value)} /></div>
                <div><label className={ds.label}>Complexity</label><input type="number" step="0.01" className={ds.input} value={formComplexity} onChange={e => setFormComplexity(e.target.value)} /></div>
              </div>
            </>)}

            {activeArtifactType === 'Iteration' && (<>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Iterations</label><input type="number" className={ds.input} value={formIterations} onChange={e => setFormIterations(e.target.value)} /></div>
                <div><label className={ds.label}>Depth</label><input type="number" className={ds.input} value={formDepth} onChange={e => setFormDepth(e.target.value)} /></div>
                <div><label className={ds.label}>Complexity</label><input type="number" step="0.01" className={ds.input} value={formComplexity} onChange={e => setFormComplexity(e.target.value)} /></div>
              </div>
            </>)}

            {activeArtifactType === 'Export' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Format</label><select className={ds.select} value={formFormat} onChange={e => setFormFormat(e.target.value)}><option value="PNG">PNG</option><option value="SVG">SVG</option><option value="JPEG">JPEG</option><option value="WebP">WebP</option><option value="JSON">JSON</option></select></div>
                <div><label className={ds.label}>Resolution</label><input className={ds.input} value={formResolution} onChange={e => setFormResolution(e.target.value)} placeholder="1920x1080" /></div>
              </div>
            </>)}

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
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><Sparkles className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as FractalArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.active;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Sparkles className="w-5 h-5 text-neon-purple" /><div>
                <p className="text-white font-medium">{d.name || item.title}</p>
                <p className={ds.textMuted}>
                  {d.algorithm && <span>{d.algorithm} </span>}
                  {d.depth && <span>Depth:{d.depth} </span>}
                  {d.iterations && <span>x{d.iterations} </span>}
                  {d.symmetry && <span>&middot; {d.symmetry} </span>}
                  {d.nodeType && <span>{d.nodeType} </span>}
                  {d.children && <span>{d.children} children </span>}
                  {d.format && <span>{d.format} </span>}
                </p>
              </div></div>
              <div className="flex items-center gap-2">
                {d.complexity && <span className="text-xs text-neon-cyan">{d.complexity.toFixed(2)}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); handleAction('generate', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-neon-purple" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="fractal" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center"><Sparkles className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>Fractal</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Fractal patterns, nodes, generators, iterations, and exports</p></div>
        </div>
        <div className="flex items-center gap-2">{runAction.isPending && <span className="text-xs text-neon-purple animate-pulse">AI processing...</span>}<DTUExportButton domain="fractal" data={{}} compact /><button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button></div>
      </header>
      <RealtimeDataPanel domain="fractal" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="fractal" artifactId={items[0]?.id} compact />

      {(() => { const all = items.map(i => i.data as unknown as FractalArtifact); const totalIter = all.reduce((s, p) => s + (p.iterations || 0), 0); const maxDepth = all.reduce((m, p) => Math.max(m, p.depth || 0), 0); const algos = [...new Set(all.map(a => a.algorithm).filter(Boolean))].length; return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><Sparkles className="w-5 h-5 text-neon-purple mb-2" /><p className={ds.textMuted}>Total Items</p><p className="text-xl font-bold text-white">{items.length}</p></div>
          <div className={ds.panel}><Infinity className="w-5 h-5 text-neon-cyan mb-2" /><p className={ds.textMuted}>Iterations</p><p className="text-xl font-bold text-white">{totalIter.toLocaleString()}</p></div>
          <div className={ds.panel}><Layers className="w-5 h-5 text-neon-green mb-2" /><p className={ds.textMuted}>Max Depth</p><p className="text-xl font-bold text-white">{maxDepth}</p></div>
          <div className={ds.panel}><GitBranch className="w-5 h-5 text-neon-blue mb-2" /><p className={ds.textMuted}>Algorithms</p><p className="text-xl font-bold text-white">{algos}</p></div>
        </div>
      ); })()}

      {/* --- Fractal Canvas Renderer --- */}
      <div className={cn(ds.panel, 'relative overflow-hidden')}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-neon-purple" />
            <h2 className={ds.heading3}>Fractal Renderer</h2>
            {isRendering && <span className="text-xs text-neon-cyan animate-pulse ml-2">Rendering...</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>Iterations: {fractalIterations}</span>
            <span>&middot;</span>
            <span>Zoom: {fractalZoom.toFixed(0)}x</span>
            <span>&middot;</span>
            <span>Center: ({fractalCenter[0].toFixed(4)}, {fractalCenter[1].toFixed(4)})</span>
            <button onClick={handleResetView} className={cn(ds.btnGhost, 'text-xs ml-2')}>Reset View</button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-2">Left-click to zoom in &middot; Right-click to zoom out &middot; Adjust Iterations in the editor form to change detail level</p>
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onContextMenu={handleCanvasRightClick}
          className="w-full rounded-lg cursor-crosshair bg-black"
          style={{ height: '420px' }}
        />
      </div>

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="fractal" /></div>}
      </div>
    </div>
  );
}
