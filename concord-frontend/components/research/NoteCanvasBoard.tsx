'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, FileText, Link2, Loader2, Plus, Save, Square, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Card {
  id: string;
  kind: 'note' | 'text' | 'link' | 'reference';
  noteId: string | null;
  referenceId: string | null;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}
interface Canvas {
  id: string;
  name: string;
  cards: Card[];
  edges: CanvasEdge[];
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
interface NoteLite {
  id: string;
  title: string;
  preview: string;
}
interface RefLite {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  journal: string | null;
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
function newEdgeId() {
  return `cedge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// Canvases stored before S6 have no referenceId on their cards (the
// server sanitiser only learned the field in S6); normalise on the way in.
function normalizeCanvas(cv: Canvas): Canvas {
  return {
    ...cv,
    cards: (cv.cards || []).map((c) => ({
      ...c,
      noteId: c.noteId ? String(c.noteId) : null,
      referenceId: c.referenceId ? String(c.referenceId) : null,
    })),
    edges: cv.edges || [],
  };
}

/**
 * NoteCanvasBoard — Obsidian-Canvas-style spatial board. Card headers
 * are drag handles: the header takes pointer capture itself and owns
 * move/up/cancel, position updates live during the drag, and the layout
 * persists via research.canvas-save when the card is dropped. Cards
 * can be free text, a note (title + body excerpt, read live from the
 * note), or a reference (title/authors/year from the library). Cards
 * can be linked; links render as lines and persist in canvas edges.
 */
export function NoteCanvasBoard() {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [active, setActive] = useState<Canvas | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<NoteLite[]>([]);
  const [references, setReferences] = useState<RefLite[]>([]);
  const [picker, setPicker] = useState<'note' | 'reference' | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);
  const activeRef = useRef<Canvas | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

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

  // Notes + references the canvas can pin as cards. notes-list returns
  // each note's title and a body preview (the excerpt the card shows);
  // reference-list returns the library records. Both are the lens's
  // existing macros — the canvas adds no server surface for content.
  const loadLibrary = useCallback(async () => {
    try {
      const [n, r] = await Promise.all([
        lensRun<{ notes: NoteLite[] }>('research', 'notes-list', {}),
        lensRun<{ references: RefLite[] }>('research', 'reference-list', {}),
      ]);
      if (n.data?.ok && n.data.result) setNotes(n.data.result.notes || []);
      if (r.data?.ok && r.data.result) setReferences(r.data.result.references || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const persist = useCallback(
    async (canvas: Canvas) => {
      setSaving(true);
      try {
        const r = await lensRun<{ canvas: Canvas }>('research', 'canvas-save', {
          id: canvas.id,
          name: canvas.name,
          cards: canvas.cards,
          edges: canvas.edges,
        });
        if (r.data?.ok && r.data.result) {
          setActive(normalizeCanvas(r.data.result.canvas));
          await loadList();
        }
      } catch (e) {
        console.error(e);
      } finally {
        setSaving(false);
      }
    },
    [loadList],
  );

  const applyAndSave = useCallback(
    (next: Canvas) => {
      setActive(next);
      void persist(next);
    },
    [persist],
  );

  const openCanvas = useCallback(
    async (id: string) => {
      try {
        const r = await lensRun<{ canvas: Canvas }>('research', 'canvas-get', { id });
        if (r.data?.ok && r.data.result) {
          setActive(normalizeCanvas(r.data.result.canvas));
          setLinkFrom(null);
          setPicker(null);
          void loadLibrary();
        }
      } catch (e) {
        console.error(e);
      }
    },
    [loadLibrary],
  );

  const createCanvas = useCallback(async () => {
    if (!name.trim()) return;
    try {
      const r = await lensRun<{ canvas: Canvas }>('research', 'canvas-save', {
        name: name.trim(),
        cards: [],
        edges: [],
      });
      if (r.data?.ok && r.data.result) {
        setActive(normalizeCanvas(r.data.result.canvas));
        setName('');
        await loadList();
      }
    } catch (e) {
      console.error(e);
    }
  }, [name, loadList]);

  const save = useCallback(async () => {
    if (!active) return;
    await persist(active);
  }, [active, persist]);

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

  const spawnPos = (count: number) => ({
    x: 24 + ((count * 36) % 220),
    y: 24 + ((count * 36) % 160),
  });

  const addCard = () => {
    if (!active) return;
    const card: Card = {
      id: newCardId(),
      kind: 'text',
      noteId: null,
      referenceId: null,
      text: 'New card',
      ...spawnPos(active.cards.length),
      w: 180,
      h: 110,
      color: 'slate',
    };
    applyAndSave({ ...active, cards: [...active.cards, card] });
  };

  const addLinkedCard = (kind: 'note' | 'reference', item: NoteLite | RefLite) => {
    if (!active) return;
    const card: Card = {
      id: newCardId(),
      kind,
      noteId: kind === 'note' ? item.id : null,
      referenceId: kind === 'reference' ? item.id : null,
      text: '',
      ...spawnPos(active.cards.length),
      w: kind === 'note' ? 220 : 240,
      h: kind === 'note' ? 132 : 120,
      color: kind === 'note' ? 'sky' : 'emerald',
    };
    setPicker(null);
    applyAndSave({ ...active, cards: [...active.cards, card] });
  };

  const updateCard = (id: string, patch: Partial<Card>) => {
    setActive((prev) =>
      prev
        ? { ...prev, cards: prev.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
        : prev,
    );
  };

  const removeCard = (id: string) => {
    if (!active) return;
    if (linkFrom === id) setLinkFrom(null);
    applyAndSave({
      ...active,
      cards: active.cards.filter((c) => c.id !== id),
      edges: active.edges.filter((e) => e.from !== id && e.to !== id),
    });
  };

  const removeEdge = (id: string) => {
    if (!active) return;
    applyAndSave({ ...active, edges: active.edges.filter((e) => e.id !== id) });
  };

  const onCardClick = (card: Card) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (!active || !linkFrom) return;
    if (linkFrom === card.id) {
      setLinkFrom(null);
      return;
    }
    const exists = active.edges.some(
      (e) =>
        (e.from === linkFrom && e.to === card.id) || (e.from === card.id && e.to === linkFrom),
    );
    setLinkFrom(null);
    if (exists) return;
    applyAndSave({
      ...active,
      edges: [...active.edges, { id: newEdgeId(), from: linkFrom, to: card.id, label: '' }],
    });
  };

  // Drag: the header takes pointer capture on ITSELF (e.currentTarget)
  // and owns move/up/cancel, so delivery never depends on events
  // bubbling from an arbitrary child to a board-level handler (the
  // pre-S6 arrangement). A 4px threshold keeps header clicks (colour,
  // link, delete) from registering as drags; presses that land on a
  // header button never start a drag at all.
  const onHeaderPointerDown = (e: React.PointerEvent, card: Card) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: card.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: card.x,
      origY: card.y,
      lastX: card.x,
      lastY: card.y,
      moved: false,
    };
  };

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.lastX = Math.max(0, Math.round(d.origX + dx));
    d.lastY = Math.max(0, Math.round(d.origY + dy));
    const { id, lastX, lastY } = d;
    setActive((prev) =>
      prev
        ? { ...prev, cards: prev.cards.map((c) => (c.id === id ? { ...c, x: lastX, y: lastY } : c)) }
        : prev,
    );
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    justDraggedRef.current = true;
    const cur = activeRef.current;
    if (!cur) return;
    // Build the drop snapshot from the drag's own final coordinates so
    // the save cannot race a state update that has not rendered yet.
    const next = {
      ...cur,
      cards: cur.cards.map((c) => (c.id === d.id ? { ...c, x: d.lastX, y: d.lastY } : c)),
    };
    setActive(next);
    void persist(next);
  };

  const notesById = new Map(notes.map((n) => [n.id, n]));
  const refsById = new Map(references.map((r) => [r.id, r]));

  if (active) {
    const cardById = new Map(active.cards.map((c) => [c.id, c]));
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
              <Plus className="w-3 h-3" /> Text
            </button>
            <button
              type="button"
              onClick={() => {
                setPicker(picker === 'note' ? null : 'note');
                void loadLibrary();
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-xs text-gray-300"
            >
              <FileText className="w-3 h-3" /> Note
            </button>
            <button
              type="button"
              onClick={() => {
                setPicker(picker === 'reference' ? null : 'reference');
                void loadLibrary();
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-xs text-gray-300"
            >
              <BookOpen className="w-3 h-3" /> Reference
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
        {picker && (
          <div className="rounded border border-white/10 bg-black/30 max-h-44 overflow-y-auto">
            {picker === 'note' &&
              (notes.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-gray-400">No notes yet.</p>
              ) : (
                notes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => addLinkedCard('note', n)}
                    className="block w-full text-left px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/5"
                  >
                    {n.title || 'Untitled note'}
                  </button>
                ))
              ))}
            {picker === 'reference' &&
              (references.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-gray-400">No references in the library yet.</p>
              ) : (
                references.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addLinkedCard('reference', r)}
                    className="block w-full text-left px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/5"
                  >
                    {r.title}
                    {r.year ? <span className="text-gray-400"> ({r.year})</span> : null}
                  </button>
                ))
              ))}
          </div>
        )}
        {linkFrom && (
          <p className="text-[11px] text-fuchsia-200">
            Linking from a card — click another card to connect them, or click the source card
            again to cancel.
          </p>
        )}
        <div
          ref={boardRef}
          className="relative rounded-lg border border-white/10 bg-black/40 overflow-hidden"
          style={{ height: 460 }}
        >
          {active.cards.length === 0 && (
            <p className="absolute inset-0 grid place-items-center text-xs text-gray-400">
              Add cards and drag to arrange.
            </p>
          )}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {active.edges.map((e) => {
              const a = cardById.get(e.from);
              const b = cardById.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + a.w / 2;
              const y1 = a.y + a.h / 2;
              const x2 = b.x + b.w / 2;
              const y2 = b.y + b.h / 2;
              return (
                <g key={e.id}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
                  <circle
                    cx={(x1 + x2) / 2}
                    cy={(y1 + y2) / 2}
                    r={8}
                    fill="#14181f"
                    stroke="rgba(255,255,255,0.45)"
                    className="pointer-events-auto cursor-pointer"
                    onClick={() => removeEdge(e.id)}
                  >
                    <title>Remove link</title>
                  </circle>
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 + 3}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#cbd5e1"
                    className="pointer-events-none"
                  >
                    ×
                  </text>
                </g>
              );
            })}
          </svg>
          {active.cards.map((c) => (
            <div
              key={c.id}
              onClick={() => onCardClick(c)}
              className={`absolute rounded border ${COLOR_CLASS[c.color] || COLOR_CLASS.slate} p-1.5 flex flex-col gap-1 ${
                linkFrom && linkFrom !== c.id ? 'ring-1 ring-fuchsia-300/60' : ''
              } ${linkFrom === c.id ? 'ring-2 ring-fuchsia-300' : ''}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            >
              <div
                onPointerDown={(e) => onHeaderPointerDown(e, c)}
                onPointerMove={onHeaderPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="flex items-center justify-between cursor-move touch-none select-none"
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
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLinkFrom(linkFrom === c.id ? null : c.id)}
                    aria-label="Link to another card"
                    title="Link to another card"
                    className={linkFrom === c.id ? 'text-fuchsia-300' : 'text-gray-400 hover:text-fuchsia-200'}
                  >
                    <Link2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCard(c.id)}
                    aria-label="Remove card"
                    className="text-gray-400 hover:text-rose-300"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {c.kind === 'note' &&
                (() => {
                  const n = c.noteId ? notesById.get(c.noteId) : undefined;
                  return (
                    <div className="flex-1 w-full overflow-hidden">
                      <p className="text-[9px] uppercase tracking-wide text-sky-300/80">Note</p>
                      {n ? (
                        <>
                          <p className="text-[11px] font-medium text-gray-100 line-clamp-2">
                            {n.title || 'Untitled note'}
                          </p>
                          <p className="text-[11px] text-gray-300 line-clamp-4 whitespace-pre-wrap">
                            {n.preview}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-gray-400">
                          Note unavailable — it may have been deleted.
                        </p>
                      )}
                    </div>
                  );
                })()}
              {c.kind === 'reference' &&
                (() => {
                  const r = c.referenceId ? refsById.get(c.referenceId) : undefined;
                  return (
                    <div className="flex-1 w-full overflow-hidden">
                      <p className="text-[9px] uppercase tracking-wide text-emerald-300/80">Reference</p>
                      {r ? (
                        <>
                          <p className="text-[11px] font-medium text-gray-100 line-clamp-3">{r.title}</p>
                          {r.authors && (
                            <p className="text-[10px] text-gray-300 line-clamp-1">{r.authors}</p>
                          )}
                          <p className="text-[10px] text-gray-400">
                            {[r.journal, r.year].filter(Boolean).join(' · ')}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-gray-400">
                          Reference unavailable — it may have been removed from the library.
                        </p>
                      )}
                    </div>
                  );
                })()}
              {(c.kind === 'text' || c.kind === 'link') && (
                <textarea
                  value={c.text}
                  onChange={(e) => updateCard(c.id, { text: e.target.value })}
                  className="flex-1 w-full bg-transparent text-[11px] text-gray-100 resize-none outline-none"
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400">
          Drag a card header to move it — the layout saves when you drop the card. Pin notes and
          references as cards, and link cards with the link icon.
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
        <div className="text-center py-6 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin inline" />
        </div>
      ) : canvases.length === 0 ? (
        <p className="text-center text-xs text-gray-400 py-6">No boards yet.</p>
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
                <p className="text-[10px] text-gray-400">
                  {c.cardCount} cards · {c.edgeCount} links
                </p>
              </button>
              <button
                type="button"
                onClick={() => deleteCanvas(c.id)}
                aria-label="Delete canvas"
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
