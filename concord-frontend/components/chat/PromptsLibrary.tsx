'use client';

import { useEffect, useState, useCallback } from 'react';
import { BookOpen, Plus, X, Edit3, Trash2, Loader2, Save, Copy, Search } from 'lucide-react';
import { api } from '@/lib/api/client';

export interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  tags: string[];
  shortcut: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert?: (content: string) => void;
}

export function PromptsLibrary({ open, onClose, onInsert }: Props) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', content: '', tags: '', shortcut: '' });
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'prompts-list',
        input: {},
      });
      const result = (res.data as { result?: { prompts?: SavedPrompt[] } })?.result;
      setPrompts(result?.prompts || []);
    } catch (e) {
      console.error('[PromptsLibrary] list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft({ name: '', content: '', tags: '', shortcut: '' });
  };

  const startEdit = (p: SavedPrompt) => {
    setEditingId(p.id);
    setCreating(false);
    setDraft({
      name: p.name,
      content: p.content,
      tags: p.tags.join(', '),
      shortcut: p.shortcut || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setCreating(false);
    setDraft({ name: '', content: '', tags: '', shortcut: '' });
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.content.trim()) return;
    setSaving(true);
    try {
      const input = {
        name: draft.name,
        content: draft.content,
        tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
        shortcut: draft.shortcut.trim() || undefined,
      };
      if (creating) {
        await api.post('/api/lens/run', {
          domain: 'chat',
          action: 'prompt-create',
          input,
        });
      } else if (editingId) {
        await api.post('/api/lens/run', {
          domain: 'chat',
          action: 'prompt-update',
          input: { id: editingId, ...input },
        });
      }
      cancelEdit();
      await refresh();
    } catch (e) {
      console.error('[PromptsLibrary] save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this saved prompt?')) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'prompt-delete',
        input: { id },
      });
      await refresh();
    } catch (e) {
      console.error('[PromptsLibrary] delete failed', e);
    }
  };

  const filtered = filter
    ? prompts.filter((p) => {
        const q = filter.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          (p.shortcut || '').toLowerCase().includes(q)
        );
      })
    : prompts;

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[460px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-emerald-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-gray-200">Saved Prompts</span>
          <span className="text-[10px] text-gray-500 ml-1">{prompts.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 hover:brightness-110"
          >
            <Plus className="w-3 h-3" /> New
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/5 text-gray-400"
            aria-label="Close prompts library"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="px-3 py-2 border-b border-white/10">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, content, tag, or shortcut"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {(creating || editingId) && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Prompt name (e.g. 'Code review checklist')"
              maxLength={60}
              className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none"
            />
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder="Prompt content (variables like {topic} are passed through verbatim)"
              maxLength={8000}
              rows={6}
              className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none resize-none font-mono"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                placeholder="Tags (comma-separated)"
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none"
              />
              <input
                type="text"
                value={draft.shortcut}
                onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })}
                placeholder="Shortcut (e.g. 'review')"
                maxLength={24}
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={save}
                disabled={saving || !draft.name.trim() || !draft.content.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs text-emerald-100 hover:brightness-110 disabled:opacity-40"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {creating ? 'Save prompt' : 'Update'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading prompts…
          </div>
        ) : filtered.length === 0 && !creating ? (
          <div className="text-center py-8 px-4">
            <BookOpen className="w-8 h-8 mx-auto text-gray-600 mb-2" />
            <p className="text-xs text-gray-500">
              {prompts.length === 0 ? 'No saved prompts' : 'No matches'}
            </p>
            {prompts.length === 0 && (
              <p className="text-[10px] text-gray-600 mt-1">
                Save reusable prompt templates. Insert with one click.
              </p>
            )}
          </div>
        ) : (
          filtered.map((p) => (
            <div
              key={p.id}
              className="rounded-md border border-white/10 bg-black/20 p-3 hover:bg-white/5 transition group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-100 truncate">{p.name}</span>
                    {p.shortcut && (
                      <code className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                        /{p.shortcut}
                      </code>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 line-clamp-2 font-mono">
                    {p.content}
                  </p>
                  {p.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {p.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
                  {onInsert && (
                    <button
                      type="button"
                      onClick={() => {
                        onInsert(p.content);
                        onClose();
                      }}
                      className="p-1 text-gray-500 hover:text-emerald-300"
                      aria-label="Insert prompt into composer"
                      title="Insert into composer"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="p-1 text-gray-500 hover:text-cyan-300"
                    aria-label="Edit prompt"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="p-1 text-gray-500 hover:text-rose-300"
                    aria-label="Delete prompt"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default PromptsLibrary;
