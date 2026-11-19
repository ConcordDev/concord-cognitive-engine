'use client';

/**
 * ArtCanvas — a real layered drawing surface. Elements (brush strokes,
 * fills, shapes, text) are vector data replayed onto an HTML5 canvas;
 * layers composite with real blend modes and clipping masks. Every
 * edit persists through lensRun().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import {
  Loader2, Undo2, Redo2, Plus, Eye, EyeOff, Trash2, ChevronUp, ChevronDown, ArrowLeft,
  Eraser, Brush, PaintBucket, Square, Circle, Minus, Type, Pipette, BoxSelect,
  Copy, Layers as LayersIcon, Lock, Unlock, Download, FlipHorizontal2, Upload,
  Lasso, Pencil, Sparkles, X, ClipboardCopy, ClipboardPaste,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';
import { ProStudioPanel, type Guides } from './ProStudioPanel';
import { PublishAsTextureDialog } from './PublishAsTextureDialog';
import { PublishAsConceptDialog } from './PublishAsConceptDialog';

interface El {
  id?: string; kind?: string; tool: string; color: string; size?: number; opacity: number;
  points?: number[][]; x?: number; y?: number; w?: number; h?: number;
  filled?: boolean; content?: string; fontSize?: number; pressure?: boolean;
  // Vector shapes (chat drawings): closed/filled polygons with straight
  // edges (smooth: false) and an optional outline colour.
  closed?: boolean; smooth?: boolean; lineColor?: string;
}
interface Layer { id: string; name: string; visible: boolean; opacity: number; blendMode: string; locked?: boolean; clipped?: boolean; strokes: El[] }
interface Artwork { id: string; title: string; width: number; height: number; background: string; layers: Layer[] }
interface BrushPreset { id: string; name: string; tool: string; size: number; opacity: number; custom?: boolean }

const BRUSH_TOOLS = ['pencil', 'ink', 'marker', 'airbrush'];
// Guide kinds the backend's symmetry-mirror-stroke macro actually mirrors
// across. perspective-1pt/2pt are drawing aids, not symmetry axes — the
// macro itself rejects them ("active guide is not a symmetry guide"), so
// don't waste a round-trip calling it while one of those is active.
const MIRROR_GUIDE_KINDS = new Set(['vertical', 'horizontal', 'quadrant', 'radial']);
// Visual offset applied to pasted strokes so a paste is never invisibly
// stacked exactly on top of the copied originals.
const PASTE_OFFSET_PX = 24;
function gco(blendMode: string): GlobalCompositeOperation {
  return (blendMode === 'normal' ? 'source-over' : blendMode) as GlobalCompositeOperation;
}

function drawElement(c: CanvasRenderingContext2D, el: El, w: number, h: number) {
  c.save();
  c.globalAlpha = el.opacity ?? 1;
  c.globalCompositeOperation = el.tool === 'eraser' ? 'destination-out' : 'source-over';
  c.fillStyle = el.color;
  c.strokeStyle = el.color;
  if (el.kind === 'fill') {
    c.fillRect(0, 0, w, h);
  } else if (el.kind === 'rect') {
    c.lineWidth = el.size || 4;
    if (el.filled) {
      c.fillRect(el.x!, el.y!, el.w!, el.h!);
      if (el.lineColor) { c.strokeStyle = el.lineColor; c.strokeRect(el.x!, el.y!, el.w!, el.h!); }
    } else c.strokeRect(el.x!, el.y!, el.w!, el.h!);
  } else if (el.kind === 'ellipse') {
    c.lineWidth = el.size || 4;
    c.beginPath();
    c.ellipse(el.x! + el.w! / 2, el.y! + el.h! / 2, Math.abs(el.w!) / 2, Math.abs(el.h!) / 2, 0, 0, Math.PI * 2);
    if (el.filled) {
      c.fill();
      if (el.lineColor) { c.strokeStyle = el.lineColor; c.stroke(); }
    } else c.stroke();
  } else if (el.kind === 'text') {
    c.font = `${el.fontSize || 32}px sans-serif`;
    c.textBaseline = 'alphabetic';
    c.fillText(el.content || '', el.x!, el.y!);
  } else {
    const pts = el.points || [];
    if (pts.length) {
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.lineWidth = el.size || 6;
      if (el.tool === 'airbrush') { c.shadowBlur = (el.size || 6) * 0.6; c.shadowColor = el.color; }
      if (pts.length === 1) {
        c.beginPath();
        c.arc(pts[0][0], pts[0][1], Math.max(0.5, (el.size || 6) / 2), 0, Math.PI * 2);
        c.fill();
      } else if (el.pressure) {
        // Stylus pressure ribbon — per-point pressure (points[i][2]) varies
        // segment width so the stroke tapers like a real pressure-sensitive
        // brush instead of one flat lineWidth.
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1], p1 = pts[i];
          const pr = ((p0[2] ?? 1) + (p1[2] ?? 1)) / 2;
          c.lineWidth = Math.max(0.5, (el.size || 6) * pr);
          c.beginPath();
          c.moveTo(p0[0], p0[1]);
          c.lineTo(p1[0], p1[1]);
          c.stroke();
        }
      } else if (el.smooth === false || el.closed || el.filled) {
        // Vector polygon / polyline: straight edges, optionally closed and filled.
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        if (el.closed) c.closePath();
        if (el.filled) {
          c.fill();
          if (el.lineColor) { c.strokeStyle = el.lineColor; c.stroke(); }
        } else c.stroke();
      } else {
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          c.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
        }
        c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        c.stroke();
      }
    }
  }
  c.restore();
}

function elBBox(el: El, w: number, h: number): [number, number, number, number] {
  if (el.kind === 'fill') return [0, 0, w, h];
  if (el.kind === 'rect' || el.kind === 'ellipse') {
    return [Math.min(el.x!, el.x! + el.w!), Math.min(el.y!, el.y! + el.h!), Math.abs(el.w!), Math.abs(el.h!)];
  }
  if (el.kind === 'text') {
    const fs = el.fontSize || 32;
    return [el.x!, el.y! - fs, (el.content || '').length * fs * 0.6, fs * 1.3];
  }
  const pts = el.points || [];
  if (!pts.length) return [0, 0, 0, 0];
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

export type SideTab = 'layers' | 'refs' | 'colour' | 'pro' | 'notes';

/**
 * The easel. `onExit` returns to the pieces; the Atelier also passes a
 * sell action and the reference / colour / notes panels for the side
 * column, plus a way to take a colour from those panels into the brush.
 */
