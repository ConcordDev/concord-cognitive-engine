'use client';

/**
 * DocTemplatePicker — modal listing all available templates (mine +
 * workspace + 6 seeded defaults). Clicking one instantiates a new
 * document via docs.template_apply and switches to it.
 */

import { useState, useEffect, useCallback } from 'react';
import { callDocsMacro } from '@/lib/api/docs';
import { X, FileText, Loader2, Plus, Bookmark } from 'lucide-react';

interface Template {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  category: string;
  icon?: string | null;
  visibility: string;
  usage_count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied: (docId: string) => void;
  currentDocId?: string | null;
}

export function DocTemplatePicker({ open, onClose, onApplied, currentDocId }: Props) {
  const [tpls, setTpls] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callDocsMacro<{ templates?: Template[] }>('template_list', { limit: 200 });
      setTpls(r?.templates || []);
    } catch (e) { console.error('template_list', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const apply = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const r = await callDocsMacro<{ id?: string }>('template_apply', { id });
      if (r?.ok && r.id) onApplied(r.id);
    } finally { setBusy(null); }
  }, [onApplied]);

  const saveCurrent = useCallback(async () => {
    if (!currentDocId) return;
    const name = prompt('Template name?');
    if (!name) return;
    setBusy('save');
    try {
      await callDocsMacro('template_save_from_doc', { documentId: currentDocId, name });
      load();
    } finally { setBusy(null); }
  }, [currentDocId, load]);

  const filtered = category ? tpls.filter((t) => t.category === category) : tpls;
  const categories = Array.from(new Set(tpls.map((t) => t.category))).sort();

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-4xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-cyan-400" /> Template library
          </h3>
          <div className="flex gap-2">
            {currentDocId && (
              <button
                onClick={saveCurrent}
                disabled={busy === 'save'}
                className="px-2 py-1 rounded text-xs bg-white/5 hover:bg-white/10 text-white/80 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Save current as template
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 flex-wrap">
          <button
            onClick={() => setCategory('')}
            className={`text-xs px-2 py-1 rounded ${category === '' ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/60 hover:bg-white/5'}`}
          >
            All ({tpls.length})
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`text-xs px-2 py-1 rounded ${category === c ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/60 hover:bg-white/5'}`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-white/40">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-white/40 text-sm py-12">
              No templates in this category.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => apply(t.id)}
                  disabled={busy === t.id}
                  className="text-left p-3 rounded border border-white/10 hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-colors disabled:opacity-40"
                >
                  <div className="text-2xl mb-2">{t.icon || <FileText className="w-5 h-5 text-white/40" />}</div>
                  <div className="text-sm font-medium text-white">{t.name}</div>
                  {t.description && (
                    <div className="text-xs text-white/50 mt-1 line-clamp-2">{t.description}</div>
                  )}
                  <div className="text-xs text-white/30 mt-2 flex items-center justify-between">
                    <span>{t.category}</span>
                    {t.usage_count > 0 && <span>used {t.usage_count}×</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
