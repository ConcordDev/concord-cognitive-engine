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
    <div className="fixed inset-y-0 right-0 w-[460px] max-w-[100vw] z-40 bg-[var(--nb-sheet,#0d1117)] border-l border-[color:var(--nb-blue,rgba(6,182,212,0.2))] shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-[color:var(--nb-rule,rgba(255,255,255,0.1))] flex items-center justify-between bg-gradient-to-r from-[var(--nb-green-soft,rgba(2,44,34,0.4))] to-transparent">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[color:var(--nb-green,#34d399)]" />
          <span className="text-sm font-semibold text-[color:var(--nb-ink,#e5e7eb)]">Saved Prompts</span>
          <span className="text-[10px] text-[color:var(--nb-muted,#9ca3af)] ml-1">{prompts.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1 rounded-md border border-[color:var(--nb-green,rgba(16,185,129,0.3))] bg-[var(--nb-green-soft,rgba(16,185,129,0.1))] px-2 py-1 text-xs text-[color:var(--nb-green,#a7f3d0)] hover:brightness-110"
          >
            <Plus className="w-3 h-3" /> New
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--nb-wash,rgba(255,255,255,0.05))] text-[color:var(--nb-muted,#9ca3af)]"
            aria-label="Close prompts library"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="px-3 py-2 border-b border-[color:var(--nb-rule,rgba(255,255,255,0.1))]">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[color:var(--nb-muted,#9ca3af)]" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, content, tag, or shortcut"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-[var(--nb-paper,rgba(0,0,0,0.4))] border border-[color:var(--nb-rule,rgba(255,255,255,0.1))] rounded text-[color:var(--nb-ink,#f3f4f6)] placeholder:text-[color:var(--nb-faint,#6b7280)] focus:border-[color:var(--nb-green,rgba(16,185,129,0.5))] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {(creating || editingId) && (
          <div className="rounded-md border border-[color:var(--nb-green,rgba(16,185,129,0.3))] bg-[var(--nb-green-soft,rgba(16,185,129,0.05))] p-3 space-y-2">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Prompt name (e.g. 'Code review checklist')"
              maxLength={60}
              className="w-full px-2 py-1.5 text-sm bg-[var(--nb-paper,rgba(0,0,0,0.4))] border border-[color:var(--nb-rule,rgba(255,255,255,0.1))] rounded text-[color:var(--nb-ink,#f3f4f6)] placeholder:text-[color:var(--nb-faint,#6b7280)] focus:border-[color:var(--nb-green,rgba(16,185,129,0.5))] focus:outline-none"
            />
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder="Prompt content (variables like {topic} are passed through verbatim)"
              maxLength={8000}
              rows={6}
              className="w-full px-2 py-1.5 text-xs bg-[var(--nb-paper,rgba(0,0,0,0.4))] border border-[color:var(--nb-rule,rgba(255,255,255,0.1))] rounded text-[color:var(--nb-ink,#f3f4f6)] placeholder:text-[color:var(--nb-faint,#6b7280)] focus:border-[color:var(--nb-green,rgba(16,185,129,0.5))] focus:outline-none resize-none font-mono"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                placeholder="Tags (comma-separated)"
                className="px-2 py-1.5 text-xs bg-[var(--nb-paper,rgba(0,0,0,0.4))] border border-[color:var(--nb-rule,rgba(255,255,255,0.1))] rounded text-[color:var(--nb-ink,#f3f4f6)] placeholder:text-[color:var(--nb-faint,#6b7280)] focus:border-[color:var(--nb-green,rgba(16,185,129,0.5))] focus:outline-none"
              />
              <input
                type="text"
                value={draft.shortcut}
                onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })}
                placeholder="Shortcut (e.g. 'review')"
                maxLength={24}
                className="px-2 py-1.5 text-xs bg-[var(--nb-paper,rgba(0,0,0,0.4))] border border-[color:var(--nb-rule,rgba(255,255,255,0.1))] rounded text-[color:var(--nb-ink,#f3f4f6)] placeholder:text-[color:var(--nb-faint,#6b7280)] focus:border-[color:var(--nb-green,rgba(16,185,129,0.5))] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={save}
                disabled={saving || !draft.name.trim() || !draft.content.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--nb-green,rgba(16,185,129,0.4))] bg-[var(--nb-green-soft,rgba(16,185,129,0.15))] px-3 py-1 text-xs text-[color:var(--nb-green,#d1fae5)] hover:brightness-110 disabled:opacity-40"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {creating ? 'Save prompt' : 'Update'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="px-3 py-1 text-xs text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-ink,#e5e7eb)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-[color:var(--nb-muted,#9ca3af)]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading prompts…
          </div>
        ) : filtered.length === 0 && !creating ? (
          <div className="text-center py-8 px-4">
            <BookOpen className="w-8 h-8 mx-auto text-[color:var(--nb-faint,#4b5563)] mb-2" />
            <p className="text-xs text-[color:var(--nb-muted,#9ca3af)]">
              {prompts.length === 0 ? 'No saved prompts' : 'No matches'}
            </p>
            {prompts.length === 0 && (
              <p className="text-[10px] text-[color:var(--nb-muted,#9ca3af)] mt-1">
                Save reusable prompt templates. Insert with one click.
              </p>
            )}
          </div>
        ) : (
          filtered.map((p) => (
            <div
              key={p.id}
              className="rounded-md border border-[color:var(--nb-rule,rgba(255,255,255,0.1))] bg-[var(--nb-paper,rgba(0,0,0,0.2))] p-3 hover:bg-[var(--nb-wash,rgba(255,255,255,0.05))] transition group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[color:var(--nb-ink,#f3f4f6)] truncate">{p.name}</span>
                    {p.shortcut && (
                      <code className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nb-green-soft,rgba(16,185,129,0.1))] border border-[color:var(--nb-green,rgba(16,185,129,0.2))] text-[color:var(--nb-green,#6ee7b7)]">
                        /{p.shortcut}
                      </code>
                    )}
                  </div>
                  <p className="text-[11px] text-[color:var(--nb-muted,#9ca3af)] mt-1 line-clamp-2 font-mono">
                    {p.content}
                  </p>
                  {p.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {p.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nb-wash,rgba(255,255,255,0.05))] text-[color:var(--nb-muted,#9ca3af)]"
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
                      className="p-1 text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-green,#6ee7b7)]"
                      aria-label="Insert prompt into composer"
                      title="Insert into composer"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="p-1 text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-blue,#67e8f9)]"
                    aria-label="Edit prompt"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="p-1 text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-red,#fda4af)]"
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
