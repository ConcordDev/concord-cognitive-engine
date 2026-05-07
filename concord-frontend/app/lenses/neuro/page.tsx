'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Brain, Network, Layers, Plus, Search, Trash2, X,
  BarChart3, Zap, ChevronDown, GitBranch, Target,
  Play, Database, TrendingUp,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ModeTab = 'networks' | 'neurons' | 'training' | 'datasets' | 'experiments' | 'metrics';
type ArtifactType = 'Network' | 'Neuron' | 'TrainingRun' | 'Dataset' | 'Experiment' | 'Metric';
type Status = 'idle' | 'training' | 'converged' | 'diverged' | 'active' | 'archived' | 'running' | 'completed';

interface NeuroArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  architecture?: string; neurons?: number; layers?: number; accuracy?: number; loss?: number;
  optimizer?: string; learningRate?: number; batchSize?: number; epochs?: number; currentEpoch?: number;
  activation?: number; connections?: number; neuronType?: string; layerIndex?: number; bias?: number;
  datasetName?: string; samples?: number; features?: number; classes?: number; splitRatio?: string;
  experimentName?: string; hypothesis?: string; result?: string; metric?: string; value?: number;
  framework?: string; gpuMemory?: string; trainingTime?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Brain; artifactType: ArtifactType }[] = [
  { id: 'networks', label: 'Networks', icon: Network, artifactType: 'Network' },
  { id: 'neurons', label: 'Neurons', icon: Brain, artifactType: 'Neuron' },
  { id: 'training', label: 'Training', icon: Play, artifactType: 'TrainingRun' },
  { id: 'datasets', label: 'Datasets', icon: Database, artifactType: 'Dataset' },
  { id: 'experiments', label: 'Experiments', icon: Target, artifactType: 'Experiment' },
  { id: 'metrics', label: 'Metrics', icon: TrendingUp, artifactType: 'Metric' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle: { label: 'Idle', color: 'gray-400' }, training: { label: 'Training', color: 'blue-400' },
  converged: { label: 'Converged', color: 'green-400' }, diverged: { label: 'Diverged', color: 'red-400' },
  active: { label: 'Active', color: 'cyan-400' }, archived: { label: 'Archived', color: 'gray-400' },
  running: { label: 'Running', color: 'purple-400' }, completed: { label: 'Completed', color: 'emerald-400' },
};

const ARCHITECTURES = ['Feedforward', 'CNN', 'RNN', 'LSTM', 'GRU', 'Transformer', 'GAN', 'Autoencoder', 'ResNet', 'BERT', 'GPT', 'Diffusion', 'Custom'];
const OPTIMIZERS = ['Adam', 'AdamW', 'SGD', 'RMSprop', 'Adagrad', 'Adadelta', 'LAMB', 'LARS'];
const NEURON_TYPES = ['Input', 'Hidden', 'Output', 'Attention', 'Embedding', 'Convolutional', 'Recurrent', 'Pooling'];
const FRAMEWORKS = ['PyTorch', 'TensorFlow', 'JAX', 'Keras', 'ONNX', 'Custom'];

export default function NeuroLensPage() {
  useLensNav('neuro');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('neuro');

  const [activeTab, setActiveTab] = useState<ModeTab>('networks');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<NeuroArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('idle');
  const [formNotes, setFormNotes] = useState('');
  const [formArchitecture, setFormArchitecture] = useState(ARCHITECTURES[0]);
  const [formNeurons, setFormNeurons] = useState('');
  const [formLayers, setFormLayers] = useState('');
  const [formAccuracy, setFormAccuracy] = useState('');
  const [formLoss, setFormLoss] = useState('');
  const [formOptimizer, setFormOptimizer] = useState(OPTIMIZERS[0]);
  const [formLearningRate, setFormLearningRate] = useState('0.001');
  const [formBatchSize, setFormBatchSize] = useState('32');
  const [formEpochs, setFormEpochs] = useState('');
  const [formActivation, setFormActivation] = useState('');
  const [formConnections, setFormConnections] = useState('');
  const [formNeuronType, setFormNeuronType] = useState(NEURON_TYPES[0]);
  const [formLayerIndex, setFormLayerIndex] = useState('');
  const [formSamples, setFormSamples] = useState('');
  const [formFeatures, setFormFeatures] = useState('');
  const [formClasses, setFormClasses] = useState('');
  const [formSplitRatio, setFormSplitRatio] = useState('80/10/10');
  const [formHypothesis, setFormHypothesis] = useState('');
  const [formResult, setFormResult] = useState('');
  const [formMetric, setFormMetric] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formFramework, setFormFramework] = useState(FRAMEWORKS[0]);
  const [formGpuMemory, setFormGpuMemory] = useState('');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Network';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<NeuroArtifact>('neuro', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('neuro');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as NeuroArtifact).description?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as NeuroArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try { await runAction.mutateAsync({ id: targetId, action }); } catch (err) { console.error('Action failed:', err); }
  }, [filtered, runAction]);

  const resetForm = () => {
    setFormName(''); setFormDescription(''); setFormStatus('idle'); setFormNotes('');
    setFormArchitecture(ARCHITECTURES[0]); setFormNeurons(''); setFormLayers('');
    setFormAccuracy(''); setFormLoss(''); setFormOptimizer(OPTIMIZERS[0]);
    setFormLearningRate('0.001'); setFormBatchSize('32'); setFormEpochs('');
    setFormActivation(''); setFormConnections(''); setFormNeuronType(NEURON_TYPES[0]);
    setFormLayerIndex(''); setFormSamples(''); setFormFeatures('');
    setFormClasses(''); setFormSplitRatio('80/10/10'); setFormHypothesis('');
    setFormResult(''); setFormMetric(''); setFormValue('');
    setFormFramework(FRAMEWORKS[0]); setFormGpuMemory('');
  };

  const openCreate = () => { setEditingItem(null); resetForm(); setEditorOpen(true); };
  const openEdit = (item: LensItem<NeuroArtifact>) => {
    const d = item.data as unknown as NeuroArtifact;
    setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || '');
    setFormStatus(d.status || 'idle'); setFormNotes(d.notes || '');
    setFormArchitecture(d.architecture || ARCHITECTURES[0]);
    setFormNeurons(d.neurons?.toString() || ''); setFormLayers(d.layers?.toString() || '');
    setFormAccuracy(d.accuracy?.toString() || ''); setFormLoss(d.loss?.toString() || '');
    setFormOptimizer(d.optimizer || OPTIMIZERS[0]);
    setFormLearningRate(d.learningRate?.toString() || '0.001');
    setFormBatchSize(d.batchSize?.toString() || '32');
    setFormEpochs(d.epochs?.toString() || '');
    setFormActivation(d.activation?.toString() || '');
    setFormConnections(d.connections?.toString() || '');
    setFormNeuronType(d.neuronType || NEURON_TYPES[0]);
    setFormLayerIndex(d.layerIndex?.toString() || '');
    setFormSamples(d.samples?.toString() || '');
    setFormFeatures(d.features?.toString() || '');
    setFormClasses(d.classes?.toString() || '');
    setFormSplitRatio(d.splitRatio || '80/10/10');
    setFormHypothesis(d.hypothesis || ''); setFormResult(d.result || '');
    setFormMetric(d.metric || ''); setFormValue(d.value?.toString() || '');
    setFormFramework(d.framework || FRAMEWORKS[0]);
    setFormGpuMemory(d.gpuMemory || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus,
      description: formDescription, notes: formNotes,
      architecture: formArchitecture, framework: formFramework, gpuMemory: formGpuMemory,
      neurons: formNeurons ? parseInt(formNeurons) : undefined,
      layers: formLayers ? parseInt(formLayers) : undefined,
      accuracy: formAccuracy ? parseFloat(formAccuracy) : undefined,
      loss: formLoss ? parseFloat(formLoss) : undefined,
      optimizer: formOptimizer,
      learningRate: formLearningRate ? parseFloat(formLearningRate) : undefined,
      batchSize: formBatchSize ? parseInt(formBatchSize) : undefined,
      epochs: formEpochs ? parseInt(formEpochs) : undefined,
      activation: formActivation ? parseFloat(formActivation) : undefined,
      connections: formConnections ? parseInt(formConnections) : undefined,
      neuronType: formNeuronType,
      layerIndex: formLayerIndex ? parseInt(formLayerIndex) : undefined,
      samples: formSamples ? parseInt(formSamples) : undefined,
      features: formFeatures ? parseInt(formFeatures) : undefined,
      classes: formClasses ? parseInt(formClasses) : undefined,
      splitRatio: formSplitRatio,
      hypothesis: formHypothesis, result: formResult,
      metric: formMetric,
      value: formValue ? parseFloat(formValue) : undefined,
    };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as NeuroArtifact);
    const totalNeurons = all.reduce((s, n) => s + (n.neurons || 0), 0);
    const totalConnections = all.reduce((s, n) => s + (n.connections || 0), 0);
    const avgAccuracy = all.filter(n => n.accuracy).length > 0
      ? all.filter(n => n.accuracy).reduce((s, n) => s + (n.accuracy || 0), 0) / all.filter(n => n.accuracy).length : 0;
    const trainingRuns = all.filter(n => n.status === 'training' || n.status === 'running').length;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}><Brain className="w-5 h-5 text-neon-pink mb-2" /><p className={ds.textMuted}>Total Neurons</p><p className="text-xl font-bold text-white">{totalNeurons.toLocaleString()}</p></div>
        <div className={ds.panel}><Network className="w-5 h-5 text-neon-blue mb-2" /><p className={ds.textMuted}>Connections</p><p className="text-xl font-bold text-white">{totalConnections.toLocaleString()}</p></div>
        <div className={ds.panel}><Target className="w-5 h-5 text-neon-green mb-2" /><p className={ds.textMuted}>Avg Accuracy</p><p className="text-xl font-bold text-white">{(avgAccuracy * 100).toFixed(1)}%</p></div>
        <div className={ds.panel}><Play className="w-5 h-5 text-neon-purple mb-2" /><p className={ds.textMuted}>Active Training</p><p className="text-xl font-bold text-white">{trainingRuns}</p></div>
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

            {activeArtifactType === 'Network' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Architecture</label><select className={ds.select} value={formArchitecture} onChange={e => setFormArchitecture(e.target.value)}>{ARCHITECTURES.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                <div><label className={ds.label}>Framework</label><select className={ds.select} value={formFramework} onChange={e => setFormFramework(e.target.value)}>{FRAMEWORKS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Neurons</label><input type="number" className={ds.input} value={formNeurons} onChange={e => setFormNeurons(e.target.value)} /></div>
                <div><label className={ds.label}>Layers</label><input type="number" className={ds.input} value={formLayers} onChange={e => setFormLayers(e.target.value)} /></div>
                <div><label className={ds.label}>GPU Mem</label><input className={ds.input} value={formGpuMemory} onChange={e => setFormGpuMemory(e.target.value)} placeholder="8GB" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Accuracy</label><input type="number" step="0.01" className={ds.input} value={formAccuracy} onChange={e => setFormAccuracy(e.target.value)} placeholder="0.0 - 1.0" /></div>
                <div><label className={ds.label}>Loss</label><input type="number" step="0.001" className={ds.input} value={formLoss} onChange={e => setFormLoss(e.target.value)} /></div>
              </div>
            </>)}

            {activeArtifactType === 'Neuron' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Type</label><select className={ds.select} value={formNeuronType} onChange={e => setFormNeuronType(e.target.value)}>{NEURON_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><label className={ds.label}>Layer Index</label><input type="number" className={ds.input} value={formLayerIndex} onChange={e => setFormLayerIndex(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Activation</label><input type="number" step="0.01" className={ds.input} value={formActivation} onChange={e => setFormActivation(e.target.value)} placeholder="0.0 - 1.0" /></div>
                <div><label className={ds.label}>Connections</label><input type="number" className={ds.input} value={formConnections} onChange={e => setFormConnections(e.target.value)} /></div>
              </div>
            </>)}

            {activeArtifactType === 'TrainingRun' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Optimizer</label><select className={ds.select} value={formOptimizer} onChange={e => setFormOptimizer(e.target.value)}>{OPTIMIZERS.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                <div><label className={ds.label}>Framework</label><select className={ds.select} value={formFramework} onChange={e => setFormFramework(e.target.value)}>{FRAMEWORKS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Learning Rate</label><input type="number" step="0.0001" className={ds.input} value={formLearningRate} onChange={e => setFormLearningRate(e.target.value)} /></div>
                <div><label className={ds.label}>Batch Size</label><input type="number" className={ds.input} value={formBatchSize} onChange={e => setFormBatchSize(e.target.value)} /></div>
                <div><label className={ds.label}>Epochs</label><input type="number" className={ds.input} value={formEpochs} onChange={e => setFormEpochs(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Accuracy</label><input type="number" step="0.01" className={ds.input} value={formAccuracy} onChange={e => setFormAccuracy(e.target.value)} /></div>
                <div><label className={ds.label}>Loss</label><input type="number" step="0.001" className={ds.input} value={formLoss} onChange={e => setFormLoss(e.target.value)} /></div>
              </div>
            </>)}

            {activeArtifactType === 'Dataset' && (<>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Samples</label><input type="number" className={ds.input} value={formSamples} onChange={e => setFormSamples(e.target.value)} /></div>
                <div><label className={ds.label}>Features</label><input type="number" className={ds.input} value={formFeatures} onChange={e => setFormFeatures(e.target.value)} /></div>
                <div><label className={ds.label}>Classes</label><input type="number" className={ds.input} value={formClasses} onChange={e => setFormClasses(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Split Ratio (train/val/test)</label><input className={ds.input} value={formSplitRatio} onChange={e => setFormSplitRatio(e.target.value)} placeholder="80/10/10" /></div>
            </>)}

            {activeArtifactType === 'Experiment' && (<>
              <div><label className={ds.label}>Hypothesis</label><textarea className={ds.textarea} rows={2} value={formHypothesis} onChange={e => setFormHypothesis(e.target.value)} /></div>
              <div><label className={ds.label}>Result</label><textarea className={ds.textarea} rows={2} value={formResult} onChange={e => setFormResult(e.target.value)} /></div>
            </>)}

            {activeArtifactType === 'Metric' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Metric Name</label><input className={ds.input} value={formMetric} onChange={e => setFormMetric(e.target.value)} placeholder="F1, Precision, Recall..." /></div>
                <div><label className={ds.label}>Value</label><input type="number" step="0.001" className={ds.input} value={formValue} onChange={e => setFormValue(e.target.value)} /></div>
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
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><Brain className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as NeuroArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.idle;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Brain className="w-5 h-5 text-neon-pink" /><div>
                <p className="text-white font-medium">{d.name || item.title}</p>
                <p className={ds.textMuted}>
                  {d.architecture && <span>{d.architecture} </span>}
                  {d.framework && <span>({d.framework}) </span>}
                  {d.neuronType && <span>{d.neuronType} </span>}
                  {d.neurons && <span>{d.neurons.toLocaleString()} neurons </span>}
                  {d.layers && <span>&middot; {d.layers}L </span>}
                  {d.samples && <span>{d.samples.toLocaleString()} samples </span>}
                  {d.metric && <span>{d.metric} </span>}
                  {d.optimizer && <span>&middot; {d.optimizer} </span>}
                </p>
              </div></div>
              <div className="flex items-center gap-2">
                {d.accuracy !== undefined && <span className="text-xs text-neon-green">{(d.accuracy * 100).toFixed(1)}%</span>}
                {d.loss !== undefined && <span className="text-xs text-yellow-400">loss: {d.loss.toFixed(4)}</span>}
                {d.value !== undefined && <span className="text-xs text-neon-cyan">{d.value.toFixed(3)}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); handleAction('train', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-neon-pink" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="neuro" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center"><Brain className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>Neuro</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Neural networks, neurons, training, datasets, experiments, and metrics</p></div>
        </div>
        <div className="flex items-center gap-2">{runAction.isPending && <span className="text-xs text-neon-pink animate-pulse">AI processing...</span>}<DTUExportButton domain="neuro" data={{}} compact /><button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button></div>
      </header>
      <RealtimeDataPanel domain="neuro" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="neuro" artifactId={items[0]?.id} compact />

      {(() => { const all = items.map(i => i.data as unknown as NeuroArtifact); const totalNeurons = all.reduce((s, n) => s + (n.neurons || 0), 0); const totalConns = all.reduce((s, n) => s + (n.connections || 0), 0); const avgAcc = all.filter(n => n.accuracy).length > 0 ? all.filter(n => n.accuracy).reduce((s, n) => s + (n.accuracy || 0), 0) / all.filter(n => n.accuracy).length : 0; return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><Brain className="w-5 h-5 text-neon-pink mb-2" /><p className={ds.textMuted}>Total Items</p><p className="text-xl font-bold text-white">{items.length}</p></div>
          <div className={ds.panel}><Network className="w-5 h-5 text-neon-blue mb-2" /><p className={ds.textMuted}>Neurons</p><p className="text-xl font-bold text-white">{totalNeurons.toLocaleString()}</p></div>
          <div className={ds.panel}><GitBranch className="w-5 h-5 text-neon-purple mb-2" /><p className={ds.textMuted}>Connections</p><p className="text-xl font-bold text-white">{totalConns.toLocaleString()}</p></div>
          <div className={ds.panel}><Target className="w-5 h-5 text-neon-green mb-2" /><p className={ds.textMuted}>Avg Accuracy</p><p className="text-xl font-bold text-white">{(avgAcc * 100).toFixed(1)}%</p></div>
        </div>
      ); })()}

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="neuro" /></div>}
      </div>
    </div>
  );
}
