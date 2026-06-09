'use client';

/**
 * KanbanBoard — Trello / Asana 2026-shape kanban: boards with columns
 * and cards, move cards between columns, labels, due dates, checklists.
 * Wires the board.board-*, board.column-* and board.card-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Kanban, Plus, Trash2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Column { id: string; name: string }
interface Card {
  id: string; columnId: string; title: string; description: string;
  labels: string[]; dueDate: string | null; assignee: string | null;
  checklist: { id: string; text: string; done: boolean }[]; position: number;
}
interface Board { id: string; name: string; columns: Column[]; cards: Card[] }
interface BoardMeta { id: string; name: string; columnCount: number; cardCount: number }

export function KanbanBoard() {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [active, setActive] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [newBoard, setNewBoard] = useState('');
  const [newCard, setNewCard] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const r = await lensRun('board', 'board-list', {});
    setBoards((r.data?.result?.boards as BoardMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('board', 'board-detail', { id });
    if (r.data?.ok) setActive(r.data.result?.board as Board);
  }, []);
  async function reload() { if (active) await open(active.id); }

  async function createBoard() {
    if (!newBoard.trim()) return;
    const r = await lensRun('board', 'board-create', { name: newBoard.trim() });
    setNewBoard('');
    await refresh();
    if (r.data?.ok) await open(r.data.result?.board.id);
  }
  async function deleteBoard(id: string) {
    if (!confirm('Delete this board?')) return;
    await lensRun('board', 'board-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function addCard(columnId: string) {
    const title = (newCard[columnId] || '').trim();
    if (!active || !title) return;
    await lensRun('board', 'card-create', { boardId: active.id, columnId, title });
    setNewCard({ ...newCard, [columnId]: '' });
    await reload();
  }
  async function moveCard(cardId: string, dir: -1 | 1) {
    if (!active) return;
    const card = active.cards.find(c => c.id === cardId);
    if (!card) return;
    const idx = active.columns.findIndex(c => c.id === card.columnId);
    const target = active.columns[idx + dir];
    if (!target) return;
    await lensRun('board', 'card-move', { boardId: active.id, cardId, toColumnId: target.id });
    await reload();
  }
  async function deleteCard(cardId: string) {
    if (!active) return;
    await lensRun('board', 'card-delete', { boardId: active.id, cardId });
    await reload();
  }
  async function addColumn() {
    if (!active) return;
    const name = prompt('New column name?');
    if (!name?.trim()) return;
    await lensRun('board', 'column-add', { boardId: active.id, name: name.trim() });
    await reload();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Kanban className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-bold text-zinc-100">Kanban Boards</h3>
        <span className="text-[11px] text-zinc-400">Trello / Asana shape</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {boards.map(b => (
          <span key={b.id} className="group inline-flex items-center gap-1">
            <button onClick={() => open(b.id)}
              className={cn('px-2.5 py-1 text-xs rounded-lg border', active?.id === b.id ? 'bg-purple-600/15 border-purple-700/50 text-purple-200' : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700')}>
              {b.name} <span className="text-zinc-600">{b.cardCount}</span>
            </button>
            <button aria-label="Delete" onClick={() => deleteBoard(b.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </span>
        ))}
        <input value={newBoard} onChange={e => setNewBoard(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createBoard(); }}
          placeholder="New board" className="w-28 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200" />
        <button aria-label="Add" onClick={createBoard} className="px-2 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white"><Plus className="w-3.5 h-3.5" /></button>
      </div>

      {active ? (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {active.columns.map((col, ci) => {
            const cards = active.cards.filter(c => c.columnId === col.id).sort((a, b) => a.position - b.position);
            return (
              <div key={col.id} className="w-56 shrink-0 bg-zinc-900/50 border border-zinc-800 rounded-lg p-2">
                <p className="text-[11px] font-bold text-zinc-300 mb-1.5 px-1">{col.name} <span className="text-zinc-600">{cards.length}</span></p>
                <div className="space-y-1.5 mb-2">
                  {cards.map(card => (
                    <div key={card.id} className="group bg-zinc-950 border border-zinc-800 rounded-lg p-2">
                      <p className="text-xs text-zinc-100">{card.title}</p>
                      {card.labels.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {card.labels.map(l => <span key={l} className="text-[9px] px-1 rounded bg-purple-900/50 text-purple-300">{l}</span>)}
                        </div>
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        {card.dueDate && <span className={cn('text-[9px]', new Date(card.dueDate).getTime() < Date.now() ? 'text-rose-400' : 'text-zinc-400')}>{card.dueDate}</span>}
                        {card.checklist.length > 0 && (
                          <span className="text-[9px] text-zinc-400">☑ {card.checklist.filter(i => i.done).length}/{card.checklist.length}</span>
                        )}
                        <div className="ml-auto flex opacity-0 group-hover:opacity-100">
                          <button aria-label="Previous" onClick={() => moveCard(card.id, -1)} disabled={ci === 0} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-30"><ChevronLeft className="w-3 h-3" /></button>
                          <button aria-label="Next" onClick={() => moveCard(card.id, 1)} disabled={ci === active.columns.length - 1} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-30"><ChevronRight className="w-3 h-3" /></button>
                          <button aria-label="Delete" onClick={() => deleteCard(card.id)} className="text-rose-400"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input value={newCard[col.id] || ''} onChange={e => setNewCard({ ...newCard, [col.id]: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') void addCard(col.id); }}
                    placeholder="+ card" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200" />
                  <button aria-label="Add" onClick={() => addCard(col.id)} className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><Plus className="w-3 h-3" /></button>
                </div>
              </div>
            );
          })}
          <button onClick={addColumn} className="w-32 shrink-0 h-9 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-400 hover:text-zinc-300 hover:border-zinc-600 inline-flex items-center justify-center gap-1">
            <Plus className="w-3 h-3" />Column
          </button>
        </div>
      ) : (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[120px]">
          Select or create a board.
        </div>
      )}
    </div>
  );
}
