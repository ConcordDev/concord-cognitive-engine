'use client';

/**
 * CreativeBoard — a freeform draggable board of cards with connections.
 * Card positions and edits persist through lensRun().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, ArrowLeft, StickyNote, CheckSquare, Heading, Link2, Image as ImageIcon, Spline, Trash2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Card {
  id: string; boardId: string; type: string; content: string; label: string | null;
  x: number; y: number; w: number; h: number; color: string; done: boolean; z: number;
}
interface Connection { id: string; fromCardId: string; toCardId: string }

const COLORS = ['amber', 'rose', 'sky', 'emerald', 'violet', 'zinc'];
const COLOR_CLASS: Record<string, string> = {
  amber: 'bg-amber-950/60 border-amber-800', rose: 'bg-rose-950/60 border-rose-800',
  sky: 'bg-sky-950/60 border-sky-800', emerald: 'bg-emerald-950/60 border-emerald-800',
  violet: 'bg-violet-950/60 border-violet-800', zinc: 'bg-zinc-900 border-zinc-700',
};
const COLOR_DOT: Record<string, string> = {
  amber: 'bg-amber-500', rose: 'bg-rose-500', sky: 'bg-sky-500',
  emerald: 'bg-emerald-500', violet: 'bg-violet-500', zinc: 'bg-zinc-500',
};
const ADD_TYPES: { type: string; label: string; icon: typeof StickyNote }[] = [
  { type: 'note', label: 'Note', icon: StickyNote },
  { type: 'task', label: 'Task', icon: CheckSquare },
  { type: 'header', label: 'Header', icon: Heading },
  { type: 'link', label: 'Link', icon: Link2 },
  { type: 'image', label: 'Image', icon: ImageIcon },
];

export function CreativeBoard({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [title, setTitle] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('creative', 'board-get', { id: boardId });
    setTitle(r.data?.result?.board?.title || 'Board');
    setCards((r.data?.result?.cards as Card[]) || []);
    setConnections((r.data?.result?.connections as Connection[]) || []);
    setLoading(false);
  }, [boardId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addCard = async (type: string) => {
    const x = 60 + Math.round(Math.random() * 120);
    const y = 60 + Math.round(Math.random() * 120);
    const r = await lensRun('creative', 'card-add', { boardId, type, content: '', x, y });
    const card = r.data?.result?.card as Card | undefined;
    if (card) { setCards((p) => [...p, card]); setSelected(card.id); }
  };

  const patchCard = (id: string, patch: Partial<Card>) => {
    setCards((p) => p.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const saveCard = async (id: string, patch: Partial<Card>) => {
    patchCard(id, patch);
    await lensRun('creative', 'card-update', { cardId: id, ...patch });
  };

  const delCard = async (id: string) => {
    setCards((p) => p.filter((c) => c.id !== id));
    setConnections((p) => p.filter((c) => c.fromCardId !== id && c.toCardId !== id));
    if (selected === id) setSelected(null);
    await lensRun('creative', 'card-delete', { cardId: id });
  };

  const onCardPointerDown = (e: React.PointerEvent, card: Card) => {
    if ((e.target as HTMLElement).closest('input,textarea,button,a')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: card.id, dx: e.clientX - card.x, dy: e.clientY - card.y, moved: false };
  };
  const onCardPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    patchCard(d.id, { x: Math.max(0, e.clientX - d.dx), y: Math.max(0, e.clientY - d.dy) });
  };
  const onCardPointerUp = async (card: Card) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved) {
      const moved = cards.find((c) => c.id === d.id);
      if (moved) {
        await lensRun('creative', 'card-move', { cardId: d.id, x: moved.x, y: moved.y });
        await lensRun('creative', 'card-raise', { cardId: d.id });
      }
    } else {
      handleCardClick(card);
    }
  };

  const handleCardClick = async (card: Card) => {
    if (connectFrom && connectFrom !== card.id) {
      const r = await lensRun('creative', 'connection-add', { fromCardId: connectFrom, toCardId: card.id });
      if (r.data?.result?.connection) setConnections((p) => [...p, r.data.result.connection as Connection]);
      setConnectFrom(null);
      return;
    }
    setSelected(card.id);
  };

  const delConnection = async (id: string) => {
    setConnections((p) => p.filter((c) => c.id !== id));
    await lensRun('creative', 'connection-delete', { id });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const bounds = cards.reduce((b, c) => ({
    w: Math.max(b.w, c.x + c.w + 80), h: Math.max(b.h, c.y + c.h + 80),
  }), { w: 900, h: 500 });
  const cardById = (id: string) => cards.find((c) => c.id === id);
  const sel = selected ? cardById(selected) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onExit}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <ArrowLeft className="w-3.5 h-3.5" /> Boards
        </button>
        <span className="text-sm font-semibold text-zinc-100 flex-1 truncate">{title}</span>
        <button type="button" onClick={() => setConnectFrom(connectFrom ? null : (selected || cards[0]?.id || null))}
          className={cn('flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg',
            connectFrom ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
          <Spline className="w-3.5 h-3.5" /> {connectFrom ? 'Pick target…' : 'Connect'}
        </button>
      </div>

      {/* Add toolbar */}
      <div className="flex flex-wrap gap-1.5">
        {ADD_TYPES.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.type} type="button" onClick={() => addCard(t.type)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Board canvas */}
      <div className="relative bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-auto"
        style={{ height: '60vh' }}>
        <div className="relative" style={{ width: bounds.w, height: bounds.h }}
          onPointerMove={onCardPointerMove}>
          {/* Connections */}
          <svg className="absolute inset-0 pointer-events-none" width={bounds.w} height={bounds.h}>
            {connections.map((cn) => {
              const a = cardById(cn.fromCardId);
              const b = cardById(cn.toCardId);
              if (!a || !b) return null;
              return (
                <line key={cn.id}
                  x1={a.x + a.w / 2} y1={a.y + a.h / 2}
                  x2={b.x + b.w / 2} y2={b.y + b.h / 2}
                  stroke="#a16207" strokeWidth={2} strokeDasharray="4 3" />
              );
            })}
          </svg>

          {cards.length === 0 && (
            <p className="absolute left-4 top-4 text-[11px] text-zinc-400 italic">
              Empty board. Add a card from the toolbar above.
            </p>
          )}

          {cards.map((card) => (
            <div key={card.id}
              onPointerDown={(e) => onCardPointerDown(e, card)}
              onPointerUp={() => onCardPointerUp(card)}
              className={cn('absolute rounded-lg border shadow-md cursor-move select-none',
                COLOR_CLASS[card.color] || COLOR_CLASS.zinc,
                selected === card.id ? 'ring-2 ring-amber-500' : '',
                connectFrom === card.id ? 'ring-2 ring-amber-400' : '')}
              style={{ left: card.x, top: card.y, width: card.w, zIndex: card.z }}>
              <div className="p-2">
                {card.type === 'header' ? (
                  <input value={card.content} placeholder="Heading"
                    onChange={(e) => patchCard(card.id, { content: e.target.value })}
                    onBlur={(e) => saveCard(card.id, { content: e.target.value })}
                    className="w-full bg-transparent text-sm font-bold text-zinc-100 focus:outline-none" />
                ) : card.type === 'task' ? (
                  <div className="flex items-start gap-1.5">
                    <button type="button" onClick={() => saveCard(card.id, { done: !card.done })}
                      className={cn('mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0',
                        card.done ? 'bg-amber-600 border-amber-600' : 'border-zinc-500')}>
                      {card.done && <CheckSquare className="w-3 h-3 text-white" />}
                    </button>
                    <textarea value={card.content} placeholder="Task"
                      onChange={(e) => patchCard(card.id, { content: e.target.value })}
                      onBlur={(e) => saveCard(card.id, { content: e.target.value })}
                      rows={2}
                      className={cn('flex-1 bg-transparent text-xs focus:outline-none resize-none',
                        card.done ? 'text-zinc-400 line-through' : 'text-zinc-100')} />
                  </div>
                ) : card.type === 'link' ? (
                  <div className="space-y-1">
                    <input value={card.content} placeholder="https://…"
                      onChange={(e) => patchCard(card.id, { content: e.target.value })}
                      onBlur={(e) => saveCard(card.id, { content: e.target.value })}
                      className="w-full bg-zinc-950/60 rounded px-1.5 py-1 text-[11px] text-sky-300 focus:outline-none" />
                    {card.content && /^https?:\/\//.test(card.content) && (
                      <a href={card.content} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] text-amber-400 hover:underline">
                        <Link2 className="w-3 h-3" /> Open link
                      </a>
                    )}
                  </div>
                ) : card.type === 'image' ? (
                  <div className="space-y-1">
                    <input value={card.content} placeholder="Image URL"
                      onChange={(e) => patchCard(card.id, { content: e.target.value })}
                      onBlur={(e) => saveCard(card.id, { content: e.target.value })}
                      className="w-full bg-zinc-950/60 rounded px-1.5 py-1 text-[11px] text-zinc-200 focus:outline-none" />
                    {card.content && /^https?:\/\//.test(card.content) && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={card.content} alt="reference" className="w-full rounded max-h-40 object-cover" />
                    )}
                  </div>
                ) : (
                  <textarea value={card.content} placeholder="Write a note…"
                    onChange={(e) => patchCard(card.id, { content: e.target.value })}
                    onBlur={(e) => saveCard(card.id, { content: e.target.value })}
                    rows={3}
                    className="w-full bg-transparent text-xs text-zinc-100 focus:outline-none resize-none" />
                )}
              </div>
              {selected === card.id && (
                <div className="flex items-center gap-1 px-2 py-1 border-t border-white/10">
                  {COLORS.map((col) => (
                    <button key={col} type="button" onClick={() => saveCard(card.id, { color: col })}
                      className={cn('w-3.5 h-3.5 rounded-full', COLOR_DOT[col],
                        card.color === col ? 'ring-1 ring-white' : '')} />
                  ))}
                  <div className="flex-1" />
                  <button aria-label="Delete" type="button" onClick={() => delCard(card.id)} className="text-zinc-400 hover:text-rose-300">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Connections list */}
      {connections.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {connections.map((cn) => {
            const a = cardById(cn.fromCardId);
            const b = cardById(cn.toCardId);
            return (
              <span key={cn.id} className="flex items-center gap-1 text-[10px] bg-zinc-800 text-zinc-400 rounded-lg pl-2 pr-1 py-0.5">
                {(a?.content || 'card').slice(0, 14) || 'card'} → {(b?.content || 'card').slice(0, 14) || 'card'}
                <button type="button" onClick={() => delConnection(cn.id)} className="hover:text-rose-300">×</button>
              </span>
            );
          })}
        </div>
      )}
      {sel && <p className="text-[10px] text-zinc-400">Selected card · drag to move · use the color row to recolor.</p>}
    </div>
  );
}
