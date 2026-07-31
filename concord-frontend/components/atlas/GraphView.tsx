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
 *
 * Click-to-focus (Obsidian's "local graph" idiom): selecting a node
 * dims everything not directly connected to it and keeps the
 * selection + its neighbors at full brightness. Escape clears it.
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
  /** Marks the node as flagged/invalid (e.g. a fabricated-citation verdict) —
   *  renders red and prominent, overriding group tinting. Never hidden. */
  flagged?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** "parent" / "citation" / "sibling" / etc — drives stroke style. */
  kind?: string;
  /** Marks the edge as flagged/invalid — renders red + bold, overriding the
   *  usual citation/plain stroke styling. Never hidden. */
  flagged?: boolean;
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
const DIM_ALPHA = 0.12;       // alpha applied to non-connected nodes/edges when something is selected

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

/** Radius used both for drawing and for hit-testing — kept in one place so
 * clicks/hover match exactly what's on screen. */
function nodeRadius(n: GraphNode): number {
  return 4 + (n.weight ?? 0.5) * 5;
}

/** Topmost node under a world-space point, or null. Iterates back-to-front
 * so a node drawn later (and thus visually on top) wins ties. */
function hitTestNode(nodes: SimNode[], x: number, y: number): SimNode | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const n = nodes[i];
    const r = nodeRadius(n) + 4; // a little slop makes small nodes easier to hit
    const dx = n.x - x;
    const dy = n.y - y;
    if (dx * dx + dy * dy <= r * r) return n;
  }
  return null;
}

