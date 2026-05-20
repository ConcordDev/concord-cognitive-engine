'use client';

/**
 * ArtCanvas — a real layered drawing surface. Strokes are vector data
 * replayed onto an HTML5 canvas; layers composite with real blend
 * modes. Every committed stroke persists through lensRun().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Undo2, Plus, Eye, EyeOff, Trash2, ChevronUp, ChevronDown, ArrowLeft, Eraser,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Stroke { id?: string; tool: string; color: string; size: number; opacity: number; points: number[][] }
interface Layer { id: string; name: string; visible: boolean; opacity: number; blendMode: string; strokes: Stroke[] }
interface Artwork { id: string; title: string; width: number; height: number; background: string; layers: Layer[] }
interface Brush { id: string; name: string; tool: string; size: number; opacity: number }

function gco(blendMode: string): GlobalCompositeOperation {
  return (blendMode === 'normal' ? 'source-over' : blendMode) as GlobalCompositeOperation;
}

function drawStroke(c: CanvasRenderingContext2D, st: Stroke) {
  const pts = st.points;
  if (!pts.length) return;
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = st.size;
  c.strokeStyle = st.color;
  c.fillStyle = st.color;
  c.globalAlpha = st.opacity;
  c.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
  if (st.tool === 'airbrush') { c.shadowBlur = st.size * 0.6; c.shadowColor = st.color; }
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0][0], pts[0][1], Math.max(0.5, st.size / 2), 0, Math.PI * 2);
    c.fill();
  } else {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    c.stroke();
  }
  c.restore();
}

export function ArtCanvas({ artworkId, onExit }: { artworkId: string; onExit: () => void }) {
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [brushes, setBrushes] = useState<Brush[]>([]);
  const [blendModes, setBlendModes] = useState<string[]>([]);
  const [swatches, setSwatches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState<string>('');
  const [tool, setTool] = useState('ink');
  const [color, setColor] = useState('#1f2933');
  const [size, setSize] = useState(6);
  const [opacity, setOpacity] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<number[][]>([]);
  const lastRef = useRef<number[] | null>(null);

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
      const cols = pals.flatMap((x) => x.colors);
      setSwatches([...new Set<string>(cols)].slice(0, 18));
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
      for (const st of layer.strokes) drawStroke(offCtx, st);
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = gco(layer.blendMode);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
  }, [artwork]);

  useEffect(() => { render(); }, [render]);

  const toCanvasPoint = (e: React.PointerEvent): number[] => {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    return [
      Math.round(((e.clientX - rect.left) / rect.width) * cv.width),
      Math.round(((e.clientY - rect.top) / rect.height) * cv.height),
    ];
  };

  const liveSegment = (a: number[], b: number[]) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    if (tool === 'airbrush') { ctx.shadowBlur = size * 0.6; ctx.shadowColor = color; }
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!artwork || !activeLayer) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = toCanvasPoint(e);
    pointsRef.current = [p];
    lastRef.current = p;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const p = toCanvasPoint(e);
    const last = lastRef.current;
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.4) return;
    if (last) liveSegment(last, p);
    pointsRef.current.push(p);
    lastRef.current = p;
  };

  const onPointerUp = async () => {
    if (!drawingRef.current || !artwork) return;
    drawingRef.current = false;
    const points = pointsRef.current;
    pointsRef.current = [];
    lastRef.current = null;
    if (!points.length) return;
    const stroke: Stroke = { tool, color, size, opacity, points };
    setArtwork((prev) => prev && ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === activeLayer ? { ...l, strokes: [...l.strokes, stroke] } : l)),
    }));
    await lensRun('art', 'stroke-commit', { artworkId: artwork.id, layerId: activeLayer, stroke });
  };

  const undo = async () => {
    if (!artwork) return;
    setArtwork((prev) => prev && ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === activeLayer ? { ...l, strokes: l.strokes.slice(0, -1) } : l)),
    }));
    await lensRun('art', 'stroke-undo', { artworkId: artwork.id, layerId: activeLayer });
  };

  const addLayer = async () => {
    if (!artwork) return;
    const r = await lensRun('art', 'layer-add', { artworkId: artwork.id });
    const layer = r.data?.result?.layer as Layer | undefined;
    if (layer) {
      setArtwork((prev) => prev && ({ ...prev, layers: [...prev.layers, layer] }));
      setActiveLayer(layer.id);
    }
  };

  const updateLayer = async (layerId: string, patch: Partial<Layer>) => {
    if (!artwork) return;
    setArtwork((prev) => prev && ({
      ...prev, layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
    }));
    await lensRun('art', 'layer-update', { artworkId: artwork.id, layerId, ...patch });
  };

  const deleteLayer = async (layerId: string) => {
    if (!artwork || artwork.layers.length <= 1) return;
    setArtwork((prev) => prev && ({ ...prev, layers: prev.layers.filter((l) => l.id !== layerId) }));
    if (activeLayer === layerId) {
      setActiveLayer(artwork.layers.filter((l) => l.id !== layerId).slice(-1)[0]?.id || '');
    }
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
        try {
          await lensRun('art', 'artwork-save-thumbnail', {
            id: artwork.id, thumbnail: tc.toDataURL('image/jpeg', 0.72),
          });
        } catch { /* thumbnail is best-effort */ }
      }
    }
    onExit();
  };

  if (loading || !artwork) {
    return <div className="flex items-center justify-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={exit}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <ArrowLeft className="w-3.5 h-3.5" /> Gallery
        </button>
        <span className="text-sm font-semibold text-zinc-100 flex-1 truncate">{artwork.title}</span>
        <button type="button" onClick={undo}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <Undo2 className="w-3.5 h-3.5" /> Undo
        </button>
      </div>

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
            style={{ maxWidth: '100%', maxHeight: '62vh', touchAction: 'none' }}
          />
        </div>

        {/* Layers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-300">Layers</h3>
            <button type="button" onClick={addLayer} className="text-zinc-400 hover:text-violet-300">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <ul className="space-y-1.5">
            {[...artwork.layers].reverse().map((l) => (
              <li key={l.id}
                className={cn('rounded-lg border p-2',
                  activeLayer === l.id ? 'border-violet-600 bg-violet-950/30' : 'border-zinc-800 bg-zinc-900/70')}>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => updateLayer(l.id, { visible: !l.visible })}
                    className="text-zinc-400 hover:text-zinc-200">
                    {l.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => setActiveLayer(l.id)}
                    className="flex-1 text-left text-xs text-zinc-200 truncate">{l.name}</button>
                  <button type="button" onClick={() => reorderLayer(l.id, 'up')} className="text-zinc-500 hover:text-zinc-300">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => reorderLayer(l.id, 'down')} className="text-zinc-500 hover:text-zinc-300">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => deleteLayer(l.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {activeLayer === l.id && (
                  <div className="mt-1.5 space-y-1.5">
                    <select value={l.blendMode} onChange={(e) => updateLayer(l.id, { blendMode: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-100 capitalize">
                      {blendModes.map((m) => <option key={m} value={m}>{m.replace(/-/g, ' ')}</option>)}
                    </select>
                    <input type="range" min={0} max={1} step={0.05} value={l.opacity}
                      onChange={(e) => updateLayer(l.id, { opacity: Number(e.target.value) })}
                      className="w-full accent-violet-500" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Brush bar */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {brushes.map((b) => (
            <button key={b.id} type="button"
              onClick={() => { setTool(b.tool); setSize(b.size); setOpacity(b.opacity); }}
              className={cn('flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg',
                tool === b.tool && size === b.size ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
              {b.tool === 'eraser' && <Eraser className="w-3 h-3" />}{b.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 bg-transparent cursor-pointer" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Size {size}
            <input type="range" min={1} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))}
              className="w-24 accent-violet-500" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Opacity {Math.round(opacity * 100)}%
            <input type="range" min={0.05} max={1} step={0.05} value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))} className="w-24 accent-violet-500" />
          </label>
        </div>
        {swatches.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {swatches.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)}
                className="w-5 h-5 rounded border border-zinc-700" style={{ background: c }} title={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
