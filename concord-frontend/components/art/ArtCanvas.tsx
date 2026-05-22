'use client';

/**
 * ArtCanvas — a real layered drawing surface. Elements (brush strokes,
 * fills, shapes, text) are vector data replayed onto an HTML5 canvas;
 * layers composite with real blend modes and clipping masks. Every
 * edit persists through lensRun().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Undo2, Redo2, Plus, Eye, EyeOff, Trash2, ChevronUp, ChevronDown, ArrowLeft,
  Eraser, Brush, PaintBucket, Square, Circle, Minus, Type, Pipette, BoxSelect,
  Copy, Layers as LayersIcon, Lock, Unlock, Download, FlipHorizontal2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ProStudioPanel } from './ProStudioPanel';

interface El {
  id?: string; kind?: string; tool: string; color: string; size?: number; opacity: number;
  points?: number[][]; x?: number; y?: number; w?: number; h?: number;
  filled?: boolean; content?: string; fontSize?: number;
}
interface Layer { id: string; name: string; visible: boolean; opacity: number; blendMode: string; locked?: boolean; clipped?: boolean; strokes: El[] }
interface Artwork { id: string; title: string; width: number; height: number; background: string; layers: Layer[] }
interface BrushPreset { id: string; name: string; tool: string; size: number; opacity: number; custom?: boolean }

const BRUSH_TOOLS = ['pencil', 'ink', 'marker', 'airbrush'];
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
    if (el.filled) c.fillRect(el.x!, el.y!, el.w!, el.h!);
    else c.strokeRect(el.x!, el.y!, el.w!, el.h!);
  } else if (el.kind === 'ellipse') {
    c.lineWidth = el.size || 4;
    c.beginPath();
    c.ellipse(el.x! + el.w! / 2, el.y! + el.h! / 2, Math.abs(el.w!) / 2, Math.abs(el.h!) / 2, 0, 0, Math.PI * 2);
    if (el.filled) c.fill(); else c.stroke();
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

export function ArtCanvas({ artworkId, onExit }: { artworkId: string; onExit: () => void }) {
  const [artwork, setArtwork] = useState<Artwork | null>(null);
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
  const [panel, setPanel] = useState<'none' | 'transform' | 'adjust' | 'canvas' | 'pro'>('none');
  const [adjust, setAdjust] = useState({ hueShift: 0, satScale: 1, lightScale: 1 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<number[][]>([]);
  const lastRef = useRef<number[] | null>(null);
  const startRef = useRef<number[] | null>(null);
  const marqueeRef = useRef<number[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [a, b, p] = await Promise.all([
        lensRun('art', 'artwork-get', { id: artworkId }),
        lensRun('art', 'brush-presets', {}),
        lensRun('art', 'palette-list', {}),
      ]);
      if (!active) return;
      const aw = (a.data?.result?.artwork as Artwork) || null;
      setArtwork(aw);
      setActiveLayer(aw?.layers?.[aw.layers.length - 1]?.id || '');
      setBrushes(b.data?.result?.brushes || []);
      setBlendModes(b.data?.result?.blendModes || []);
      const pals = (p.data?.result?.palettes || []) as { colors: string[] }[];
      setSwatches([...new Set<string>(pals.flatMap((x) => x.colors))].slice(0, 18));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [artworkId]);

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
      ctx.strokeStyle = '#a78bfa';
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

  const toPoint = (e: React.PointerEvent): number[] => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) / r.width) * cv.width),
      Math.round(((e.clientY - r.top) / r.height) * cv.height),
    ];
  };

  const commit = useCallback(async (el: El) => {
    if (!artwork) return;
    const withId: El = { ...el, id: `tmp_${Math.random().toString(36).slice(2)}` };
    setArtwork((prev) => prev && ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === activeLayer ? { ...l, strokes: [...l.strokes, withId] } : l)),
    }));
    const r = await lensRun('art', 'stroke-commit', { artworkId: artwork.id, layerId: activeLayer, stroke: el });
    if (r.data?.ok === false) {
      // roll back on rejection (e.g. locked layer)
      setArtwork((prev) => prev && ({
        ...prev, layers: prev.layers.map((l) => (l.id === activeLayer ? { ...l, strokes: l.strokes.filter((x) => x.id !== withId.id) } : l)),
      }));
    }
  }, [artwork, activeLayer]);

  const drawLivePreview = (kind: string, a: number[], b: number[]) => {
    render();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = kind === 'select' ? 0.9 : opacity;
    ctx.strokeStyle = kind === 'select' ? '#a78bfa' : color;
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
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'select') {
      if (startRef.current) drawLivePreview(tool, startRef.current, p);
      marqueeRef.current = p;
      return;
    }
    const last = lastRef.current;
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.4) return;
    if (last) {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.lineWidth = size; ctx.strokeStyle = color; ctx.globalAlpha = opacity;
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
    const points = pointsRef.current;
    pointsRef.current = [];
    lastRef.current = null;
    if (points.length) await commit({ tool, color, size, opacity, points });
  };

  // ── history ──
  const undo = async () => {
    if (!artwork) return;
    setArtwork((prev) => prev && ({
      ...prev, layers: prev.layers.map((l) => (l.id === activeLayer ? { ...l, strokes: l.strokes.slice(0, -1) } : l)),
    }));
    await lensRun('art', 'stroke-undo', { artworkId: artwork.id, layerId: activeLayer });
  };
  const redo = async () => {
    if (!artwork) return;
    await lensRun('art', 'stroke-redo', { artworkId: artwork.id, layerId: activeLayer });
    await reload();
  };
  const reload = async () => {
    const r = await lensRun('art', 'artwork-get', { id: artworkId });
    setArtwork((r.data?.result?.artwork as Artwork) || null);
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
  const resizeCanvas = async (w: number, h: number) => {
    await lensRun('art', 'artwork-resize', { id: artwork!.id, width: w, height: h });
    await reload();
  };
  const flipCanvas = async (axis: string) => {
    await lensRun('art', 'artwork-flip', { id: artwork!.id, axis });
    await reload();
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

  if (loading || !artwork) {
    return <div className="flex items-center justify-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const TOOLS: { id: string; icon: typeof Brush; label: string }[] = [
    { id: 'select', icon: BoxSelect, label: 'Select' },
    { id: 'fill', icon: PaintBucket, label: 'Fill' },
    { id: 'rect', icon: Square, label: 'Rectangle' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse' },
    { id: 'line', icon: Minus, label: 'Line' },
    { id: 'text', icon: Type, label: 'Text' },
    { id: 'pick', icon: Pipette, label: 'Eyedropper' },
    { id: 'eraser', icon: Eraser, label: 'Eraser' },
  ];

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exit} className={topBtn}><ArrowLeft className="w-3.5 h-3.5" /> Gallery</button>
        <span className="text-sm font-semibold text-zinc-100 flex-1 truncate">{artwork.title}</span>
        <button type="button" onClick={undo} className={topBtn}><Undo2 className="w-3.5 h-3.5" /> Undo</button>
        <button type="button" onClick={redo} className={topBtn}><Redo2 className="w-3.5 h-3.5" /> Redo</button>
        <button type="button" onClick={exportPNG} className={topBtn}><Download className="w-3.5 h-3.5" /> PNG</button>
      </div>

      {/* Tool palette */}
      <div className="flex flex-wrap gap-1.5">
        {brushes.filter((b) => BRUSH_TOOLS.includes(b.tool)).map((b) => (
          <button key={b.id} type="button"
            onClick={() => { setTool(b.tool); setSize(b.size); setOpacity(b.opacity); setSelectedIds(new Set()); }}
            className={cn(toolBtn, tool === b.tool && size === b.size ? on : off)}>
            <Brush className="w-3 h-3" />{b.name}
          </button>
        ))}
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => { setTool(t.id); if (t.id !== 'select') setSelectedIds(new Set()); }}
              className={cn(toolBtn, tool === t.id ? on : off)}>
              <Icon className="w-3 h-3" />{t.label}
            </button>
          );
        })}
      </div>

      {/* Selection toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 bg-violet-950/40 border border-violet-900/50 rounded-lg px-3 py-1.5">
          <span className="text-[11px] text-violet-200">{selectedIds.size} selected</span>
          <button type="button" onClick={deleteSelection} className="text-[11px] px-2 py-0.5 bg-zinc-800 hover:bg-rose-900 text-zinc-200 rounded">Delete</button>
          <span className="text-[10px] text-zinc-500">Transform panel applies to the selection.</span>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="text-[11px] text-zinc-400 ml-auto">Clear</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3">
        {/* Canvas */}
        <div className="bg-[repeating-conic-gradient(#3f3f46_0%_25%,#27272a_0%_50%)] bg-[length:16px_16px] rounded-xl p-2 flex items-center justify-center overflow-hidden">
          <canvas
            ref={canvasRef}
            width={artwork.width}
            height={artwork.height}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="rounded shadow-lg cursor-crosshair"
            style={{ maxWidth: '100%', maxHeight: '60vh', touchAction: 'none' }}
          />
        </div>

        {/* Layers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-300">Layers</h3>
            <button type="button" onClick={addLayer} className="text-zinc-400 hover:text-violet-300"><Plus className="w-4 h-4" /></button>
          </div>
          <ul className="space-y-1.5">
            {[...artwork.layers].reverse().map((l) => (
              <li key={l.id}
                className={cn('rounded-lg border p-2', activeLayer === l.id ? 'border-violet-600 bg-violet-950/30' : 'border-zinc-800 bg-zinc-900/70')}>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => updateLayer(l.id, { visible: !l.visible })} className="text-zinc-400 hover:text-zinc-200">
                    {l.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => { setActiveLayer(l.id); setSelectedIds(new Set()); }}
                    className="flex-1 text-left text-xs text-zinc-200 truncate">{l.name}</button>
                  <button type="button" onClick={() => updateLayer(l.id, { locked: !l.locked })} className="text-zinc-500 hover:text-zinc-300">
                    {l.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                  <button type="button" onClick={() => reorderLayer(l.id, 'up')} className="text-zinc-500 hover:text-zinc-300"><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => reorderLayer(l.id, 'down')} className="text-zinc-500 hover:text-zinc-300"><ChevronDown className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => deleteLayer(l.id)} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                {activeLayer === l.id && (
                  <div className="mt-1.5 space-y-1.5">
                    <select value={l.blendMode} onChange={(e) => updateLayer(l.id, { blendMode: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-100 capitalize">
                      {blendModes.map((m) => <option key={m} value={m}>{m.replace(/-/g, ' ')}</option>)}
                    </select>
                    <input type="range" min={0} max={1} step={0.05} value={l.opacity}
                      onChange={(e) => updateLayer(l.id, { opacity: Number(e.target.value) })} className="w-full accent-violet-500" />
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => duplicateLayer(l.id)} className={miniBtn}><Copy className="w-3 h-3" /> Dup</button>
                      <button type="button" onClick={() => mergeDown(l.id)} className={miniBtn}><LayersIcon className="w-3 h-3" /> Merge</button>
                      <button type="button" onClick={() => updateLayer(l.id, { clipped: !l.clipped })}
                        className={cn(miniBtn, l.clipped && 'bg-violet-700 text-white')}>Clip</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Brush settings */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Color <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-8 bg-transparent cursor-pointer" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Size {size}
            <input type="range" min={1} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-24 accent-violet-500" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Opacity {Math.round(opacity * 100)}%
            <input type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-24 accent-violet-500" />
          </label>
          {tool === 'text' && (
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              Font {fontSize}
              <input type="range" min={8} max={200} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-20 accent-violet-500" />
            </label>
          )}
          {(tool === 'rect' || tool === 'ellipse') && (
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              <input type="checkbox" checked={shapeFilled} onChange={(e) => setShapeFilled(e.target.checked)} className="accent-violet-500" /> Filled
            </label>
          )}
        </div>
        {swatches.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {swatches.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className="w-5 h-5 rounded border border-zinc-700" style={{ background: c }} title={c} />
            ))}
          </div>
        )}
        {/* Panel toggles */}
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-zinc-800">
          {(['transform', 'adjust', 'canvas', 'pro'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPanel(panel === p ? 'none' : p)}
              className={cn(miniBtn, panel === p && 'bg-violet-700 text-white')}>
              {p === 'pro' ? 'pro studio' : p}
            </button>
          ))}
        </div>
        {panel === 'transform' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-500">{selectedIds.size ? 'selection' : 'layer'}:</span>
            <button type="button" onClick={() => doTransform('layer-transform', { dx: -20, dy: 0, scale: 1 })} className={miniBtn}>← move</button>
            <button type="button" onClick={() => doTransform('layer-transform', { dx: 20, dy: 0, scale: 1 })} className={miniBtn}>move →</button>
            <button type="button" onClick={() => doTransform('layer-transform', { dx: 0, dy: -20, scale: 1 })} className={miniBtn}>↑</button>
            <button type="button" onClick={() => doTransform('layer-transform', { dx: 0, dy: 20, scale: 1 })} className={miniBtn}>↓</button>
            <button type="button" onClick={() => doTransform('layer-transform', { dx: 0, dy: 0, scale: 1.2 })} className={miniBtn}>scale +</button>
            <button type="button" onClick={() => doTransform('layer-transform', { dx: 0, dy: 0, scale: 0.83 })} className={miniBtn}>scale −</button>
            <button type="button" onClick={() => doTransform('layer-flip', { axis: 'horizontal' })} className={miniBtn}>flip H</button>
            <button type="button" onClick={() => doTransform('layer-flip', { axis: 'vertical' })} className={miniBtn}>flip V</button>
            <button type="button" onClick={() => doTransform('layer-rotate90', { direction: 'cw' })} className={miniBtn}>rotate 90°</button>
          </div>
        )}
        {panel === 'adjust' && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-[10px] text-zinc-400">Hue {adjust.hueShift}°
              <input type="range" min={-180} max={180} value={adjust.hueShift}
                onChange={(e) => setAdjust({ ...adjust, hueShift: Number(e.target.value) })} className="w-20 accent-violet-500" /></label>
            <label className="flex items-center gap-1 text-[10px] text-zinc-400">Sat {adjust.satScale.toFixed(2)}
              <input type="range" min={0} max={2} step={0.05} value={adjust.satScale}
                onChange={(e) => setAdjust({ ...adjust, satScale: Number(e.target.value) })} className="w-20 accent-violet-500" /></label>
            <label className="flex items-center gap-1 text-[10px] text-zinc-400">Light {adjust.lightScale.toFixed(2)}
              <input type="range" min={0} max={2} step={0.05} value={adjust.lightScale}
                onChange={(e) => setAdjust({ ...adjust, lightScale: Number(e.target.value) })} className="w-20 accent-violet-500" /></label>
            <button type="button" onClick={applyAdjust} className={cn(miniBtn, 'bg-violet-600 text-white')}>Apply to layer</button>
          </div>
        )}
        {panel === 'canvas' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => flipCanvas('horizontal')} className={miniBtn}><FlipHorizontal2 className="w-3 h-3" /> Flip H</button>
            <button type="button" onClick={() => flipCanvas('vertical')} className={miniBtn}>Flip V</button>
            <button type="button" onClick={() => resizeCanvas(artwork.width + 200, artwork.height)} className={miniBtn}>Wider</button>
            <button type="button" onClick={() => resizeCanvas(artwork.width, artwork.height + 200)} className={miniBtn}>Taller</button>
            <span className="text-[10px] text-zinc-500">{artwork.width}×{artwork.height}</span>
          </div>
        )}
      </div>

      {/* Pro Studio — Procreate / Krita parity tools */}
      {panel === 'pro' && activeLayer && (
        <ProStudioPanel
          artworkId={artwork.id}
          layerId={activeLayer}
          selectedIds={[...selectedIds]}
          onApplied={reload}
        />
      )}
    </div>
  );
}

const topBtn = 'flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg';
const toolBtn = 'flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg';
const miniBtn = 'flex items-center gap-1 px-2 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded capitalize';
const on = 'bg-violet-600 text-white';
const off = 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700';
