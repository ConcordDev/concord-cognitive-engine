'use client';

/**
 * GraphCanvas — interactive force-directed entity/relation graph for the
 * worldmodel lens. Pure SVG + a tiny in-component force simulation so it
 * has no extra dependency. Nodes are draggable; clicking a node or edge
 * raises the selection up to the page for inspection / relation creation.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface GraphNode {
  id: string;
  name?: string;
  type?: string;
  degree?: number;
  attributes?: Record<string, unknown>;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type?: string;
  weight?: number;
}

interface Placed extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const W = 760;
const H = 460;

function typeColor(type?: string): string {
  const palette = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444'];
  if (!type) return '#52525b';
  let h = 0;
  for (let i = 0; i < type.length; i += 1) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function GraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onSelectEdge,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (n: GraphNode) => void;
  onSelectEdge?: (e: GraphEdge) => void;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // seed positions deterministically on a circle so re-renders are stable
  const seeded = useMemo<Placed[]>(() => {
    const n = nodes.length || 1;
    return nodes.map((nd, i) => ({
      ...nd,
      x: W / 2 + Math.cos((i / n) * Math.PI * 2) * 160,
      y: H / 2 + Math.sin((i / n) * Math.PI * 2) * 130,
      vx: 0,
      vy: 0,
    }));
  }, [nodes]);

  useEffect(() => {
    setPlaced((prev) => {
      // preserve positions of nodes that already existed
      const byId = new Map(prev.map((p) => [p.id, p]));
      return seeded.map((s) => {
        const old = byId.get(s.id);
        return old ? { ...s, x: old.x, y: old.y, vx: 0, vy: 0 } : s;
      });
    });
  }, [seeded]);

  // simple force tick: repulsion + spring edges + centering
  useEffect(() => {
    if (placed.length === 0) return;
    let frame = 0;
    let raf = 0;
    const edgeList = edges.filter((e) => e.from && e.to);
    const tick = () => {
      frame += 1;
      setPlaced((cur) => {
        if (cur.length === 0) return cur;
        const next = cur.map((p) => ({ ...p }));
        const idx = new Map(next.map((p, i) => [p.id, i]));
        for (let i = 0; i < next.length; i += 1) {
          for (let j = i + 1; j < next.length; j += 1) {
            const a = next[i];
            const b = next[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
            const f = 2600 / d2;
            const d = Math.sqrt(d2);
            a.vx += (dx / d) * f;
            a.vy += (dy / d) * f;
            b.vx -= (dx / d) * f;
            b.vy -= (dy / d) * f;
          }
        }
        for (const e of edgeList) {
          const ai = idx.get(e.from);
          const bi = idx.get(e.to);
          if (ai == null || bi == null) continue;
          const a = next[ai];
          const b = next[bi];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = (d - 120) * 0.02;
          a.vx += (dx / d) * k;
          a.vy += (dy / d) * k;
          b.vx -= (dx / d) * k;
          b.vy -= (dy / d) * k;
        }
        for (const p of next) {
          p.vx += (W / 2 - p.x) * 0.002;
          p.vy += (H / 2 - p.y) * 0.002;
          if (dragRef.current?.id === p.id) { p.vx = 0; p.vy = 0; continue; }
          p.vx *= 0.82;
          p.vy *= 0.82;
          p.x = Math.max(24, Math.min(W - 24, p.x + p.vx));
          p.y = Math.max(24, Math.min(H - 24, p.y + p.vy));
        }
        return next;
      });
      if (frame < 220) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [edges, placed.length]);

  const posOf = (id: string) => placed.find((p) => p.id === id);

  function onPointerDown(id: string, e: React.PointerEvent) {
    const p = posOf(id);
    if (!p) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    dragRef.current = { id, ox: sx - p.x, oy: sy - p.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    setPlaced((cur) => cur.map((p) => (p.id === drag.id
      ? { ...p, x: Math.max(24, Math.min(W - 24, sx - drag.ox)), y: Math.max(24, Math.min(H - 24, sy - drag.oy)) }
      : p)));
  }
  function onPointerUp() { dragRef.current = null; }

  if (nodes.length === 0) {
    return (
      <div className="flex h-[460px] items-center justify-center rounded-lg border border-emerald-900/40 bg-emerald-950/10 text-xs text-emerald-700">
        No entities yet — add entities to see the graph.
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-lg border border-emerald-900/40 bg-black/60"
      style={{ touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      role="img"
      aria-label="Entity relation graph"
    >
      {edges.map((e) => {
        const a = posOf(e.from);
        const b = posOf(e.to);
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={e.id} onClick={() => onSelectEdge?.(e)} className="cursor-pointer">
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="#10b981"
              strokeOpacity={0.35 + (e.weight ?? 0.5) * 0.5}
              strokeWidth={1 + (e.weight ?? 0.5) * 3}
            />
            <text x={mx} y={my - 3} textAnchor="middle" fontSize={8} fill="#34d399">
              {e.type}
            </text>
          </g>
        );
      })}
      {placed.map((p) => {
        const r = 10 + Math.min(14, (p.degree ?? 0) * 2.4);
        const sel = p.id === selectedNodeId;
        return (
          <g
            key={p.id}
            transform={`translate(${p.x},${p.y})`}
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => onPointerDown(p.id, e)}
            onClick={() => onSelectNode?.(p)}
          >
            <circle
              r={r}
              fill={typeColor(p.type)}
              fillOpacity={sel ? 0.95 : 0.6}
              stroke={sel ? '#fff' : '#022c22'}
              strokeWidth={sel ? 2.5 : 1.5}
            />
            <text y={r + 11} textAnchor="middle" fontSize={9} fill="#d1fae5">
              {p.name || p.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
