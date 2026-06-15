'use client';

/**
 * WhiteboardCanvas — an infinite-feeling
 * canvas + floating tool palette + zoom controls + zoomable presence
 * grid background.
 *
 * Pure-React + Canvas2D. Supports drawing rectangles, sticky notes, and
 * freehand strokes — enough to read as a whiteboard immediately. The
 * point isn't to replace tldraw; it's to give the lens the unmistakable
 * silhouette so the user understands what kind of space they're in.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Square, StickyNote, Pencil, MousePointer2, ZoomIn, ZoomOut, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Tool = 'select' | 'rect' | 'sticky' | 'pen';

export interface Shape {
  id: string;
  kind: 'rect' | 'sticky' | 'stroke' | 'connector' | 'frame' | 'embed';
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  color?: string;
  points?: Array<{ x: number; y: number }>;
  // connector: endpoints by element id; frame/embed: label + embed url
  fromId?: string;
  toId?: string;
  label?: string;
  url?: string;
  votes?: number;
}

export interface WhiteboardCanvasProps {
  initialShapes?: Shape[];
  onChange?: (shapes: Shape[]) => void;
  /** Remote scene to apply when `syncSignal` changes (realtime collab resync). */
  syncShapes?: Shape[];
  /** Bump this (e.g. a remote update timestamp) to replace the canvas with `syncShapes`. */
  syncSignal?: number;
  /** Live peer cursors (world coords) to overlay (multi-cursor presence). */
  peerCursors?: Array<{ userId: string; x: number; y: number }>;
  /** Per-element vote tallies to render as badges (id → count). */
  voteCounts?: Record<string, number>;
  /** Called with world-coords on pointer move (for broadcasting your cursor to peers). */
  onCursorMove?: (x: number, y: number) => void;
  className?: string;
}

const CURSOR_COLORS = ['#f472b6', '#34d399', '#60a5fa', '#fbbf24', '#a78bfa', '#fb7185'];
function cursorColor(id: string) {
  let h = 0; for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}

const STICKY_COLORS = ['#fef08a', '#fbcfe8', '#bae6fd', '#bbf7d0', '#fed7aa'];

function uid() {
  return `s_${Math.random().toString(36).slice(2, 8)}`;
}

