'use client';

/**
 * TrustGraphView
 *
 * Force-directed trust graph showing this Concord instance and its
 * known peers. Edge weight = trust score. Self-node sits at center.
 *
 * No external graph libraries — uses an SVG layout with simple
 * spring-relaxation in a useEffect loop. Cheap, dependency-free.
 */

import { useEffect, useRef, useState } from 'react';

interface GraphNode {
  id: string;
  name: string;
  kind: 'self' | 'peer';
  trust?: number;
  status?: string;
  lastSeen?: string | null;
  dtuCount?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  dtusSharedWith?: number;
  dtusReceivedFrom?: number;
}

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const CANVAS_W = 720;
const CANVAS_H = 480;

export default function TrustGraphView() {
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [positions, setPositions] = useState<PositionedNode[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/federation/trust-graph', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.nodes)) {
          setGraph({ nodes: data.nodes, edges: data.edges ?? [] });
        }
      } catch { /* network silent */ }
    }
    load();
    const id = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Initialize positions when graph changes.
  useEffect(() => {
    if (!graph) return;
    const next: PositionedNode[] = graph.nodes.map((n, i) => {
      if (n.kind === 'self') {
        return { ...n, x: CANVAS_W / 2, y: CANVAS_H / 2, vx: 0, vy: 0 };
      }
      const angle = (i / Math.max(1, graph.nodes.length - 1)) * Math.PI * 2;
      return {
        ...n,
        x: CANVAS_W / 2 + Math.cos(angle) * 180,
        y: CANVAS_H / 2 + Math.sin(angle) * 140,
        vx: 0,
        vy: 0,
      };
    });
    setPositions(next);
  }, [graph]);

  // Force layout — runs while there are unresolved forces.
  useEffect(() => {
    if (!graph || positions.length === 0) return;

    const tick = () => {
      setPositions((prev) => {
        if (!graph) return prev;
        const nodes = prev.map((n) => ({ ...n }));
        const byId = new Map(nodes.map((n) => [n.id, n]));

        // Repulsion: every pair pushes apart.
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d2 = Math.max(40, dx * dx + dy * dy);
            const force = 4000 / d2;
            const fx = (dx / Math.sqrt(d2)) * force;
            const fy = (dy / Math.sqrt(d2)) * force;
            a.vx -= fx; a.vy -= fy;
            b.vx += fx; b.vy += fy;
          }
        }

        // Attraction: edges pull toward their natural length.
        const naturalLen = 160;
        for (const e of graph.edges) {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const stretch = (d - naturalLen) / d;
          const k = 0.04 * (e.weight ?? 0.5) + 0.01;
          const fx = dx * stretch * k;
          const fy = dy * stretch * k;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }

        // Pin self to center; integrate everyone else.
        for (const n of nodes) {
          if (n.kind === 'self') {
            n.vx = 0; n.vy = 0;
            n.x = CANVAS_W / 2;
            n.y = CANVAS_H / 2;
            continue;
          }
          n.vx *= 0.6; n.vy *= 0.6;
          n.x += n.vx; n.y += n.vy;
          n.x = Math.max(40, Math.min(CANVAS_W - 40, n.x));
          n.y = Math.max(40, Math.min(CANVAS_H - 40, n.y));
        }
        return nodes;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [graph, positions.length]);

  if (!graph) {
    return <div className="text-gray-500 italic">Loading federation graph...</div>;
  }
  if (graph.nodes.length <= 1) {
    return (
      <div className="text-gray-500 italic">
        No peers yet. Use <code className="text-amber-300">POST /api/federation/register</code> to peer with another instance.
      </div>
    );
  }

  const positionsById = new Map(positions.map((p) => [p.id, p]));

  return (
    <div className="rounded-lg border border-amber-500/30 bg-black/80 p-4">
      <h3 className="text-amber-300 font-semibold mb-2">Federation Trust Graph</h3>
      <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} className="w-full h-auto">
        {graph.edges.map((e, i) => {
          const a = positionsById.get(e.source);
          const b = positionsById.get(e.target);
          if (!a || !b) return null;
          const stroke = e.weight >= 0.7 ? '#fbbf24' : e.weight >= 0.4 ? '#a78bfa' : '#64748b';
          return (
            <g key={`edge_${i}`}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={stroke}
                strokeWidth={Math.max(1, (e.weight ?? 0.5) * 4)}
                opacity={0.6}
              />
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 4}
                fill="#94a3b8"
                fontSize={9}
                textAnchor="middle"
              >
                {(e.weight ?? 0.5).toFixed(2)}
              </text>
            </g>
          );
        })}
        {positions.map((n) => (
          <g key={n.id}>
            <circle
              cx={n.x} cy={n.y}
              r={n.kind === 'self' ? 18 : 12}
              fill={n.kind === 'self' ? '#fbbf24' : n.status === 'connected' ? '#10b981' : '#64748b'}
              stroke="#0b0f17"
              strokeWidth={2}
            />
            <text
              x={n.x}
              y={n.y + (n.kind === 'self' ? 32 : 26)}
              fill="#e2e8f0"
              fontSize={11}
              textAnchor="middle"
              fontFamily="monospace"
            >
              {n.name}
            </text>
            {n.kind === 'self' && (
              <text x={n.x} y={n.y + 4} fill="#0b0f17" fontSize={9} textAnchor="middle" fontWeight="bold">
                SELF
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-3 text-xs text-gray-500">
        {graph.nodes.length} instance{graph.nodes.length === 1 ? '' : 's'},
        {' '}{graph.edges.length} trust edge{graph.edges.length === 1 ? '' : 's'}.
        Edge weight = trust score (0..1).
      </div>
    </div>
  );
}
