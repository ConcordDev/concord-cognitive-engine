'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers } from '@/lib/api/client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Play,
  Square,
  Activity,
  Database,
  Cpu,
  Plus,
  TrendingUp,
  Download,
  Upload,
  RefreshCw,
  Zap,
  Layers,
  Target,
  Clock,
  CheckCircle,
  XCircle,
  Code,
  FileJson,
  Grid3X3,
  List,
  Search,
  X,
  Copy,
  Rocket,
  TestTube,
  Beaker,
  LineChart,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useUIStore } from '@/store/ui';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// Types
interface Model {
  id: string;
  name: string;
  type: 'classification' | 'regression' | 'clustering' | 'generation' | 'embedding' | 'transformer';
  framework: 'pytorch' | 'tensorflow' | 'sklearn' | 'custom';
  status: 'ready' | 'training' | 'trained' | 'failed' | 'deploying' | 'deployed';
  version: string;
  accuracy?: number;
  f1Score?: number;
  loss?: number;
  parameters: number;
  size: string;
  lastTrained?: string;
  description?: string;
  tags?: string[];
  deployedAt?: string;
  endpoint?: string;
}

interface Experiment {
  id: string;
  name: string;
  modelId: string;
  status: 'running' | 'completed' | 'failed' | 'queued';
  hyperparams: Record<string, unknown>;
  metrics: {
    epoch: number;
    trainLoss: number;
    valLoss: number;
    accuracy: number;
    learningRate: number;
  }[];
  startedAt: string;
  completedAt?: string;
  duration?: string;
}

interface Dataset {
  id: string;
  name: string;
  size: number;
  samples: number;
  features: number;
  type: 'tabular' | 'image' | 'text' | 'audio';
  splits: { train: number; val: number; test: number };
  createdAt: string;
}

interface Deployment {
  id: string;
  modelId: string;
  modelName: string;
  version: string;
  status: 'active' | 'inactive' | 'scaling';
  endpoint: string;
  replicas: number;
  requestsPerSec: number;
  avgLatency: number;
  errorRate: number;
  createdAt: string;
}

type Tab = 'models' | 'experiments' | 'datasets' | 'deployments' | 'playground';
type ViewMode = 'grid' | 'list';

// Seed data — empty; all data comes from the backend API
const INITIAL_MODELS: Model[] = [];

const INITIAL_EXPERIMENTS: Experiment[] = [];

const INITIAL_DATASETS: Dataset[] = [];

const INITIAL_DEPLOYMENTS: Deployment[] = [];

