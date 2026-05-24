'use client';

/**
 * DatasetHubPanel — browse Hugging Face datasets + manage per-user
 * versioned datasets with splits. Wires ml.dataset-hub,
 * ml.dataset-register, ml.dataset-list.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Database, Search, Download, Heart, Loader2, RefreshCw, Plus, ExternalLink, X, Layers,
} from 'lucide-react';

interface HubDataset {
  id: string; name: string; author: string; downloads: number; likes: number;
  tags: string[]; updatedAt: string | null; url: string;
}
interface DatasetVersion {
  version: number; samples: number; features: number; sizeMb: number; note: string; createdAt: string;
}
interface MyDataset {
  id: string; name: string; type: string;
  splits: { train: number; val: number; test: number };
  latestVersion: number; versions: DatasetVersion[]; createdAt: string;
}

function fmt(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function DatasetHubPanel() {
  const [mode, setMode] = useState<'hub' | 'mine'>('hub');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('downloads');
  const [hub, setHub] = useState<HubDataset[]>([]);
  const [mine, setMine] = useState<MyDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadHub = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await lensRun('ml', 'dataset-hub', { query, sort, limit: 24 });
    if (r.data?.ok && r.data.result) setHub((r.data.result as { datasets: HubDataset[] }).datasets || []);
    else { setError(r.data?.error || 'Failed to load datasets'); setHub([]); }
    setLoading(false);
  }, [query, sort]);

  const loadMine = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await lensRun('ml', 'dataset-list', {});
    if (r.data?.ok && r.data.result) setMine((r.data.result as { datasets: MyDataset[] }).datasets || []);
    else setError(r.data?.error || 'Failed to load datasets');
    setLoading(false);
  }, []);

  useEffect(() => { if (mode === 'hub') loadHub(); else loadMine(); }, [mode, loadHub, loadMine]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex bg-lattice-surface/50 p-1 rounded-lg">
          <button onClick={() => setMode('hub')}
            className={`px-3 py-1.5 rounded text-sm ${mode === 'hub' ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400'}`}>
            HF Datasets
          </button>
          <button onClick={() => setMode('mine')}
            className={`px-3 py-1.5 rounded text-sm ${mode === 'mine' ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400'}`}>
            My Datasets
          </button>
        </div>
        {mode === 'mine' && (
          <button onClick={() => setShowNew(true)} className="btn-neon small purple ml-auto">
            <Plus className="w-3 h-3 mr-1 inline" /> Register Dataset
          </button>
        )}
      </div>

      {mode === 'hub' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadHub()}
              placeholder="Search Hugging Face datasets..."
              className="w-full pl-9 pr-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)}
            className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none">
            <option value="downloads">Most downloaded</option>
            <option value="likes">Most liked</option>
            <option value="lastModified">Recently updated</option>
          </select>
          <button onClick={loadHub} disabled={loading} className="btn-neon small purple disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : mode === 'hub' ? (
        hub.length === 0 ? <div className="py-10 text-center text-gray-400">No datasets found.</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {hub.map((d) => (
              <a key={d.id} href={d.url} target="_blank" rel="noreferrer"
                className="panel p-4 hover:border-neon-purple/50 transition-colors block">
                <div className="flex items-start gap-2 mb-2">
                  <Database className="w-4 h-4 text-neon-cyan mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate" title={d.id}>{d.name}</p>
                    <p className="text-xs text-gray-400 truncate">{d.author}</p>
                  </div>
                  <ExternalLink className="w-3 h-3 text-gray-400 ml-auto shrink-0" />
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400 mb-2">
                  <span className="flex items-center gap-1"><Download className="w-3 h-3" />{fmt(d.downloads)}</span>
                  <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{fmt(d.likes)}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {d.tags.slice(0, 3).map((t) => (
                    <span key={t} className="text-[10px] bg-lattice-surface px-1.5 py-0.5 rounded text-gray-400">{t}</span>
                  ))}
                </div>
              </a>
            ))}
          </div>
        )
      ) : (
        mine.length === 0 ? (
          <div className="panel p-10 text-center text-gray-400 text-sm">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
            No datasets registered. Register one to track versions and splits.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mine.map((ds) => {
              const latest = ds.versions[0];
              return (
                <div key={ds.id} className="panel p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Database className="w-4 h-4 text-neon-cyan" />{ds.name}
                    </h4>
                    <span className="text-xs bg-lattice-surface px-2 py-0.5 rounded capitalize">{ds.type}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
                    <span className="flex items-center gap-1">
                      <Layers className="w-3 h-3" />v{ds.latestVersion} ({ds.versions.length} versions)
                    </span>
                    {latest && <span>{latest.samples.toLocaleString()} samples · {latest.features} features</span>}
                  </div>
                  <div className="flex gap-1 mb-1">
                    <div className="h-2 bg-neon-blue/40 rounded" style={{ width: `${ds.splits.train * 100}%` }} title={`Train ${ds.splits.train * 100}%`} />
                    <div className="h-2 bg-neon-purple/40 rounded" style={{ width: `${ds.splits.val * 100}%` }} title={`Val ${ds.splits.val * 100}%`} />
                    <div className="h-2 bg-neon-pink/40 rounded" style={{ width: `${ds.splits.test * 100}%` }} title={`Test ${ds.splits.test * 100}%`} />
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>Train {Math.round(ds.splits.train * 100)}%</span>
                    <span>Val {Math.round(ds.splits.val * 100)}%</span>
                    <span>Test {Math.round(ds.splits.test * 100)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {showNew && (
        <RegisterDatasetModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); loadMine(); }} />
      )}
    </div>
  );
}

function RegisterDatasetModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [cfg, setCfg] = useState({
    name: '', type: 'tabular', samples: 0, features: 0, sizeMb: 0,
    train: 0.7, val: 0.15, test: 0.15, note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!cfg.name.trim()) { setError('Name required'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('ml', 'dataset-register', cfg);
    if (r.data?.ok) onDone();
    else { setError(r.data?.error || 'Failed'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-lg p-6 space-y-4"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Register Dataset Version</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-400">Re-registering an existing name appends a new version.</p>
        <input value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
          placeholder="Dataset name"
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple" />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">Type
            <select value={cfg.type} onChange={(e) => setCfg({ ...cfg, type: e.target.value })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple">
              <option value="tabular">Tabular</option>
              <option value="image">Image</option>
              <option value="text">Text</option>
              <option value="audio">Audio</option>
            </select>
          </label>
          <label className="text-xs text-gray-400">Size (MB)
            <input type="number" value={cfg.sizeMb} onChange={(e) => setCfg({ ...cfg, sizeMb: parseFloat(e.target.value) || 0 })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
          <label className="text-xs text-gray-400">Samples
            <input type="number" value={cfg.samples} onChange={(e) => setCfg({ ...cfg, samples: parseInt(e.target.value) || 0 })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
          <label className="text-xs text-gray-400">Features
            <input type="number" value={cfg.features} onChange={(e) => setCfg({ ...cfg, features: parseInt(e.target.value) || 0 })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(['train', 'val', 'test'] as const).map((s) => (
            <label key={s} className="text-xs text-gray-400 capitalize">{s} split
              <input type="number" step="0.05" value={cfg[s]}
                onChange={(e) => setCfg({ ...cfg, [s]: parseFloat(e.target.value) || 0 })}
                className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
            </label>
          ))}
        </div>
        <input value={cfg.note} onChange={(e) => setCfg({ ...cfg, note: e.target.value })}
          placeholder="Version note (optional)"
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-lattice-border">
          <button onClick={onClose} className="px-4 py-2 hover:bg-white/10 rounded text-sm">Cancel</button>
          <button onClick={submit} disabled={busy || !cfg.name.trim()} className="btn-neon purple disabled:opacity-50">
            {busy ? 'Saving...' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
}
