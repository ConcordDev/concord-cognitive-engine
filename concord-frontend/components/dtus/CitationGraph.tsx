'use client';

/**
 * CitationGraph — interactive node-link visualization of DTU citation
 * lineage. Wired to the `dtus.citationGraph` macro: feeds the current
 * corpus, receives computed nodes (with influence + degree) and edges,
 * and lays them out with a deterministic force-free radial pack so the
 * graph reads even with no physics loop.
 */

import { useMemo, useState } from 'react';
import { Network, Loader2 } from 'lucide-react';

export interface GraphNode {
  id: string;
  label: string;
  tier: string;
  inDegree: number;
  outDegree: number;
  influence: number;
  size: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

interface CitationGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hubs: GraphNode[];
  stats: { nodeCount: number; edgeCount: number; isolated: number; density: number };
}

const TIER_COLOR: Record<string, string> = {
  regular: '#3b82f6',
  mega: '#a855f7',
  hyper: '#ec4899',
  shadow: '#6b7280',
};

function layout(nodes: GraphNode[], width: number, height: number) {
  // Influence-banded radial layout: hubs in the centre, leaves outward.
  const cx = width / 2;
  const cy = height / 2;
  const sorted = [...nodes].sort((a, b) => b.influence - a.influence);
  const positions = new Map<string, { x: number; y: number }>();
  sorted.forEach((n, i) => {
    if (i === 0 && sorted.length > 1) {
      positions.set(n.id, { x: cx, y: cy });
      return;
    }
    const ring = Math.ceil((i + 1) / 8);
    const idxInRing = i % 8;
    const radius = Math.min(width, height) * 0.12 * ring;
    const angle = (idxInRing / 8) * Math.PI * 2 + ring * 0.6;
    positions.set(n.id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });
  return positions;
}

export function CitationGraph({
  result,
  loading,
  onSelectNode,
}: {
  result: CitationGraphResult | null;
  loading: boolean;
  onSelectNode?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const width = 640;
  const height = 420;

  const positions = useMemo(
    () => (result ? layout(result.nodes, width, height) : new Map()),
    [result],
  );

  if (loading) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-lg border border-lattice-border bg-lattice-deep">
        <Loader2 className="h-6 w-6 animate-spin text-neon-cyan" />
      </div>
    );
  }

  if (!result || result.nodes.length === 0) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center rounded-lg border border-lattice-border bg-lattice-deep text-gray-400">
        <Network className="mb-2 h-8 w-8" />
        <p className="text-sm">No citation links in the current corpus.</p>
        <p className="text-xs text-gray-400">Load DTUs with parents/cites to see the graph.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Nodes" value={result.stats.nodeCount} />
        <Stat label="Edges" value={result.stats.edgeCount} />
        <Stat label="Isolated" value={result.stats.isolated} />
        <Stat label="Density" value={`${result.stats.density}%`} />
      </div>

      <div className="overflow-hidden rounded-lg border border-lattice-border bg-lattice-deep">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[420px] w-full">
          <defs>
            <marker
              id="dtu-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#52525b" />
            </marker>
          </defs>
          {result.edges.map((e, i) => {
            const a = positions.get(e.source);
            const b = positions.get(e.target);
            if (!a || !b) return null;
            const active = hovered === e.source || hovered === e.target;
            return (
              <line
                key={`e${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? '#06b6d4' : '#3f3f46'}
                strokeWidth={active ? 1.8 : 0.9}
                markerEnd="url(#dtu-arrow)"
              />
            );
          })}
          {result.nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const r = Math.max(6, n.size / 2);
            const active = hovered === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectNode?.(n.id)}
                className="cursor-pointer"
              >
                <circle
                  r={r}
                  fill={TIER_COLOR[n.tier] || TIER_COLOR.regular}
                  fillOpacity={active ? 1 : 0.78}
                  stroke={active ? '#fff' : 'transparent'}
                  strokeWidth={1.5}
                />
                {(active || n.influence >= 60) && (
                  <text
                    y={-r - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#e4e4e7"
                  >
                    {n.label.length > 22 ? `${n.label.slice(0, 22)}…` : n.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {result.hubs.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-gray-400">Top citation hubs</p>
          <div className="flex flex-wrap gap-2">
            {result.hubs.map((h) => (
              <button
                key={h.id}
                onClick={() => onSelectNode?.(h.id)}
                className="flex items-center gap-1.5 rounded border border-lattice-border bg-lattice-surface px-2 py-1 text-xs text-gray-300 hover:border-neon-cyan/50"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: TIER_COLOR[h.tier] || TIER_COLOR.regular }}
                />
                <span className="max-w-[160px] truncate">{h.label}</span>
                <span className="text-neon-cyan">{h.inDegree}↩</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-lattice-border bg-lattice-surface p-2 text-center">
      <p className="text-sm font-bold text-white">{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  );
}