export default function MLLensPage() {
  useLensNav('ml');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('ml');
  const queryClient = useQueryClient();
  const { isError, error, refetch, isLoading: isLoadingModels, items: modelItems } = useLensData<Model>('ml', 'model', {
    seed: INITIAL_MODELS.map(m => ({ title: m.name, data: m as unknown as Record<string, unknown> })),
  });
  const { isError: isError2, error: error2, refetch: refetch2, isLoading: isLoadingExperiments, items: expItems } = useLensData<Experiment>('ml', 'experiment', {
    seed: INITIAL_EXPERIMENTS.map(e => ({ title: e.name, data: e as unknown as Record<string, unknown> })),
  });
  const { isError: isError3, error: error3, refetch: refetch3, isLoading: isLoadingDatasets, items: datasetItems } = useLensData<Dataset>('ml', 'dataset', {
    seed: INITIAL_DATASETS.map(d => ({ title: d.name, data: d as unknown as Record<string, unknown> })),
  });
  const { isError: isError4, error: error4, refetch: refetch4, isLoading: isLoadingDeployments, items: deploymentItems } = useLensData<Deployment>('ml', 'deployment', {
    seed: INITIAL_DEPLOYMENTS.map(d => ({ title: d.modelName, data: d as unknown as Record<string, unknown> })),
  });
  const isLoading = isLoadingModels || isLoadingExperiments || isLoadingDatasets || isLoadingDeployments;
  const models: Model[] = modelItems.map(i => ({ ...(i.data as unknown as Model), id: i.id }));
  const experiments: Experiment[] = expItems.map(i => ({ ...(i.data as unknown as Experiment), id: i.id }));
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // State
  const [tab, setTab] = useState<Tab>('models');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [showNewExperiment, setShowNewExperiment] = useState(false);
  const [playgroundInput, setPlaygroundInput] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [playgroundOutput, setPlaygroundOutput] = useState<unknown>(null);
  const [playgroundModel, setPlaygroundModel] = useState<string>('');

  // Queries
  const { items: metricsItems } = useLensData('ml', 'metrics', { noSeed: true });
  const runAction = useRunArtifact('ml');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = modelItems[0]?.id;
    if (!targetId) { setActionResult({ message: 'Add a model first to run analysis.' }); return; }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  // Mutations
  const runInference = useMutation({
    mutationFn: (payload: { modelId: string; input: string }) =>
      apiHelpers.lens.run('ml', payload.modelId, { action: 'infer', params: { input: payload.input } }).then(r => r.data),
    onSuccess: (data) => setPlaygroundOutput(data),
    onError: (err) => console.error('runInference failed:', err instanceof Error ? err.message : err),
  });

  const startTraining = useMutation({
    mutationFn: (config: Record<string, unknown>) => apiHelpers.lens.create('ml', { type: 'training-job', data: config }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-experiments'] });
      setShowNewExperiment(false);
    },
    onError: (err) => console.error('startTraining failed:', err instanceof Error ? err.message : err),
  });

  const deployModel = useMutation({
    mutationFn: (modelId: string) => apiHelpers.lens.run('ml', modelId, { action: 'deploy' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ml-models'] }),
    onError: (err) => console.error('deployModel failed:', err instanceof Error ? err.message : err),
  });

  const stopExperiment = useMutation({
    mutationFn: (expId: string) => apiHelpers.lens.run('ml', expId, { action: 'stop' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-experiments'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Experiment stopped' });
    },
    onError: (err) => useUIStore.getState().addToast({ type: 'error', message: `Failed to stop: ${err instanceof Error ? err.message : 'Unknown error'}` }),
  });

  const scaleDeployment = useMutation({
    mutationFn: (depId: string) => apiHelpers.lens.run('ml', depId, { action: 'scale', params: { replicas: 2 } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-deployments'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Deployment scaling initiated' });
    },
    onError: (err) => useUIStore.getState().addToast({ type: 'error', message: `Scale failed: ${err instanceof Error ? err.message : 'Unknown error'}` }),
  });

  const stopDeployment = useMutation({
    mutationFn: (depId: string) => apiHelpers.lens.run('ml', depId, { action: 'stop-deployment' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-deployments'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Deployment stopped' });
    },
    onError: (err) => useUIStore.getState().addToast({ type: 'error', message: `Stop failed: ${err instanceof Error ? err.message : 'Unknown error'}` }),
  });

  const handleUploadDataset = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json,.parquet,.tsv,.jsonl';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        useUIStore.getState().addToast({ type: 'info', message: `Uploading dataset: ${file.name}` });
      }
    };
    input.click();
  };

  const handleCopyOutput = () => {
    if (playgroundOutput) {
      navigator.clipboard.writeText(JSON.stringify(playgroundOutput, null, 2));
      useUIStore.getState().addToast({ type: 'success', message: 'Output copied to clipboard' });
    }
  };

  const handleExportOutput = () => {
    if (playgroundOutput) {
      const blob = new Blob([JSON.stringify(playgroundOutput, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ml-output-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Data - sourced from persistent backend
  const datasets: Dataset[] = datasetItems.map(i => ({ ...(i.data as unknown as Dataset), id: i.id }));
  const deployments: Deployment[] = deploymentItems.map(i => ({ ...(i.data as unknown as Deployment), id: i.id }));
  const metrics = (metricsItems?.[0]?.data || { gpuUsage: 0, memoryUsage: 0, totalInferences: 0, avgLatency: 0 }) as { gpuUsage: number; memoryUsage: number; totalInferences: number; avgLatency: number };

  // Filtered data
  const filteredModels = useMemo(() => {
    return models.filter((m: Model) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.type.toLowerCase().includes(search.toLowerCase()) ||
      m.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
    );
  }, [models, search]);

  // Draw metrics chart
  useEffect(() => {
    if (tab !== 'experiments' || !selectedExperiment || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const data = selectedExperiment.metrics;
    if (data.length === 0) return;

    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Find min/max
    const maxLoss = Math.max(...data.map(d => Math.max(d.trainLoss, d.valLoss)));
    const minLoss = Math.min(...data.map(d => Math.min(d.trainLoss, d.valLoss)));
    const maxEpoch = data.length;

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (chartH * i / 5);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    // Draw axes labels
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const val = maxLoss - ((maxLoss - minLoss) * i / 5);
      ctx.fillText(val.toFixed(2), padding.left - 5, padding.top + (chartH * i / 5) + 3);
    }

    ctx.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      const epoch = Math.round(maxEpoch * i / 5);
      ctx.fillText(epoch.toString(), padding.left + (chartW * i / 5), h - 10);
    }

    // Draw train loss line
    ctx.beginPath();
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    data.forEach((d, i) => {
      const x = padding.left + (i / (maxEpoch - 1)) * chartW;
      const y = padding.top + ((maxLoss - d.trainLoss) / (maxLoss - minLoss)) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw val loss line
    ctx.beginPath();
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 2;
    data.forEach((d, i) => {
      const x = padding.left + (i / (maxEpoch - 1)) * chartW;
      const y = padding.top + ((maxLoss - d.valLoss) / (maxLoss - minLoss)) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Legend
    ctx.fillStyle = '#00ffff';
    ctx.fillRect(w - 100, 10, 12, 12);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText('Train Loss', w - 85, 20);

    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(w - 100, 28, 12, 12);
    ctx.fillStyle = '#fff';
    ctx.fillText('Val Loss', w - 85, 38);
  }, [tab, selectedExperiment]);

  const statusConfig = {
    ready: { color: 'text-neon-green bg-neon-green/10', icon: CheckCircle },
    training: { color: 'text-neon-blue bg-neon-blue/10 animate-pulse', icon: RefreshCw },
    failed: { color: 'text-red-400 bg-red-400/10', icon: XCircle },
    deploying: { color: 'text-yellow-400 bg-yellow-400/10', icon: Rocket },
    deployed: { color: 'text-neon-purple bg-neon-purple/10', icon: Rocket },
    running: { color: 'text-neon-blue bg-neon-blue/10 animate-pulse', icon: Activity },
    completed: { color: 'text-neon-green bg-neon-green/10', icon: CheckCircle },
    queued: { color: 'text-gray-400 bg-gray-400/10', icon: Clock },
    active: { color: 'text-neon-green bg-neon-green/10', icon: CheckCircle },
    inactive: { color: 'text-gray-400 bg-gray-400/10', icon: Square },
    scaling: { color: 'text-yellow-400 bg-yellow-400/10', icon: TrendingUp }
  };

  const typeConfig: Record<string, { color: string; icon: React.ElementType }> = {
    classification: { color: 'text-neon-purple', icon: Target },
    regression: { color: 'text-neon-blue', icon: TrendingUp },
    clustering: { color: 'text-neon-cyan', icon: Grid3X3 },
    generation: { color: 'text-neon-pink', icon: Zap },
    embedding: { color: 'text-neon-green', icon: Layers },
    transformer: { color: 'text-yellow-400', icon: Brain }
  };


  if (isError || isError2 || isError3 || isError4) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message || error4?.message} onRetry={() => { refetch(); refetch2(); refetch3(); refetch4(); }} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-neon-purple" />
          <p className="text-gray-400">Loading ML data...</p>
        </div>
      </div>
    );
  }
  return (
    <div data-lens-theme="ml" className="p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🤖</span>
          <div>
            <h1 className="text-xl font-bold">ML Lens</h1>
            <p className="text-sm text-gray-400">
              Machine learning model management, training & deployment
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="ml" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewExperiment(true)}
            className="btn-neon purple flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Experiment
          </button>
        </div>
      </header>

      {/* System Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={<Cpu className="w-5 h-5" />}
          label="GPU Usage"
          value={`${metrics.gpuUsage}%`}
          trend={metrics.gpuUsage > 80 ? 'warning' : 'normal'}
          color="blue"
        />
        <MetricCard
          icon={<Database className="w-5 h-5" />}
          label="Memory"
          value={`${metrics.memoryUsage}%`}
          trend={metrics.memoryUsage > 80 ? 'warning' : 'normal'}
          color="purple"
        />
        <MetricCard
          icon={<Zap className="w-5 h-5" />}
          label="Total Inferences"
          value={metrics.totalInferences.toLocaleString()}
          color="cyan"
        />
        <MetricCard
          icon={<Clock className="w-5 h-5" />}
          label="Avg Latency"
          value={`${metrics.avgLatency}ms`}
          color="green"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-lattice-surface/50 p-1 rounded-lg w-fit">
        {[
          { id: 'models', label: 'Models', icon: Brain, badge: models.length },
          { id: 'experiments', label: 'Experiments', icon: Beaker, badge: experiments.filter((e: Experiment) => e.status === 'running').length },
          { id: 'datasets', label: 'Datasets', icon: Database },
          { id: 'deployments', label: 'Deployments', icon: Rocket, badge: deployments.filter(d => d.status === 'active').length },
          { id: 'playground', label: 'Playground', icon: TestTube }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            className={`px-4 py-2 rounded-md flex items-center gap-2 transition-colors ${
              tab === t.id ? 'bg-neon-purple/20 text-neon-purple' : 'hover:bg-white/5'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className={`text-xs px-1.5 rounded ${
                t.id === 'experiments' && t.badge > 0 ? 'bg-neon-blue/30 text-neon-blue' : 'bg-neon-purple/30 text-neon-purple'
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Models Tab */}
      {tab === 'models' && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search models..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg focus:border-neon-purple outline-none"
              />
            </div>
            <div className="flex items-center bg-lattice-surface border border-lattice-border rounded-lg">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'text-neon-purple' : 'text-gray-400'}`}
              >
                <Grid3X3 className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'text-neon-purple' : 'text-gray-400'}`}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Model Grid/List */}
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredModels.map((model: Model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  statusConfig={statusConfig}
                  typeConfig={typeConfig}
                  onSelect={() => setSelectedModel(model)}
                  onDeploy={() => deployModel.mutate(model.id)}
                  isDeploying={deployModel.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredModels.map((model: Model) => (
                <ModelListItem
                  key={model.id}
                  model={model}
                  statusConfig={statusConfig}
                  typeConfig={typeConfig}
                  onSelect={() => setSelectedModel(model)}
                  onDeploy={() => deployModel.mutate(model.id)}
                  isDeploying={deployModel.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Experiments Tab */}
      {tab === 'experiments' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Experiment List */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Beaker className="w-4 h-4 text-neon-purple" />
              Experiments
            </h3>
            <div className="space-y-2">
              {experiments.map((exp: Experiment) => {
                const StatusIcon = statusConfig[exp.status]?.icon || Activity;
                return (
                  <button
                    key={exp.id}
                    onClick={() => setSelectedExperiment(exp)}
                    className={`w-full text-left panel p-4 transition-colors ${
                      selectedExperiment?.id === exp.id ? 'border-neon-purple' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{exp.name}</span>
                      <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${statusConfig[exp.status]?.color}`}>
                        <StatusIcon className="w-3 h-3" />
                        {exp.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-400">
                      <span>Epoch {exp.metrics.length}/{exp.hyperparams.epochs as number}</span>
                      {exp.duration && <span>{exp.duration}</span>}
                    </div>
                    <div className="mt-2 h-1 bg-lattice-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-neon-purple transition-all"
                        style={{ width: `${(exp.metrics.length / (exp.hyperparams.epochs as number)) * 100}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Experiment Detail */}
          <div className="lg:col-span-2 space-y-4">
            {selectedExperiment ? (
              <>
                <div className="panel p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold">{selectedExperiment.name}</h3>
                    <div className="flex items-center gap-2">
                      {selectedExperiment.status === 'running' && (
                        <button className="btn-neon small pink" onClick={() => stopExperiment.mutate(selectedExperiment.id)} disabled={stopExperiment.isPending}>
                          <Square className="w-4 h-4 mr-1" /> {stopExperiment.isPending ? 'Stopping...' : 'Stop'}
                        </button>
                      )}
                      <button className="btn-neon small" onClick={() => {
                        setShowNewExperiment(true);
                        useUIStore.getState().addToast({ type: 'info', message: `Cloning experiment "${selectedExperiment.name}"` });
                      }}>
                        <Copy className="w-4 h-4 mr-1" /> Clone
                      </button>
                    </div>
                  </div>

                  {/* Hyperparameters */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {Object.entries(selectedExperiment.hyperparams).map(([key, value]) => (
                      <div key={key} className="bg-lattice-surface p-3 rounded-lg">
                        <p className="text-xs text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                        <p className="font-mono">{String(value)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Current Metrics */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-neon-cyan">
                        {selectedExperiment.metrics[selectedExperiment.metrics.length - 1]?.trainLoss.toFixed(4) || '—'}
                      </p>
                      <p className="text-xs text-gray-400">Train Loss</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-neon-pink">
                        {selectedExperiment.metrics[selectedExperiment.metrics.length - 1]?.valLoss.toFixed(4) || '—'}
                      </p>
                      <p className="text-xs text-gray-400">Val Loss</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-neon-green">
                        {((selectedExperiment.metrics[selectedExperiment.metrics.length - 1]?.accuracy || 0) * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-gray-400">Accuracy</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-neon-purple">
                        {selectedExperiment.metrics.length}
                      </p>
                      <p className="text-xs text-gray-400">Epoch</p>
                    </div>
                  </div>
                </div>

                {/* Training Chart */}
                <div className="panel p-4">
                  <h4 className="font-semibold mb-4 flex items-center gap-2">
                    <LineChart className="w-4 h-4 text-neon-cyan" />
                    Training Progress
                  </h4>
                  <div className="relative aspect-[2/1] bg-lattice-surface rounded-lg">
                    <canvas
                      ref={canvasRef}
                      width={800}
                      height={400}
                      className="w-full h-full"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="panel p-12 text-center text-gray-400">
                <Beaker className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select an experiment to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Datasets Tab */}
      {tab === 'datasets' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Available Datasets</h3>
            <button className="btn-neon" onClick={handleUploadDataset}>
              <Upload className="w-4 h-4 mr-2" />
              Upload Dataset
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {datasets.map(ds => (
              <div key={ds.id} className="panel p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold">{ds.name}</h4>
                  <span className="text-xs bg-lattice-surface px-2 py-1 rounded capitalize">{ds.type}</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                  <div>
                    <p className="text-gray-400">Samples</p>
                    <p className="font-mono">{ds.samples.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Features</p>
                    <p className="font-mono">{ds.features}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Size</p>
                    <p className="font-mono">{ds.size} GB</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 h-2 bg-neon-blue/30 rounded" style={{ width: `${ds.splits.train * 100}%` }} title={`Train: ${ds.splits.train * 100}%`} />
                  <div className="h-2 bg-neon-purple/30 rounded" style={{ width: `${ds.splits.val * 100}%` }} title={`Val: ${ds.splits.val * 100}%`} />
                  <div className="h-2 bg-neon-pink/30 rounded" style={{ width: `${ds.splits.test * 100}%` }} title={`Test: ${ds.splits.test * 100}%`} />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>Train {ds.splits.train * 100}%</span>
                  <span>Val {ds.splits.val * 100}%</span>
                  <span>Test {ds.splits.test * 100}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deployments Tab */}
      {tab === 'deployments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Active Deployments</h3>
          </div>

          {deployments.length === 0 ? (
            <div className="panel p-12 text-center text-gray-400">
              <Rocket className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No active deployments</p>
              <p className="text-sm mt-1">Deploy a model to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              {deployments.map(dep => (
                <div key={dep.id} className="panel p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="font-semibold">{dep.modelName}</h4>
                      <p className="text-sm text-gray-400">v{dep.version}</p>
                    </div>
                    <span className={`flex items-center gap-1 text-sm px-3 py-1 rounded ${statusConfig[dep.status]?.color}`}>
                      <CheckCircle className="w-4 h-4" />
                      {dep.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-400">Endpoint</p>
                      <code className="text-xs text-neon-cyan">{dep.endpoint}</code>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Replicas</p>
                      <p className="font-mono">{dep.replicas}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Req/sec</p>
                      <p className="font-mono text-neon-green">{dep.requestsPerSec}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Avg Latency</p>
                      <p className="font-mono">{dep.avgLatency}ms</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Error Rate</p>
                      <p className="font-mono text-neon-pink">{dep.errorRate}%</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button className="btn-neon small" onClick={() => scaleDeployment.mutate(dep.id)} disabled={scaleDeployment.isPending}>Scale</button>
                    <button className="btn-neon small" onClick={() => useUIStore.getState().addToast({ type: 'info', message: `Fetching logs for ${dep.modelName}...` })}>Logs</button>
                    <button className="btn-neon small pink" onClick={() => stopDeployment.mutate(dep.id)} disabled={stopDeployment.isPending}>Stop</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Playground Tab */}
      {tab === 'playground' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <TestTube className="w-4 h-4 text-neon-purple" />
              Inference Playground
            </h3>

            <div>
              <label className="text-sm text-gray-400 block mb-2">Select Model</label>
              <select
                value={playgroundModel}
                onChange={e => setPlaygroundModel(e.target.value)}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg focus:border-neon-purple outline-none"
              >
                <option value="">Choose a model...</option>
                {models.filter((m: Model) => m.status === 'ready' || m.status === 'deployed').map((m: Model) => (
                  <option key={m.id} value={m.id}>{m.name} (v{m.version})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-400 block mb-2">Input Data</label>
              <textarea
                value={playgroundInput}
                onChange={e => setPlaygroundInput(e.target.value)}
                placeholder='{"text": "Your input here..."}'
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg h-48 font-mono text-sm focus:border-neon-purple outline-none resize-none"
              />
            </div>

            <button
              onClick={() => runInference.mutate({ modelId: playgroundModel, input: playgroundInput })}
              disabled={!playgroundModel || !playgroundInput || runInference.isPending}
              className="btn-neon purple w-full disabled:opacity-50"
            >
              <Play className="w-4 h-4 mr-2 inline" />
              {runInference.isPending ? 'Running Inference...' : 'Run Inference'}
            </button>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Code className="w-4 h-4 text-neon-green" />
              Output
            </h3>

            <div className="panel p-4 h-[400px] overflow-auto">
              {Boolean(playgroundOutput) ? (
                <pre className="text-sm font-mono text-neon-green whitespace-pre-wrap">
                  {JSON.stringify(playgroundOutput, null, 2)}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <FileJson className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>Run inference to see output</p>
                  </div>
                </div>
              )}
            </div>

            {!!playgroundOutput && (
              <div className="flex gap-2">
                <button className="btn-neon small flex-1" onClick={handleCopyOutput}>
                  <Copy className="w-4 h-4 mr-1" /> Copy
                </button>
                <button className="btn-neon small flex-1" onClick={handleExportOutput}>
                  <Download className="w-4 h-4 mr-1" /> Export
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Model Detail Modal */}
      <AnimatePresence>
        {selectedModel && (
          <ModelDetailModal
            model={selectedModel}
            onClose={() => setSelectedModel(null)}
            onDeploy={() => deployModel.mutate(selectedModel.id)}
            onTrain={() => { setSelectedModel(null); setShowNewExperiment(true); }}
            statusConfig={statusConfig}
            typeConfig={typeConfig}
            isDeploying={deployModel.isPending}
          />
        )}
      </AnimatePresence>

      {/* New Experiment Modal */}
      <AnimatePresence>
        {showNewExperiment && (
          <NewExperimentModal
            models={models}
            datasets={datasets}
            onClose={() => setShowNewExperiment(false)}
            onSubmit={(config: Record<string, unknown>) => startTraining.mutate(config)}
            submitting={startTraining.isPending}
          />
        )}
      </AnimatePresence>

      <RealtimeDataPanel data={realtimeInsights} />
      <UniversalActions domain="ml" artifactId={null} compact />

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-purple" />
          ML Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'modelEvaluate', label: 'Model Evaluate' },
            { action: 'featureImportance', label: 'Feature Importance' },
            { action: 'datasetProfile', label: 'Dataset Profile' },
            { action: 'hyperparameterSuggest', label: 'Hyperparameter Suggest' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'type' in actionResult && 'samples' in actionResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Type: <span className="text-neon-cyan">{String(actionResult.type)}</span></span>
                  <span className="text-gray-400">Samples: <span className="text-neon-cyan">{String(actionResult.samples)}</span></span>
                  {'accuracy' in actionResult && <span className="text-gray-400">Accuracy: <span className="text-neon-green font-bold">{String(actionResult.accuracy)}</span></span>}
                  {'mse' in actionResult && <span className="text-gray-400">MSE: <span className="text-neon-cyan">{String(actionResult.mse)}</span></span>}
                  {'r2' in actionResult && <span className="text-gray-400">R²: <span className="text-neon-green">{String(actionResult.r2)}</span></span>}
                </div>
                {'perClass' in actionResult && Array.isArray(actionResult.perClass) && actionResult.perClass.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Per Class</p>
                    {(actionResult.perClass as Array<Record<string, unknown>>).map((c, i) => (
                      <div key={i} className="flex justify-between text-xs bg-lattice-surface rounded px-2 py-1">
                        <span className="text-gray-300">{String(c.label || c.class)}</span>
                        <span className="text-neon-cyan">{String(c.f1 || c.precision || 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'rankings' in actionResult && Array.isArray(actionResult.rankings) && !('recommended' in actionResult) && (
              <div className="space-y-2">
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>Total Features: <span className="text-neon-cyan">{String(actionResult.totalFeatures)}</span></span>
                  <span>Numeric: <span className="text-neon-cyan">{String(actionResult.numericFeatures)}</span></span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Top Features</p>
                  {(actionResult.rankings as Array<Record<string, unknown>>).slice(0, 5).map((f, i) => (
                    <div key={i} className="flex justify-between text-xs bg-lattice-surface rounded px-2 py-1">
                      <span className="text-gray-300">{String(f.feature || f.name)}</span>
                      <span className="text-neon-green">{String(f.importance || f.score || 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {'rows' in actionResult && 'columns' in actionResult && (
              <div className="space-y-2">
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>Rows: <span className="text-neon-cyan font-bold">{String(actionResult.rows)}</span></span>
                  <span>Columns: <span className="text-neon-cyan font-bold">{String(actionResult.columns)}</span></span>
                  <span>Quality: <span className="text-neon-green font-bold">{String(actionResult.qualityScore)}%</span></span>
                </div>
              </div>
            )}
            {'modelType' in actionResult && 'suggestions' in actionResult && (
              <div className="space-y-2">
                <span className="text-gray-400 text-xs">Model: <span className="text-neon-cyan">{String(actionResult.modelType)}</span></span>
                {'notes' in actionResult && Array.isArray(actionResult.notes) && actionResult.notes.length > 0 && (
                  <div className="space-y-1">
                    {(actionResult.notes as string[]).map((n, i) => <p key={i} className="text-xs text-gray-300">• {n}</p>)}
                  </div>
                )}
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="ml" />
          </div>
        )}
      </div>
    </div>
  );
}

// Sub-components

function MetricCard({ icon, label, value, trend, color }: { icon: React.ReactNode; label: string; value: string; trend?: 'normal' | 'warning'; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'text-neon-blue bg-neon-blue/10',
    purple: 'text-neon-purple bg-neon-purple/10',
    cyan: 'text-neon-cyan bg-neon-cyan/10',
    green: 'text-neon-green bg-neon-green/10'
  };

  return (
    <div className="panel p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
        {icon}
      </div>
      <div>
        <p className={`text-2xl font-bold ${trend === 'warning' ? 'text-yellow-400' : ''}`}>{value}</p>
        <p className="text-sm text-gray-400">{label}</p>
      </div>
    </div>
  );
}

function ModelCard({ model, statusConfig, typeConfig, onSelect, onDeploy, isDeploying }: { model: Model; statusConfig: Record<string, Record<string, unknown>>; typeConfig: Record<string, Record<string, unknown>>; onSelect: () => void; onDeploy: () => void; isDeploying?: boolean }) {
  const StatusIcon = (statusConfig[model.status]?.icon || Activity) as React.ElementType;
  const TypeIcon = (typeConfig[model.type]?.icon || Brain) as React.ElementType;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="panel p-4 cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <TypeIcon className={`w-5 h-5 ${typeConfig[model.type]?.color as string}`} />
          <div>
            <h4 className="font-semibold">{model.name}</h4>
            <p className="text-xs text-gray-400">v{model.version}</p>
          </div>
        </div>
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${statusConfig[model.status]?.color as string}`}>
          <StatusIcon className="w-3 h-3" />
          {model.status}
        </span>
      </div>

      {model.description && (
        <p className="text-sm text-gray-400 mb-3 line-clamp-2">{model.description}</p>
      )}

      <div className="grid grid-cols-3 gap-2 text-sm mb-3">
        {model.accuracy && (
          <div>
            <p className="text-xs text-gray-500">Accuracy</p>
            <p className="font-mono text-neon-green">{(model.accuracy * 100).toFixed(1)}%</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500">Params</p>
          <p className="font-mono">{(model.parameters / 1000000).toFixed(1)}M</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Size</p>
          <p className="font-mono">{model.size}</p>
        </div>
      </div>

      {model.tags && (
        <div className="flex flex-wrap gap-1 mb-3">
          {model.tags.slice(0, 3).map((tag: string) => (
            <span key={tag} className="text-xs bg-lattice-surface px-2 py-0.5 rounded text-gray-400">
              {tag}
            </span>
          ))}
        </div>
      )}

      {model.status === 'trained' && (
        <button
          onClick={(e) => { e.stopPropagation(); onDeploy(); }}
          disabled={isDeploying}
          className="w-full mt-2 py-1.5 text-xs font-medium rounded bg-neon-green/20 text-neon-green hover:bg-neon-green/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
        >
          <Rocket className="w-3 h-3" />
          {isDeploying ? 'Deploying...' : 'Deploy Model'}
        </button>
      )}
    </motion.div>
  );
}

function ModelListItem({ model, statusConfig, typeConfig, onSelect, onDeploy, isDeploying }: { model: Model; statusConfig: Record<string, Record<string, unknown>>; typeConfig: Record<string, Record<string, unknown>>; onSelect: () => void; onDeploy: () => void; isDeploying?: boolean }) {
  const StatusIcon = (statusConfig[model.status]?.icon || Activity) as React.ElementType;
  const TypeIcon = (typeConfig[model.type]?.icon || Brain) as React.ElementType;

  return (
    <div
      onClick={onSelect}
      className="panel p-4 flex items-center gap-4 cursor-pointer hover:border-neon-purple/50"
    >
      <TypeIcon className={`w-6 h-6 ${typeConfig[model.type]?.color as string}`} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{model.name}</span>
          <span className="text-xs text-gray-500">v{model.version}</span>
        </div>
        <p className="text-sm text-gray-400">{model.description}</p>
      </div>
      <div className="flex items-center gap-4 text-sm">
        {model.accuracy && (
          <span className="text-neon-green">{(model.accuracy * 100).toFixed(1)}%</span>
        )}
        <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${statusConfig[model.status]?.color as string}`}>
          <StatusIcon className="w-3 h-3" />
          {model.status}
        </span>
        {model.status === 'ready' && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeploy(); }}
            disabled={isDeploying}
            className="btn-neon small disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Rocket className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function ModelDetailModal({ model, onClose, onDeploy, onTrain, statusConfig, typeConfig, isDeploying }: { model: Model; onClose: () => void; onDeploy: () => void; onTrain: () => void; statusConfig: Record<string, Record<string, unknown>>; typeConfig: Record<string, Record<string, unknown>>; isDeploying?: boolean }) {
  const StatusIcon = (statusConfig[model.status]?.icon || Activity) as React.ElementType;
  const TypeIcon = (typeConfig[model.type]?.icon || Brain) as React.ElementType;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-lattice-border">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${typeConfig[model.type]?.color as string} bg-current/10`}>
                <TypeIcon className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{model.name}</h2>
                <p className="text-gray-400">Version {model.version} · {model.framework}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <span className={`flex items-center gap-1 px-3 py-1 rounded ${statusConfig[model.status]?.color as string}`}>
              <StatusIcon className="w-4 h-4" />
              {model.status}
            </span>
            {model.status === 'ready' && (
              <>
                <button onClick={onDeploy} disabled={isDeploying} className="btn-neon purple disabled:opacity-50 disabled:cursor-not-allowed">
                  <Rocket className="w-4 h-4 mr-2" /> {isDeploying ? 'Deploying...' : 'Deploy'}
                </button>
                <button onClick={onTrain} className="btn-neon">
                  <RefreshCw className="w-4 h-4 mr-2" /> Retrain
                </button>
              </>
            )}
            {model.status === 'deployed' && model.endpoint && (
              <code className="text-xs bg-lattice-surface px-3 py-2 rounded text-neon-cyan">
                {model.endpoint}
              </code>
            )}
          </div>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
          {model.description && (
            <div>
              <h3 className="font-semibold mb-2">Description</h3>
              <p className="text-gray-300">{model.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {model.accuracy && (
              <div className="bg-lattice-surface p-4 rounded-lg text-center">
                <p className="text-2xl font-bold text-neon-green">{(model.accuracy * 100).toFixed(1)}%</p>
                <p className="text-xs text-gray-400">Accuracy</p>
              </div>
            )}
            {model.f1Score && (
              <div className="bg-lattice-surface p-4 rounded-lg text-center">
                <p className="text-2xl font-bold text-neon-purple">{(model.f1Score * 100).toFixed(1)}%</p>
                <p className="text-xs text-gray-400">F1 Score</p>
              </div>
            )}
            {model.loss && (
              <div className="bg-lattice-surface p-4 rounded-lg text-center">
                <p className="text-2xl font-bold text-neon-cyan">{model.loss.toFixed(4)}</p>
                <p className="text-xs text-gray-400">Loss</p>
              </div>
            )}
            <div className="bg-lattice-surface p-4 rounded-lg text-center">
              <p className="text-2xl font-bold">{(model.parameters / 1000000).toFixed(1)}M</p>
              <p className="text-xs text-gray-400">Parameters</p>
            </div>
          </div>

          {model.tags && (
            <div>
              <h3 className="font-semibold mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {model.tags.map((tag: string) => (
                  <span key={tag} className="px-3 py-1 bg-lattice-surface rounded-full text-sm">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-400">Type</p>
              <p className="capitalize">{model.type}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Framework</p>
              <p className="capitalize">{model.framework}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Size</p>
              <p>{model.size}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Last Trained</p>
              <p>{model.lastTrained ? new Date(model.lastTrained).toLocaleDateString() : '—'}</p>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function NewExperimentModal({ models, datasets, onClose, onSubmit, submitting }: { models: Model[]; datasets: Dataset[]; onClose: () => void; onSubmit: (config: Record<string, unknown>) => void; submitting: boolean }) {
  const [config, setConfig] = useState({
    name: '',
    modelId: '',
    datasetId: '',
    learningRate: 0.001,
    batchSize: 32,
    epochs: 50,
    optimizer: 'adam'
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-lg p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">New Experiment</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Experiment Name</label>
            <input
              type="text"
              value={config.name}
              onChange={e => setConfig({ ...config, name: e.target.value })}
              placeholder="My Experiment"
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded focus:border-neon-purple outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Model</label>
              <select
                value={config.modelId}
                onChange={e => setConfig({ ...config, modelId: e.target.value })}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded focus:border-neon-purple outline-none"
              >
                <option value="">Select model...</option>
                {models.map((m: Model) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Dataset</label>
              <select
                value={config.datasetId}
                onChange={e => setConfig({ ...config, datasetId: e.target.value })}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded focus:border-neon-purple outline-none"
              >
                <option value="">Select dataset...</option>
                {datasets.map((d: Dataset) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Learning Rate</label>
              <input
                type="number"
                step="0.0001"
                value={config.learningRate}
                onChange={e => setConfig({ ...config, learningRate: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded focus:border-neon-purple outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Batch Size</label>
              <input
                type="number"
                value={config.batchSize}
                onChange={e => setConfig({ ...config, batchSize: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded focus:border-neon-purple outline-none font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Epochs</label>
              <input
                type="number"
                value={config.epochs}
                onChange={e => setConfig({ ...config, epochs: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded focus:border-neon-purple outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Optimizer</label>
              <select
                value={config.optimizer}
                onChange={e => setConfig({ ...config, optimizer: e.target.value })}
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded focus:border-neon-purple outline-none"
              >
                <option value="adam">Adam</option>
                <option value="sgd">SGD</option>
                <option value="rmsprop">RMSprop</option>
                <option value="adamw">AdamW</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-4 border-t border-lattice-border">
          <button onClick={onClose} className="px-4 py-2 hover:bg-white/10 rounded">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(config)}
            disabled={submitting || !config.name || !config.modelId}
            className="btn-neon purple disabled:opacity-50"
          >
            {submitting ? 'Starting...' : 'Start Training'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
