'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Network, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface GraphNode {
  id: string;
  title: string;
  tags: string[];
  degree: number;
  updatedAt: string;
}
interface GraphEdge {
  source: string;
  target: string;
  sourceTitle: string;
  targetTitle: string;
}
interface GraphStats {
  noteCount: number;
  linkCount: number;
  orphanCount: number;
}

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

/**
 * NoteGraphView — Obsidian-style force-laid backlink graph.
 * Renders the [[wikilink]] network from research.note-graph. No fake data:
 * every node/edge comes from the user's real notes.
 */
export function NoteGraphView({ onOpenNote }: { onOpenNote: (id: string) => void }) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 560, h: 420 });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats }>(
        'research',
        'note-graph',
        {},
      );
      if (r.data?.ok && r.data.result) {
        setNodes(r.data.result.nodes || []);
        setEdges(r.data.result.edges || []);
        setStats(r.data.result.stats || null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 560, h: 420 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Deterministic force-directed layout (seeded by node id, run synchronously).
  const positioned = useMemo<PositionedNode[]>(() => {
    if (nodes.length === 0) return [];
    const { w, h } = size;
    const cx = w / 2;
    const cy = h / 2;
    // Seed each node on a circle, deterministic from index.
    const pos = nodes.map((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2;
      const r = Math.min(w, h) * 0.32;
      return { ...n, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });
    const idx = new Map(pos.map((p, i) => [p.id, i]));
    // Simple spring relaxation.
    for (let iter = 0; iter < 90; iter++) {
      const fx = new Array(pos.length).fill(0);
      const fy = new Array(pos.length).fill(0);
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          let dx = pos[i].x - pos[j].x;
          let dy = pos[i].y - pos[j].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            d2 = 1;
            dx = 0.5;
            dy = 0.5;
          }
          const rep = 1800 / d2;
          const d = Math.sqrt(d2);
          fx[i] += (dx / d) * rep;
          fy[i] += (dy / d) * rep;
          fx[j] -= (dx / d) * rep;
          fy[j] -= (dy / d) * rep;
        }
      }
      for (const e of edges) {
        const a = idx.get(e.source);
        const b = idx.get(e.target);
        if (a == null || b == null) continue;
        const dx = pos[b].x - pos[a].x;
        const dy = pos[b].y - pos[a].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const attr = (d - 90) * 0.02;
        fx[a] += (dx / d) * attr;
        fy[a] += (dy / d) * attr;
        fx[b] -= (dx / d) * attr;
        fy[b] -= (dy / d) * attr;
      }
      for (let i = 0; i < pos.length; i++) {
        pos[i].x = Math.max(24, Math.min(w - 24, pos[i].x + fx[i] * 0.85));
        pos[i].y = Math.max(24, Math.min(h - 24, pos[i].y + fy[i] * 0.85));
      }
    }
    return pos;
  }, [nodes, edges, size]);

  const posById = useMemo(() => new Map(positioned.map((p) => [p.id, p])), [positioned]);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-fuchsia-400" />
          <span className="text-sm font-semibold text-gray-200">Knowledge graph</span>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-xs text-gray-400 hover:text-gray-200"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {stats && (
        <div className="flex gap-3 text-[11px] text-gray-400">
          <span>{stats.noteCount} notes</span>
          <span className="text-fuchsia-300">{stats.linkCount} links</span>
          <span className="text-amber-300">{stats.orphanCount} orphans</span>
        </div>
      )}

      <div
        ref={wrapRef}
        className="relative rounded-lg border border-white/10 bg-black/30 overflow-hidden"
        style={{ height: 420 }}
      >
        {loading ? (
          <div className="absolute inset-0 grid place-items-center text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-xs text-gray-400 text-center px-6">
            No notes yet. Create notes with [[wikilinks]] to build a graph.
          </div>
        ) : (
          <svg width={size.w} height={420} className="block">
            {edges.map((e, i) => {
              const a = posById.get(e.source);
              const b = posById.get(e.target);
              if (!a || !b) return null;
              const active = hovered === e.source || hovered === e.target;
              return (
                <line
                  key={`${e.source}-${e.target}-${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? '#e879f9' : '#3f3f46'}
                  strokeWidth={active ? 1.6 : 0.8}
                />
              );
            })}
            {positioned.map((n) => {
              const r = 5 + Math.min(14, n.degree * 2.4);
              const active = hovered === n.id;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onOpenNote(n.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    r={r}
                    fill={n.degree === 0 ? '#52525b' : active ? '#e879f9' : '#a855f7'}
                    stroke={active ? '#fae8ff' : 'transparent'}
                    strokeWidth={1.5}
                  />
                  {(active || n.degree >= 2) && (
                    <text
                      y={-r - 5}
                      textAnchor="middle"
                      fontSize={10}
                      fill={active ? '#fae8ff' : '#a1a1aa'}
                    >
                      {n.title.length > 22 ? `${n.title.slice(0, 22)}…` : n.title}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="text-[10px] text-gray-400">
        Node size scales with link count. Click a node to open the note.
      </p>
    </div>
  );
}

export default NoteGraphView;
