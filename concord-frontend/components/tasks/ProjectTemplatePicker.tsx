'use client';

import { useState, useEffect, useCallback } from 'react';
import { callTasksMacro } from '@/lib/api/tasks';
import { X, Loader2, FolderPlus, Bookmark } from 'lucide-react';

interface Template {
  id: string; owner_id: string; name: string; description?: string | null;
  category: string; icon?: string | null; visibility: string; usage_count: number;
}

interface Props { open: boolean; onClose: () => void; onApplied: (projectId: string) => void; }

export function ProjectTemplatePicker({ open, onClose, onApplied }: Props) {
  const [tpls, setTpls] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callTasksMacro<{ templates?: Template[] }>('project_template_list');
      setTpls(r?.templates || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) { load(); setActive(null); setName(''); setKey(''); } }, [open, load]);

  const apply = useCallback(async () => {
    if (!active || !name.trim() || !key.trim()) return;
    setBusy(true);
    try {
      const r = await callTasksMacro<{ projectId?: string; reason?: string }>('project_template_apply', {
        id: active.id, name, key: key.toUpperCase(),
      });
      if (r.ok && r.projectId) onApplied(r.projectId);
    } finally { setBusy(false); }
  }, [active, name, key, onApplied]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-3xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-cyan-400" /> Project templates
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden flex">
          <div className="w-64 border-r border-white/10 overflow-y-auto p-2 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-white/40"><Loader2 className="w-4 h-4 animate-spin" /></div>
            ) : tpls.length === 0 ? (
              <div className="text-xs text-white/40 text-center p-4">No templates.</div>
            ) : (
              tpls.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActive(t)}
                  className={`w-full text-left p-2 rounded text-sm flex items-start gap-2 ${active?.id === t.id ? 'bg-cyan-500/10' : 'hover:bg-white/5'}`}
                >
                  <span className="text-2xl">{t.icon || '📋'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium truncate">{t.name}</div>
                    <div className="text-xs text-white/40">{t.category} · used {t.usage_count}×</div>
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="flex-1 p-4 overflow-y-auto">
            {!active ? (
              <div className="text-center text-white/40 text-sm py-12">Pick a template on the left to instantiate.</div>
            ) : (
              <div className="space-y-3">
                <div className="text-3xl">{active.icon || '📋'}</div>
                <h4 className="text-white font-semibold">{active.name}</h4>
                {active.description && <p className="text-sm text-white/70">{active.description}</p>}
                <hr className="border-white/10" />
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
                <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().slice(0, 10))} placeholder="KEY" className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white font-mono" />
                <button
                  onClick={apply}
                  disabled={busy || !name.trim() || key.length < 2}
                  className="w-full py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                  Create project from template
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
