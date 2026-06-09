'use client';

/**
 * AnimStudio — a real frame-by-frame animator. Each frame holds vector
 * strokes; onion skinning ghosts adjacent frames; playback cycles the
 * exposure-expanded sequence at the project fps.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, ArrowLeft, Undo2, Play, Pause, Plus, Copy, Trash2, Eraser, Layers, Eye, EyeOff, Music,
  Wrench,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AnimToolsPanel } from './AnimToolsPanel';

interface Stroke {
  tool: string; color: string; size: number; opacity: number; points: number[][];
  widths?: number[]; pressureSize?: number;
}
interface FLayer { id: string; name: string; visible: boolean; opacity: number; strokes: Stroke[] }
interface Frame { id: string; exposure: number; layers: FLayer[]; strokes?: Stroke[] }
interface AudioTrack { id: string; name: string; url: string | null; startSec: number }
interface CanvasGuides {
  grid: boolean; gridSize: number; thirds: boolean; safeArea: boolean;
  symmetry: 'none' | 'vertical' | 'horizontal' | 'both';
}
interface CustomBrush {
  id: string; name: string; tool: string; size: number; opacity: number;
  color: string; pressureSize: number;
}
interface Anim {
  id: string; title: string; width: number; height: number; fps: number; background: string;
  frames: Frame[]; audio?: AudioTrack[]; guides?: CanvasGuides;
}

// Flatten a frame's visible layers (tolerates legacy single-layer frames).
function visibleStrokes(frame: Frame | undefined): Stroke[] {
  if (!frame) return [];
  if (Array.isArray(frame.layers) && frame.layers.length) {
    return frame.layers.filter((l) => l.visible).flatMap((l) => l.strokes);
  }
  return frame.strokes || [];
}

const BRUSHES = [
  { id: 'pencil', name: 'Pencil', tool: 'pencil', size: 4, opacity: 1 },
  { id: 'ink', name: 'Ink', tool: 'ink', size: 7, opacity: 1 },
  { id: 'marker', name: 'Marker', tool: 'marker', size: 18, opacity: 0.45 },
  { id: 'eraser', name: 'Eraser', tool: 'eraser', size: 22, opacity: 1 },
];

function drawStroke(c: CanvasRenderingContext2D, st: Stroke, alpha = 1) {
  const pts = st.points;
  if (!pts.length) return;
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = st.size;
  c.strokeStyle = st.color;
  c.fillStyle = st.color;
  c.globalAlpha = st.opacity * alpha;
  c.globalCompositeOperation = st.tool === 'eraser' && alpha === 1 ? 'destination-out' : 'source-over';
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

// Draw the onscreen grid / thirds / safe-area / symmetry guides.
function drawGuides(
  c: CanvasRenderingContext2D, w: number, h: number, g?: CanvasGuides,
) {
  if (!g) return;
  c.save();
  c.globalCompositeOperation = 'source-over';
  if (g.grid && g.gridSize >= 4) {
    c.strokeStyle = 'rgba(34,211,238,0.18)';
    c.lineWidth = 1;
    for (let x = g.gridSize; x < w; x += g.gridSize) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
    }
    for (let y = g.gridSize; y < h; y += g.gridSize) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }
  }
  if (g.thirds) {
    c.strokeStyle = 'rgba(251,146,60,0.45)';
    c.lineWidth = 1.2;
    for (const f of [1 / 3, 2 / 3]) {
      c.beginPath(); c.moveTo(w * f, 0); c.lineTo(w * f, h); c.stroke();
      c.beginPath(); c.moveTo(0, h * f); c.lineTo(w, h * f); c.stroke();
    }
  }
  if (g.safeArea) {
    c.strokeStyle = 'rgba(255,255,255,0.4)';
    c.setLineDash([6, 4]);
    c.lineWidth = 1;
    c.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
    c.setLineDash([]);
  }
  if (g.symmetry === 'vertical' || g.symmetry === 'both') {
    c.strokeStyle = 'rgba(168,85,247,0.5)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
  }
  if (g.symmetry === 'horizontal' || g.symmetry === 'both') {
    c.strokeStyle = 'rgba(168,85,247,0.5)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  }
  c.restore();
}

export function AnimStudio({ animId, onExit }: { animId: string; onExit: () => void }) {
  const [anim, setAnim] = useState<Anim | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameIdx, setFrameIdx] = useState(0);
  const [activeLayer, setActiveLayer] = useState<string>('');
  const [onion, setOnion] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState('ink');
  const [color, setColor] = useState('#10242e');
  const [size, setSize] = useState(7);
  const [opacity, setOpacity] = useState(1);
  const [showTools, setShowTools] = useState(false);
  const [customBrushes, setCustomBrushes] = useState<CustomBrush[]>([]);
  // Pressure dynamics for the active brush (how stylus pressure maps to size).
  const [pressureSize, setPressureSize] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<number[][]>([]);
  const lastRef = useRef<number[] | null>(null);
  const playRef = useRef<{ timer: number | null; pos: number }>({ timer: null, pos: 0 });

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await lensRun('animation', 'anim-get', { id: animId });
      if (!active) return;
      setAnim((r.data?.result?.animation as Anim) || null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [animId]);

  const renderFrame = useCallback((idx: number, withOnion: boolean) => {
    const cv = canvasRef.current;
    if (!cv || !anim) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = anim.background;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.restore();
    if (withOnion && idx > 0) {
      for (const st of visibleStrokes(anim.frames[idx - 1])) drawStroke(ctx, st, 0.28);
    }
    if (withOnion && idx < anim.frames.length - 1) {
      for (const st of visibleStrokes(anim.frames[idx + 1])) drawStroke(ctx, st, 0.18);
    }
    for (const st of visibleStrokes(anim.frames[idx])) drawStroke(ctx, st, 1);
    // Onscreen grid / guides overlay (non-destructive, drawn last).
    drawGuides(ctx, cv.width, cv.height, anim.guides);
  }, [anim]);

  // Custom brush library — saved brushes from the tools panel.
  const loadBrushes = useCallback(async () => {
    const r = await lensRun('animation', 'brush-list', {});
    if (r.data?.ok) setCustomBrushes((r.data.result as { brushes: CustomBrush[] }).brushes || []);
  }, []);
  useEffect(() => { void loadBrushes(); }, [loadBrushes]);

  // Live guide updates from the Canvas tools tab.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ animId: string; guides: CanvasGuides }>).detail;
      if (detail?.animId === animId) {
        setAnim((prev) => prev && { ...prev, guides: detail.guides });
      }
    };
    window.addEventListener('anim:guides', handler);
    return () => window.removeEventListener('anim:guides', handler);
  }, [animId]);

  useEffect(() => {
    if (!playing) renderFrame(frameIdx, onion);
  }, [renderFrame, frameIdx, onion, playing]);

  // Keep the active layer valid as the frame changes.
  useEffect(() => {
    const frame = anim?.frames[frameIdx];
    const layers = frame?.layers || [];
    setActiveLayer((prev) => (layers.some((l) => l.id === prev) ? prev : layers[layers.length - 1]?.id || ''));
  }, [anim, frameIdx]);

  // Playback
  useEffect(() => {
    if (!playing || !anim) return;
    const sequence: number[] = [];
    anim.frames.forEach((f, i) => { for (let k = 0; k < f.exposure; k++) sequence.push(i); });
    if (!sequence.length) { setPlaying(false); return; }
    playRef.current.pos = 0;
    const timer = window.setInterval(() => {
      const pos = playRef.current.pos % sequence.length;
      renderFrame(sequence[pos], false);
      playRef.current.pos = pos + 1;
    }, 1000 / anim.fps);
    playRef.current.timer = timer;
    return () => { window.clearInterval(timer); };
  }, [playing, anim, renderFrame]);

  const toPoint = (e: React.PointerEvent): number[] => {
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
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
  };

  // A stylus reports pressure in 0..1; a mouse reports 0.5. Pressure is the
  // 3rd component of each sampled point when pressure dynamics are active.
  const onPointerDown = (e: React.PointerEvent) => {
    if (playing || !anim) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = toPoint(e);
    const sample = pressureSize > 0 ? [...p, e.pressure || 0.5] : p;
    pointsRef.current = [sample];
    lastRef.current = p;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const p = toPoint(e);
    const last = lastRef.current;
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.4) return;
    if (last) liveSegment(last, p);
    pointsRef.current.push(pressureSize > 0 ? [...p, e.pressure || 0.5] : p);
    lastRef.current = p;
  };
  const onPointerUp = async () => {
    if (!drawingRef.current || !anim) return;
    drawingRef.current = false;
    const points = pointsRef.current;
    pointsRef.current = [];
    lastRef.current = null;
    if (!points.length) return;
    const fid = anim.frames[frameIdx].id;
    const lid = activeLayer;
    // 2D point list for optimistic local render (drop the pressure component).
    const flat = points.map((p) => [p[0], p[1]]);
    const stroke: Stroke = { tool, color, size, opacity, points: flat };
    setAnim((prev) => prev && ({
      ...prev,
      frames: prev.frames.map((f, i) => (i === frameIdx
        ? { ...f, layers: f.layers.map((l) => (l.id === lid ? { ...l, strokes: [...l.strokes, stroke] } : l)) } : f)),
    }));
    if (pressureSize > 0) {
      await lensRun('animation', 'stroke-commit-pressure', {
        animId: anim.id, frameId: fid, layerId: lid,
        stroke: { tool, color, size, opacity, pressureSize, points },
      });
    } else {
      await lensRun('animation', 'anim-stroke-commit', { animId: anim.id, frameId: fid, layerId: lid, stroke });
    }
  };

  const undo = async () => {
    if (!anim) return;
    const fid = anim.frames[frameIdx].id;
    const lid = activeLayer;
    setAnim((prev) => prev && ({
      ...prev,
      frames: prev.frames.map((f, i) => (i === frameIdx
        ? { ...f, layers: f.layers.map((l) => (l.id === lid ? { ...l, strokes: l.strokes.slice(0, -1) } : l)) } : f)),
    }));
    await lensRun('animation', 'anim-stroke-undo', { animId: anim.id, frameId: fid, layerId: lid });
  };

  const reloadAnim = async () => {
    const r = await lensRun('animation', 'anim-get', { id: animId });
    setAnim((r.data?.result?.animation as Anim) || null);
  };
  const addLayer = async () => {
    if (!anim) return;
    await lensRun('animation', 'frame-layer-add', { animId: anim.id, frameId: anim.frames[frameIdx].id });
    await reloadAnim();
  };
  const updateLayer = async (layerId: string, patch: { visible?: boolean; opacity?: number }) => {
    if (!anim) return;
    const fid = anim.frames[frameIdx].id;
    setAnim((prev) => prev && ({
      ...prev,
      frames: prev.frames.map((f, i) => (i === frameIdx
        ? { ...f, layers: f.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) } : f)),
    }));
    await lensRun('animation', 'frame-layer-update', { animId: anim.id, frameId: fid, layerId, ...patch });
  };
  const deleteLayer = async (layerId: string) => {
    if (!anim || (anim.frames[frameIdx].layers || []).length <= 1) return;
    await lensRun('animation', 'frame-layer-delete', { animId: anim.id, frameId: anim.frames[frameIdx].id, layerId });
    await reloadAnim();
  };

  const addFrame = async (duplicate: boolean) => {
    if (!anim) return;
    const fid = anim.frames[frameIdx].id;
    const macro = duplicate ? 'frame-duplicate' : 'frame-add';
    const r = await lensRun('animation', macro, { animId: anim.id, frameId: fid, afterFrameId: fid });
    const frame = r.data?.result?.frame as Frame | undefined;
    if (frame) {
      setAnim((prev) => {
        if (!prev) return prev;
        const frames = [...prev.frames];
        frames.splice(frameIdx + 1, 0, frame);
        return { ...prev, frames };
      });
      setFrameIdx(frameIdx + 1);
    }
  };

  const deleteFrame = async () => {
    if (!anim || anim.frames.length <= 1) return;
    const fid = anim.frames[frameIdx].id;
    await lensRun('animation', 'frame-delete', { animId: anim.id, frameId: fid });
    setAnim((prev) => prev && ({ ...prev, frames: prev.frames.filter((f) => f.id !== fid) }));
    setFrameIdx(Math.max(0, frameIdx - 1));
  };

  const setExposure = async (val: number) => {
    if (!anim) return;
    const fid = anim.frames[frameIdx].id;
    setAnim((prev) => prev && ({
      ...prev, frames: prev.frames.map((f) => (f.id === fid ? { ...f, exposure: val } : f)),
    }));
    await lensRun('animation', 'frame-set-exposure', { animId: anim.id, frameId: fid, exposure: val });
  };

  const exit = async () => {
    if (playing) setPlaying(false);
    const cv = canvasRef.current;
    if (cv && anim) {
      renderFrame(0, false);
      const scale = Math.min(1, 360 / cv.width);
      const tc = document.createElement('canvas');
      tc.width = Math.round(cv.width * scale);
      tc.height = Math.round(cv.height * scale);
      const tctx = tc.getContext('2d');
      if (tctx) {
        tctx.drawImage(cv, 0, 0, tc.width, tc.height);
        try {
          await lensRun('animation', 'anim-save-thumbnail', { id: anim.id, thumbnail: tc.toDataURL('image/jpeg', 0.72) });
        } catch { /* best effort */ }
      }
    }
    onExit();
  };

  if (loading || !anim) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const frame = anim.frames[frameIdx];

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={exit}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <ArrowLeft className="w-3.5 h-3.5" /> Gallery
        </button>
        <span className="text-sm font-semibold text-zinc-100 flex-1 truncate">{anim.title}</span>
        <button type="button" onClick={() => setOnion(!onion)}
          className={cn('flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg',
            onion ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
          <Layers className="w-3.5 h-3.5" /> Onion
        </button>
        <button type="button" onClick={() => setPlaying(!playing)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg">
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={undo} disabled={playing}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg disabled:opacity-40">
          <Undo2 className="w-3.5 h-3.5" /> Undo
        </button>
        <button type="button" onClick={() => setShowTools((v) => !v)}
          className={cn('flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg',
            showTools ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
          <Wrench className="w-3.5 h-3.5" /> Tools
        </button>
      </div>

      {/* Canvas */}
      <div className="bg-[repeating-conic-gradient(#3f3f46_0%_25%,#27272a_0%_50%)] bg-[length:16px_16px] rounded-xl p-2 flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          width={anim.width}
          height={anim.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className={cn('rounded shadow-lg', playing ? 'cursor-default' : 'cursor-crosshair')}
          style={{ maxWidth: '100%', maxHeight: '52vh', touchAction: 'none' }}
        />
      </div>

      {/* FlipaClip / Pencil2D parity tools */}
      {showTools && <AnimToolsPanel anim={anim} onChange={reloadAnim} />}

      {/* Frame timeline */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-400">
            Frame {frameIdx + 1}/{anim.frames.length} · {anim.fps} fps
          </span>
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">
            Hold
            <input type="number" min={1} max={60} value={frame.exposure}
              onChange={(e) => setExposure(Math.max(1, Number(e.target.value) || 1))}
              className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-100" />
          </label>
          <div className="flex-1" />
          <button type="button" onClick={() => addFrame(false)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white rounded">
            <Plus className="w-3 h-3" /> Frame
          </button>
          <button type="button" onClick={() => addFrame(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">
            <Copy className="w-3 h-3" /> Duplicate
          </button>
          <button aria-label="Delete" type="button" onClick={deleteFrame}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-rose-900 text-zinc-200 rounded">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {anim.frames.map((f, i) => (
            <button key={f.id} type="button" onClick={() => { setPlaying(false); setFrameIdx(i); }}
              className={cn('relative shrink-0 w-12 h-12 rounded border text-[10px] font-mono flex items-center justify-center',
                i === frameIdx ? 'border-cyan-500 bg-cyan-950/50 text-cyan-200' : 'border-zinc-700 bg-zinc-900 text-zinc-400')}>
              {i + 1}
              {f.exposure > 1 && (
                <span className="absolute bottom-0 right-0 bg-zinc-800 text-zinc-300 text-[8px] px-1 rounded-tl">×{f.exposure}</span>
              )}
              {visibleStrokes(f).length > 0 && <span className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-cyan-500" />}
            </button>
          ))}
        </div>
      </div>

      {/* Brush bar */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {BRUSHES.map((b) => (
            <button key={b.id} type="button"
              onClick={() => { setTool(b.tool); setSize(b.size); setOpacity(b.opacity); setPressureSize(0); }}
              className={cn('flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg',
                tool === b.tool ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
              {b.tool === 'eraser' && <Eraser className="w-3 h-3" />}{b.name}
            </button>
          ))}
        </div>
        {customBrushes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] text-zinc-400 self-center">Custom:</span>
            {customBrushes.map((b) => (
              <button key={b.id} type="button"
                onClick={() => {
                  setTool(b.tool); setSize(b.size); setOpacity(b.opacity);
                  setColor(b.color); setPressureSize(b.pressureSize);
                }}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.color }} />
                {b.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 bg-transparent cursor-pointer" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Size {size}
            <input type="range" min={1} max={80} value={size} onChange={(e) => setSize(Number(e.target.value))}
              className="w-24 accent-cyan-500" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Opacity {Math.round(opacity * 100)}%
            <input type="range" min={0.05} max={1} step={0.05} value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))} className="w-24 accent-cyan-500" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Pressure {Math.round(pressureSize * 100)}%
            <input type="range" min={0} max={1} step={0.05} value={pressureSize}
              onChange={(e) => setPressureSize(Number(e.target.value))} className="w-24 accent-cyan-500" />
          </label>
        </div>
      </div>

      {/* Frame layers */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Layers className="w-3.5 h-3.5 text-cyan-400" /> Frame {frameIdx + 1} layers
          </h3>
          <button aria-label="Add" type="button" onClick={addLayer} className="text-zinc-400 hover:text-cyan-300"><Plus className="w-4 h-4" /></button>
        </div>
        <ul className="space-y-1">
          {[...(frame.layers || [])].reverse().map((l) => (
            <li key={l.id}
              className={cn('flex items-center gap-1.5 rounded px-2 py-1 border',
                activeLayer === l.id ? 'border-cyan-600 bg-cyan-950/30' : 'border-zinc-800 bg-zinc-900')}>
              <button type="button" onClick={() => updateLayer(l.id, { visible: !l.visible })}
                className="text-zinc-400 hover:text-zinc-200">
                {l.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button type="button" onClick={() => setActiveLayer(l.id)}
                className="flex-1 text-left text-[11px] text-zinc-200 truncate">{l.name}</button>
              <input type="range" min={0} max={1} step={0.1} value={l.opacity}
                onChange={(e) => updateLayer(l.id, { opacity: Number(e.target.value) })}
                className="w-14 accent-cyan-500" />
              <button aria-label="Delete" type="button" onClick={() => deleteLayer(l.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Audio tracks */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Music className="w-3.5 h-3.5 text-cyan-400" /> Audio tracks
          </h3>
          <button type="button"
            onClick={async () => {
              const name = window.prompt('Track name:');
              if (!name || !name.trim()) return;
              const url = window.prompt('Audio URL (optional):') || '';
              const startSec = Number(window.prompt('Start time (seconds):', '0') || '0');
              await lensRun('animation', 'audio-track-add', { animId: anim.id, name: name.trim(), url, startSec });
              await reloadAnim();
            }}
            className="text-zinc-400 hover:text-cyan-300"><Plus className="w-4 h-4" /></button>
        </div>
        {(anim.audio || []).length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No audio tracks. Add up to 6 to score the timeline.</p>
        ) : (
          <ul className="space-y-1">
            {(anim.audio || []).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-[11px] text-zinc-300 bg-zinc-900 rounded px-2 py-1">
                <Music className="w-3 h-3 text-zinc-400" />
                <span className="flex-1">{t.name}</span>
                <span className="text-zinc-400">@ {t.startSec}s</span>
                {t.url && <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400">open</a>}
                <button aria-label="Delete" type="button"
                  onClick={() => lensRun('animation', 'audio-track-remove', { animId: anim.id, id: t.id }).then(reloadAnim)}
                  className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