export function ArtCanvas({ artworkId, onExit, onSell, side, colourIn }: {
  artworkId: string;
  onExit: () => void;
  onSell?: (canvas: HTMLCanvasElement | null, artwork: { id: string; title: string }) => void;
  side?: Partial<Record<'refs' | 'colour' | 'notes', React.ReactNode>>;
  colourIn?: { color: string; seq: number } | null;
}) {
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  // FIX-art-009: stroke commits are fire-and-forget async — a layer-clear
  // issued while a commit was still in flight reached the server first,
  // and the late commit resurrected a cleared stroke (the Studio card then
  // showed a stroke the blank canvas disowned). Stroke mutations from this
  // canvas now run through one queue so the server sees them in the order
  // the user issued them.
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueMutation = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = mutationQueue.current.then(fn, fn);
    mutationQueue.current = run.catch(() => undefined);
    return run;
  }, []);
  const [brushes, setBrushes] = useState<BrushPreset[]>([]);
  const [blendModes, setBlendModes] = useState<string[]>([]);
  const [swatches, setSwatches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState<string>('');
  const [tool, setTool] = useState('ink');
  const [color, setColor] = useState('#1f2933');
  const [size, setSize] = useState(6);
  const [opacity, setOpacity] = useState(1);
  const [fontSize, setFontSize] = useState(36);
  const [shapeFilled, setShapeFilled] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sideTab, setSideTab] = useState<SideTab>('layers');
  const [publishOpen, setPublishOpen] = useState(false);
  const [conceptOpen, setConceptOpen] = useState(false);
  const [adjust, setAdjust] = useState({ hueShift: 0, satScale: 1, lightScale: 1 });
  const [guides, setGuides] = useState<Guides | null>(null);
  const [clipboard, setClipboard] = useState<El[]>([]);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<number[][]>([]);
  const lastRef = useRef<number[] | null>(null);
  const startRef = useRef<number[] | null>(null);
  const marqueeRef = useRef<number[] | null>(null);
  // FIX-art-008: an in-progress drag of the current selection (select
  // tool, pointer down on a selected mark). dx/dy accumulate in canvas
  // coordinates; the move commits through layer-transform on release.
  const moveDragRef = useRef<{ startX: number; startY: number; dx: number; dy: number } | null>(null);
  const isPenRef = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [critiquing, setCritiquing] = useState(false);
  const [critique, setCritique] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [a, b, p, g] = await Promise.all([
        lensRun('art', 'artwork-get', { id: artworkId }),
        lensRun('art', 'brush-presets', {}),
        lensRun('art', 'palette-list', {}),
        lensRun('art', 'guides-get', { artworkId }),
      ]);
      if (!active) return;
      const aw = (a.data?.result?.artwork as Artwork) || null;
      setArtwork(aw);
      setActiveLayer(aw?.layers?.[aw.layers.length - 1]?.id || '');
      if (b.data?.ok === false || p.data?.ok === false) {
        setToolsError(b.data?.error || p.data?.error || 'Could not load brush presets or palettes.');
      } else {
        setToolsError(null);
      }
      setBrushes(b.data?.result?.brushes || []);
      setBlendModes(b.data?.result?.blendModes || []);
      const pals = (p.data?.result?.palettes || []) as { colors: string[] }[];
      setSwatches([...new Set<string>(pals.flatMap((x) => x.colors))].slice(0, 18));
      setGuides((g.data?.result as { guides?: Guides } | undefined)?.guides || null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [artworkId]);

  // Brush-preset CRUD (surfaces art.brush-preset-save / brush-preset-delete).
  const reloadBrushes = useCallback(async () => {
    const b = await lensRun('art', 'brush-presets', {});
    if (b.data?.ok === false) {
      setToolsError(b.data?.error || 'Could not reload brush presets.');
      return;
    }
    setToolsError(null);
    setBrushes(b.data?.result?.brushes || []);
  }, []);
  const saveBrush = useCallback(async () => {
    const name = window.prompt('Name this brush preset')?.trim();
    if (!name) return;
    await lensRun('art', 'brush-preset-save', { name, tool, size, opacity });
    await reloadBrushes();
  }, [tool, size, opacity, reloadBrushes]);
  const deleteBrush = useCallback(async (id: string) => {
    setBrushes((prev) => prev.filter((b) => b.id !== id));
    try { await lensRun('art', 'brush-preset-delete', { id }); } catch { void reloadBrushes(); }
  }, [reloadBrushes]);

  const render = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !artwork) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = artwork.background;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.restore();
    let off = offRef.current;
    if (!off) { off = document.createElement('canvas'); offRef.current = off; }
    if (off.width !== cv.width) off.width = cv.width;
    if (off.height !== cv.height) off.height = cv.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    for (const layer of artwork.layers) {
      if (!layer.visible || !layer.strokes.length) continue;
      offCtx.clearRect(0, 0, off.width, off.height);
      for (const el of layer.strokes) drawElement(offCtx, el, cv.width, cv.height);
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.clipped ? 'source-atop' : gco(layer.blendMode);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
    // selection highlight
    if (selectedIds.size) {
      const layer = artwork.layers.find((l) => l.id === activeLayer);
      ctx.save();
      ctx.strokeStyle = '#e2611c';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      for (const el of layer?.strokes || []) {
        if (!el.id || !selectedIds.has(el.id)) continue;
        const [x, y, w, h] = elBBox(el, cv.width, cv.height);
        ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      }
      ctx.restore();
    }
  }, [artwork, selectedIds, activeLayer]);

  useEffect(() => { render(); }, [render]);

  // Re-fetch the full artwork. Used after any mutation whose resulting
  // strokes aren't fully knowable from the mutation's own response (symmetry
  // mirrors, batch pastes, redo, layer ops) — the server is the source of
  // truth for what strokes now exist, and `render()` already draws whatever
  // `artwork` holds, so a reload is how those new strokes actually show up.
  const reload = useCallback(async () => {
    const r = await lensRun('art', 'artwork-get', { id: artworkId });
    setArtwork((r.data?.result?.artwork as Artwork) || null);
  }, [artworkId]);

  const toPoint = (e: React.PointerEvent): number[] => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    // Real stylus devices report a variable 0..1 pressure; mice/touch report
    // a constant 0 or 0.5. Keep it on every point — harmless for the plain
    // stroke-commit path (sanitizeStroke reads only [0]/[1]) and load-bearing
    // for stroke-commit-pressure's variable-width ribbon.
    return [
      Math.round(((e.clientX - r.left) / r.width) * cv.width),
      Math.round(((e.clientY - r.top) / r.height) * cv.height),
      typeof e.pressure === 'number' ? e.pressure : 0.5,
    ];
  };

  const commit = useCallback(async (el: El) => {
    if (!artwork) return;
    const withId: El = { ...el, id: `tmp_${Math.random().toString(36).slice(2)}` };
    setArtwork((prev) => prev && ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === activeLayer ? { ...l, strokes: [...l.strokes, withId] } : l)),
    }));
    // Real stylus strokes (pointerType 'pen' with genuine per-point pressure)
    // go through the pressure-ribbon macro so the committed stroke actually
    // tapers; everything else (mouse/touch, constant 0.5) uses plain commit.
    const macro = el.pressure ? 'stroke-commit-pressure' : 'stroke-commit';
    const r = await enqueueMutation(() => lensRun('art', macro, { artworkId: artwork.id, layerId: activeLayer, stroke: el }));
    if (r.data?.ok === false) {
      // roll back on rejection (e.g. locked layer)
      setArtwork((prev) => prev && ({
        ...prev, layers: prev.layers.map((l) => (l.id === activeLayer ? { ...l, strokes: l.strokes.filter((x) => x.id !== withId.id) } : l)),
      }));
      return;
    }
    // Live symmetry: when a mirror-shaped guide (vertical / horizontal /
    // quadrant / radial — never the perspective guides, which the backend
    // rejects for this macro) is active, ask the backend to mirror the
    // just-committed stroke for real and persist the copies into the same
    // layer, then reload so they render. A full-canvas fill has no geometry
    // to mirror, so it's skipped rather than wasting a duplicate-fill call.
    const strokeId = (r.data?.result as { strokeId?: string } | undefined)?.strokeId;
    if (strokeId && el.kind !== 'fill' && guides && MIRROR_GUIDE_KINDS.has(guides.kind)) {
      const m = await lensRun('art', 'symmetry-mirror-stroke', { artworkId: artwork.id, layerId: activeLayer, strokeId });
      if (m.data?.ok) await reload();
    }
  }, [artwork, activeLayer, guides, reload, enqueueMutation]);

  const drawLivePreview = (kind: string, a: number[], b: number[]) => {
    render();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = kind === 'select' ? 0.9 : opacity;
    ctx.strokeStyle = kind === 'select' ? '#e2611c' : color;
    ctx.fillStyle = color;
    ctx.lineWidth = kind === 'select' ? 1.5 : size;
    if (kind === 'select') ctx.setLineDash([5, 4]);
    if (kind === 'rect' || kind === 'select') {
      ctx[shapeFilled && kind === 'rect' ? 'fillRect' : 'strokeRect'](a[0], a[1], b[0] - a[0], b[1] - a[1]);
    } else if (kind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      if (shapeFilled) ctx.fill(); else ctx.stroke();
    } else if (kind === 'line') {
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.restore();
  };

  const onPointerDown = async (e: React.PointerEvent) => {
    if (!artwork || !activeLayer) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isPenRef.current = e.pointerType === 'pen';
    const p = toPoint(e);
    if (tool === 'fill') {
      await commit({ kind: 'fill', tool: 'fill', color, opacity });
      return;
    }
    if (tool === 'text') {
      const content = window.prompt('Text:');
      if (content && content.trim()) {
        await commit({ kind: 'text', tool: 'text', color, opacity, x: p[0], y: p[1], content: content.trim(), fontSize });
      }
      return;
    }
    if (tool === 'pick') {
      const ctx = canvasRef.current!.getContext('2d');
      const d = ctx?.getImageData(p[0], p[1], 1, 1).data;
      if (d) {
        const hex = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        setColor(hex);
      }
      return;
    }
    drawingRef.current = true;
    if (tool === 'select' && selectedIds.size) {
      // Grabbing a selected mark starts a move drag, not a new marquee.
      const cv = canvasRef.current;
      const layer = artwork.layers.find((l) => l.id === activeLayer);
      const onSelected = !!cv && !!layer && layer.strokes.some((el) => {
        if (!el.id || !selectedIds.has(el.id)) return false;
        const [bx, by, bw, bh] = elBBox(el, cv.width, cv.height);
        return p[0] >= bx && p[0] <= bx + bw && p[1] >= by && p[1] <= by + bh;
      });
      if (onSelected) {
        moveDragRef.current = { startX: p[0], startY: p[1], dx: 0, dy: 0 };
        return;
      }
    }
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'select') {
      startRef.current = p;
      return;
    }
    pointsRef.current = [p];
    lastRef.current = p;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const p = toPoint(e);
    if (tool === 'select' && moveDragRef.current) {
      const md = moveDragRef.current;
      md.dx = p[0] - md.startX;
      md.dy = p[1] - md.startY;
      // Ghost preview: repaint the artwork, then stroke the selection's
      // boxes at the dragged offset (the real move commits on release).
      render();
      const cv = canvasRef.current;
      const ctx = cv?.getContext('2d');
      const layer = artwork?.layers.find((l) => l.id === activeLayer);
      if (cv && ctx && layer) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#e2611c'; ctx.globalAlpha = 0.9;
        for (const el of layer.strokes) {
          if (!el.id || !selectedIds.has(el.id)) continue;
          const [bx, by, bw, bh] = elBBox(el, cv.width, cv.height);
          ctx.strokeRect(bx + md.dx, by + md.dy, bw, bh);
        }
        ctx.restore();
      }
      return;
    }
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'select') {
      if (startRef.current) drawLivePreview(tool, startRef.current, p);
      marqueeRef.current = p;
      return;
    }
    const last = lastRef.current;
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.4) return;
    if (tool === 'lasso') {
      // freeform selection outline — dashed violet preview only, never paint
      if (last) {
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#e2611c'; ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
          ctx.restore();
        }
      }
      pointsRef.current.push(p);
      lastRef.current = p;
      return;
    }
    if (last) {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.lineWidth = size * (isPenRef.current ? (p[2] ?? 0.5) + 0.3 : 1); ctx.strokeStyle = color; ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
        if (tool === 'airbrush') { ctx.shadowBlur = size * 0.6; ctx.shadowColor = color; }
        ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
        ctx.restore();
      }
    }
    pointsRef.current.push(p);
    lastRef.current = p;
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    if (!drawingRef.current || !artwork) return;
    drawingRef.current = false;
    const end = toPoint(e);
    const start = startRef.current;
    startRef.current = null;
    if (tool === 'select' && moveDragRef.current) {
      const md = moveDragRef.current;
      moveDragRef.current = null;
      const dx = Math.round(md.dx); const dy = Math.round(md.dy);
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
        await lensRun('art', 'layer-transform', { artworkId: artwork.id, layerId: activeLayer, dx, dy, scale: 1, ids: [...selectedIds] });
        await reload();
      } else {
        render(); // a plain click on a selected mark — keep the selection
      }
      return;
    }
    if (tool === 'select') {
      if (start) {
        const x = Math.min(start[0], end[0]); const y = Math.min(start[1], end[1]);
        const w = Math.abs(end[0] - start[0]); const h = Math.abs(end[1] - start[1]);
        const layer = artwork.layers.find((l) => l.id === activeLayer);
        const cv = canvasRef.current!;
        const hit = new Set<string>();
        for (const el of layer?.strokes || []) {
          if (!el.id) continue;
          const [bx, by, bw, bh] = elBBox(el, cv.width, cv.height);
          if (bx < x + w && bx + bw > x && by < y + h && by + bh > y) hit.add(el.id);
        }
        setSelectedIds(hit);
      }
      return;
    }
    if (tool === 'rect' || tool === 'ellipse') {
      if (start) {
        const x = Math.min(start[0], end[0]); const y = Math.min(start[1], end[1]);
        const w = Math.abs(end[0] - start[0]); const h = Math.abs(end[1] - start[1]);
        if (w > 1 && h > 1) await commit({ kind: tool, tool, color, size, opacity, x, y, w, h, filled: shapeFilled });
      }
      return;
    }
    if (tool === 'line') {
      if (start) await commit({ tool: 'ink', color, size, opacity, points: [start, end] });
      return;
    }
    if (tool === 'lasso') {
      const polygon = pointsRef.current;
      pointsRef.current = [];
      lastRef.current = null;
      render(); // wipe the transient dashed preview
      if (polygon.length >= 3) {
        const r = await lensRun('art', 'selection-lasso', { artworkId: artwork.id, layerId: activeLayer, polygon });
        if (r.data?.ok) setSelectedIds(new Set((r.data.result?.selection?.ids as string[]) || []));
      }
      return;
    }
    const points = pointsRef.current;
    pointsRef.current = [];
    lastRef.current = null;
    // A stylus stroke where pressure genuinely varied across the path (not a
    // flat mouse/touch 0.5 default) commits through the pressure-ribbon
    // macro so it persists and replays as a real tapered stroke.
    const hasRealPressure = isPenRef.current && points.some((pt) => Math.abs((pt[2] ?? 0.5) - 0.5) > 0.03);
    if (points.length) await commit({ tool, color, size, opacity, points, pressure: hasRealPressure || undefined });
  };

  // ── history ──
  const undo = async () => {
    if (!artwork) return;
    setArtwork((prev) => prev && ({
      ...prev, layers: prev.layers.map((l) => (l.id === activeLayer ? { ...l, strokes: l.strokes.slice(0, -1) } : l)),
    }));
    await enqueueMutation(() => lensRun('art', 'stroke-undo', { artworkId: artwork.id, layerId: activeLayer }));
  };
  const redo = async () => {
    if (!artwork) return;
    await enqueueMutation(() => lensRun('art', 'stroke-redo', { artworkId: artwork.id, layerId: activeLayer }));
    await reload();
  };

  // ── layer ops ──
  const addLayer = async () => {
    if (!artwork) return;
    const r = await lensRun('art', 'layer-add', { artworkId: artwork.id });
    const layer = r.data?.result?.layer as Layer | undefined;
    if (layer) { setArtwork((prev) => prev && ({ ...prev, layers: [...prev.layers, layer] })); setActiveLayer(layer.id); }
  };
  const updateLayer = async (layerId: string, patch: Partial<Layer>) => {
    setArtwork((prev) => prev && ({ ...prev, layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) }));
    await lensRun('art', 'layer-update', { artworkId: artwork!.id, layerId, ...patch });
  };
  const deleteLayer = async (layerId: string) => {
    if (!artwork || artwork.layers.length <= 1) return;
    setArtwork((prev) => prev && ({ ...prev, layers: prev.layers.filter((l) => l.id !== layerId) }));
    if (activeLayer === layerId) setActiveLayer(artwork.layers.filter((l) => l.id !== layerId).slice(-1)[0]?.id || '');
    await lensRun('art', 'layer-delete', { artworkId: artwork.id, layerId });
  };
  const reorderLayer = async (layerId: string, direction: 'up' | 'down') => {
    if (!artwork) return;
    const i = artwork.layers.findIndex((l) => l.id === layerId);
    const j = i + (direction === 'up' ? 1 : -1);
    if (i < 0 || j < 0 || j >= artwork.layers.length) return;
    const layers = [...artwork.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    setArtwork({ ...artwork, layers });
    await lensRun('art', 'layer-reorder', { artworkId: artwork.id, layerId, direction });
  };
  const duplicateLayer = async (layerId: string) => {
    await lensRun('art', 'layer-duplicate', { artworkId: artwork!.id, layerId });
    await reload();
  };
  const mergeDown = async (layerId: string) => {
    await lensRun('art', 'layer-merge-down', { artworkId: artwork!.id, layerId });
    await reload();
  };

  // ── transform / adjust / canvas ──
  const doTransform = async (action: string, params: Record<string, unknown>) => {
    const ids = selectedIds.size ? [...selectedIds] : undefined;
    await lensRun('art', action, { artworkId: artwork!.id, layerId: activeLayer, ...params, ids });
    await reload();
  };
  const applyAdjust = async () => {
    await lensRun('art', 'layer-adjust-color', { artworkId: artwork!.id, layerId: activeLayer, ...adjust });
    setAdjust({ hueShift: 0, satScale: 1, lightScale: 1 });
    await reload();
  };
  const deleteSelection = async () => {
    if (!selectedIds.size) return;
    await lensRun('art', 'element-delete', { artworkId: artwork!.id, layerId: activeLayer, ids: [...selectedIds] });
    setSelectedIds(new Set());
    await reload();
  };

  // ── copy / paste (art.stroke-batch) ──
  // Copy is purely client-side (nothing to persist — it's just a clipboard
  // snapshot of the selected strokes' real data). Paste is the actual wire:
  // it posts the serialized strokes through stroke-batch so what lands in
  // the layer is genuinely server-minted, offset so it's visibly distinct
  // from the strokes it was copied from rather than stacking invisibly.
  const copySelection = useCallback(() => {
    if (!artwork || !selectedIds.size) return;
    const layer = artwork.layers.find((l) => l.id === activeLayer);
    if (!layer) return;
    const copied = layer.strokes.filter((el) => el.id && selectedIds.has(el.id));
    setClipboard(copied);
  }, [artwork, activeLayer, selectedIds]);

  const pasteClipboard = useCallback(async () => {
    if (!artwork || !clipboard.length) return;
    const strokes = clipboard.map((el) => ({
      ...el,
      points: el.points
        ? el.points.map((pt) => (pt.length >= 3
          ? [pt[0] + PASTE_OFFSET_PX, pt[1] + PASTE_OFFSET_PX, pt[2]]
          : [pt[0] + PASTE_OFFSET_PX, pt[1] + PASTE_OFFSET_PX]))
        : undefined,
      x: typeof el.x === 'number' ? el.x + PASTE_OFFSET_PX : el.x,
      y: typeof el.y === 'number' ? el.y + PASTE_OFFSET_PX : el.y,
    }));
    const r = await lensRun('art', 'stroke-batch', { artworkId: artwork.id, layerId: activeLayer, strokes });
    if (r.data?.ok) {
      setSelectedIds(new Set());
      await reload();
    }
  }, [artwork, activeLayer, clipboard, reload]);
  const resizeCanvas = async (w: number, h: number) => {
    await lensRun('art', 'artwork-resize', { id: artwork!.id, width: w, height: h });
    await reload();
  };
  const flipCanvas = async (axis: string) => {
    await lensRun('art', 'artwork-flip', { id: artwork!.id, axis });
    await reload();
  };

  // ── rename ──
  const startRename = () => { setTitleDraft(artwork?.title || ''); setRenaming(true); };
  const saveRename = async () => {
    const title = titleDraft.trim();
    setRenaming(false);
    if (!artwork || !title || title === artwork.title) return;
    setArtwork((prev) => prev && ({ ...prev, title }));
    await lensRun('art', 'artwork-rename', { id: artwork.id, title });
  };

  // ── clear layer (remove all strokes, keep the layer itself) ──
  const clearLayer = async (layerId: string) => {
    if (!artwork) return;
    if (!window.confirm('Clear all strokes on this layer? This cannot be undone.')) return;
    setArtwork((prev) => prev && ({
      ...prev, layers: prev.layers.map((l) => (l.id === layerId ? { ...l, strokes: [] } : l)),
    }));
    await enqueueMutation(() => lensRun('art', 'layer-clear', { artworkId: artwork.id, layerId }));
  };

  // ── AI vision critique — snapshots the live canvas and asks the vision
  // brain for real feedback (composition, color, technique). Honest failure
  // when the vision brain is unreachable, never a fabricated critique.
  const runCritique = async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    setCritiquing(true);
    setCritique(null);
    try {
      // The `vision` handler returns its own {ok, content, error} envelope
      // (not the {ok, result} shape most macros use), so unwrap one level
      // deeper — the transport's outer `ok` only means "the call dispatched".
      const r = await lensRun('art', 'vision', { imageB64: cv.toDataURL('image/jpeg', 0.85) });
      const inner = r.data?.result as { ok?: boolean; content?: string; error?: string } | undefined;
      if (inner?.ok && inner.content) {
        setCritique(inner.content);
      } else {
        setCritique(`Vision brain unavailable (${inner?.error || r.data?.error || 'unreachable'}).`);
      }
    } catch (e) {
      setCritique(`Vision brain unavailable (${e instanceof Error ? e.message : 'request failed'}).`);
    }
    setCritiquing(false);
  };

  const exportPNG = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `${artwork?.title || 'artwork'}.png`;
    a.click();
  };

  const exit = async () => {
    const cv = canvasRef.current;
    if (cv && artwork) {
      const scale = Math.min(1, 360 / cv.width);
      const tc = document.createElement('canvas');
      tc.width = Math.round(cv.width * scale);
      tc.height = Math.round(cv.height * scale);
      const tctx = tc.getContext('2d');
      if (tctx) {
        tctx.drawImage(cv, 0, 0, tc.width, tc.height);
        try { await lensRun('art', 'artwork-save-thumbnail', { id: artwork.id, thumbnail: tc.toDataURL('image/jpeg', 0.72) }); } catch { /* best effort */ }
      }
    }
    onExit();
  };

  // A colour chosen on the Colour panel loads onto the brush.
  useEffect(() => { if (colourIn?.color) setColor(colourIn.color); }, [colourIn]);

  // Painter's keys: B brush, E eraser, V select, L lasso, G fill, I eyedropper,
  // T text, R/O/N shapes, [ and ] brush size, ⌘Z undo, ⇧⌘Z redo.
  const keysRef = useRef({ undo, redo });
  keysRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); void (e.shiftKey ? keysRef.current.redo() : keysRef.current.undo()); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, string> = { b: 'ink', e: 'eraser', v: 'select', l: 'lasso', g: 'fill', i: 'pick', t: 'text', r: 'rect', o: 'ellipse', n: 'line' };
      const k = e.key.toLowerCase();
      if (map[k]) { e.preventDefault(); setTool(map[k]); if (k !== 'v' && k !== 'l') setSelectedIds(new Set()); return; }
      if (e.key === '[') setSize((v) => Math.max(1, v - 2));
      if (e.key === ']') setSize((v) => Math.min(120, v + 2));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loading || !artwork) {
    return <div className="at-easel min-h-[60vh]" role="status" aria-label="Loading the piece"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--at-muted)]" /></div>;
  }

  const TOOLS: { id: string; icon: typeof Brush; label: string; key: string }[] = [
    { id: 'select', icon: BoxSelect, label: 'Select', key: 'V' },
    { id: 'lasso', icon: Lasso, label: 'Lasso', key: 'L' },
    { id: 'fill', icon: PaintBucket, label: 'Fill', key: 'G' },
    { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' },
    { id: 'line', icon: Minus, label: 'Line', key: 'N' },
    { id: 'text', icon: Type, label: 'Text', key: 'T' },
    { id: 'pick', icon: Pipette, label: 'Eyedropper', key: 'I' },
    { id: 'eraser', icon: Eraser, label: 'Eraser', key: 'E' },
  ];
  const SIDE: { id: SideTab; label: string }[] = [
    { id: 'layers', label: 'Layers' },
    { id: 'refs', label: 'Refs' },
    { id: 'colour', label: 'Colour' },
    { id: 'pro', label: 'Tools' },
    { id: 'notes', label: 'Notes' },
  ];
  const strokes = artwork.layers.reduce((n, l) => n + l.strokes.length, 0);

  return (
    <div className="space-y-3" data-testid="art-canvas">
      {/* The piece: its name, the hand tools and what you can do with it */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exit} className="at-btn at-btn-quiet" title="Your pieces"><ArrowLeft className="h-3.5 w-3.5" /> Pieces</button>
        {renaming ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            maxLength={200}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setRenaming(false); }}
            onBlur={saveRename}
            className="at-input max-w-[360px]"
            aria-label="Name this piece"
          />
        ) : (
          <button type="button" onClick={startRename} title="Rename this piece" className="group flex min-w-0 items-baseline gap-2 text-left">
            <span className="at-display truncate text-[22px] leading-none" data-testid="at-title">{artwork.title}</span>
            <Pencil className="h-3 w-3 shrink-0 text-[color:var(--at-faint)] group-hover:text-[color:var(--at-accent)]" />
          </button>
        )}
        <span className="at-label at-num hidden sm:inline">{artwork.width}×{artwork.height} · {artwork.layers.length} layers · {strokes} marks</span>
        <span className="flex-1" />
        <button type="button" onClick={undo} className="at-btn at-btn-quiet" title="Undo (⌘Z)"><Undo2 className="h-3.5 w-3.5" /> Undo</button>
        <button type="button" onClick={redo} className="at-btn at-btn-quiet" title="Redo (⇧⌘Z)"><Redo2 className="h-3.5 w-3.5" /> Redo</button>
        <button type="button" onClick={() => void pasteClipboard()} disabled={!clipboard.length} className="at-btn at-btn-quiet"
          title="Paste the copied marks into the active layer, offset so you can see them land">
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste{clipboard.length ? ` (${clipboard.length})` : ''}
        </button>
        <button type="button" onClick={exportPNG} className="at-btn at-btn-quiet" title="Download as PNG"><Download className="h-3.5 w-3.5" /> PNG</button>
        <button type="button" onClick={runCritique} disabled={critiquing} className="at-btn" title="Snapshot the canvas and ask the vision brain for a critique">
          {critiquing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Critique
        </button>
        <button type="button" onClick={() => setPublishOpen(true)} className="at-btn"
          title="Publish as a Concordia material texture — flows through evo_assets → pbr-loader → procedural-buildings">
          <Upload className="h-3.5 w-3.5" /> Material
        </button>
        <button type="button" onClick={() => setConceptOpen(true)} className="at-btn"
          title="Publish as concept art — mints a citable DTU other asset macros (e.g. a building blueprint) can cite as their origin">
          <Upload className="h-3.5 w-3.5" /> Concept
        </button>
        {onSell && (
          <button type="button" onClick={() => onSell(canvasRef.current, { id: artwork.id, title: artwork.title })} className="at-btn at-btn-paint" data-testid="at-sell">
            Put on sale
          </button>
        )}
      </div>

      {critique && (
        <div className="at-note at-rise flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--at-accent)]" />
          <p className="flex-1 leading-relaxed">{critique}</p>
          <button type="button" onClick={() => setCritique(null)} aria-label="Dismiss critique" className="text-[color:var(--at-muted)]"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {toolsError && <ErrorState variant="inline" message={toolsError} onRetry={() => void reloadBrushes()} />}

      {/* Selection */}
      {selectedIds.size > 0 && (
        <div className="at-tray at-rise flex flex-wrap items-center gap-2 px-3 py-1.5">
          <span className="text-[12px] font-medium">{selectedIds.size} selected</span>
          <span className="flex flex-wrap items-center gap-1">
            {(artwork.layers.find((l) => l.id === activeLayer)?.strokes || [])
              .filter((el) => el.id && selectedIds.has(el.id))
              .map((el) => {
                const label = el.kind === 'text' ? `text “${(el.content || '').slice(0, 16)}”` : (el.tool || el.kind || 'mark');
                return (
                  <span key={el.id} className="flex items-center gap-1 rounded bg-[var(--at-accent-soft)] px-1.5 py-0.5 text-[11px]">
                    {label}
                    <button type="button" aria-label={`Remove ${label} from selection`}
                      onClick={() => setSelectedIds((prev) => { const next = new Set(prev); next.delete(el.id!); return next; })}
                      className="text-[color:var(--at-accent-text)]">×</button>
                  </span>
                );
              })}
          </span>
          <button type="button" onClick={copySelection} className="at-btn h-7 px-2"><ClipboardCopy className="h-3 w-3" /> Copy</button>
          <button type="button" onClick={deleteSelection} className="at-btn h-7 px-2">Delete</button>
          <span className="text-[11px] text-[color:var(--at-muted)]">Drag selected marks on the canvas to move them.</span>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="ml-auto text-[12px] text-[color:var(--at-muted)]">Clear</button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[208px_minmax(0,1fr)_300px]">
        {/* The brush tray and the mixing slab */}
        <aside className="order-2 min-w-0 space-y-3 lg:order-none" aria-label="Brushes and colour">
          <div className="at-tray p-2">
            <p className="at-label px-1 pb-1.5">Brushes</p>
            <div className="at-scroll flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
              {brushes.filter((b) => BRUSH_TOOLS.includes(b.tool)).map((b) => (
                <span key={b.id} className="group relative block shrink-0 lg:shrink">
                  <button type="button" aria-pressed={tool === b.tool && size === b.size}
                    onClick={() => { setTool(b.tool); setSize(b.size); setOpacity(b.opacity); setSelectedIds(new Set()); }}
                    className="at-tool">
                    <Brush className="h-3.5 w-3.5" />{b.name}<span className="ml-auto text-[10.5px] text-[color:var(--at-faint)] at-num">{b.size}px</span>
                  </button>
                  {b.custom && (
                    <button type="button" onClick={() => void deleteBrush(b.id)} aria-label={`Delete brush ${b.name}`}
                      className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-[var(--at-bad)] text-[9px] text-[color:var(--at-accent-ink)] group-hover:flex">×</button>
                  )}
                </span>
              ))}
              <button type="button" onClick={() => void saveBrush()} className="at-tool text-[color:var(--at-muted)]"
                title="Keep the current tool, size and opacity as a brush. The piece itself saves on its own.">
                <Plus className="h-3.5 w-3.5" />Save brush
              </button>
            </div>
            <p className="at-label px-1 pb-1.5 pt-3">Tools</p>
            <div className="at-scroll flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
              {TOOLS.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.id} type="button" aria-label={t.label} aria-pressed={tool === t.id}
                    onClick={() => { setTool(t.id); if (t.id !== 'select' && t.id !== 'lasso') setSelectedIds(new Set()); }}
                    className="at-tool">
                    <Icon className="h-3.5 w-3.5" />{t.label}<kbd className="ml-auto text-[10px] text-[color:var(--at-faint)]">{t.key}</kbd>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="at-slab space-y-2.5" aria-label="Colour">
            <div className="flex items-center gap-3">
              <label className="relative" title="Mix a colour">
                <span className="at-loaded block" style={{ background: color }} data-testid="at-loaded" />
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Brush colour" />
              </label>
              <div className="min-w-0">
                <p className="at-label">On the brush</p>
                <p className="at-num text-[12px] uppercase">{color}</p>
              </div>
            </div>
            {swatches.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {swatches.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)} className="at-dab" aria-pressed={c.toLowerCase() === color.toLowerCase()} style={{ background: c }} title={c} aria-label={`Load ${c}`} />
                ))}
              </div>
            )}
            <label className="block text-[12px]">
              <span className="flex justify-between"><span>Size</span><span className="at-num text-[color:var(--at-muted)]">{size}px</span></span>
              <input type="range" min={1} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} className="at-range" />
            </label>
            <label className="block text-[12px]">
              <span className="flex justify-between"><span>Opacity</span><span className="at-num text-[color:var(--at-muted)]">{Math.round(opacity * 100)}%</span></span>
              <input type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="at-range" />
            </label>
            {tool === 'text' && (
              <label className="block text-[12px]">
                <span className="flex justify-between"><span>Font</span><span className="at-num text-[color:var(--at-muted)]">{fontSize}</span></span>
                <input type="range" min={8} max={200} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="at-range" />
              </label>
            )}
            {(tool === 'rect' || tool === 'ellipse') && (
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={shapeFilled} onChange={(e) => setShapeFilled(e.target.checked)} className="accent-[color:var(--at-accent)]" /> Filled
              </label>
            )}
          </div>
        </aside>

        {/* The easel */}
        <div className="at-easel order-1 min-h-[42vh] p-3 sm:p-8 lg:order-none lg:min-h-[56vh]">
          <canvas
            ref={canvasRef}
            width={artwork.width}
            height={artwork.height}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="cursor-crosshair"
            style={{ maxWidth: '100%', maxHeight: '64vh', touchAction: 'none' }}
            aria-label={`Canvas: ${artwork.title}`}
          />
          <div className="at-ledge" aria-hidden />
        </div>

        {/* The studio wall: layers, references, colour, tools, notes */}
        <aside className="order-3 min-w-0 lg:order-none" aria-label="Studio wall">
          <div className="at-scroll flex gap-0.5 overflow-x-auto" role="tablist" aria-label="Side panels">
            {SIDE.filter((t) => t.id === 'layers' || t.id === 'pro' || side?.[t.id as 'refs' | 'colour' | 'notes']).map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={sideTab === t.id} className="at-tab" onClick={() => setSideTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <div className="at-tray at-scroll max-h-[72vh] overflow-y-auto rounded-tl-none p-2.5">
            {sideTab === 'layers' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="at-label">Layers · top first</p>
                  <button type="button" onClick={addLayer} aria-label="Add layer" className="at-btn h-7 px-2"><Plus className="h-3.5 w-3.5" /> Add</button>
                </div>
                <ul className="space-y-1.5">
                  {[...artwork.layers].reverse().map((l) => (
                    <li key={l.id} className="at-layer p-2" data-active={activeLayer === l.id}>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => updateLayer(l.id, { visible: !l.visible })} aria-label={l.visible ? `Hide layer ${l.name}` : `Show layer ${l.name}`} className="text-[color:var(--at-muted)]">
                          {l.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" onClick={() => { setActiveLayer(l.id); setSelectedIds(new Set()); }} className="flex-1 truncate text-left text-[12.5px]">
                          {l.name} <span className="text-[10.5px] text-[color:var(--at-faint)] at-num">{l.strokes.length}</span>
                        </button>
                        <button type="button" onClick={() => updateLayer(l.id, { locked: !l.locked })} aria-label={l.locked ? `Unlock layer ${l.name}` : `Lock layer ${l.name}`} className="text-[color:var(--at-muted)]">
                          {l.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        </button>
                        <button type="button" onClick={() => reorderLayer(l.id, 'up')} aria-label={`Move layer ${l.name} up`} className="text-[color:var(--at-muted)]"><ChevronUp className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => reorderLayer(l.id, 'down')} aria-label={`Move layer ${l.name} down`} className="text-[color:var(--at-muted)]"><ChevronDown className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => deleteLayer(l.id)} aria-label={`Delete layer ${l.name}`} className="text-[color:var(--at-faint)] hover:text-[color:var(--at-bad)]"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      {activeLayer === l.id && (
                        <div className="mt-2 space-y-1.5">
                          <select value={l.blendMode} onChange={(e) => updateLayer(l.id, { blendMode: e.target.value })} className="at-input h-7 capitalize" aria-label="Blend mode">
                            {blendModes.map((m) => <option key={m} value={m}>{m.replace(/-/g, ' ')}</option>)}
                          </select>
                          <label className="block text-[11.5px]">
                            <span className="flex justify-between"><span>Layer opacity</span><span className="at-num">{Math.round(l.opacity * 100)}%</span></span>
                            <input type="range" min={0} max={1} step={0.05} value={l.opacity} onChange={(e) => updateLayer(l.id, { opacity: Number(e.target.value) })} className="at-range" />
                          </label>
                          <div className="flex flex-wrap gap-1">
                            <button type="button" onClick={() => duplicateLayer(l.id)} className="at-btn h-7 px-2 text-[11.5px]"><Copy className="h-3 w-3" /> Dup</button>
                            <button type="button" onClick={() => mergeDown(l.id)} className="at-btn h-7 px-2 text-[11.5px]"><LayersIcon className="h-3 w-3" /> Merge</button>
                            <button type="button" onClick={() => updateLayer(l.id, { clipped: !l.clipped })} aria-pressed={!!l.clipped} className={cn('at-btn h-7 px-2 text-[11.5px]', l.clipped && 'at-btn-paint')}>Clip</button>
                            <button type="button" onClick={() => clearLayer(l.id)} disabled={!l.strokes.length} className="at-btn h-7 px-2 text-[11.5px]" title="Erase every mark on this layer">Clear</button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sideTab === 'pro' && (
              <div className="space-y-4">
                <section>
                  <p className="at-label mb-1.5">Move · {selectedIds.size ? 'the selection' : 'the layer'}</p>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => doTransform('layer-transform', { dx: -20, dy: 0, scale: 1 })} className="at-btn h-7 px-2" aria-label="Move left">←</button>
                    <button type="button" onClick={() => doTransform('layer-transform', { dx: 20, dy: 0, scale: 1 })} className="at-btn h-7 px-2" aria-label="Move right">→</button>
                    <button type="button" onClick={() => doTransform('layer-transform', { dx: 0, dy: -20, scale: 1 })} className="at-btn h-7 px-2" aria-label="Move up">↑</button>
                    <button type="button" onClick={() => doTransform('layer-transform', { dx: 0, dy: 20, scale: 1 })} className="at-btn h-7 px-2" aria-label="Move down">↓</button>
                    <button type="button" onClick={() => doTransform('layer-transform', { dx: 0, dy: 0, scale: 1.2 })} className="at-btn h-7 px-2">Larger</button>
                    <button type="button" onClick={() => doTransform('layer-transform', { dx: 0, dy: 0, scale: 0.83 })} className="at-btn h-7 px-2">Smaller</button>
                    <button type="button" onClick={() => doTransform('layer-flip', { axis: 'horizontal' })} className="at-btn h-7 px-2">Flip ↔</button>
                    <button type="button" onClick={() => doTransform('layer-flip', { axis: 'vertical' })} className="at-btn h-7 px-2">Flip ↕</button>
                    <button type="button" onClick={() => doTransform('layer-rotate90', { direction: 'cw' })} className="at-btn h-7 px-2">Turn 90°</button>
                  </div>
                </section>
                <section>
                  <p className="at-label mb-1.5">Adjust the layer's colour</p>
                  <div className="space-y-1">
                    <label className="block text-[11.5px]"><span className="flex justify-between"><span>Hue</span><span className="at-num">{adjust.hueShift}°</span></span>
                      <input type="range" min={-180} max={180} value={adjust.hueShift} onChange={(e) => setAdjust({ ...adjust, hueShift: Number(e.target.value) })} className="at-range" /></label>
                    <label className="block text-[11.5px]"><span className="flex justify-between"><span>Saturation</span><span className="at-num">{adjust.satScale.toFixed(2)}</span></span>
                      <input type="range" min={0} max={2} step={0.05} value={adjust.satScale} onChange={(e) => setAdjust({ ...adjust, satScale: Number(e.target.value) })} className="at-range" /></label>
                    <label className="block text-[11.5px]"><span className="flex justify-between"><span>Lightness</span><span className="at-num">{adjust.lightScale.toFixed(2)}</span></span>
                      <input type="range" min={0} max={2} step={0.05} value={adjust.lightScale} onChange={(e) => setAdjust({ ...adjust, lightScale: Number(e.target.value) })} className="at-range" /></label>
                    <button type="button" onClick={applyAdjust} className="at-btn at-btn-paint h-7 px-2">Apply to layer</button>
                  </div>
                </section>
                <section>
                  <p className="at-label mb-1.5">Canvas · <span className="at-num">{artwork.width}×{artwork.height}</span></p>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => flipCanvas('horizontal')} className="at-btn h-7 px-2"><FlipHorizontal2 className="h-3 w-3" /> Flip ↔</button>
                    <button type="button" onClick={() => flipCanvas('vertical')} className="at-btn h-7 px-2">Flip ↕</button>
                    <button type="button" onClick={() => resizeCanvas(artwork.width + 200, artwork.height)} className="at-btn h-7 px-2">Wider</button>
                    <button type="button" onClick={() => resizeCanvas(artwork.width, artwork.height + 200)} className="at-btn h-7 px-2">Taller</button>
                  </div>
                </section>
                {activeLayer && (
                  <ProStudioPanel artworkId={artwork.id} layerId={activeLayer} selectedIds={[...selectedIds]} onApplied={reload}
                    canvas={canvasRef.current} guides={guides} onGuidesChange={setGuides} />
                )}
              </div>
            )}

            {sideTab === 'refs' && side?.refs}
            {sideTab === 'colour' && side?.colour}
            {sideTab === 'notes' && side?.notes}
          </div>
        </aside>
      </div>

      {publishOpen && <PublishAsTextureDialog canvas={canvasRef.current} artworkId={artwork?.id} onClose={() => setPublishOpen(false)} />}
      {conceptOpen && <PublishAsConceptDialog canvas={canvasRef.current} artworkId={artwork?.id} artworkTitle={artwork?.title} onClose={() => setConceptOpen(false)} />}
    </div>
  );
}