export function WhiteboardCanvas({ initialShapes = [], onChange, syncShapes, syncSignal, peerCursors, voteCounts, onCursorMove, className }: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shapes, setShapes] = useState<Shape[]>(initialShapes);
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drawingRef = useRef<Shape | null>(null);
  const syncShapesRef = useRef(syncShapes);
  syncShapesRef.current = syncShapes;
  const peerCursorsRef = useRef(peerCursors);
  peerCursorsRef.current = peerCursors;
  const voteCountsRef = useRef(voteCounts);
  voteCountsRef.current = voteCounts;

  useEffect(() => {
    onChange?.(shapes);
  }, [shapes, onChange]);

  // Realtime resync: when a remote scene-update bumps syncSignal, replace the canvas
  // with the re-fetched remote scene. (Last-write-wins full-scene baseline — Batch G E1.)
  useEffect(() => {
    if (syncSignal && Array.isArray(syncShapesRef.current)) setShapes(syncShapesRef.current);
  }, [syncSignal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2 = canvas.getContext('2d');
    if (!ctx2) return;
    const ctx: CanvasRenderingContext2D = ctx2;

    function draw() {
      const c = canvas;
      if (!c) return;
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      ctx.clearRect(0, 0, W, H);
      // Dot grid background — the tldraw tell.
      const gridSpacing = 24 * zoom;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      const startX = pan.x % gridSpacing;
      const startY = pan.y % gridSpacing;
      for (let x = startX; x < W; x += gridSpacing) {
        for (let y = startY; y < H; y += gridSpacing) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
      // Render shapes.
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);
      const all = drawingRef.current ? [...shapes, drawingRef.current] : shapes;
      const centerOf = (el: Shape) => ({ x: el.x + (el.w || (el.kind === 'sticky' ? 120 : 40)) / 2, y: el.y + (el.h || (el.kind === 'sticky' ? 80 : 30)) / 2 });
      // Draw order: frames behind, then connectors, then nodes (rect/sticky/stroke/embed).
      const zRank = (k: Shape['kind']) => (k === 'frame' ? 0 : k === 'connector' ? 1 : 2);
      const ordered = [...all].sort((a, b) => zRank(a.kind) - zRank(b.kind));
      for (const s of ordered) {
        if (s.kind === 'rect') {
          ctx.strokeStyle = s.color || '#7dd3fc';
          ctx.lineWidth = 2 / zoom;
          ctx.strokeRect(s.x, s.y, s.w || 40, s.h || 30);
        } else if (s.kind === 'sticky') {
          ctx.fillStyle = s.color || '#fef08a';
          ctx.fillRect(s.x, s.y, s.w || 120, s.h || 80);
          if (s.text) {
            ctx.fillStyle = '#1a1a1a';
            ctx.font = `${14 / zoom}px system-ui, sans-serif`;
            wrapText(ctx, s.text, s.x + 8, s.y + 20, (s.w || 120) - 16, 18 / zoom);
          }
        } else if (s.kind === 'stroke') {
          if (!s.points || s.points.length < 2) continue;
          ctx.strokeStyle = s.color || '#fff';
          ctx.lineWidth = 2.5 / zoom;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(s.points[0].x, s.points[0].y);
          for (let i = 1; i < s.points.length; i += 1) ctx.lineTo(s.points[i].x, s.points[i].y);
          ctx.stroke();
        } else if (s.kind === 'frame') {
          // Labeled dashed bounding region drawn behind its children.
          const w = s.w || 240, h = s.h || 180;
          ctx.save();
          ctx.strokeStyle = s.color || '#64748b';
          ctx.lineWidth = 1.5 / zoom;
          ctx.setLineDash([6 / zoom, 4 / zoom]);
          ctx.strokeRect(s.x, s.y, w, h);
          ctx.setLineDash([]);
          ctx.fillStyle = s.color || '#94a3b8';
          ctx.font = `${12 / zoom}px system-ui, sans-serif`;
          ctx.fillText(s.label || s.text || 'Frame', s.x + 4, s.y - 6 / zoom);
          ctx.restore();
        } else if (s.kind === 'connector') {
          // Line between two elements' centers, with an arrowhead at the target.
          const from = all.find((e) => e.id === s.fromId);
          const to = all.find((e) => e.id === s.toId);
          if (!from || !to) continue;
          const a = centerOf(from), b = centerOf(to);
          ctx.strokeStyle = s.color || '#a78bfa';
          ctx.lineWidth = 2 / zoom;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const ah = 9 / zoom;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - ah * Math.cos(ang - Math.PI / 7), b.y - ah * Math.sin(ang - Math.PI / 7));
          ctx.lineTo(b.x - ah * Math.cos(ang + Math.PI / 7), b.y - ah * Math.sin(ang + Math.PI / 7));
          ctx.closePath();
          ctx.fillStyle = s.color || '#a78bfa';
          ctx.fill();
          if (s.label) {
            ctx.fillStyle = '#cbd5e1';
            ctx.font = `${11 / zoom}px system-ui, sans-serif`;
            ctx.fillText(s.label, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 4);
          }
        } else if (s.kind === 'embed') {
          // Placeholder card for an embedded URL/resource.
          const w = s.w || 200, h = s.h || 120;
          ctx.fillStyle = 'rgba(30,41,59,0.85)';
          ctx.fillRect(s.x, s.y, w, h);
          ctx.strokeStyle = s.color || '#38bdf8';
          ctx.lineWidth = 1.5 / zoom;
          ctx.strokeRect(s.x, s.y, w, h);
          ctx.fillStyle = '#7dd3fc';
          ctx.font = `${12 / zoom}px system-ui, sans-serif`;
          ctx.fillText('🔗 ' + (s.label || 'Embed'), s.x + 8, s.y + 20 / zoom);
          if (s.url) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = `${10 / zoom}px system-ui, sans-serif`;
            wrapText(ctx, s.url, s.x + 8, s.y + 38 / zoom, w - 16, 14 / zoom);
          }
        }
        // Vote badge on any element that carries one (local or realtime tally).
        const voteN = (voteCountsRef.current?.[s.id] ?? s.votes) || 0;
        if (voteN > 0 && (s.kind === 'rect' || s.kind === 'sticky' || s.kind === 'embed' || s.kind === 'frame')) {
          const bx = s.x + (s.w || 120) - 10 / zoom, by = s.y + 10 / zoom;
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(bx, by, 9 / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1a1a1a';
          ctx.font = `bold ${10 / zoom}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(String(voteN), bx, by + 3 / zoom);
          ctx.textAlign = 'start';
        }
      }
      // Multi-cursor presence overlay (peer cursors are in world coords).
      const cursors = peerCursorsRef.current || [];
      for (const cur of cursors) {
        const col = cursorColor(cur.userId);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cur.x, cur.y);
        ctx.lineTo(cur.x, cur.y + 16 / zoom);
        ctx.lineTo(cur.x + 5 / zoom, cur.y + 11 / zoom);
        ctx.lineTo(cur.x + 11 / zoom, cur.y + 11 / zoom);
        ctx.closePath();
        ctx.fill();
        ctx.font = `${9 / zoom}px system-ui, sans-serif`;
        ctx.fillText(cur.userId.slice(0, 6), cur.x + 12 / zoom, cur.y + 8 / zoom);
      }
      ctx.restore();
    }

    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [shapes, zoom, pan]);

  function worldFromMouse(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return { x: (screenX - pan.x) / zoom, y: (screenY - pan.y) / zoom };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (tool === 'select') return;
    const p = worldFromMouse(e);
    if (tool === 'rect') {
      drawingRef.current = { id: uid(), kind: 'rect', x: p.x, y: p.y, w: 0, h: 0 };
    } else if (tool === 'sticky') {
      const text = window.prompt('Sticky note text', '');
      if (text === null) return;
      const color = STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)];
      const s: Shape = { id: uid(), kind: 'sticky', x: p.x - 60, y: p.y - 40, w: 120, h: 80, text, color };
      setShapes((prev) => [...prev, s]);
    } else if (tool === 'pen') {
      drawingRef.current = { id: uid(), kind: 'stroke', x: 0, y: 0, points: [p] };
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (onCursorMove) { const wp = worldFromMouse(e); onCursorMove(wp.x, wp.y); }
    if (!drawingRef.current) return;
    const p = worldFromMouse(e);
    if (drawingRef.current.kind === 'rect') {
      drawingRef.current.w = p.x - drawingRef.current.x;
      drawingRef.current.h = p.y - drawingRef.current.y;
    } else if (drawingRef.current.kind === 'stroke') {
      drawingRef.current.points?.push(p);
    }
  }

  function onMouseUp() {
    if (!drawingRef.current) return;
    setShapes((prev) => [...prev, drawingRef.current!]);
    drawingRef.current = null;
  }

  return (
    <div className={cn('relative w-full h-full bg-[#0d0d0f] overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
      {/* Tool palette — the tldraw island bottom-center */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-4 flex items-center gap-1 bg-black/70 backdrop-blur border border-white/10 rounded-full p-1 shadow-lg">
        {[
          { id: 'select' as Tool,  icon: MousePointer2, label: 'Select' },
          { id: 'rect' as Tool,    icon: Square,        label: 'Rectangle' },
          { id: 'sticky' as Tool,  icon: StickyNote,    label: 'Sticky note' },
          { id: 'pen' as Tool,     icon: Pencil,        label: 'Draw' },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            aria-pressed={tool === id}
            className={cn(
              'inline-flex items-center justify-center w-9 h-9 rounded-full transition',
              tool === id
                ? 'bg-amber-500/30 text-amber-200'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            )}
            title={label}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
      {/* Zoom controls — top-right */}
      <div className="absolute top-4 right-4 flex flex-col gap-1 bg-black/70 backdrop-blur border border-white/10 rounded-md p-1">
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.2))} className="w-8 h-8 inline-flex items-center justify-center text-gray-400 hover:text-white" title="Zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))} className="w-8 h-8 inline-flex items-center justify-center text-gray-400 hover:text-white" title="Zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="w-8 h-8 inline-flex items-center justify-center text-gray-400 hover:text-white" title="Reset view">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
      {/* Clear all */}
      <button
        type="button"
        onClick={() => setShapes([])}
        className="absolute top-4 left-4 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-rose-300 px-2 py-1 rounded-md bg-black/60 backdrop-blur border border-white/10"
        title="Clear board"
      >
        <Trash2 className="w-3 h-3" /> Clear
      </button>
      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 text-[10px] text-gray-400 font-mono">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  let dy = 0;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + dy);
      line = word + ' ';
      dy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y + dy);
}

export default WhiteboardCanvas;
