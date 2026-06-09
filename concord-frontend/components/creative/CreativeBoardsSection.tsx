'use client';

/**
 * CreativeBoardsSection — Milanote-shape visual boards. Gallery of
 * boards plus a freeform draggable board canvas; hydrates via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, Plus, Loader2, Trash2, Copy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { CreativeBoard } from './CreativeBoard';

interface BoardMeta { id: string; title: string; cardCount: number }
interface Template { id: string; name: string; description: string }

export function CreativeBoardsSection() {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const refresh = useCallback(async () => {
    const [b, t] = await Promise.all([
      lensRun('creative', 'board-list', {}),
      lensRun('creative', 'board-templates', {}),
    ]);
    setBoards(b.data?.result?.boards || []);
    setTemplates(t.data?.result?.templates || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createBoard = async () => {
    if (!title.trim()) { setError('Board title is required.'); return; }
    const r = await lensRun('creative', 'board-create', { title: title.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setTitle('');
    setError(null);
    await refresh();
    if (r.data?.result?.board?.id) setOpen(r.data.result.board.id);
  };

  const fromTemplate = async (templateId: string) => {
    const r = await lensRun('creative', 'board-from-template', { templateId });
    await refresh();
    if (r.data?.result?.board?.id) setOpen(r.data.result.board.id);
  };

  const dupBoard = async (id: string) => {
    await lensRun('creative', 'board-duplicate', { id });
    await refresh();
  };

  const delBoard = async (id: string) => {
    await lensRun('creative', 'board-delete', { id });
    if (open === id) setOpen(null);
    await refresh();
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-amber-600/15 to-transparent">
        <LayoutDashboard className="w-5 h-5 text-amber-400" />
        <h2 className="text-sm font-bold text-zinc-100">Creative Boards</h2>
        <span className="text-[11px] text-zinc-400">Milanote shape · visual boards for ideas</span>
      </header>

      <div className="p-4">
        {open ? (
          <CreativeBoard boardId={open} onExit={() => { setOpen(null); void refresh(); }} />
        ) : (
          <div className="space-y-4">
            {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

            <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input placeholder="New board title" value={title} onChange={(e) => setTitle(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                <button type="button" onClick={createBoard}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
                  <Plus className="w-3.5 h-3.5" /> Board
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <button key={t.id} type="button" onClick={() => fromTemplate(t.id)} title={t.description}
                    className="text-[10px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">
                    + {t.name}
                  </button>
                ))}
              </div>
            </section>

            {loading ? (
              <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : boards.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic py-6 text-center">No boards yet. Create one or start from a template.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {boards.map((b) => (
                  <div key={b.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                    <button type="button" onClick={() => setOpen(b.id)} className="block w-full text-left">
                      <div className="h-16 rounded-lg bg-gradient-to-br from-amber-900/30 to-zinc-800 mb-2 flex items-center justify-center">
                        <LayoutDashboard className="w-6 h-6 text-amber-500/50" />
                      </div>
                      <p className="text-xs font-medium text-zinc-100 truncate">{b.title}</p>
                      <p className="text-[10px] text-zinc-400">{b.cardCount} cards</p>
                    </button>
                    <div className="flex items-center gap-2 mt-1.5">
                      <button type="button" onClick={() => dupBoard(b.id)}
                        className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-300">
                        <Copy className="w-3 h-3" /> Duplicate
                      </button>
                      <div className="flex-1" />
                      <button aria-label="Delete" type="button" onClick={() => delBoard(b.id)} className="text-zinc-600 hover:text-rose-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
