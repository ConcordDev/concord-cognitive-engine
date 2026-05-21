'use client';

/**
 * DeploymentsPanel — publish a model as a callable endpoint, scale and
 * stop replicas. Wires ml.deploy-{create,list,scale,stop}.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Rocket, Plus, Loader2, Square, TrendingUp, CheckCircle, X, Copy,
} from 'lucide-react';

interface Deployment {
  id: string; modelId: string; modelName: string; version: string;
  status: 'active' | 'inactive' | 'scaling';
  endpoint: string; replicas: number; requestsPerSec: number;
  avgLatency: number; errorRate: number; createdAt: string;
}

const STATUS: Record<string, string> = {
  active: 'text-neon-green bg-neon-green/10',
  inactive: 'text-gray-400 bg-gray-400/10',
  scaling: 'text-yellow-400 bg-yellow-400/10',
};

export function DeploymentsPanel({ defaultModelId = '' }: { defaultModelId?: string }) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await lensRun('ml', 'deploy-list', {});
    if (r.data?.ok && r.data.result) setDeployments((r.data.result as { deployments: Deployment[] }).deployments || []);
    else setError(r.data?.error || 'Failed to load deployments');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const scale = async (id: string) => {
    setBusy(id);
    await lensRun('ml', 'deploy-scale', { deploymentId: id });
    await load();
    setBusy(null);
  };
  const stop = async (id: string) => {
    setBusy(id);
    await lensRun('ml', 'deploy-stop', { deploymentId: id });
    await load();
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Rocket className="w-4 h-4 text-neon-purple" /> Deployments
        </h3>
        <button onClick={() => setShowNew(true)} className="btn-neon small purple">
          <Plus className="w-3 h-3 mr-1 inline" /> Deploy Model
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : deployments.length === 0 ? (
        <div className="panel p-12 text-center text-gray-500">
          <Rocket className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No deployments yet</p>
          <p className="text-sm mt-1">Deploy a model to expose a callable endpoint</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deployments.map((dep) => (
            <div key={dep.id} className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-semibold">{dep.modelName}</h4>
                  <p className="text-xs text-gray-500">v{dep.version} · {dep.modelId}</p>
                </div>
                <span className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded ${STATUS[dep.status]}`}>
                  <CheckCircle className="w-3 h-3" />{dep.status}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-400">Endpoint</p>
                  <button onClick={() => navigator.clipboard.writeText(dep.endpoint)}
                    className="text-xs text-neon-cyan font-mono flex items-center gap-1 hover:text-neon-cyan/80">
                    {dep.endpoint}<Copy className="w-3 h-3" />
                  </button>
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
              </div>
              <div className="flex gap-2">
                <button className="btn-neon small" disabled={busy === dep.id || dep.status === 'inactive'}
                  onClick={() => scale(dep.id)}>
                  <TrendingUp className="w-3 h-3 mr-1 inline" /> Scale
                </button>
                <button className="btn-neon small pink" disabled={busy === dep.id || dep.status === 'inactive'}
                  onClick={() => stop(dep.id)}>
                  <Square className="w-3 h-3 mr-1 inline" /> Stop
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <DeployModal defaultModelId={defaultModelId}
          onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function DeployModal({ defaultModelId, onClose, onDone }: {
  defaultModelId: string; onClose: () => void; onDone: () => void;
}) {
  const [cfg, setCfg] = useState({ modelId: defaultModelId, name: '', version: '1.0.0', replicas: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!cfg.modelId.trim()) { setError('Model ID required'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('ml', 'deploy-create', cfg);
    if (r.data?.ok) onDone();
    else { setError(r.data?.error || 'Deploy failed'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Deploy Model</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <input value={cfg.modelId} onChange={(e) => setCfg({ ...cfg, modelId: e.target.value })}
          placeholder="Model ID (e.g. distilbert-base-uncased)"
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
        <input value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
          placeholder="Display name (optional)"
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple" />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">Version
            <input value={cfg.version} onChange={(e) => setCfg({ ...cfg, version: e.target.value })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
          <label className="text-xs text-gray-400">Replicas
            <input type="number" min={1} max={16} value={cfg.replicas}
              onChange={(e) => setCfg({ ...cfg, replicas: parseInt(e.target.value) || 1 })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-lattice-border">
          <button onClick={onClose} className="px-4 py-2 hover:bg-white/10 rounded text-sm">Cancel</button>
          <button onClick={submit} disabled={busy || !cfg.modelId.trim()} className="btn-neon purple disabled:opacity-50">
            {busy ? 'Deploying...' : 'Deploy'}
          </button>
        </div>
      </div>
    </div>
  );
}
