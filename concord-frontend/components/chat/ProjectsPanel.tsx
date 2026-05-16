'use client';

import { useEffect, useState, useCallback } from 'react';
import { FolderOpen, Plus, X, Edit3, Trash2, Loader2, Folder, Save } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface ChatProject {
  id: string;
  name: string;
  systemPrompt: string;
  attachedDtuIds: string[];
  color: string;
  threadIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectProject?: (project: ChatProject) => void;
  activeProjectId?: string | null;
}

const COLORS = ['cyan', 'emerald', 'amber', 'rose', 'violet', 'sky'];

export function ProjectsPanel({ open, onClose, onSelectProject, activeProjectId }: Props) {
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', systemPrompt: '', color: 'cyan' });
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'projects-list',
        input: {},
      });
      const result = (res.data as { result?: { projects?: ChatProject[] } })?.result;
      setProjects(result?.projects || []);
    } catch (e) {
      console.error('[ProjectsPanel] list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const startEdit = (p: ChatProject) => {
    setEditingId(p.id);
    setCreating(false);
    setDraft({ name: p.name, systemPrompt: p.systemPrompt, color: p.color });
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft({ name: '', systemPrompt: '', color: 'cyan' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setCreating(false);
    setDraft({ name: '', systemPrompt: '', color: 'cyan' });
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      if (creating) {
        await api.post('/api/lens/run', {
          domain: 'chat',
          action: 'project-create',
          input: draft,
        });
      } else if (editingId) {
        await api.post('/api/lens/run', {
          domain: 'chat',
          action: 'project-update',
          input: { id: editingId, ...draft },
        });
      }
      cancelEdit();
      await refresh();
    } catch (e) {
      console.error('[ProjectsPanel] save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this project? Conversations will not be deleted.')) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'project-delete',
        input: { id },
      });
      await refresh();
    } catch (e) {
      console.error('[ProjectsPanel] delete failed', e);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-cyan-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Projects</span>
          <span className="text-[10px] text-gray-500 ml-1">{projects.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200 hover:brightness-110"
          >
            <Plus className="w-3 h-3" /> New
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/5 text-gray-400"
            aria-label="Close projects panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {(creating || editingId) && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-2">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Project name"
              maxLength={80}
              className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-cyan-500/50 focus:outline-none"
            />
            <textarea
              value={draft.systemPrompt}
              onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
              placeholder="System prompt for this project (optional)"
              maxLength={4000}
              rows={4}
              className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-cyan-500/50 focus:outline-none resize-none"
            />
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraft({ ...draft, color: c })}
                  className={cn(
                    'w-5 h-5 rounded-full border-2 transition',
                    draft.color === c ? 'border-white scale-110' : 'border-transparent',
                    c === 'cyan' && 'bg-cyan-500',
                    c === 'emerald' && 'bg-emerald-500',
                    c === 'amber' && 'bg-amber-500',
                    c === 'rose' && 'bg-rose-500',
                    c === 'violet' && 'bg-violet-500',
                    c === 'sky' && 'bg-sky-500',
                  )}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={save}
                disabled={saving || !draft.name.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100 hover:brightness-110 disabled:opacity-40"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {creating ? 'Create' : 'Save'}
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
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading projects…
          </div>
        ) : projects.length === 0 && !creating ? (
          <div className="text-center py-8 px-4">
            <Folder className="w-8 h-8 mx-auto text-gray-600 mb-2" />
            <p className="text-xs text-gray-500">No projects yet</p>
            <p className="text-[10px] text-gray-600 mt-1">
              Group related chats with a shared system prompt and attached DTUs.
            </p>
          </div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className={cn(
                'rounded-md border p-3 transition hover:bg-white/5',
                activeProjectId === p.id
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-white/10 bg-black/20',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectProject?.(p)}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full',
                        p.color === 'cyan' && 'bg-cyan-400',
                        p.color === 'emerald' && 'bg-emerald-400',
                        p.color === 'amber' && 'bg-amber-400',
                        p.color === 'rose' && 'bg-rose-400',
                        p.color === 'violet' && 'bg-violet-400',
                        p.color === 'sky' && 'bg-sky-400',
                      )}
                    />
                    <span className="text-sm font-medium text-gray-100 truncate">{p.name}</span>
                  </div>
                  {p.systemPrompt && (
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{p.systemPrompt}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-600">
                    <span>{p.threadIds.length} chats</span>
                    <span>{p.attachedDtuIds.length} DTUs</span>
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="p-1 text-gray-500 hover:text-cyan-300"
                    aria-label="Edit project"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="p-1 text-gray-500 hover:text-rose-300"
                    aria-label="Delete project"
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

export default ProjectsPanel;
