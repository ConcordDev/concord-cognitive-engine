'use client';

/**
 * The light table: draw a shot frame by frame on a backlit disc, with onion
 * skins in the animator's blue pencil (drawings before) and red pencil
 * (drawings after), the X-sheet beside it for timing, and drawers for
 * layers, the soundtrack, tweens, rigs, paper, pencils, timing charts,
 * export, publishing and sharing. Strokes are vector and saved on the
 * server as you draw; playback runs on the clock with the soundtrack.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Undo2, Redo2, Play, Pause, Plus, Copy, Trash2, Eraser, Layers, Eye, EyeOff,
  ChevronLeft, ChevronRight, ImageIcon, Pencil, Repeat,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { AudioSyncPanel, TweenPanel, CanvasPanel, RigPanel, BrushPanel, SharePanel } from './AnimToolsPanel';
import { AnimationMotionToolkit } from './AnimationMotionToolkit';
import { setActiveFrameTarget } from './animReferenceTarget';
import { drawFrame, drawStroke, filmSequence, visibleStrokes, type Anim as BaseAnim, type Frame, type Stroke } from './table/draw';
import { XSheet } from './table/XSheet';
import { ExportDesk } from './table/ExportDesk';
import { PublishDesk } from './table/PublishDesk';

const ONION_BEFORE = '#2f63d6';
const ONION_AFTER = '#d2382a';

interface CanvasGuides {
  grid: boolean; gridSize: number; thirds: boolean; safeArea: boolean;
  symmetry: 'none' | 'vertical' | 'horizontal' | 'both';
}
interface CustomBrush {
  id: string; name: string; tool: string; size: number; opacity: number;
  color: string; pressureSize: number;
}
type Anim = BaseAnim & { guides?: CanvasGuides };

type Drawer = 'layers' | 'sound' | 'tween' | 'rig' | 'paper' | 'pencils' | 'timing' | 'export' | 'publish' | 'share';
const DRAWERS: { id: Drawer; label: string }[] = [
  { id: 'layers', label: 'Layers' }, { id: 'sound', label: 'Soundtrack' }, { id: 'tween', label: 'In-betweens' },
  { id: 'rig', label: 'Rig' }, { id: 'paper', label: 'Paper & guides' }, { id: 'pencils', label: 'Pencils' },
  { id: 'timing', label: 'Timing charts' }, { id: 'export', label: 'Export' }, { id: 'publish', label: 'Publish' }, { id: 'share', label: 'Share link' },
];

const BRUSHES = [
  { id: 'pencil', name: 'Pencil', tool: 'pencil', size: 4, opacity: 1 },
  { id: 'ink', name: 'Ink', tool: 'ink', size: 7, opacity: 1 },
  { id: 'marker', name: 'Marker', tool: 'marker', size: 18, opacity: 0.45 },
  { id: 'eraser', name: 'Eraser', tool: 'eraser', size: 22, opacity: 1 },
];

// Draw the onscreen grid / thirds / safe-area / symmetry guides.
function drawGuides(
  c: CanvasRenderingContext2D, w: number, h: number, g?: CanvasGuides,
) {
  if (!g) return;
  c.save();
  c.globalCompositeOperation = 'source-over';
  if (g.grid && g.gridSize >= 4) {
    c.strokeStyle = 'rgba(47,99,214,0.16)';
    c.lineWidth = 1;
    for (let x = g.gridSize; x < w; x += g.gridSize) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
    }
    for (let y = g.gridSize; y < h; y += g.gridSize) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }
  }
  if (g.thirds) {
    c.strokeStyle = 'rgba(210,56,42,0.4)';
    c.lineWidth = 1.2;
    for (const f of [1 / 3, 2 / 3]) {
      c.beginPath(); c.moveTo(w * f, 0); c.lineTo(w * f, h); c.stroke();
      c.beginPath(); c.moveTo(0, h * f); c.lineTo(w, h * f); c.stroke();
    }
  }
  if (g.safeArea) {
    c.strokeStyle = 'rgba(38,40,43,0.35)';
    c.setLineDash([6, 4]);
    c.lineWidth = 1;
    c.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
    c.setLineDash([]);
  }
  if (g.symmetry === 'vertical' || g.symmetry === 'both') {
    c.strokeStyle = 'rgba(47,99,214,0.45)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
  }
  if (g.symmetry === 'horizontal' || g.symmetry === 'both') {
    c.strokeStyle = 'rgba(47,99,214,0.45)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  }
  c.restore();
}

export function AnimStudio({ animId, onExit, onOpenScreening }: { animId: string; onExit: () => void; onOpenScreening?: (releaseId: string) => void }) {
  const [anim, setAnim] = useState<Anim | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameIdx, setFrameIdx] = useState(0);
  const [activeLayer, setActiveLayer] = useState<string>('');
  // Onion skin depth: how many drawings either side show through (0 = off).
  const [onion, setOnion] = useState(2);
  const [loop, setLoop] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<Drawer>('layers');
  const [render, setRender] = useState<{ mediaId: string; durationSec: number } | null>(null);
  const [xsRev, setXsRev] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState('ink');
  const [color, setColor] = useState('#26282b');
  const [size, setSize] = useState(7);
  const [opacity, setOpacity] = useState(1);
  const [customBrushes, setCustomBrushes] = useState<CustomBrush[]>([]);
  // Pressure dynamics for the active brush (how stylus pressure maps to size).
  const [pressureSize, setPressureSize] = useState(0);
  // Real playback duration, sourced from the `playback-frames` macro (the
  // exposure-expanded sequence length) rather than recomputed client-side.
  const [duration, setDuration] = useState<{ totalFrames: number; durationSec: number } | null>(null);
  // Cross-operation undo/redo. `lastAction` tracks whether the most recent
  // edit was a single stroke draw (undone via the narrower single-level
  // `anim-stroke-undo`) or a structural frame/layer edit (undone via the
  // real cross-operation op-log: `anim-undo` / `anim-redo`, see
  // server/domains/animation.js). The Undo button routes to whichever
  // primitive matches the last edit; Redo only ever applies to the
  // structural stack — stroke-undo is a single-level pop with no redo,
  // and stays that way by design (it's a narrower, still-real primitive
  // layered alongside the new stack, not replaced by it).
  const [lastAction, setLastAction] = useState<'stroke' | 'structural' | null>(null);
  const [canRedo, setCanRedo] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<number[][]>([]);
  const lastRef = useRef<number[] | null>(null);
  const playRef = useRef<{ timer: number | null; pos: number }>({ timer: null, pos: 0 });
  // Reference-image underlays are drawn from real <img> elements, cached by
  // imageRef so switching frames doesn't re-fetch. A tick bump forces a
  // re-render once a not-yet-loaded image finishes loading.
  const refImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [, bumpRefImageTick] = useState(0);
  const getRefImage = useCallback((src: string): HTMLImageElement => {
    const cache = refImageCacheRef.current;
    const existing = cache.get(src);
    if (existing) return existing;
    const img = new window.Image();
    img.onload = () => bumpRefImageTick((n) => n + 1);
    img.src = src;
    cache.set(src, img);
    return img;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await lensRun('animation', 'anim-get', { id: animId });
      if (!active) return;
      setAnim((r.data?.result?.animation as Anim) || null);
      // Restore real Undo/Redo button state from the server (e.g. after a
      // page refresh mid-session) instead of guessing at load time.
      const loaded = r.data?.result as { canUndo?: boolean; canRedo?: boolean } | undefined;
      setLastAction(loaded?.canUndo ? 'structural' : null);
      setCanRedo(!!loaded?.canRedo);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [animId]);

  const renderFrame = useCallback((idx: number, depth: number) => {
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
    // Reference-image underlay(s) for this frame — drawn before onion skin
    // and strokes so real artwork always reads on top of the tracing guide.
    // Never converted into strokes; just an <img> painted at layer opacity.
    for (const l of anim.frames[idx]?.layers || []) {
      if (l.visible && l.type === 'reference' && l.imageRef) {
        const img = getRefImage(l.imageRef);
        if (img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = l.opacity;
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          ctx.restore();
        }
      }
    }
    // Onion skins in the animator's pencils: drawings before in blue, after
    // in red, fading with distance.
    const FADE = [0.34, 0.2, 0.11];
    for (let k = depth; k >= 1; k--) {
      const before = anim.frames[idx - k];
      const after = anim.frames[idx + k];
      if (before) for (const st of visibleStrokes(before)) drawStroke(ctx, st, FADE[k - 1], ONION_BEFORE);
      if (after) for (const st of visibleStrokes(after)) drawStroke(ctx, st, FADE[k - 1], ONION_AFTER);
    }
    for (const st of visibleStrokes(anim.frames[idx])) drawStroke(ctx, st, 1);
    // Onscreen grid / guides overlay (non-destructive, drawn last).
    drawGuides(ctx, cv.width, cv.height, anim.guides);
  }, [anim, getRefImage]);

  // Real playback duration — only re-fetches when frame count or exposure
  // actually changes (not on every stroke), so drawing stays chatter-free.
  const framesSignature = anim ? `${anim.frames.length}:${anim.frames.map((f) => f.exposure).join(',')}` : '';
  useEffect(() => {
    if (!anim) { queueMicrotask(() => setDuration(null)); return; }
    let active = true;
    void lensRun('animation', 'playback-frames', { id: anim.id }).then((r) => {
      if (!active) return;
      if (r.data?.ok) setDuration(r.data.result as { totalFrames: number; durationSec: number });
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim?.id, framesSignature]);

  // Custom brush library — saved brushes from the tools panel.
  const loadBrushes = useCallback(async () => {
    const r = await lensRun('animation', 'brush-list', {});
    if (r.data?.ok) setCustomBrushes((r.data.result as { brushes: CustomBrush[] }).brushes || []);
  }, []);
  useEffect(() => { void Promise.resolve().then(loadBrushes); }, [loadBrushes]);

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

  // Keep the active layer valid as the frame changes. A reference layer is
  // never a valid drawing target (the backend rejects strokes on it), so the
  // default pick always prefers the topmost PAINTABLE layer.
  useEffect(() => {
    const frame = anim?.frames[frameIdx];
    const layers = frame?.layers || [];
    const paintable = layers.filter((l) => l.type !== 'reference');
    const fallback = (paintable.length ? paintable : layers)[
      (paintable.length ? paintable : layers).length - 1
    ]?.id || '';
    queueMicrotask(() => setActiveLayer((prev) => {
      const prevLayer = layers.find((l) => l.id === prev);
      return prevLayer && prevLayer.type !== 'reference' ? prev : fallback;
    }));
  }, [anim, frameIdx]);

  // Publish "the frame currently open in the studio" so the Reference tab's
  // "Import onto frame" action has a real target even after Studio unmounts
  // (tab switch). See animReferenceTarget.ts for the honest-scope note.
  useEffect(() => {
    if (!anim) return;
    const frame = anim.frames[frameIdx];
    if (!frame) return;
    setActiveFrameTarget({
      animId: anim.id, frameId: frame.id, animTitle: anim.title,
      frameIndex: frameIdx, frameCount: anim.frames.length,
    });
  }, [anim, frameIdx]);

  const loopRef = useRef(loop);
  loopRef.current = loop;
  // Playback, locked to the clock: the film frame shown is elapsed time ×
  // fps, so it stays in step with the soundtrack (which plays from the
  // animator's own uploaded audio, each track from its start time).
  useEffect(() => {
    if (!playing || !anim) return;
    const seq = filmSequence(anim.frames);
    if (!seq.length) { queueMicrotask(() => setPlaying(false)); return; }
    const fps = Math.max(1, anim.fps || 12);
    const timers: number[] = [];
    const players = (anim.audio || []).map((t) => {
      const src = t.src || (t.mediaId ? `/api/media/${encodeURIComponent(t.mediaId)}/stream` : t.url);
      if (!src) return null;
      const a = new Audio(src); a.preload = 'auto';
      return { a, start: Math.max(0, t.startSec || 0) };
    }).filter((x): x is { a: HTMLAudioElement; start: number } => !!x);
    const startSound = () => {
      for (const { a, start } of players) {
        a.pause();
        if (start <= 0) { a.currentTime = 0; void a.play().catch(() => {}); }
        else timers.push(window.setTimeout(() => { a.currentTime = 0; void a.play().catch(() => {}); }, start * 1000));
      }
    };
    let t0 = performance.now();
    startSound();
    const timer = window.setInterval(() => {
      let pos = Math.floor(((performance.now() - t0) / 1000) * fps);
      if (pos >= seq.length) {
        if (!loopRef.current) { setPlaying(false); return; }
        t0 = performance.now(); pos = 0;
        timers.splice(0).forEach((x) => window.clearTimeout(x));
        startSound();
      }
      renderFrame(seq[pos], 0);
      setPlayhead(pos + 1);
    }, Math.max(8, 500 / fps));
    playRef.current.timer = timer;
    return () => {
      window.clearInterval(timer);
      timers.forEach((x) => window.clearTimeout(x));
      for (const { a } of players) { a.pause(); a.src = ''; }
      setPlayhead(null);
    };
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
    // Defense-in-depth: the active-layer effect already steers away from
    // reference layers, but never start a stroke on one even so — the
    // backend rejects it anyway (see stroke-commit's "reference layer"
    // guard), so bailing here avoids a doomed optimistic draw.
    const activeLayerObj = anim.frames[frameIdx]?.layers.find((l) => l.id === activeLayer);
    if (activeLayerObj?.type === 'reference') return;
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
    setLastAction('stroke');
  };

  // Routes to whichever undo primitive matches the most recent edit. A
  // structural edit (frame/layer add, delete, reorder, clear, …) undoes via
  // the real cross-operation op-log; anything else falls back to the
  // pre-existing single-level per-layer stroke undo.
  const undo = async () => {
    if (!anim) return;
    if (lastAction === 'structural') {
      const r = await lensRun('animation', 'anim-undo', { animId: anim.id });
      const result = r.data?.result as { ok?: boolean; error?: string; canUndo?: boolean; canRedo?: boolean; frameCount?: number } | undefined;
      if (r.data?.ok && result?.ok !== false) {
        await reloadAnim();
        setCanRedo(!!result?.canRedo);
        setLastAction(result?.canUndo ? 'structural' : null);
        // A structural undo can change the frame count (undoing a delete
        // restores a frame; undoing an add removes one) — keep the current
        // frame pointer in bounds so the render never indexes a frame that
        // no longer exists.
        if (typeof result?.frameCount === 'number') {
          setFrameIdx((idx) => Math.min(idx, Math.max(0, result.frameCount! - 1)));
        }
      }
      return;
    }
    const fid = anim.frames[frameIdx].id;
    const lid = activeLayer;
    setAnim((prev) => prev && ({
      ...prev,
      frames: prev.frames.map((f, i) => (i === frameIdx
        ? { ...f, layers: f.layers.map((l) => (l.id === lid ? { ...l, strokes: l.strokes.slice(0, -1) } : l)) } : f)),
    }));
    await lensRun('animation', 'anim-stroke-undo', { animId: anim.id, frameId: fid, layerId: lid });
    setLastAction(null); // stroke-undo is single-level — nothing further to undo via this path
  };

  // Redo only ever applies to the structural op-log (there is no stroke redo).
  const redo = async () => {
    if (!anim || !canRedo) return;
    const r = await lensRun('animation', 'anim-redo', { animId: anim.id });
    const result = r.data?.result as { ok?: boolean; canUndo?: boolean; canRedo?: boolean; frameCount?: number } | undefined;
    if (r.data?.ok && result?.ok !== false) {
      await reloadAnim();
      setCanRedo(!!result?.canRedo);
      setLastAction('structural');
      // Same frame-count clamp as undo() — a redone frame-add/delete can
      // change how many frames exist.
      if (typeof result?.frameCount === 'number') {
        setFrameIdx((idx) => Math.min(idx, Math.max(0, result.frameCount! - 1)));
      }
    }
  };

  const reloadAnim = async () => {
    const r = await lensRun('animation', 'anim-get', { id: animId });
    setAnim((r.data?.result?.animation as Anim) || null);
  };
  // Every handler below performs a structural, op-log-backed edit
  // (server/domains/animation.js pushes a real undo snapshot before each of
  // these macros mutates). Marking `lastAction: 'structural'` + clearing
  // `canRedo` client-side after each one mirrors exactly what the backend
  // just did (a genuinely new edit clears the redo stack) so the toolbar's
  // Undo/Redo state never lags or fabricates availability that isn't real.
  const addLayer = async () => {
    if (!anim) return;
    await lensRun('animation', 'frame-layer-add', { animId: anim.id, frameId: anim.frames[frameIdx].id });
    await reloadAnim();
    setLastAction('structural');
    setCanRedo(false);
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
    setLastAction('structural');
    setCanRedo(false);
  };
  const deleteLayer = async (layerId: string) => {
    if (!anim || (anim.frames[frameIdx].layers || []).length <= 1) return;
    await lensRun('animation', 'frame-layer-delete', { animId: anim.id, frameId: anim.frames[frameIdx].id, layerId });
    await reloadAnim();
    setLastAction('structural');
    setCanRedo(false);
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
      setLastAction('structural');
      setCanRedo(false);
    }
  };

  const [renaming, setRenaming] = useState<string | null>(null);
  const saveTitle = async () => {
    if (!anim || renaming == null) return;
    const title = renaming.trim();
    if (!title || title === anim.title) { setRenaming(null); return; }
    const r = await lensRun('animation', 'anim-rename', { id: anim.id, title });
    if (r.data?.ok) setAnim((prev) => prev && ({ ...prev, title }));
    setRenaming(null);
  };

  const clearFrame = async (allLayers: boolean) => {
    if (!anim) return;
    const frame = anim.frames[frameIdx];
    const layerId = activeLayer || frame.layers[0]?.id;
    if (!layerId) return;
    await lensRun('animation', 'frame-clear', { animId: anim.id, frameId: frame.id, layerId, allLayers });
    await reloadAnim();
    setLastAction('structural');
    setCanRedo(false);
  };

  const deleteFrame = async () => {
    if (!anim || anim.frames.length <= 1) return;
    const fid = anim.frames[frameIdx].id;
    await lensRun('animation', 'frame-delete', { animId: anim.id, frameId: fid });
    setAnim((prev) => prev && ({ ...prev, frames: prev.frames.filter((f) => f.id !== fid) }));
    setFrameIdx(Math.max(0, frameIdx - 1));
    setLastAction('structural');
    setCanRedo(false);
  };

  const moveFrame = async (direction: 'left' | 'right') => {
    if (!anim) return;
    const fid = anim.frames[frameIdx].id;
    const r = await lensRun('animation', 'frame-reorder', { animId: anim.id, frameId: fid, direction });
    const order = r.data?.result?.order as string[] | undefined;
    if (!order) return;
    setAnim((prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.frames.map((f) => [f.id, f]));
      const frames = order.map((id) => byId.get(id)).filter((f): f is Frame => !!f);
      return { ...prev, frames };
    });
    setFrameIdx(order.indexOf(fid));
    setLastAction('structural');
    setCanRedo(false);
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
    return <div className="lt-skeleton mx-auto h-[420px] max-w-[760px]" role="status" aria-label="Opening the shot" />;
  }

  const frame = anim.frames[frameIdx];
  const paintable = (frame.layers || []).filter((l) => l.type !== 'reference');

  return (
    <div className="space-y-4" data-testid="lt-studio">
      {/* the shot's bar on the desk */}
      <div className="lt-on-desk flex flex-wrap items-center gap-2">
        <button type="button" onClick={exit} className="lt-btn lt-desk-btn !min-h-[32px]"><ArrowLeft className="h-4 w-4" /> All shots</button>
        {renaming != null ? (
          <input aria-label="Animation title" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveTitle(); if (e.key === 'Escape') setRenaming(null); }}
            className="lt-input lt-title !w-auto min-w-0 flex-1 !text-[18px]" />
        ) : (
          <button type="button" onClick={() => setRenaming(anim.title)} title="Rename" className="group flex min-w-[55%] flex-1 items-center gap-1.5 text-left sm:min-w-0">
            <span className="lt-title truncate text-[22px] text-[#fbfaf6]">{anim.title}</span>
            <Pencil className="h-3.5 w-3.5 shrink-0 text-[#b9b2a6] opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        <span className="lt-mono text-[12px] text-[#c9c2b5]">
          {playing && playhead ? `fr ${String(playhead).padStart(3, '0')}` : `drawing ${frameIdx + 1}/${anim.frames.length}`} · {anim.fps} fps{duration ? ` · ${duration.durationSec}s` : ''}
        </span>
        <button type="button" onClick={() => setPlaying(!playing)} className="lt-btn lt-btn-red !min-h-[32px]" data-testid="lt-play" aria-label={playing ? 'Stop' : 'Play'}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? 'Stop' : 'Play'}
        </button>
        <button type="button" onClick={() => setLoop((v) => !v)} aria-pressed={loop} className="lt-btn lt-desk-btn !min-h-[32px]" title="Loop playback"><Repeat className="h-4 w-4" /></button>
        <div className="flex items-center gap-1 rounded-md border border-[#6d665b] px-1.5 py-0.5" role="group" aria-label="Onion skins">
          <Layers className="h-3.5 w-3.5 text-[#b9b2a6]" />
          {[0, 1, 2, 3].map((n) => (
            <button key={n} type="button" aria-pressed={onion === n} onClick={() => setOnion(n)} className={`lt-mono h-6 w-6 rounded text-[11px] ${onion === n ? 'bg-[#ece6da] text-[var(--lt-desk)]' : 'text-[#c9c2b5] hover:text-white'}`} title={n ? `${n} drawing${n > 1 ? 's' : ''} either side` : 'Onion skins off'}>{n || 'off'}</button>
          ))}
        </div>
        <button type="button" onClick={undo} disabled={playing} className="lt-btn lt-desk-btn !min-h-[32px]" aria-label="Undo"><Undo2 className="h-4 w-4" /></button>
        <button type="button" onClick={redo} disabled={playing || !canRedo} className="lt-btn lt-desk-btn !min-h-[32px]" aria-label="Redo"><Redo2 className="h-4 w-4" /></button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          {/* the light table: a backlit disc, the peg bar, the drawing on top */}
          <div className="lt-stage">
            <div className="lt-disc w-full max-w-[760px]" style={{ aspectRatio: '1 / 0.74', borderRadius: '50% / 50%' }}>
              <div className="lt-disc-ring" aria-hidden />
              <div className="flex h-full items-center justify-center">
                <div className="lt-paperframe" style={{ width: '86%' }}>
                  <span className="lt-pegbar" aria-hidden><span className="lt-peg" /></span>
                  <canvas
                    ref={canvasRef}
                    width={anim.width}
                    height={anim.height}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                    aria-label={`Drawing ${frameIdx + 1}. Draw with the pointer.`}
                    data-testid="lt-canvas"
                    className={playing ? 'cursor-default' : 'cursor-crosshair'}
                    style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'none' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* the drawings, in order, each with its hold */}
          <div className="flex items-center gap-2">
            <button aria-label="Move drawing earlier" type="button" onClick={() => moveFrame('left')} disabled={frameIdx === 0} className="lt-btn lt-desk-btn !min-h-[30px] !px-2"><ChevronLeft className="h-4 w-4" /></button>
            <DrawingStrip anim={anim} current={frameIdx} onPick={(i) => { setPlaying(false); setFrameIdx(i); }} />
            <button aria-label="Move drawing later" type="button" onClick={() => moveFrame('right')} disabled={frameIdx === anim.frames.length - 1} className="lt-btn lt-desk-btn !min-h-[30px] !px-2"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => addFrame(false)} className="lt-btn lt-desk-btn !min-h-[32px]" data-testid="lt-new-drawing"><Plus className="h-4 w-4" /> New drawing</button>
            <button type="button" onClick={() => addFrame(true)} className="lt-btn lt-desk-btn !min-h-[32px]"><Copy className="h-4 w-4" /> Trace a copy</button>
            <label className="flex items-center gap-1.5 text-[12px] text-[#c9c2b5]">Hold
              <input type="number" min={1} max={60} value={frame.exposure} onChange={(e) => { void setExposure(Math.max(1, Math.min(60, Number(e.target.value) || 1))).then(() => setXsRev((n) => n + 1)); }} className="lt-input lt-mono !min-h-[30px] !w-14 !py-0" aria-label="Hold this drawing for frames" />
              <span>frames</span>
            </label>
            <span className="flex-1" />
            <button type="button" onClick={() => void clearFrame(false)} className="lt-btn lt-desk-btn !min-h-[32px]" title="Erase this layer of the drawing (undoable)"><Eraser className="h-4 w-4" /> Clear layer</button>
            <button type="button" onClick={() => void clearFrame(true)} className="lt-btn lt-desk-btn !min-h-[32px]" title="Erase every layer of the drawing (undoable)">Clear drawing</button>
            <button aria-label="Delete this drawing" type="button" onClick={deleteFrame} disabled={anim.frames.length <= 1} className="lt-btn lt-desk-btn !min-h-[32px] !px-2"><Trash2 className="h-4 w-4" /></button>
          </div>

          {/* the pencil cup */}
          <div className="lt-sheet space-y-2.5 p-3" aria-label="Pencils">
            <div className="flex flex-wrap items-center gap-1.5">
              {BRUSHES.map((b) => (
                <button key={b.id} type="button" aria-pressed={tool === b.tool}
                  onClick={() => { setTool(b.tool); setSize(b.size); setOpacity(b.opacity); setPressureSize(0); }}
                  className="lt-chip">{b.tool === 'eraser' && <Eraser className="h-3 w-3" />}{b.name}</button>
              ))}
              {[['#26282b', 'Graphite'], ['#2f63d6', 'Blue pencil'], ['#d2382a', 'Red pencil'], ['#1d7a4b', 'Green pencil']].map(([c, n]) => (
                <button key={c} type="button" aria-label={n} aria-pressed={color === c} onClick={() => setColor(c)} className="h-6 w-6 rounded-full border-2" style={{ background: c, borderColor: color === c ? '#d2382a' : 'transparent', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)' }} />
              ))}
              {customBrushes.length > 0 && <span className="lt-label ml-2">Saved</span>}
              {customBrushes.map((b) => (
                <button key={b.id} type="button" className="lt-chip"
                  onClick={() => { setTool(b.tool); setSize(b.size); setOpacity(b.opacity); setColor(b.color); setPressureSize(b.pressureSize); }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />{b.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-[var(--lt-graphite-2)]">
              <label className="flex items-center gap-1.5">Colour <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-8 cursor-pointer bg-transparent" /></label>
              <label className="flex items-center gap-1.5">Size <span className="lt-mono w-6">{size}</span><input type="range" min={1} max={80} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-24 accent-[#d2382a]" /></label>
              <label className="flex items-center gap-1.5">Opacity <span className="lt-mono w-9">{Math.round(opacity * 100)}%</span><input type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-24 accent-[#d2382a]" /></label>
              <label className="flex items-center gap-1.5">Pressure <span className="lt-mono w-9">{Math.round(pressureSize * 100)}%</span><input type="range" min={0} max={1} step={0.05} value={pressureSize} onChange={(e) => setPressureSize(Number(e.target.value))} className="w-24 accent-[#d2382a]" /></label>
              {paintable.length > 1 && (
                <label className="flex items-center gap-1.5">Layer
                  <select className="lt-input !min-h-[28px] !w-auto !py-0" value={activeLayer} onChange={(e) => setActiveLayer(e.target.value)} aria-label="Drawing on layer">
                    {paintable.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="h-[560px] xl:h-auto xl:max-h-[calc(100vh-180px)]">
          <XSheet animId={anim.id} rev={`${framesSignature}:${xsRev}`} playhead={playhead} openDrawing={frameIdx}
            onOpenDrawing={(i) => { setPlaying(false); setFrameIdx(i); }} onChanged={() => { void reloadAnim(); }} />
        </div>
      </div>

      {/* drawers */}
      <section aria-label="Tools" className="lt-sheet overflow-hidden">
        <div role="tablist" aria-label="Tool drawers" className="flex gap-0.5 overflow-x-auto border-b border-[#e3dfd5] bg-[var(--lt-paper-2)] px-2">
          {DRAWERS.map((d) => (
            <button key={d.id} type="button" role="tab" aria-selected={drawer === d.id} onClick={() => setDrawer(d.id)} data-testid={`lt-drawer-${d.id}`}
              className={`whitespace-nowrap px-3 py-2 text-[12.5px] font-semibold ${drawer === d.id ? 'border-b-2 border-[var(--lt-red)] text-[var(--lt-graphite)]' : 'text-[var(--lt-muted)] hover:text-[var(--lt-graphite)]'}`}>{d.label}</button>
          ))}
        </div>
        <div className="lt-drawer p-4">
          {drawer === 'layers' && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="lt-label">Drawing {frameIdx + 1}: layers</h3>
                <button type="button" onClick={addLayer} aria-label="Add layer" className="lt-btn lt-btn-quiet !min-h-[30px] text-[12px]"><Plus className="h-3.5 w-3.5" /> Layer</button>
              </div>
              <ul className="space-y-1">
                {[...(frame.layers || [])].reverse().map((l) => {
                  const isRef = l.type === 'reference';
                  return (
                    <li key={l.id} className={`flex items-center gap-1.5 rounded border px-2 py-1 ${isRef ? 'border-dashed border-[#c9b98f] bg-[#fbf6e6]' : activeLayer === l.id ? 'border-[var(--lt-red)] bg-white' : 'border-[#e2ded4] bg-[#fffefb]'}`}>
                      <button type="button" aria-label={l.visible ? `Hide layer ${l.name}` : `Show layer ${l.name}`} onClick={() => updateLayer(l.id, { visible: !l.visible })} className="inline-flex min-h-9 min-w-9 items-center justify-center text-[var(--lt-muted)] hover:text-[var(--lt-graphite)]">
                        {l.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      {isRef && <span className="flex items-center gap-0.5 rounded bg-[#efe3bf] px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#7a6022]" aria-label="Reference layer"><ImageIcon className="h-2.5 w-2.5" /> Ref</span>}
                      {isRef ? <span className="flex-1 truncate text-[12px] text-[#7a6022]">{l.name}</span>
                        : <button type="button" onClick={() => setActiveLayer(l.id)} className="flex-1 truncate text-left text-[12px]">{l.name}</button>}
                      <input type="range" min={0} max={1} step={0.1} value={l.opacity} aria-label={isRef ? 'Reference opacity' : 'Layer opacity'} onChange={(e) => updateLayer(l.id, { opacity: Number(e.target.value) })} className="w-16 accent-[#d2382a]" />
                      <button aria-label={`Delete layer ${l.name}`} type="button" onClick={() => deleteLayer(l.id)} className="text-[var(--lt-faint)] hover:text-[var(--lt-red)]"><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {drawer === 'sound' && <AudioSyncPanel anim={anim} onChange={() => { void reloadAnim(); setXsRev((n) => n + 1); }} />}
          {drawer === 'tween' && <TweenPanel anim={anim} onChange={reloadAnim} />}
          {drawer === 'rig' && <RigPanel anim={anim} onChange={reloadAnim} />}
          {drawer === 'paper' && <CanvasPanel anim={anim} onChange={reloadAnim} />}
          {drawer === 'pencils' && <BrushPanel />}
          {drawer === 'timing' && <AnimationMotionToolkit />}
          {drawer === 'export' && <ExportDesk anim={anim} onPublish={(mediaId, durationSec) => { setRender({ mediaId, durationSec }); setDrawer('publish'); }} />}
          {drawer === 'publish' && <PublishDesk anim={anim} mediaId={render?.mediaId || null} runtimeSec={render?.durationSec ?? null} openDrawing={frameIdx} onOpenScreening={onOpenScreening} />}
          {drawer === 'share' && <SharePanel anim={anim} />}
        </div>
      </section>
    </div>
  );
}

/** The drawings in order, as small pages: number, hold, and what's on them. */
function DrawingStrip({ anim, current, onPick }: { anim: Anim; current: number; onPick: (i: number) => void }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      anim.frames.forEach((f, i) => {
        const cv = refs.current[i]; const c = cv?.getContext('2d');
        if (cv && c) drawFrame(c, f, anim.background, { scale: cv.width / anim.width });
      });
    }, 60);
    return () => window.clearTimeout(id);
  }, [anim]);
  const tw = 64; const th = Math.max(24, Math.round((anim.height / anim.width) * tw));
  return (
    <div className="lt-strip min-w-0 flex-1" role="list" aria-label="Drawings">
      {anim.frames.map((f, i) => (
        <button key={f.id} type="button" role="listitem" className="lt-thumb" aria-pressed={i === current} aria-label={`Drawing ${i + 1}${f.exposure > 1 ? `, held ${f.exposure} frames` : ''}`} onClick={() => onPick(i)}>
          <canvas ref={(el) => { refs.current[i] = el; }} width={tw * 2} height={th * 2} />
          <span className="lt-thumb-no">{i + 1}</span>
          {f.exposure > 1 && <span className="lt-thumb-hold">×{f.exposure}</span>}
        </button>
      ))}
    </div>
  );
}