export function GraphView({ nodes, edges, onNodeClick, focusedId, className }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const neighborIdsRef = useRef<Set<string> | null>(null);
  const mousePos = useRef({ x: -1, y: -1 });
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

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

  // Clear the selection whenever the graph is swapped for a different one
  // (a stale selectedId pointing at a node that no longer exists would
  // otherwise silently dim the entire new graph).
  useEffect(() => {
    setSelectedId(null);
  }, [sim]);

  // Neighbor set for the current selection — recomputed only when the
  // selection or the graph itself changes, not every animation frame.
  const neighborIds = useMemo(() => {
    if (!selectedId) return null;
    const s = new Set<string>([selectedId]);
    for (const e of sim.edges) {
      if (e.source === selectedId) s.add(e.target);
      else if (e.target === selectedId) s.add(e.source);
    }
    return s;
  }, [selectedId, sim]);
  useEffect(() => { neighborIdsRef.current = neighborIds; }, [neighborIds]);

  // Escape clears the local-graph focus.
  useEffect(() => {
    if (!selectedId) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setSelectedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // rAF loop: integrate forces + redraw. Deliberately does NOT depend on
  // `hovered` — that used to tear down and rebuild the whole listener set
  // (including resetting the tracked mouse position to -1,-1) on every
  // single hover transition, causing the hover label to flicker off for a
  // frame each time it appeared. Mouse position and hover id now live in
  // refs the loop reads directly, so the effect only restarts when the
  // graph itself, the focused id, or the click callback actually changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    // Capture into a non-null const so the rAF closure preserves narrowing.
    const ctx: CanvasRenderingContext2D = ctx2d;

    let raf = 0;

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

      const selId = selectedIdRef.current;
      const neighbors = selId ? neighborIdsRef.current : null;

      // Draw.
      ctx.clearRect(0, 0, W, H);
      // Edges first (back layer).
      for (const e of es) {
        const a = indexById.get(e.source);
        const b = indexById.get(e.target);
        if (!a || !b) continue;
        const dimmed = !!neighbors && !(neighbors.has(e.source) && neighbors.has(e.target));
        // Flagged (e.g. fabricated-citation) edges render red + bold — this
        // overrides the usual citation/plain styling and is never hidden.
        ctx.lineWidth = e.flagged ? 2 : 0.6;
        ctx.strokeStyle = e.flagged
          ? 'rgba(244, 63, 94, 0.9)'
          : e.kind === 'citation'
            ? 'rgba(245, 158, 11, 0.35)'
            : 'rgba(255, 255, 255, 0.12)';
        ctx.globalAlpha = dimmed ? DIM_ALPHA : 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Nodes.
      const hoverId = hitTestNode(ns, mousePos.current.x, mousePos.current.y)?.id ?? null;
      if (hoverId !== hoveredRef.current) {
        hoveredRef.current = hoverId;
        setHovered(hoverId);
      }
      for (const n of ns) {
        const r = nodeRadius(n);
        const isHover = n.id === hoverId;
        const isFocused = focusedId === n.id;
        const isSelected = n.id === selId;
        const dimmed = !!neighbors && !neighbors.has(n.id);
        // Flagged nodes render red, overriding group tinting — prominent and
        // never hidden (e.g. a fabricated-citation verdict).
        const fill = n.flagged ? '#f43f5e' : colorForGroup(n.group, '#7dd3fc');
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (isFocused || isSelected ? 4 : 0) + (isHover ? 2 : 0) + (n.flagged ? 2 : 0), 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.globalAlpha = dimmed ? DIM_ALPHA : isFocused || isSelected ? 1 : isHover ? 0.95 : 0.85;
        ctx.fill();
        if (isFocused || isSelected || n.flagged) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = n.flagged ? '#fecdd3' : isSelected ? '#38bdf8' : '#fff';
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (hoverId) {
        const hoverNode = indexById.get(hoverId);
        if (hoverNode) {
          ctx.fillStyle = '#fff';
          ctx.font = '12px ui-monospace, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(hoverNode.label || hoverNode.id.slice(0, 16), hoverNode.x + 10, hoverNode.y + 4);
        }
      }

      raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    const onMouse = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mousePos.current = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    const onLeave = () => {
      mousePos.current = { x: -1, y: -1 };
    };
    const onClick = () => {
      const hit = hitTestNode(sim.nodes, mousePos.current.x, mousePos.current.y);
      if (!hit) return;
      onNodeClick?.(hit);
      setSelectedId((prev) => (prev === hit.id ? null : hit.id));
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
  }, [sim, focusedId, onNodeClick]);

  const selectedNode = selectedId ? sim.nodes.find((n) => n.id === selectedId) ?? null : null;
  const connectionCount = neighborIds ? neighborIds.size - 1 : 0;

  // Legend — real, derived from the actual node groups in this graph (never
  // a fixed/decorative palette key). Ordered by frequency, ties broken
  // alphabetically for a stable render.
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const g = n.group || '(ungrouped)';
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([group, count]) => ({ group, count, color: colorForGroup(group === '(ungrouped)' ? undefined : group, '#7dd3fc') }));
  }, [nodes]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative w-full h-[480px] rounded-lg border border-white/10 bg-[#0a0a0d] overflow-hidden">
        <canvas
          ref={canvasRef}
          className={cn('absolute inset-0 w-full h-full', hovered ? 'cursor-pointer' : 'cursor-default')}
          aria-label="Knowledge graph"
        />
        <div className="absolute top-2 right-2 text-[10px] text-white/40 font-mono uppercase tracking-wider">
          {nodes.length} nodes · {edges.length} links
        </div>
        {selectedNode && (
          <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-black/70 backdrop-blur border border-sky-500/30 px-2.5 py-1.5 text-[11px] text-sky-200">
            <span className="font-medium text-white">{selectedNode.label || selectedNode.id}</span>
            <span className="text-sky-300/70">
              {connectionCount} connection{connectionCount === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="ml-1 text-sky-300/70 hover:text-white"
              aria-label="Clear selection"
              title="Clear selection (Esc)"
            >
              ×
            </button>
          </div>
        )}
      </div>
      {legend.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-400">
          {legend.map(({ group, count, color }) => (
            <span key={group} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              {group} <span className="text-gray-600">· {count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default GraphView;
