'use client';

/**
 * DeploymentsPanel — named, versioned handles on hosted Hugging Face models.
 * Invoking one calls the hosted inference API (ml.deploy-invoke) and the
 * stats shown are the real counts from those calls. Concord runs no model
 * servers, so there are no replicas or public URLs.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Rocket, Plus, Loader2, Square, Play, CheckCircle, X, Copy, Send,
} from 'lucide-react';

interface Deployment {
  id: string; modelId: string; modelName: string; version: string;
  status: 'active' | 'inactive';
  invoke?: { domain: string; name: string; input: Record<string, unknown> };
  totalRequests?: number; errorCount?: number; avgLatency: number | null;
  lastInvokedAt?: string | null; createdAt: string;
}

const STATUS: Record<string, string> = {
  active: 'text-neon-green bg-neon-green/10',
  inactive: 'text-gray-400 bg-gray-400/10',
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

  const [tryInput, setTryInput] = useState<Record<string, string>>({});
  const [tryOut, setTryOut] = useState<Record<string, { ok: boolean; text: string }>>({});
  const toggle = async (dep: Deployment) => {
    setBusy(dep.id);
    await lensRun('ml', 'deploy-stop', { deploymentId: dep.id, resume: dep.status === 'inactive' });
    await load();
    setBusy(null);
  };
  const invoke = async (id: string) => {
    const input = (tryInput[id] || '').trim();
    if (!input) return;
    setBusy(id);
    const r = await lensRun('ml', 'deploy-invoke', { deploymentId: id, input });
    setTryOut(prev => ({
      ...prev,
      [id]: r.data?.ok
        ? { ok: true, text: JSON.stringify((r.data.result as { output: unknown }).output, null, 2) }
        : { ok: false, text: r.data?.error || 'Invocation failed' },
    }));
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
        <div className="panel p-12 text-center text-gray-400">
          <Rocket className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No deployments yet</p>
          <p className="text-sm mt-1">Pin a Hugging Face model under a name and call it from here or via the lens API</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deployments.map((dep) => (
            <div key={dep.id} className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-semibold">{dep.modelName}</h4>
                  <p className="text-xs text-gray-400">v{dep.version} · {dep.modelId}</p>
                </div>
                <span className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded ${STATUS[dep.status]}`}>
                  <CheckCircle className="w-3 h-3" />{dep.status}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-400">Call via lens API</p>
                  <button onClick={() => navigator.clipboard.writeText(JSON.stringify({ domain: 'ml', name: 'deploy-invoke', input: { deploymentId: dep.id, input: '...' } }))}
                    title="Copy the POST /api/lens/run body for this deployment"
                    className="text-xs text-neon-cyan font-mono flex items-center gap-1 hover:text-neon-cyan/80">
                    ml.deploy-invoke · {dep.id}<Copy className="w-3 h-3" />
                  </button>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Requests (errors)</p>
                  <p className="font-mono">{dep.totalRequests ?? 0} <span className="text-red-400">({dep.errorCount ?? 0})</span></p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Avg latency</p>
                  <p className="font-mono">{dep.avgLatency != null ? `${dep.avgLatency}ms` : '—'}</p>
                </div>
              </div>
              {dep.status === 'active' && (
                <div className="mb-3 space-y-2">
                  <div className="flex gap-2">
                    <input value={tryInput[dep.id] || ''} onChange={(e) => setTryInput(p => ({ ...p, [dep.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') invoke(dep.id); }}
                      placeholder="Test input" aria-label={`Test input for ${dep.modelName}`} className="input-lattice flex-1 text-sm" />
                    <button className="btn-neon small" disabled={busy === dep.id || !(tryInput[dep.id] || '').trim()} onClick={() => invoke(dep.id)}>
                      {busy === dep.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <Send className="w-3 h-3 inline" />} Invoke
                    </button>
                  </div>
                  {tryOut[dep.id] && (
                    <pre role={tryOut[dep.id].ok ? undefined : 'alert'} className={`text-xs p-2 rounded bg-black/40 overflow-x-auto max-h-48 ${tryOut[dep.id].ok ? 'text-gray-200' : 'text-red-400'}`}>{tryOut[dep.id].text}</pre>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button className={`btn-neon small ${dep.status === 'active' ? 'pink' : ''}`} disabled={busy === dep.id}
                  onClick={() => toggle(dep)}>
                  {dep.status === 'active'
                    ? <><Square className="w-3 h-3 mr-1 inline" /> Stop</>
                    : <><Play className="w-3 h-3 mr-1 inline" /> Resume</>}
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
  const [cfg, setCfg] = useState({ modelId: defaultModelId, name: '', version: '1.0.0' });
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
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
        <div>
          <label className="text-xs text-gray-400">Version
            <input value={cfg.version} onChange={(e) => setCfg({ ...cfg, version: e.target.value })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
        </div>
        <p className="text-xs text-gray-500">Calls go to the hosted Hugging Face inference API; the model must be available there.</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-lattice-border">
          <button onClick={onClose} className="px-4 py-2 hover:bg-white/10 rounded text-sm">Cancel</button>
          <button onClick={submit} disabled={busy || !cfg.modelId.trim()} className="btn-neon purple disabled:opacity-50">
            {busy ? 'Creating...' : 'Create deployment'}
          </button>
        </div>
      </div>
    </div>
  );
}
