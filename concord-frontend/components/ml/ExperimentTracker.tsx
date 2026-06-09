'use client';

/**
 * ExperimentTracker — training-run experiment tracking. Log experiments
 * with metrics, params and artifacts over time. Wires
 * ml.experiment-{start,log,finish,list,delete}.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Beaker, Plus, Loader2, Trash2, Square, Activity, CheckCircle, XCircle, X, LineChart,
} from 'lucide-react';

interface MetricPoint {
  epoch: number; trainLoss: number; valLoss: number; accuracy: number; learningRate: number;
}
interface Experiment {
  id: string;
  name: string;
  modelId: string;
  datasetId: string;
  status: 'running' | 'completed' | 'failed';
  hyperparams: { learningRate: number; batchSize: number; epochs: number; optimizer: string };
  metrics: MetricPoint[];
  tags: string[];
  startedAt: string;
  completedAt: string | null;
}

const STATUS: Record<string, { color: string; Icon: typeof Activity }> = {
  running: { color: 'text-neon-blue', Icon: Activity },
  completed: { color: 'text-neon-green', Icon: CheckCircle },
  failed: { color: 'text-red-400', Icon: XCircle },
};

export function ExperimentTracker() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Experiment | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('ml', 'experiment-list', {});
    if (r.data?.ok && r.data.result) {
      const list = (r.data.result as { experiments: Experiment[] }).experiments || [];
      setExperiments(list);
      setSelected((cur) => (cur ? list.find((e) => e.id === cur.id) || null : null));
    } else setError(r.data?.error || 'Failed to load experiments');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    setBusy(id);
    await lensRun('ml', 'experiment-delete', { experimentId: id });
    if (selected?.id === id) setSelected(null);
    await load();
    setBusy(null);
  };
  const finish = async (id: string, failed: boolean) => {
    setBusy(id);
    await lensRun('ml', 'experiment-finish', { experimentId: id, failed });
    await load();
    setBusy(null);
  };
  const logEpoch = async (exp: Experiment) => {
    setBusy(exp.id);
    const epoch = exp.metrics.length + 1;
    // simulate one training step — deterministic decay curve
    const trainLoss = Math.max(0.02, 2.5 * Math.exp(-epoch / 12) + Math.random() * 0.06);
    const valLoss = trainLoss + 0.04 + Math.random() * 0.1;
    const accuracy = Math.min(0.99, 1 - valLoss / 3);
    await lensRun('ml', 'experiment-log', {
      experimentId: exp.id, epoch,
      trainLoss: Math.round(trainLoss * 1e4) / 1e4,
      valLoss: Math.round(valLoss * 1e4) / 1e4,
      accuracy: Math.round(accuracy * 1e4) / 1e4,
    });
    await load();
    setBusy(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Beaker className="w-4 h-4 text-neon-purple" /> Experiments
          </h3>
          <button onClick={() => setShowNew(true)} className="btn-neon small purple">
            <Plus className="w-3 h-3 mr-1 inline" /> New
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading ? (
          <div className="py-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : experiments.length === 0 ? (
          <div className="panel p-8 text-center text-gray-400 text-sm">
            <Beaker className="w-8 h-8 mx-auto mb-2 opacity-40" />
            No experiments yet. Start one to track training runs.
          </div>
        ) : experiments.map((exp) => {
          const S = STATUS[exp.status] || STATUS.running;
          const progress = exp.hyperparams.epochs > 0
            ? Math.min(100, (exp.metrics.length / exp.hyperparams.epochs) * 100) : 0;
          return (
            <button key={exp.id} onClick={() => setSelected(exp)}
              className={`w-full text-left panel p-3 transition-colors ${selected?.id === exp.id ? 'border-neon-purple' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm truncate">{exp.name}</span>
                <span className={`flex items-center gap-1 text-xs ${S.color}`}>
                  <S.Icon className="w-3 h-3" />{exp.status}
                </span>
              </div>
              <div className="text-xs text-gray-400">
                Epoch {exp.metrics.length}/{exp.hyperparams.epochs}
              </div>
              <div className="mt-1.5 h-1 bg-lattice-surface rounded-full overflow-hidden">
                <div className="h-full bg-neon-purple" style={{ width: `${progress}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      <div className="lg:col-span-2 space-y-4">
        {selected ? (
          <>
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">{selected.name}</h3>
                <div className="flex items-center gap-2">
                  {selected.status === 'running' && (
                    <>
                      <button className="btn-neon small" disabled={busy === selected.id}
                        onClick={() => logEpoch(selected)}>
                        {busy === selected.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Log epoch'}
                      </button>
                      <button className="btn-neon small pink" disabled={busy === selected.id}
                        onClick={() => finish(selected.id, false)}>
                        <Square className="w-3 h-3 mr-1 inline" /> Finish
                      </button>
                    </>
                  )}
                  <button aria-label="Delete" className="btn-neon small pink" disabled={busy === selected.id}
                    onClick={() => remove(selected.id)}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {Object.entries(selected.hyperparams).map(([k, v]) => (
                  <div key={k} className="bg-lattice-surface p-2.5 rounded-lg">
                    <p className="text-xs text-gray-400 capitalize">{k.replace(/([A-Z])/g, ' $1')}</p>
                    <p className="font-mono text-sm">{String(v)}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-3 text-center">
                {(() => {
                  const last = selected.metrics[selected.metrics.length - 1];
                  return [
                    { label: 'Train Loss', value: last?.trainLoss?.toFixed(4) ?? '—', color: 'text-neon-cyan' },
                    { label: 'Val Loss', value: last?.valLoss?.toFixed(4) ?? '—', color: 'text-neon-pink' },
                    { label: 'Accuracy', value: last ? `${(last.accuracy * 100).toFixed(1)}%` : '—', color: 'text-neon-green' },
                    { label: 'Epoch', value: String(selected.metrics.length), color: 'text-neon-purple' },
                  ].map((m) => (
                    <div key={m.label}>
                      <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
                      <p className="text-xs text-gray-400">{m.label}</p>
                    </div>
                  ));
                })()}
              </div>
            </div>
            <div className="panel p-4">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <LineChart className="w-4 h-4 text-neon-cyan" /> Training Curves
              </h4>
              <ChartKit
                kind="line"
                data={selected.metrics.map((m) => ({ ...m }))}
                xKey="epoch"
                series={[
                  { key: 'trainLoss', label: 'Train Loss', color: '#06b6d4' },
                  { key: 'valLoss', label: 'Val Loss', color: '#ec4899' },
                ]}
                height={240}
              />
            </div>
          </>
        ) : (
          <div className="panel p-12 text-center text-gray-400">
            <Beaker className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>Select an experiment to view metrics</p>
          </div>
        )}
      </div>

      {showNew && (
        <NewExperimentModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function NewExperimentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [cfg, setCfg] = useState({
    name: '', modelId: '', datasetId: '',
    learningRate: 0.001, batchSize: 32, epochs: 50, optimizer: 'adam',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!cfg.name.trim()) { setError('Name required'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('ml', 'experiment-start', cfg);
    if (r.data?.ok) onCreated();
    else { setError(r.data?.error || 'Failed to create'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-lg p-6 space-y-4"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">New Experiment</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <input value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
          placeholder="Experiment name"
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple" />
        <div className="grid grid-cols-2 gap-3">
          <input value={cfg.modelId} onChange={(e) => setCfg({ ...cfg, modelId: e.target.value })}
            placeholder="Model ID (optional)"
            className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple" />
          <input value={cfg.datasetId} onChange={(e) => setCfg({ ...cfg, datasetId: e.target.value })}
            placeholder="Dataset ID (optional)"
            className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">Learning rate
            <input type="number" step="0.0001" value={cfg.learningRate}
              onChange={(e) => setCfg({ ...cfg, learningRate: parseFloat(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
          <label className="text-xs text-gray-400">Batch size
            <input type="number" value={cfg.batchSize}
              onChange={(e) => setCfg({ ...cfg, batchSize: parseInt(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
          <label className="text-xs text-gray-400">Epochs
            <input type="number" value={cfg.epochs}
              onChange={(e) => setCfg({ ...cfg, epochs: parseInt(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
          <label className="text-xs text-gray-400">Optimizer
            <select value={cfg.optimizer} onChange={(e) => setCfg({ ...cfg, optimizer: e.target.value })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple">
              <option value="adam">Adam</option>
              <option value="sgd">SGD</option>
              <option value="rmsprop">RMSprop</option>
              <option value="adamw">AdamW</option>
            </select>
          </label>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-lattice-border">
          <button onClick={onClose} className="px-4 py-2 hover:bg-white/10 rounded text-sm">Cancel</button>
          <button onClick={create} disabled={busy || !cfg.name.trim()} className="btn-neon purple disabled:opacity-50">
            {busy ? 'Creating...' : 'Start Experiment'}
          </button>
        </div>
      </div>
    </div>
  );
}
