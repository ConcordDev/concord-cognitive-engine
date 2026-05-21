'use client';

/**
 * SpacesPanel — Spaces-style shareable demo apps for models.
 * Wires ml.space-{create,list,delete}.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Sparkles, Plus, Loader2, Trash2, Eye, Heart, Lock, Globe, X } from 'lucide-react';

interface Space {
  id: string; title: string; modelId: string; description: string;
  sdk: string; task: string; visibility: 'public' | 'private';
  url: string; likes: number; views: number; createdAt: string;
}

export function SpacesPanel({ defaultModelId = '' }: { defaultModelId?: string }) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await lensRun('ml', 'space-list', {});
    if (r.data?.ok && r.data.result) setSpaces((r.data.result as { spaces: Space[] }).spaces || []);
    else setError(r.data?.error || 'Failed to load spaces');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    setBusy(id);
    await lensRun('ml', 'space-delete', { spaceId: id });
    await load();
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-neon-purple" /> Demo Spaces
        </h3>
        <button onClick={() => setShowNew(true)} className="btn-neon small purple">
          <Plus className="w-3 h-3 mr-1 inline" /> New Space
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : spaces.length === 0 ? (
        <div className="panel p-12 text-center text-gray-500">
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No demo spaces yet</p>
          <p className="text-sm mt-1">Create a shareable demo app for a model</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {spaces.map((sp) => (
            <div key={sp.id} className="panel p-4">
              <div className="flex items-start justify-between mb-2">
                <h4 className="font-semibold text-sm">{sp.title}</h4>
                <span className={`text-xs flex items-center gap-1 ${sp.visibility === 'private' ? 'text-yellow-400' : 'text-neon-green'}`}>
                  {sp.visibility === 'private' ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                  {sp.visibility}
                </span>
              </div>
              {sp.description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{sp.description}</p>}
              <p className="text-xs text-neon-cyan font-mono mb-2 truncate">{sp.modelId}</p>
              <div className="flex items-center gap-3 text-xs text-gray-400 mb-3">
                <span className="bg-lattice-surface px-1.5 py-0.5 rounded">{sp.sdk}</span>
                <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{sp.views}</span>
                <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{sp.likes}</span>
              </div>
              <div className="flex gap-2">
                <a href={sp.url} className="btn-neon small flex-1 text-center">Open</a>
                <button onClick={() => remove(sp.id)} disabled={busy === sp.id}
                  className="btn-neon small pink" aria-label="Delete">
                  {busy === sp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <SpaceModal defaultModelId={defaultModelId}
          onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function SpaceModal({ defaultModelId, onClose, onDone }: {
  defaultModelId: string; onClose: () => void; onDone: () => void;
}) {
  const [cfg, setCfg] = useState({
    title: '', modelId: defaultModelId, description: '',
    sdk: 'gradio', task: 'text-generation', private: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!cfg.title.trim() || !cfg.modelId.trim()) { setError('Title and model ID required'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('ml', 'space-create', cfg);
    if (r.data?.ok) onDone();
    else { setError(r.data?.error || 'Failed'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">New Demo Space</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <input value={cfg.title} onChange={(e) => setCfg({ ...cfg, title: e.target.value })}
          placeholder="Space title"
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple" />
        <input value={cfg.modelId} onChange={(e) => setCfg({ ...cfg, modelId: e.target.value })}
          placeholder="Model ID"
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono outline-none focus:border-neon-purple" />
        <textarea value={cfg.description} onChange={(e) => setCfg({ ...cfg, description: e.target.value })}
          placeholder="Description (optional)" rows={2}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple resize-none" />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">SDK
            <select value={cfg.sdk} onChange={(e) => setCfg({ ...cfg, sdk: e.target.value })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple">
              <option value="gradio">Gradio</option>
              <option value="streamlit">Streamlit</option>
              <option value="static">Static</option>
            </select>
          </label>
          <label className="text-xs text-gray-400">Task
            <input value={cfg.task} onChange={(e) => setCfg({ ...cfg, task: e.target.value })}
              className="w-full mt-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm outline-none focus:border-neon-purple" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" checked={cfg.private}
            onChange={(e) => setCfg({ ...cfg, private: e.target.checked })} />
          Private space
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-lattice-border">
          <button onClick={onClose} className="px-4 py-2 hover:bg-white/10 rounded text-sm">Cancel</button>
          <button onClick={submit} disabled={busy || !cfg.title.trim() || !cfg.modelId.trim()}
            className="btn-neon purple disabled:opacity-50">
            {busy ? 'Creating...' : 'Create Space'}
          </button>
        </div>
      </div>
    </div>
  );
}
