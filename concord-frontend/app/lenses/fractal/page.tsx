'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { FractalRepos } from '@/components/fractal/FractalRepos';
import { FractalRenderer } from '@/components/fractal/FractalRenderer';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(
    [
      { id: 'tab-patterns', keys: 'p', description: 'Patterns', category: 'navigation', action: () => setActiveTab('patterns') },
      { id: 'tab-nodes', keys: 'n', description: 'Nodes', category: 'navigation', action: () => setActiveTab('nodes') },
      { id: 'tab-generators', keys: 'g', description: 'Generators', category: 'navigation', action: () => setActiveTab('generators') },
      { id: 'tab-iterations', keys: 'i', description: 'Iterations', category: 'navigation', action: () => setActiveTab('iterations') },
      { id: 'tab-exports', keys: 'e', description: 'Exports', category: 'navigation', action: () => setActiveTab('exports') },      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },

    ],
    { lensId: 'fractal' }
  );
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditorOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="flex items-center justify-between mb-4"><h3 className={ds.heading3}>{editingItem ? 'Edit' : 'New'} {activeArtifactType}</h3><button onClick={() => setEditorOpen(false)} className={ds.btnGhost} aria-label="Close"><X className="w-4 h-4" /></button></div>
          <div className="space-y-3">
            <div><label className={ds.label}>Name</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} /></div>
            <div><label className={ds.label}>Description</label><DraftedTextarea lensId="fractal" draftKey="artifact_description" initial={formDescription} onValueChange={setFormDescription} className={ds.textarea} rows={2} /></div>
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
              <div><label className={ds.label}>Parameters (JSON)</label><DraftedTextarea lensId="fractal" draftKey="fractal_parameters" initial={formParameters} onValueChange={setFormParameters} className={ds.textarea} rows={2} placeholder='{"re": -0.7, "im": 0.27}' /></div>
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

            <div><label className={ds.label}>Notes</label><DraftedTextarea lensId="fractal" draftKey="artifact_notes" initial={formNotes} onValueChange={setFormNotes} className={ds.textarea} rows={2} /></div>
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
                <button onClick={e => { e.stopPropagation(); handleAction('generate', item.id); }} className={ds.btnGhost} aria-label="Activate"><Zap className="w-4 h-4 text-neon-purple" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost} aria-label="Delete"><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <LensShell lensId="fractal" asMain={false}>
      <FirstRunTour lensId="fractal" />
      <ManifestActionBar />
      <DepthBadge lensId="fractal" size="sm" className="ml-2" />
      <LensVerticalHero lensId="fractal" className="mx-6 mt-4" />
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

      {/* --- Interactive Fractal Renderer (Mandelbrot/Julia/Burning-Ship/Tricorn/Multibrot) --- */}
      <FractalRenderer />

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="fractal" /></div>}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <FractalRepos />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <a href="#fractal-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to fractal content</a>
          <RecentMineCard domain="fractal" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="fractal" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="fractal" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
