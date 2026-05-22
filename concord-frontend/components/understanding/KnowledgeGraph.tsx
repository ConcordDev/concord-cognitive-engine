'use client';

// KnowledgeGraph — interactive linked-knowledge graph for the
// understanding lens (Obsidian's signature view). Renders nodes (notes)
// and edges (manual links + resolved [[wiki-links]]) with a
// deterministic radial layout, node sizing by connection degree, and
// click-to-focus. All data comes from the understanding.graph macro —
// no seed/demo data; an empty graph shows an empty state.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, RefreshCw, Network, X } from 'lucide-react';

interface GraphNode { id: string; label: string; tags: string[]; degree: number }
interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  kind: 'manual' | 'wiki';
}
interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeCount: number;
  edgeCount: number;
  orphanCount: number;
  orphans: string[];
}

interface Placed extends GraphNode { x: number; y: number }

const W = 720;
const H = 520;

export function KnowledgeGraph({ onOpenNote }: { onOpenNote?: (id: string) => void }) {
  const [graph, setGraph] = useState<GraphResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<GraphResult>('understanding', 'graph', {});
      if (r.data?.ok && r.data.result) setGraph(r.data.result);
      else setError(r.data?.error || 'graph failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'graph failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Deterministic radial layout: connected nodes by degree on an inner
  // ring (most-connected near centre), orphans on an outer ring.
  const placed = useMemo<Placed[]>(() => {
    if (!graph) return [];
    const cx = W / 2;
    const cy = H / 2;
    const connected = graph.nodes
      .filter((n) => n.degree > 0)
      .sort((a, b) => b.degree - a.degree);
    const orphans = graph.nodes.filter((n) => n.degree === 0);
    const out: Placed[] = [];
    const maxDeg = Math.max(1, ...connected.map((n) => n.degree));
    connected.forEach((n, i) => {
      const angle = (i / Math.max(1, connected.length)) * Math.PI * 2;
      // Higher degree → closer to centre.
      const radius = 70 + (1 - n.degree / maxDeg) * 150;
      out.push({ ...n, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    });
    orphans.forEach((n, i) => {
      const angle = (i / Math.max(1, orphans.length)) * Math.PI * 2 + 0.3;
      out.push({ ...n, x: cx + Math.cos(angle) * 235, y: cy + Math.sin(angle) * 235 });
    });
    return out;
  }, [graph]);

  const posById = useMemo(() => {
    const m = new Map<string, Placed>();
    for (const p of placed) m.set(p.id, p);
    return m;
  }, [placed]);

  const neighbours = useMemo(() => {
    const m = new Set<string>();
    if (focus && graph) {
      for (const e of graph.edges) {
        if (e.from === focus) m.add(e.to);
        if (e.to === focus) m.add(e.from);
      }
    }
    return m;
  }, [focus, graph]);

  const focusNode = focus ? posById.get(focus) : null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-white/80 inline-flex items-center gap-1.5">
          <Network className="w-4 h-4 text-violet-300" /> Knowledge graph
          {graph && (
            <span className="text-white/40 font-normal">
              · {graph.nodeCount} notes · {graph.edgeCount} links · {graph.orphanCount} orphan{graph.orphanCount === 1 ? '' : 's'}
            </span>
          )}
        </h3>
        <button
          onClick={refresh}
          className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-white/60 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Building graph…
        </div>
      ) : !graph || graph.nodeCount === 0 ? (
        <div className="rounded-lg border border-white/10 bg-black/40 p-8 text-center text-white/50 text-sm">
          No data yet. Create notes and link them to see the knowledge graph.
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-black/60 overflow-hidden">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.08),transparent_70%)]"
            role="img"
            aria-label="Knowledge graph of notes and their links"
          >
            {/* Edges */}
            {graph.edges.map((e) => {
              const a = posById.get(e.from);
              const b = posById.get(e.to);
              if (!a || !b) return null;
              const active = !focus || e.from === focus || e.to === focus;
              return (
                <line
                  key={e.id}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={e.kind === 'manual' ? '#22d3ee' : '#a78bfa'}
                  strokeWidth={active ? 1.6 : 0.6}
                  strokeOpacity={active ? 0.6 : 0.12}
                  strokeDasharray={e.kind === 'wiki' ? '3 3' : undefined}
                />
              );
            })}
            {/* Nodes */}
            {placed.map((n) => {
              const r = 6 + Math.min(16, n.degree * 2.4);
              const isFocus = focus === n.id;
              const isNeighbour = neighbours.has(n.id);
              const dim = !!focus && !isFocus && !isNeighbour;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  className="cursor-pointer"
                  onClick={() => setFocus(isFocus ? null : n.id)}
                >
                  <circle
                    r={r}
                    fill={n.degree === 0 ? '#475569' : isFocus ? '#c4b5fd' : '#8b5cf6'}
                    fillOpacity={dim ? 0.2 : 0.9}
                    stroke={isFocus ? '#ede9fe' : '#1e1b4b'}
                    strokeWidth={isFocus ? 2 : 1}
                  />
                  <text
                    y={r + 11}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#e2e8f0"
                    fillOpacity={dim ? 0.25 : 0.9}
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.label.length > 22 ? `${n.label.slice(0, 22)}…` : n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Focus inspector */}
      {focusNode && (
        <div className="rounded-lg border border-violet-500/30 bg-black/70 p-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-violet-200 truncate">{focusNode.label}</p>
            <p className="text-[11px] text-white/50">
              {focusNode.degree} connection{focusNode.degree === 1 ? '' : 's'}
              {focusNode.tags.length > 0 && ` · ${focusNode.tags.join(', ')}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onOpenNote && (
              <button
                onClick={() => onOpenNote(focusNode.id)}
                className="px-2.5 py-1 text-[11px] bg-violet-600 hover:bg-violet-500 rounded text-white"
              >
                Open note
              </button>
            )}
            <button onClick={() => setFocus(null)} className="text-white/40 hover:text-white" aria-label="Clear focus">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-white/40">
        Solid cyan edges are manual links; dashed violet edges are <code className="text-violet-300">[[wiki-links]]</code>.
        Larger nodes have more connections. Click a node to focus its neighbourhood.
      </p>
    </section>
  );
}
