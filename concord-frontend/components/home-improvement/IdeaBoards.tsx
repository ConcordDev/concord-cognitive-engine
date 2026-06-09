'use client';
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Lightbulb, Plus, Trash2, Loader2, ImageIcon, Link2 } from 'lucide-react';

interface Idea {
  id: string;
  note: string;
  imageUrl: string;
  sourceUrl: string;
  tags: string[];
  addedAt: string;
}
interface Board {
  id: string;
  name: string;
  room: string;
  description: string;
  ideas: Idea[];
  ideaCount: number;
  createdAt: string;
}

const DOMAIN = 'home-improvement';
const ROOMS = ['whole_house', 'kitchen', 'bathroom', 'bedroom', 'living_room', 'basement', 'garage', 'exterior'];

export function IdeaBoards() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', room: 'whole_house', description: '' });
  const [openBoard, setOpenBoard] = useState<string | null>(null);
  const [ideaForm, setIdeaForm] = useState({ note: '', imageUrl: '', sourceUrl: '', tags: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<{ boards: Board[] }>(DOMAIN, 'board-list', {});
    if (data.ok && data.result) setBoards(data.result.boards || []);
    else setError(data.error || 'Failed to load boards');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const addBoard = async () => {
    if (!form.name.trim()) return;
    setBusy(true); setError(null);
    const { data } = await lensRun(DOMAIN, 'board-add', { ...form });
    if (data.ok) { setForm({ name: '', room: 'whole_house', description: '' }); setShowForm(false); await load(); }
    else setError(data.error || 'Failed to add board');
    setBusy(false);
  };

  const removeBoard = async (id: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'board-delete', { id });
    if (data.ok) await load();
    setBusy(false);
  };

  const addIdea = async (boardId: string) => {
    if (!ideaForm.note.trim() && !ideaForm.imageUrl.trim()) return;
    setBusy(true); setError(null);
    const tags = ideaForm.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const { data } = await lensRun(DOMAIN, 'board-idea-add', {
      boardId, note: ideaForm.note, imageUrl: ideaForm.imageUrl, sourceUrl: ideaForm.sourceUrl, tags,
    });
    if (data.ok) { setIdeaForm({ note: '', imageUrl: '', sourceUrl: '', tags: '' }); await load(); }
    else setError(data.error || 'Failed to add idea');
    setBusy(false);
  };

  const removeIdea = async (boardId: string, ideaId: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'board-idea-delete', { boardId, ideaId });
    if (data.ok) await load();
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Lightbulb className="w-4 h-4 text-amber-400" /> Idea Boards
          <span className="text-xs text-gray-400">({boards.length})</span>
        </h3>
        <button onClick={() => setShowForm((v) => !v)} className="text-xs flex items-center gap-1 text-amber-400 hover:text-amber-300">
          <Plus className="w-3.5 h-3.5" /> New board
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {showForm && (
        <div className="panel p-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Board name" className="input-lattice" />
            <select value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} className="input-lattice">
              {ROOMS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="input-lattice w-full" />
          <button onClick={addBoard} disabled={busy || !form.name.trim()} className="btn-neon green w-full text-sm disabled:opacity-50">
            {busy ? 'Saving...' : 'Create Board'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading boards...</div>
      ) : boards.length === 0 ? (
        <p className="text-xs text-gray-400">No idea boards yet. Collect inspiration for your next project.</p>
      ) : (
        <div className="space-y-3">
          {boards.map((b) => (
            <div key={b.id} className="panel p-3 space-y-2">
              <div className="flex items-center justify-between">
                <button onClick={() => setOpenBoard((o) => (o === b.id ? null : b.id))} className="min-w-0 text-left">
                  <p className="text-sm font-medium text-white truncate">{b.name}</p>
                  <p className="text-xs text-gray-400">{b.room.replace(/_/g, ' ')} · {b.ideaCount} idea{b.ideaCount !== 1 ? 's' : ''}{b.description ? ` · ${b.description}` : ''}</p>
                </button>
                <button aria-label="Delete" onClick={() => removeBoard(b.id)} disabled={busy} className="text-gray-400 hover:text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>

              {openBoard === b.id && (
                <div className="space-y-2 border-t border-lattice-border pt-2">
                  {b.ideas.length === 0 && <p className="text-xs text-gray-400">No ideas pinned yet.</p>}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {b.ideas.map((idea) => (
                      <div key={idea.id} className="rounded-lg bg-lattice-deep p-2 space-y-1">
                        {idea.imageUrl ? (
                          <img src={idea.imageUrl} alt={idea.note || 'idea'} className="w-full h-24 object-cover rounded" />
                        ) : (
                          <div className="w-full h-24 rounded bg-lattice-surface flex items-center justify-center text-gray-600"><ImageIcon className="w-5 h-5" /></div>
                        )}
                        {idea.note && <p className="text-xs text-gray-200">{idea.note}</p>}
                        {idea.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {idea.tags.map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 bg-amber-400/10 text-amber-400 rounded">{t}</span>)}
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          {idea.sourceUrl ? (
                            <a href={idea.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-neon-cyan flex items-center gap-0.5"><Link2 className="w-3 h-3" /> source</a>
                          ) : <span />}
                          <button aria-label="Delete" onClick={() => removeIdea(b.id, idea.id)} disabled={busy} className="text-gray-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input value={ideaForm.note} onChange={(e) => setIdeaForm((f) => ({ ...f, note: e.target.value }))} placeholder="Idea note" className="input-lattice" />
                    <input value={ideaForm.imageUrl} onChange={(e) => setIdeaForm((f) => ({ ...f, imageUrl: e.target.value }))} placeholder="Image URL (optional)" className="input-lattice" />
                    <input value={ideaForm.sourceUrl} onChange={(e) => setIdeaForm((f) => ({ ...f, sourceUrl: e.target.value }))} placeholder="Source URL (optional)" className="input-lattice" />
                    <input value={ideaForm.tags} onChange={(e) => setIdeaForm((f) => ({ ...f, tags: e.target.value }))} placeholder="Tags, comma-separated" className="input-lattice" />
                  </div>
                  <button onClick={() => addIdea(b.id)} disabled={busy || (!ideaForm.note.trim() && !ideaForm.imageUrl.trim())} className="btn-neon w-full text-xs disabled:opacity-50">
                    {busy ? 'Saving...' : 'Pin Idea'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
