'use client';

/**
 * ChatMemoryPanel — ChatGPT-Memory parity surface.
 *
 * Lists my facts, lets me toggle / edit / forget each one, lets me
 * save a new fact. Backed by chat.memory_* macros from Sprint A.
 */

import { useState, useEffect, useCallback } from 'react';
import { callChatMacro, type MemoryFact } from '@/lib/api/chat-extras';
import { Brain, Plus, X, Loader2, Trash2, Pencil, Check, EyeOff, Eye } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId?: string | null;
}

const KINDS: MemoryFact['kind'][] = ['preference', 'identity', 'goal', 'context', 'constraint', 'fact'];

export function ChatMemoryPanel({ open, onClose, projectId = null }: Props) {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<MemoryFact['kind']>('preference');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await callChatMacro<{ memory?: MemoryFact[] }>('memory_list', {
        projectId, includeDisabled: true,
      });
      setFacts(r?.memory || []);
    } finally { setBusy(false); }
  }, [projectId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const save = useCallback(async () => {
    if (!draft.trim()) return;
    await callChatMacro('memory_save', { fact: draft, kind: draftKind, projectId });
    setDraft(''); setDraftKind('preference');
    load();
  }, [draft, draftKind, projectId, load]);

  const toggle = useCallback(async (f: MemoryFact) => {
    await callChatMacro('memory_update', { id: f.id, enabled: !f.enabled });
    load();
  }, [load]);

  const remove = useCallback(async (id: number) => {
    if (!confirm('Forget this fact permanently?')) return;
    await callChatMacro('memory_delete', { id });
    load();
  }, [load]);

  const startEdit = useCallback((f: MemoryFact) => {
    setEditingId(f.id); setEditText(f.fact);
  }, []);

  const saveEdit = useCallback(async () => {
    if (editingId == null || !editText.trim()) return;
    await callChatMacro('memory_update', { id: editingId, fact: editText });
    setEditingId(null); setEditText('');
    load();
  }, [editingId, editText, load]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Brain className="w-4 h-4 text-cyan-400" />
            {projectId ? 'Project memory' : 'Memory'}
            <span className="text-xs text-white/40 font-normal">— {facts.filter((f) => f.enabled).length} active</span>
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-3 border-b border-white/10 space-y-2 bg-cyan-500/5">
          <div className="text-xs text-white/60">Add a fact the assistant should remember:</div>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) save(); }}
              placeholder="e.g. 'prefers concise replies' or 'lives in Berlin'"
              className="flex-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
            />
            <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as MemoryFact['kind'])} className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
              {KINDS.map((k) => <option key={k} value={k} className="bg-black">{k}</option>)}
            </select>
            <button
              onClick={save}
              disabled={!draft.trim()}
              className="px-3 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {busy && (
            <div className="flex items-center justify-center py-8 text-white/40">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}
          {!busy && facts.length === 0 && (
            <div className="text-center text-white/40 text-sm py-8">No facts saved yet.</div>
          )}
          {facts.map((f) => (
            <div key={f.id} className={`flex items-start gap-2 px-2 py-1.5 rounded ${f.enabled ? 'bg-white/5' : 'bg-white/5 opacity-50'}`}>
              <span className="text-xs uppercase text-cyan-300/70 mt-1 w-16 flex-shrink-0">{f.kind}</span>
              <div className="flex-1 min-w-0">
                {editingId === f.id ? (
                  <input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                    autoFocus
                    className="w-full px-1 py-0.5 text-sm bg-cyan-500/10 border border-cyan-400/30 rounded text-white"
                  />
                ) : (
                  <div className="text-sm text-white/90 break-words">{f.fact}</div>
                )}
                {f.hit_count > 0 && <div className="text-xs text-white/40 mt-0.5">recalled {f.hit_count}×</div>}
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {editingId === f.id ? (
                  <button onClick={saveEdit} className="p-1 rounded hover:bg-white/10 text-green-400"><Check className="w-3.5 h-3.5" /></button>
                ) : (
                  <>
                    <button onClick={() => toggle(f)} className="p-1 rounded hover:bg-white/10 text-white/60" title={f.enabled ? 'Disable' : 'Enable'}>
                      {f.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => startEdit(f)} className="p-1 rounded hover:bg-white/10 text-white/60"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(f.id)} className="p-1 rounded hover:bg-red-500/20 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 px-3 py-2 text-xs text-white/40">
          Saved facts are injected into the system prompt for future chats. Project facts rank above global.
        </div>
      </div>
    </div>
  );
}
