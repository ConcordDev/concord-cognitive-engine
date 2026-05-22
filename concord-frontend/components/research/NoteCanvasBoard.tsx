'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Save, Square, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Card {
  id: string;
  kind: 'note' | 'text' | 'link';
  noteId: string | null;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
interface Canvas {
  id: string;
  name: string;
  cards: Card[];
  edges: { id: string; from: string; to: string; label: string }[];
  createdAt: string;
  updatedAt: string;
}
interface CanvasSummary {
  id: string;
  name: string;
  cardCount: number;
  edgeCount: number;
  updatedAt: string;
}

const COLORS = ['slate', 'fuchsia', 'sky', 'emerald', 'amber'];
const COLOR_CLASS: Record<string, string> = {
  slate: 'bg-slate-800/80 border-slate-600',
  fuchsia: 'bg-fuchsia-900/50 border-fuchsia-600',
  sky: 'bg-sky-900/50 border-sky-600',
  emerald: 'bg-emerald-900/50 border-emerald-600',
  amber: 'bg-amber-900/50 border-amber-600',
};

function newCardId() {
  return `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * NoteCanvasBoard — Obsidian-Canvas-style spatial board. Cards are
 * draggable; layout persists via research.canvas-save. No fake data —
 * every card's text is user input.
 */
export function NoteCanvasBoard() {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [active, setActive] = useState<Canvas | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ canvases: CanvasSummary[] }>('research', 'canvas-list', {});
      if (r.data?.ok && r.data.result) setCanvases(r.data.result.canvases || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openCanvas = useCallback(async (id: string) => {
    try {
      const r = await lensRun<{ canvas: Canvas }>('research', 'canvas-get', { id });
      if (r.data?.ok && r.data.result) setActive(r.data.result.canvas);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const createCanvas = useCallback(async () => {
    if (!name.trim()) return;
    try {
      const r = await lensRun<{ canvas: Canvas }>('research', 'canvas-save', {
        name: name.trim(),
        cards: [],
        edges: [],
      });
      if (r.data?.ok && r.data.result) {
        setActive(r.data.result.canvas);
        setName('');
        await loadList();
      }
    } catch (e) {
      console.error(e);
    }
  }, [name, loadList]);

  const save = useCallback(async () => {
    if (!active) return;
    setSaving(true);
    try {
      const r = await lensRun<{ canvas: Canvas }>('research', 'canvas-save', {
        id: active.id,
        name: active.name,
        cards: active.cards,
        edges: active.edges,
      });
      if (r.data?.ok && r.data.result) {
        setActive(r.data.result.canvas);
        await loadList();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }, [active, loadList]);

  const deleteCanvas = useCallback(
    async (id: string) => {
      try {
        await lensRun('research', 'canvas-delete', { id });
        if (active?.id === id) setActive(null);
        await loadList();
      } catch (e) {
        console.error(e);
      }
    },
    [active, loadList],
  );

  const addCard = () => {
    if (!active) return;
    const card: Card = {
      id: newCardId(),
      kind: 'text',
      noteId: null,
      text: 'New card',
      x: 40 + active.cards.length * 24,
      y: 40 + active.cards.length * 24,
      w: 180,
      h: 110,
      color: 'slate',
    };
    setActive({ ...active, cards: [...active.cards, card] });
  };

  const updateCard = (id: string, patch: Partial<Card>) => {
    if (!active) return;
    setActive({
      ...active,
      cards: active.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const removeCard = (id: string) => {
    if (!active) return;
    setActive({
      ...active,
      cards: active.cards.filter((c) => c.id !== id),
      edges: active.edges.filter((e) => e.from !== id && e.to !== id),
    });
  };

  const onPointerDown = (e: React.PointerEvent, card: Card) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      id: card.id,
      ox: e.clientX - rect.left - card.x,
      oy: e.clientY - rect.top - card.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const rect = boardRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    updateCard(d.id, {
      x: Math.max(0, Math.round(e.clientX - rect.left - d.ox)),
      y: Math.max(0, Math.round(e.clientY - rect.top - d.oy)),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  if (active) {
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setActive(null)}
            className="text-xs text-gray-400 hover:text-gray-200"
          >
            ← Boards
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={addCard}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-xs text-gray-300"
            >
              <Plus className="w-3 h-3" /> Card
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-fuchsia-500/40 bg-fuchsia-500/15 text-xs text-fuchsia-100 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
        <p className="text-sm font-semibold text-gray-100">{active.name}</p>
        <div
          ref={boardRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative rounded-lg border border-white/10 bg-black/40 overflow-hidden"
          style={{ height: 460 }}
        >
          {active.cards.length === 0 && (
            <p className="absolute inset-0 grid place-items-center text-xs text-gray-500">
              Add cards and drag to arrange.
            </p>
          )}
          {active.cards.map((c) => (
            <div
              key={c.id}
              className={`absolute rounded border ${COLOR_CLASS[c.color] || COLOR_CLASS.slate} p-1.5 flex flex-col gap-1`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            >
              <div
                onPointerDown={(e) => onPointerDown(e, c)}
                className="flex items-center justify-between cursor-move"
              >
                <div className="flex gap-1">
                  {COLORS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => updateCard(c.id, { color: col })}
                      className={`w-2.5 h-2.5 rounded-full ${COLOR_CLASS[col]?.split(' ')[0]} ${c.color === col ? 'ring-1 ring-white' : ''}`}
                      aria-label={col}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => removeCard(c.id)}
                  className="text-gray-500 hover:text-rose-300"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <textarea
                value={c.text}
                onChange={(e) => updateCard(c.id, { text: e.target.value })}
                className="flex-1 w-full bg-transparent text-[11px] text-gray-100 resize-none outline-none"
              />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-500">
          Drag a card header to move it. Save persists the layout.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Square className="w-4 h-4 text-fuchsia-400" />
        <span className="text-sm font-semibold text-gray-200">Canvas boards</span>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createCanvas();
          }}
          placeholder="New board name"
          className="flex-1 px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100"
        />
        <button
          type="button"
          onClick={createCanvas}
          disabled={!name.trim()}
          className="px-3 py-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 text-xs text-fuchsia-100 disabled:opacity-40"
        >
          Create
        </button>
      </div>
      {loading ? (
        <div className="text-center py-6 text-xs text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin inline" />
        </div>
      ) : canvases.length === 0 ? (
        <p className="text-center text-xs text-gray-500 py-6">No boards yet.</p>
      ) : (
        <div className="space-y-1">
          {canvases.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded border border-white/10 bg-black/20 p-2.5"
            >
              <button
                type="button"
                onClick={() => openCanvas(c.id)}
                className="text-left min-w-0 flex-1"
              >
                <p className="text-sm text-gray-100 truncate">{c.name}</p>
                <p className="text-[10px] text-gray-500">
                  {c.cardCount} cards · {c.edgeCount} links
                </p>
              </button>
              <button
                type="button"
                onClick={() => deleteCanvas(c.id)}
                className="p-1 text-gray-600 hover:text-rose-300"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NoteCanvasBoard;
