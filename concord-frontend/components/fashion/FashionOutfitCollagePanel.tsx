'use client';

/**
 * FashionOutfitCollagePanel — visual drag-and-resize outfit collage canvas
 * (Whering "Dress Me" parity gap, docs/lens-specs/fashion-capability-map.md
 * item 5: "Visual drag-and-resize outfit collage canvas"). Distinct from
 * FashionOutfitsPanel's tag-select outfit builder: the itemIds an outfit
 * holds have always been real closet items — this panel adds genuine
 * spatial arrangement (drag to reposition, a corner handle to resize) on
 * top of that already-real data. Not a new data model: it calls the
 * existing fashion.outfit-detail / fashion.outfit-set-item-position
 * macros, mirroring FashionMoodboardPanel's persistent x/y pin pattern.
 *
 * Drag/resize is built on native Pointer Events only (no new dependency),
 * the same technique as components/research/NoteCanvasBoard.tsx: capture
 * the pointer offset on pointerdown, compute a clamped live position on
 * pointermove, and commit the final value via a macro call on pointerup.
 * Local state updates immediately during the gesture for a fluid feel;
 * the server is still the source of truth — a failed persist surfaces its
 * real error instead of silently keeping the optimistic position.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ArrowLeft, LayoutGrid, Move } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface OutfitSummary {
  id: string; name: string; occasion: string; itemIds: string[]; itemNames: string[]; timesWorn: number;
}
interface DetailItem { id: string; name: string; category: string }
interface LayoutEntry { itemId: string; x: number; y: number; scale: number; custom: boolean }

const CANVAS_MAX = 640;
const BASE_SIZE = 120;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.0;

type DragState = { itemId: string; ox: number; oy: number; lastX: number; lastY: number };
type ResizeState = { itemId: string; startScale: number; startClientX: number; lastScale: number };

export function FashionOutfitCollagePanel({ onChange }: { onChange?: () => void } = {}) {
  const [outfits, setOutfits] = useState<OutfitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openName, setOpenName] = useState('');
  const [items, setItems] = useState<DetailItem[]>([]);
  const [layout, setLayout] = useState<LayoutEntry[]>([]);

  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fashion', 'outfit-list', {});
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to load outfits.'); setLoading(false); return; }
    setOutfits((r.data?.result?.outfits as OutfitSummary[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const openOutfit = useCallback(async (o: OutfitSummary) => {
    setLoading(true);
    const r = await lensRun('fashion', 'outfit-detail', { id: o.id });
    setLoading(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to load outfit.'); return; }
    setItems((r.data?.result as { items?: DetailItem[] })?.items || []);
    setLayout((r.data?.result as { layout?: LayoutEntry[] })?.layout || []);
    setOpenId(o.id);
    setOpenName(o.name);
    setError(null);
  }, []);

  const closeOutfit = () => { setOpenId(null); setItems([]); setLayout([]); };

  const persist = useCallback(async (itemId: string, patch: { x?: number; y?: number; scale?: number }) => {
    if (!openId) return;
    const r = await lensRun('fashion', 'outfit-set-item-position', { id: openId, itemId, ...patch });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to save position.'); return; }
    const result = r.data?.result as { layout?: LayoutEntry[] } | null;
    if (result?.layout) setLayout(result.layout);
    onChange?.();
  }, [openId, onChange]);

  // ── Drag (reposition) ────────────────────────────────────────────────
  const onDragPointerDown = (e: React.PointerEvent, entry: LayoutEntry) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      itemId: entry.itemId,
      ox: e.clientX - rect.left - entry.x,
      oy: e.clientY - rect.top - entry.y,
      lastX: entry.x,
      lastY: entry.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  // ── Resize (scale via corner handle) ─────────────────────────────────
  const onResizePointerDown = (e: React.PointerEvent, entry: LayoutEntry) => {
    e.stopPropagation();
    resizeRef.current = { itemId: entry.itemId, startScale: entry.scale, startClientX: e.clientX, lastScale: entry.scale };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onBoardPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const rect = boardRef.current?.getBoundingClientRect();
    if (d && rect) {
      const x = Math.max(0, Math.min(CANVAS_MAX, Math.round(e.clientX - rect.left - d.ox)));
      const y = Math.max(0, Math.min(CANVAS_MAX, Math.round(e.clientY - rect.top - d.oy)));
      d.lastX = x; d.lastY = y;
      setLayout((ls) => ls.map((l) => (l.itemId === d.itemId ? { ...l, x, y } : l)));
      return;
    }
    const r = resizeRef.current;
    if (r) {
      const deltaScale = (e.clientX - r.startClientX) / BASE_SIZE;
      const scale = Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, r.startScale + deltaScale)) * 20) / 20;
      r.lastScale = scale;
      setLayout((ls) => ls.map((l) => (l.itemId === r.itemId ? { ...l, scale } : l)));
    }
  };

  const onBoardPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d) { void persist(d.itemId, { x: d.lastX, y: d.lastY }); return; }
    const r = resizeRef.current;
    resizeRef.current = null;
    if (r) void persist(r.itemId, { scale: r.lastScale });
  };

  const itemName = (id: string) => items.find((i) => i.id === id)?.name || 'Item';

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (openId) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={closeOutfit}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="w-3.5 h-3.5" /> All outfits
          </button>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <LayoutGrid className="w-3.5 h-3.5 text-fuchsia-400" /> {openName}
          </h3>
        </div>

        {error && <div role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        {items.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
            This outfit has no items to arrange yet.
          </div>
        ) : (
          <>
            <div
              ref={boardRef}
              data-testid="collage-canvas"
              onPointerMove={onBoardPointerMove}
              onPointerUp={onBoardPointerUp}
              className="relative w-full h-[420px] bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-auto touch-none"
            >
              <div className="relative" style={{ width: CANVAS_MAX, height: CANVAS_MAX }}>
                {layout.map((entry) => {
                  const size = Math.round(BASE_SIZE * entry.scale);
                  return (
                    <div
                      key={entry.itemId}
                      data-testid={`collage-item-${entry.itemId}`}
                      data-x={entry.x}
                      data-y={entry.y}
                      data-scale={entry.scale}
                      onPointerDown={(e) => onDragPointerDown(e, entry)}
                      className="absolute select-none cursor-move bg-zinc-950 border border-zinc-700 rounded-lg shadow-lg flex flex-col items-center justify-center gap-1 group"
                      style={{ left: entry.x, top: entry.y, width: size, height: size }}
                    >
                      <Move className="w-3.5 h-3.5 text-zinc-600 group-hover:text-fuchsia-400" />
                      <p className="text-[10px] text-zinc-300 text-center px-1 line-clamp-2">{itemName(entry.itemId)}</p>
                      <div
                        aria-label={`Resize ${itemName(entry.itemId)}`}
                        role="slider"
                        aria-valuemin={SCALE_MIN}
                        aria-valuemax={SCALE_MAX}
                        aria-valuenow={entry.scale}
                        tabIndex={0}
                        data-testid={`resize-handle-${entry.itemId}`}
                        onPointerDown={(e) => onResizePointerDown(e, entry)}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') void persist(entry.itemId, { scale: Math.min(SCALE_MAX, Math.round((entry.scale + 0.1) * 20) / 20) });
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') void persist(entry.itemId, { scale: Math.max(SCALE_MIN, Math.round((entry.scale - 0.1) * 20) / 20) });
                        }}
                        className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-sm bg-fuchsia-600 border border-fuchsia-400 cursor-nwse-resize focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-[10px] text-zinc-400">
              Drag an item to reposition it. Drag the corner handle (or focus it and use the arrow keys) to resize.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <LayoutGrid className="w-3.5 h-3.5 text-fuchsia-400" /> Outfit collage
        </h3>
        <span className="text-[11px] text-zinc-400"><span className="text-zinc-100 font-semibold">{outfits.length}</span> outfits</span>
      </div>

      {error && <div role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {outfits.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No outfits yet. Build one in the Outfits tab, then arrange it here.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {outfits.map((o) => (
            <li key={o.id} data-testid={`collage-outfit-${o.id}`}>
              <button type="button" onClick={() => openOutfit(o)}
                className="w-full text-left bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 hover:border-fuchsia-700/50">
                <p className="text-sm font-semibold text-zinc-100 truncate">{o.name}</p>
                <p className="text-[10px] text-zinc-400 capitalize">{o.occasion} · {o.itemIds.length} items</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
