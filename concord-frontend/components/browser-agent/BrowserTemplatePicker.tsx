'use client';

import { useEffect, useState, useCallback } from 'react';
import { callBrowserAgentMacro } from '@/lib/api/browser-agent';
import { Loader2, X, Plus, Bookmark, Sparkles } from 'lucide-react';

interface Template {
  id: string; owner_id: string; name: string; description?: string | null;
  category: string; icon?: string | null; goal_template: string;
  default_max_steps: number; default_max_cost_cents: number;
  visibility: string; usage_count: number;
}

interface Props { open: boolean; onClose: () => void; onApplied: (taskId: string) => void; }

export function BrowserTemplatePicker({ open, onClose, onApplied }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Template | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callBrowserAgentMacro<{ templates?: Template[] }>('template_list');
      setTemplates(r?.templates || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) { load(); setActive(null); setVars({}); } }, [open, load]);

  // Extract {{vars}} from the template
  const varNames = active ? Array.from(new Set((active.goal_template.match(/\{\{(\w+)\}\}/g) || []).map((m) => m.slice(2, -2)))) : [];

  const apply = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    try {
      const r = await callBrowserAgentMacro<{ taskId?: string }>('template_apply', { id: active.id, vars });
      if (r.ok && r.taskId) onApplied(r.taskId);
    } finally { setBusy(false); }
  }, [active, vars, onApplied]);

  const publish = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    try {
      const r = await callBrowserAgentMacro<{ dtuId?: string }>('template_publish', { id: active.id });
      if (r.ok) load();
    } finally { setBusy(false); }
  }, [active, load]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-3xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Bookmark className="w-4 h-4 text-cyan-400" /> Browser-agent templates</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-hidden flex">
          <div className="w-64 border-r border-white/10 overflow-y-auto p-2 space-y-1">
            {loading ? <div className="flex items-center justify-center h-32 text-white/40"><Loader2 className="w-4 h-4 animate-spin" /></div> :
             templates.length === 0 ? <div className="text-xs text-white/40 text-center p-4">No templates.</div> :
             templates.map((t) => (
              <button key={t.id} onClick={() => setActive(t)} className={`w-full text-left p-2 rounded text-sm flex items-start gap-2 ${active?.id === t.id ? 'bg-cyan-500/10' : 'hover:bg-white/5'}`}>
                <span className="text-2xl">{t.icon || '🤖'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium truncate">{t.name}</div>
                  <div className="text-xs text-white/40">{t.category} · used {t.usage_count}×</div>
                </div>
              </button>
            ))}
          </div>
          <div className="flex-1 p-4 overflow-y-auto">
            {!active ? (
              <div className="text-center text-white/40 text-sm py-12">Pick a template to instantiate.</div>
            ) : (
              <div className="space-y-3">
                <div className="text-3xl">{active.icon || '🤖'}</div>
                <h4 className="text-white font-semibold">{active.name}</h4>
                {active.description && <p className="text-sm text-white/70">{active.description}</p>}
                <pre className="text-xs text-white/60 bg-white/5 rounded p-2 whitespace-pre-wrap font-mono">{active.goal_template}</pre>
                <hr className="border-white/10" />
                {varNames.length > 0 ? varNames.map((vn) => (
                  <div key={vn}>
                    <label className="text-xs text-white/40">{vn}</label>
                    <input value={vars[vn] || ''} onChange={(e) => setVars({ ...vars, [vn]: e.target.value })} placeholder={vn} className="w-full mt-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
                  </div>
                )) : <div className="text-xs text-white/40">No variables to fill — apply directly.</div>}
                <div className="flex gap-2">
                  <button onClick={apply} disabled={busy} className="flex-1 py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Apply
                  </button>
                  {active.owner_id !== 'system_seed' && (
                    <button onClick={publish} disabled={busy} className="px-3 py-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-sm flex items-center gap-1" title="Publish as agent_spec DTU">
                      <Sparkles className="w-3.5 h-3.5" /> Publish
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
