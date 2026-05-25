'use client';

// Relationship graph — undirected weighted communication graph between
// emergent identities. Backed by GET /api/emergents/graph/relationships.
// Renders a deterministic radial layout (no physics dependency).

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Network } from 'lucide-react';

interface GraphNode { id: string; label: string; degree: number }
interface GraphEdge { source: string; target: string; weight: number; lastAt: number }
interface GraphResponse {
  ok: boolean;
  error?: string;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  isolated?: number;
  totalCommunications?: number;
}

export function RelationshipGraph({ onSelect }: { onSelect?: (id: string) => void }) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/emergents/graph/relationships?limit=600')
      .then((r) => r.json())
      .then((d: GraphResponse) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setData({ ok: false, error: 'unreachable' }); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const layout = useMemo(() => {
    const nodes = data?.nodes || [];
    const W = 560;
    const H = 360;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 48;
    // Higher-degree nodes pulled toward the centre; rest on the rim.
    const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
    const pos = new Map<string, { x: number; y: number }>();
    sorted.forEach((n, i) => {
      const angle = (i / Math.max(1, sorted.length)) * Math.PI * 2;
      const ring = sorted.length > 1 ? r * (0.45 + 0.55 * (i / sorted.length)) : 0;
      pos.set(n.id, { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring });
    });
    return { W, H, pos };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Building relationship graph…
      </div>
    );
  }
  if (!data?.ok) {
    return (
      <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        Could not load the relationship graph ({data?.error || 'unknown error'}).
      </div>
    );
  }

  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const maxWeight = Math.max(1, ...edges.map((e) => e.weight));
  const maxDeg = Math.max(1, ...nodes.map((n) => n.degree));

  return (
    <div className="space-y-2">
      <header className="flex items-center gap-2">
        <Network className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Communication graph</h3>
        <span className="text-[11px] text-zinc-400">
          {nodes.length} connected · {edges.length} link{edges.length === 1 ? '' : 's'} ·{' '}
          {data.isolated ?? 0} isolated
        </span>
      </header>

      {nodes.length === 0 ? (
        <p className="text-xs text-zinc-400">
          No inter-emergent communications recorded yet — the graph is empty.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${layout.W} ${layout.H}`}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60"
          role="img"
          aria-label="Emergent communication graph"
        >
          {edges.map((e) => {
            const a = layout.pos.get(e.source);
            const b = layout.pos.get(e.target);
            if (!a || !b) return null;
            const active = hover === e.source || hover === e.target;
            return (
              <line
                key={`${e.source}-${e.target}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? '#22d3ee' : '#3f3f46'}
                strokeWidth={1 + (e.weight / maxWeight) * 4}
                strokeOpacity={active ? 0.9 : 0.5}
              />
            );
          })}
          {nodes.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const radius = 5 + (n.degree / maxDeg) * 11;
            const active = hover === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(n.id)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  r={radius}
                  fill={active ? '#22d3ee' : '#6366f1'}
                  stroke="#e4e4e7"
                  strokeWidth={active ? 2 : 0.75}
                />
                <text
                  y={-radius - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill={active ? '#a5f3fc' : '#a1a1aa'}
                >
                  {n.label}
                </text>
                <text y={3} textAnchor="middle" fontSize={8} fill="#18181b" fontWeight="bold">
                  {n.degree}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
