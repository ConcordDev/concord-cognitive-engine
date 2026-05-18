'use client';

/**
 * ChatPersonaPicker — ChatGPT-Custom-GPTs parity.
 *
 * Modal with two views: pick a persona (default), or create one.
 * On apply, returns the system prompt + brain slot to the caller
 * so the chat session can switch persona mid-conversation.
 */

import { useState, useEffect, useCallback } from 'react';
import { callChatMacro, type ChatPersona } from '@/lib/api/chat-extras';
import { User, X, Plus, Loader2, Check, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (persona: { id: string; name: string; systemPrompt: string; brainSlot: string }) => void;
}

const BRAINS = ['conscious', 'subconscious', 'utility', 'repair', 'multimodal'] as const;

export function ChatPersonaPicker({ open, onClose, onApply }: Props) {
  const [personas, setPersonas] = useState<ChatPersona[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    name: '', description: '', icon: '', systemPrompt: '',
    brainSlot: 'conscious' as typeof BRAINS[number],
    visibility: 'private' as 'private' | 'workspace' | 'public',
  });

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await callChatMacro<{ personas?: ChatPersona[] }>('persona_list', { limit: 100 });
      setPersonas(r?.personas || []);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { if (open) { load(); setCreating(false); } }, [open, load]);

  const submitDraft = useCallback(async () => {
    if (!draft.name.trim() || !draft.systemPrompt.trim()) return;
    setBusy(true);
    try {
      await callChatMacro('persona_create', draft);
      setCreating(false);
      setDraft({ name: '', description: '', icon: '', systemPrompt: '', brainSlot: 'conscious', visibility: 'private' });
      load();
    } finally { setBusy(false); }
  }, [draft, load]);

  const apply = useCallback(async (p: ChatPersona) => {
    const r = await callChatMacro<{ persona?: { id: string; name: string; systemPrompt: string; brainSlot: string } }>('persona_apply', { id: p.id });
    if (r?.persona) {
      onApply(r.persona);
      onClose();
    }
  }, [onApply, onClose]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Delete this persona?')) return;
    await callChatMacro('persona_delete', { id });
    load();
  }, [load]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <User className="w-4 h-4 text-cyan-400" /> Personas
          </h3>
          <div className="flex items-center gap-2">
            {!creating && (
              <button onClick={() => setCreating(true)} className="px-2 py-1 text-xs rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 flex items-center gap-1">
                <Plus className="w-3 h-3" /> New
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {creating && (
            <div className="border border-cyan-500/30 rounded p-3 space-y-2 bg-cyan-500/5">
              <div className="flex gap-2">
                <input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value.slice(0, 3) })} placeholder="🤖" className="w-14 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white text-center" />
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name (e.g. 'Tough editor')" autoFocus className="flex-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
              </div>
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="One-line description (optional)" className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
              <textarea
                value={draft.systemPrompt}
                onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                rows={5}
                placeholder="System prompt — how should this persona behave?"
                className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white resize-none font-mono"
              />
              <div className="grid grid-cols-2 gap-2">
                <select value={draft.brainSlot} onChange={(e) => setDraft({ ...draft, brainSlot: e.target.value as typeof BRAINS[number] })} className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
                  {BRAINS.map((b) => <option key={b} value={b} className="bg-black">{b}</option>)}
                </select>
                <select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as 'private' | 'workspace' | 'public' })} className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
                  <option value="private" className="bg-black">private</option>
                  <option value="workspace" className="bg-black">workspace</option>
                  <option value="public" className="bg-black">public</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCreating(false)} className="flex-1 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">Cancel</button>
                <button onClick={submitDraft} disabled={busy || !draft.name.trim() || !draft.systemPrompt.trim()} className="flex-1 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm disabled:opacity-40">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Create'}
                </button>
              </div>
            </div>
          )}

          {busy && personas.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-white/40"><Loader2 className="w-4 h-4 animate-spin" /></div>
          ) : personas.length === 0 && !creating ? (
            <div className="text-center text-white/40 text-sm py-12">No personas yet.</div>
          ) : (
            personas.map((p) => (
              <div key={p.id} className="border border-white/10 rounded p-3 flex items-start gap-3 hover:bg-white/5">
                <span className="text-2xl">{p.icon || '🤖'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium flex items-center gap-2">
                    {p.name}
                    <span className="text-xs text-white/40 uppercase">{p.brain_slot}</span>
                    {p.usage_count > 0 && <span className="text-xs text-white/40">used {p.usage_count}×</span>}
                  </div>
                  {p.description && <div className="text-xs text-white/60 mt-0.5">{p.description}</div>}
                  <div className="text-xs text-white/40 mt-1 line-clamp-2 font-mono">{p.system_prompt}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => apply(p)} className="px-2 py-1 text-xs rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Apply
                  </button>
                  <button onClick={() => remove(p.id)} className="p-1 rounded hover:bg-red-500/20 text-red-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
