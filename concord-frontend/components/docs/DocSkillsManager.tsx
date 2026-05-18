'use client';

/**
 * DocSkillsManager — Custom AI Skills CRUD modal. Mirrors Notion
 * 3.4's "save your best workflows as Skills" surface. Skills are
 * prompts with {{doc}}, {{selection}}, {{input}} templates the
 * docs-skills.skill_run macro substitutes on invocation.
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, Loader2, Sparkles, Pencil } from 'lucide-react';
import { callDocsMacro } from '@/lib/api/docs';

interface Skill {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  prompt?: string;
  kind: string;
  visibility: string;
  run_count: number;
  updated_at: number;
}

interface Props { open: boolean; onClose: () => void; currentUserId?: string; }

const KIND_OPTIONS = ['rewrite', 'compose', 'analyze', 'format', 'custom'] as const;
const VIS_OPTIONS = ['private', 'workspace', 'public'] as const;

export function DocSkillsManager({ open, onClose, currentUserId }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callDocsMacro<{ skills?: Skill[] }>('skill_list', { limit: 200 });
      setSkills(r?.skills || []);
    } catch (e) { console.error('skill_list', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const save = useCallback(async () => {
    if (!editing?.name || !editing.prompt) return;
    setBusy(true);
    try {
      if (editing.id) {
        await callDocsMacro('skill_update', editing);
      } else {
        await callDocsMacro('skill_create', editing);
      }
      setEditing(null);
      load();
    } finally { setBusy(false); }
  }, [editing, load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Delete this skill?')) return;
    setBusy(true);
    try {
      await callDocsMacro('skill_delete', { id });
      load();
    } finally { setBusy(false); }
  }, [load]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-3xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" /> AI Skills
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* List */}
          <div className="w-64 border-r border-white/10 overflow-y-auto">
            <button
              onClick={() => setEditing({ name: '', prompt: '', kind: 'custom', visibility: 'private' })}
              className="w-full p-2 text-left text-sm text-cyan-300 hover:bg-white/5 border-b border-white/10 flex items-center gap-2"
            >
              <Plus className="w-3.5 h-3.5" /> New skill
            </button>
            {loading ? (
              <div className="flex items-center justify-center h-32 text-white/40">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : skills.length === 0 ? (
              <div className="text-xs text-white/40 text-center p-4">
                No skills yet. Save a prompt you reuse a lot.
              </div>
            ) : (
              skills.map((s) => (
                <button
                  key={s.id}
                  onClick={async () => {
                    const r = await callDocsMacro<{ skill?: Skill }>('skill_get', { id: s.id });
                    if (r?.skill) setEditing(r.skill);
                  }}
                  className={`w-full text-left p-2 text-sm hover:bg-white/5 border-b border-white/5 ${
                    editing?.id === s.id ? 'bg-cyan-500/10' : ''
                  }`}
                >
                  <div className="text-white font-medium truncate">{s.name}</div>
                  <div className="text-xs text-white/40 flex items-center gap-2">
                    <span>{s.kind}</span>
                    <span>·</span>
                    <span>{s.visibility}</span>
                    <span>·</span>
                    <span>{s.run_count} runs</span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-y-auto p-4">
            {!editing ? (
              <div className="text-center text-white/40 text-sm py-12">
                Pick a skill on the left, or create a new one to template
                a prompt you reuse a lot. Use <code className="text-cyan-300">{'{{doc}}'}</code>,
                <code className="text-cyan-300 mx-1">{'{{selection}}'}</code>, and
                <code className="text-cyan-300 ml-1">{'{{input}}'}</code> as substitution slots.
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  value={editing.name || ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Skill name"
                  className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40"
                />
                <textarea
                  value={editing.description || ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Description (optional)"
                  rows={2}
                  className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40 resize-none"
                />
                <div className="flex gap-2">
                  <select
                    value={editing.kind || 'custom'}
                    onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
                  >
                    {KIND_OPTIONS.map((k) => <option key={k} value={k} className="bg-black">{k}</option>)}
                  </select>
                  <select
                    value={editing.visibility || 'private'}
                    onChange={(e) => setEditing({ ...editing, visibility: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
                  >
                    {VIS_OPTIONS.map((v) => <option key={v} value={v} className="bg-black">{v}</option>)}
                  </select>
                </div>
                <textarea
                  value={editing.prompt || ''}
                  onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                  placeholder={`Prompt template — e.g.\nRewrite this paragraph in a friendlier tone for our customer audience:\n{{selection}}`}
                  rows={10}
                  className="w-full px-2 py-1.5 text-sm font-mono bg-black/40 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40 resize-none"
                />
                <div className="flex items-center justify-between gap-2">
                  {editing.id && editing.owner_id === currentUserId && (
                    <button
                      onClick={() => remove(editing.id!)}
                      className="px-3 py-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  )}
                  <div className="flex gap-2 ml-auto">
                    <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">
                      Cancel
                    </button>
                    <button
                      onClick={save}
                      disabled={busy || !editing.name?.trim() || !editing.prompt?.trim()}
                      className="px-4 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editing.id ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      {editing.id ? 'Save' : 'Create'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
