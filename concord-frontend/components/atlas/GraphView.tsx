'use client';

/**
 * GraphView — Roam / Obsidian-shape force-laid knowledge graph.
 *
 * Nodes are DTUs (or any { id, label } you pass in); edges are
 * citation / parent / sibling links. We use a tiny built-in
 * force-directed layout — no third-party physics lib, ~150 LOC of
 * Verlet-like attraction + repulsion + light spring damping. That's
 * enough fidelity to land the unmistakable Obsidian silhouette: the
 * pulsing constellation that animates into stable clumps.
 *
 * Canvas-rendered for perf on graphs of a few hundred nodes; SVG
 * would handle the click/hover surface but doesn't reach a thousand
 * nodes the way most Obsidian vaults end up doing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface GraphNode {
  id: string;
  label?: string;
  /** Optional grouping for tinting (domain / tier / faction). */
  group?: string;
  /** 0..1 scaling on the rendered radius. */
  weight?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** "parent" / "citation" / "sibling" / etc — drives stroke style. */
  kind?: string;
}

interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Click a node — typically opens its DTU detail. */
  onNodeClick?: (node: GraphNode) => void;
  /** Highlight an active focal node (lights up in Obsidian's blue glow). */
  focusedId?: string;
  className?: string;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const REPULSION = 1500;       // node-node repulsion strength
const SPRING_K  = 0.012;      // edge spring constant
const SPRING_LEN = 80;        // ideal edge length
const DAMPING = 0.85;         // velocity decay each frame
const CENTER_PULL = 0.0015;   // pull toward viewport center
const MIN_DISTANCE = 8;       // softening for repulsion at zero distance

const GROUP_COLORS = [
  '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ec4899', '#22c55e', '#fb7185', '#3b82f6',
];

function colorForGroup(group: string | undefined, fallback: string): string {
  if (!group) return fallback;
  let hash = 0;
  for (let i = 0; i < group.length; i += 1) hash = (hash * 31 + group.charCodeAt(i)) & 0xfffffff;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

export function GraphView({ nodes, edges, onNodeClick, focusedId, className }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Build the simulation state. Restart whenever the node list changes
  // identity; edges alone don't reseed because we keep positions.
  const sim = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const filteredEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    const seeded: SimNode[] = nodes.map((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const r = 120 + Math.random() * 60;
      return {
        ...n,
        x: 320 + Math.cos(angle) * r,
        y: 200 + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
    });
    return { nodes: seeded, edges: filteredEdges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, edges.length]);

  // rAF loop: integrate forces + redraw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    // Capture into a non-null const so the rAF closure preserves narrowing.
    const ctx: CanvasRenderingContext2D = ctx2d;

    let raf = 0;
    let mouseX = -1;
    let mouseY = -1;

    function step() {
      const W = canvas?.clientWidth ?? 640;
      const H = canvas?.clientHeight ?? 400;
      if (canvas && (canvas.width !== W || canvas.height !== H)) {
        canvas.width = W;
        canvas.height = H;
      }

      const { nodes: ns, edges: es } = sim;
      const indexById = new Map<string, SimNode>();
      ns.forEach((n) => indexById.set(n.id, n));

      // Pairwise repulsion (O(n^2) — fine up to ~300 nodes).
      for (let i = 0; i < ns.length; i += 1) {
        for (let j = i + 1; j < ns.length; j += 1) {
          const a = ns[i];
          const b = ns[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < MIN_DISTANCE * MIN_DISTANCE) {
            d2 = MIN_DISTANCE * MIN_DISTANCE;
            dx = MIN_DISTANCE;
            dy = MIN_DISTANCE;
          }
          const force = REPULSION / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Edge spring attraction.
      for (const e of es) {
        const a = indexById.get(e.source);
        const b = indexById.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const stretch = d - SPRING_LEN;
        const fx = (dx / d) * stretch * SPRING_K;
        const fy = (dy / d) * stretch * SPRING_K;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // Center pull + integrate.
      for (const n of ns) {
        n.vx += (W / 2 - n.x) * CENTER_PULL;
        n.vy += (H / 2 - n.y) * CENTER_PULL;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
      }

      // Draw.
      ctx.clearRect(0, 0, W, H);
      // Edges first (back layer).
      ctx.lineWidth = 0.6;
      for (const e of es) {
        const a = indexById.get(e.source);
        const b = indexById.get(e.target);
        if (!a || !b) continue;
        ctx.strokeStyle = e.kind === 'citation' ? 'rgba(245, 158, 11, 0.35)' : 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      // Nodes.
      let hover: SimNode | null = null;
      for (const n of ns) {
        const r = 4 + (n.weight ?? 0.5) * 5;
        const dx = n.x - mouseX;
        const dy = n.y - mouseY;
        const isHover = dx * dx + dy * dy < (r + 4) * (r + 4);
        if (isHover) hover = n;
        const isFocused = focusedId === n.id;
        const fill = colorForGroup(n.group, '#7dd3fc');
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (isFocused ? 4 : 0) + (isHover ? 2 : 0), 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.globalAlpha = isFocused ? 1 : isHover ? 0.95 : 0.85;
        ctx.fill();
        if (isFocused) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (hover) {
        ctx.fillStyle = '#fff';
        ctx.font = '12px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(hover.label || hover.id.slice(0, 16), hover.x + 10, hover.y + 4);
      }
      setHovered(hover?.id ?? null);

      raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    const onMouse = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = ev.clientX - rect.left;
      mouseY = ev.clientY - rect.top;
    };
    const onLeave = () => {
      mouseX = -1;
      mouseY = -1;
    };
    const onClick = () => {
      if (hovered) {
        const node = sim.nodes.find((n) => n.id === hovered);
        if (node) onNodeClick?.(node);
      }
    };
    canvas.addEventListener('mousemove', onMouse);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousemove', onMouse);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
    };
  }, [sim, hovered, focusedId, onNodeClick]);

  return (
    <div className={cn('relative w-full h-[480px] rounded-lg border border-white/10 bg-[#0a0a0d] overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        className={cn('absolute inset-0 w-full h-full', hovered ? 'cursor-pointer' : 'cursor-default')}
        aria-label="Knowledge graph"
      />
      <div className="absolute top-2 right-2 text-[10px] text-white/40 font-mono uppercase tracking-wider">
        {nodes.length} nodes · {edges.length} links
      </div>
    </div>
  );
}

export default GraphView;
