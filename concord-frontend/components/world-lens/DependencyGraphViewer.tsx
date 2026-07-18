'use client';

/**
 * DependencyGraphViewer — DTU citation/dependency graph for the world-lens
 * fabrication toolset.
 *
 * Honesty note (2026-07-18): this component used to render entirely from
 * hardcoded fake data (invented creators, citation counts, royalties, and
 * "Riverside Library"/"Main St Bridge" structures that don't exist). It now
 * fetches a real corpus via `GET /api/dtus/paginated` and projects it into a
 * graph via the real `dtus.citationGraph` macro (`server/domains/dtus.js`) —
 * the same macro `components/dtus/CitationGraph.tsx` uses inside the dtus
 * lens's KnowledgeWorkbench. Node fields are limited to what a real DTU
 * carries: id/title/tier (`ownerId` for creator, `coherence` for a quality
 * estimate per the same convention `app/lenses/dtus/page.tsx` already uses,
 * `summary` for description, and citation in/out-degree computed by the
 * macro from real `parents` links). There is no per-DTU royalty figure
 * cheaply available here, so the old "royalty flow" visualization was
 * dropped rather than kept on fabricated numbers — an honest missing
 * section, not a faked one.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiHelpers, lensRun } from '@/lib/api/client';
import type { DTU, DTUTier } from '@/lib/api/generated-types';
import { Skeleton, EmptyState, ErrorState } from '@/components/ui';
import { Network } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string;
  tier: string;
  creator: string;
  citations: number; // real in-degree within the loaded corpus (dtus.citationGraph)
  quality: number; // 0-100, derived from real DTU.coherence
  description: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

interface LayoutPosition {
  x: number;
  y: number;
}

interface CitationGraphMacroResult {
  nodes: { id: string; label: string; tier: string; inDegree: number; outDegree: number; influence: number; size: number }[];
  edges: { source: string; target: string }[];
  stats?: { nodeCount: number; edgeCount: number; isolated: number; density: number };
}

// ── Layouts (computed from the real fetched graph, not hardcoded ids) ──────────

function radialLayout(nodes: GraphNode[]): Record<string, LayoutPosition> {
  const cx = 300, cy = 200;
  const pos: Record<string, LayoutPosition> = {};
  if (nodes.length === 0) return pos;
  const sorted = [...nodes].sort((a, b) => b.citations - a.citations);
  sorted.forEach((n, i) => {
    if (i === 0) { pos[n.id] = { x: cx, y: cy }; return; }
    const ring = Math.ceil(i / 8);
    const idxInRing = (i - 1) % 8;
    const nodesInThisRing = Math.min(8, sorted.length - 1 - (ring - 1) * 8);
    const radius = 80 * ring;
    const angle = (2 * Math.PI * idxInRing) / Math.max(1, nodesInThisRing) - Math.PI / 2;
    pos[n.id] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  return pos;
}

// Tier order reflects the real consolidation hierarchy: regular DTUs roll up
// into MEGA, MEGA rolls up into HYPER (see CLAUDE.md "DTU substrate").
const TIER_LAYER_ORDER = ['hyper', 'mega', 'regular', 'shadow', 'archive'];

function hierarchicalLayout(nodes: GraphNode[]): Record<string, LayoutPosition> {
  const pos: Record<string, LayoutPosition> = {};
  const byTier = new Map<string, GraphNode[]>();
  nodes.forEach((n) => {
    const list = byTier.get(n.tier) || [];
    list.push(n);
    byTier.set(n.tier, list);
  });
  const layers = TIER_LAYER_ORDER.filter((t) => byTier.has(t));
  layers.forEach((tier, li) => {
    const layerNodes = byTier.get(tier)!;
    const y = 40 + li * 90;
    const spacing = 600 / (layerNodes.length + 1);
    layerNodes.forEach((n, ni) => {
      pos[n.id] = { x: spacing * (ni + 1), y };
    });
  });
  return pos;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** A small real spring/repulsion simulation seeded from the radial layout —
 * genuinely force-directed off the real edges, unlike the previous fixed,
 * hand-picked coordinates for 10 nonexistent nodes. */
function forceDirectedLayout(nodes: GraphNode[], edges: GraphEdge[]): Record<string, LayoutPosition> {
  const pos = radialLayout(nodes);
  const ids = nodes.map((n) => n.id);
  if (ids.length < 2) return pos;
  const REPULSION = 2200;
  const SPRING = 0.02;
  const IDEAL_LEN = 90;
  for (let it = 0; it < 60; it++) {
    const disp: Record<string, LayoutPosition> = {};
    ids.forEach((id) => { disp[id] = { x: 0, y: 0 }; });
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        const dx = a.x - b.x, dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, 0.01);
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        disp[ids[i]].x += fx; disp[ids[i]].y += fy;
        disp[ids[j]].x -= fx; disp[ids[j]].y -= fy;
      }
    }
    edges.forEach((e) => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = SPRING * (dist - IDEAL_LEN);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      disp[e.from].x += fx; disp[e.from].y += fy;
      disp[e.to].x -= fx; disp[e.to].y -= fy;
    });
    ids.forEach((id) => {
      pos[id] = {
        x: clamp(pos[id].x + disp[id].x * 0.05, 30, 570),
        y: clamp(pos[id].y + disp[id].y * 0.05, 30, 370),
      };
    });
  }
  return pos;
}

// ── Color maps (mirrors components/dtus/CitationGraph.tsx's tier palette) ──────

const tierColor: Record<string, string> = {
  regular: '#3b82f6',
  mega: '#a855f7',
  hyper: '#ec4899',
  shadow: '#6b7280',
  archive: '#64748b',
};

const tierBg: Record<string, string> = {
  regular: 'bg-blue-500/20 text-blue-300',
  mega: 'bg-purple-500/20 text-purple-300',
  hyper: 'bg-pink-500/20 text-pink-300',
  shadow: 'bg-gray-500/20 text-gray-300',
  archive: 'bg-slate-500/20 text-slate-300',
};

const ALL_TIERS: DTUTier[] = ['regular', 'mega', 'hyper', 'shadow', 'archive'];

// ── Component ──────────────────────────────────────────────────────────────────

export default function DependencyGraphViewer() {
  const [layoutName, setLayoutName] = useState<string>('radial');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [minCitations, setMinCitations] = useState(0);
  const [tierFilters, setTierFilters] = useState<Record<string, boolean>>({
    regular: true, mega: true, hyper: true, shadow: true, archive: true,
  });

  // Dragging state for pan
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Real data
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listRes = await apiHelpers.dtus.paginated({ limit: 80 });
      const listData = listRes.data as { ok?: boolean; dtus?: DTU[]; items?: DTU[] };
      const corpus = listData?.dtus || listData?.items || [];

      if (corpus.length === 0) {
        setNodes([]);
        setEdges([]);
        setLoading(false);
        return;
      }

      const graphRes = await lensRun<CitationGraphMacroResult>('dtus', 'citationGraph', { dtus: corpus });
      if (!graphRes.data.ok || !graphRes.data.result) {
        setError(graphRes.data.error || 'Citation graph macro returned no result');
        setLoading(false);
        return;
      }

      const corpusById = new Map(corpus.map((d) => [d.id, d]));
      const mergedNodes: GraphNode[] = graphRes.data.result.nodes.map((n) => {
        const src = corpusById.get(n.id);
        return {
          id: n.id,
          name: n.label,
          tier: n.tier || 'regular',
          creator: src?.ownerId || 'unknown',
          citations: n.inDegree,
          quality: src?.coherence !== undefined ? Math.round(src.coherence * 100) : 0,
          description: src?.summary || '',
        };
      });
      const mergedEdges: GraphEdge[] = graphRes.data.result.edges.map((e) => ({
        from: e.source,
        to: e.target,
        label: 'cites',
      }));

      setNodes(mergedNodes);
      setEdges(mergedEdges);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dependency graph');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const positions = useMemo(() => {
    if (layoutName === 'hierarchical') return hierarchicalLayout(nodes);
    if (layoutName === 'force-directed') return forceDirectedLayout(nodes, edges);
    return radialLayout(nodes);
  }, [layoutName, nodes, edges]);

  const maxCitationsBound = useMemo(
    () => Math.max(10, ...nodes.map((n) => n.citations)),
    [nodes]
  );

  const filteredNodeIds = useMemo(() => {
    return new Set(
      nodes
        .filter(
          (n) =>
            tierFilters[n.tier] !== false &&
            n.citations >= minCitations &&
            (searchQuery === '' || n.name.toLowerCase().includes(searchQuery.toLowerCase()))
        )
        .map((n) => n.id)
    );
  }, [nodes, tierFilters, minCitations, searchQuery]);

  const filteredEdges = useMemo(
    () => edges.filter((e) => filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to)),
    [edges, filteredNodeIds]
  );

  const nodeRadius = (citations: number) => {
    const min = 20, max = 50;
    return min + (citations / maxCitationsBound) * (max - min);
  };

  const nodeMap = useMemo(() => {
    const m: Record<string, GraphNode> = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  const selectedNodeData = selectedNode ? nodeMap[selectedNode] : null;
  const hoveredNodeData = hoveredNode ? nodeMap[hoveredNode] : null;

  const creators = useMemo(() => new Set(nodes.map((n) => n.creator)), [nodes]);
  const avgQuality = useMemo(() => {
    if (nodes.length === 0) return 0;
    return Math.round(nodes.reduce((s, n) => s + n.quality, 0) / nodes.length);
  }, [nodes]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'circle') return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const fitToScreen = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const toggleTier = (t: string) => {
    setTierFilters((prev) => ({ ...prev, [t]: !prev[t] }));
  };

  const handleExport = () => {
    const data = { nodes, edges, layout: positions };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dependency-graph.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4 font-mono text-sm">
        <div className="flex gap-4 flex-col lg:flex-row">
          <div className="w-full lg:w-56 shrink-0 space-y-3">
            <Skeleton variant="block" height={80} />
            <Skeleton variant="block" height={140} />
            <Skeleton variant="block" height={70} />
          </div>
          <div className="flex-1 space-y-3">
            <Skeleton variant="block" height={44} />
            <Skeleton variant="block" height={440} />
            <Skeleton variant="block" height={48} />
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <ErrorState message={error} title="Dependency graph unavailable" onRetry={loadGraph} />
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (nodes.length === 0) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <EmptyState
          icon={<Network className="h-5 w-5" />}
          title="No dependency data yet"
          description="No DTUs with citation links were found. Create DTUs that cite one another (components, materials, structures) to see their dependency graph here."
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4 font-mono text-sm text-white/90">
      <div className="flex gap-4 flex-col lg:flex-row">
        {/* ── Left sidebar: Filters ─────────────────────────────────── */}
        <div className="w-full lg:w-56 shrink-0 space-y-3">
          {/* Search */}
          <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-4">
            <label className="block text-xs text-white/40 uppercase tracking-wider mb-2">
              Search Nodes
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name..."
              className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white/90 placeholder-white/20 focus:outline-none focus:border-blue-500/60 text-xs"
            />
          </div>

          {/* Tier filters */}
          <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-4">
            <label className="block text-xs text-white/40 uppercase tracking-wider mb-2">
              DTU Tiers
            </label>
            <div className="space-y-2">
              {ALL_TIERS.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={tierFilters[t] !== false}
                    onChange={() => toggleTier(t)}
                    className="rounded border-white/20 bg-black/40 text-blue-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: tierColor[t] }}
                  />
                  <span className="text-xs text-white/60 group-hover:text-white/80 capitalize">{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Min citations slider */}
          <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-4">
            <label className="block text-xs text-white/40 uppercase tracking-wider mb-2">
              Min Citations: {minCitations}
            </label>
            <input
              type="range"
              min={0}
              max={maxCitationsBound}
              step={1}
              value={minCitations}
              onChange={(e) => setMinCitations(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            className="w-full rounded-xl bg-black/80 backdrop-blur border border-white/10 p-3 text-xs text-white/50 hover:text-white/80 hover:border-white/30 transition-colors text-center"
          >
            Download JSON
          </button>
        </div>

        {/* ── Main area ─────────────────────────────────────────────── */}
        <div className="flex-1 space-y-3">
          {/* Controls bar */}
          <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-white/40 uppercase tracking-wider mr-2">Layout</span>
            {['radial', 'hierarchical', 'force-directed'].map((l) => (
              <button
                key={l}
                onClick={() => setLayoutName(l)}
                className={`text-xs px-3 py-1 rounded-md border transition-colors ${
                  layoutName === l
                    ? 'border-blue-500/60 text-blue-400 bg-blue-500/10'
                    : 'border-white/10 text-white/40 hover:text-white/60'
                }`}
              >
                {l}
              </button>
            ))}

            <div className="flex-1" />

            <button
              onClick={() => setZoom((z) => Math.min(z + 0.15, 2.5))}
              className="w-7 h-7 rounded border border-white/10 text-white/50 hover:text-white/80 flex items-center justify-center text-sm"
            >
              +
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
              className="w-7 h-7 rounded border border-white/10 text-white/50 hover:text-white/80 flex items-center justify-center text-sm"
            >
              -
            </button>
            <button
              onClick={fitToScreen}
              className="text-xs px-3 py-1 rounded border border-white/10 text-white/40 hover:text-white/60 transition-colors"
            >
              Fit
            </button>
          </div>

          {/* SVG Graph */}
          <div
            className="relative rounded-xl bg-black/80 backdrop-blur border border-white/10 overflow-hidden"
            style={{ height: 440 }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 600 400"
              className="cursor-grab active:cursor-grabbing"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="rgba(255,255,255,0.15)" />
                </marker>
              </defs>

              <g transform={`translate(${offset.x},${offset.y}) scale(${zoom})`}>
                {/* Edges */}
                {filteredEdges.map((edge, i) => {
                  const from = positions[edge.from];
                  const to = positions[edge.to];
                  const targetNode = nodeMap[edge.to];
                  if (!from || !to || !targetNode) return null;
                  const r = nodeRadius(targetNode.citations);
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                  const nx = dx / dist;
                  const ny = dy / dist;
                  const tx = to.x - nx * r;
                  const ty = to.y - ny * r;

                  return (
                    <line
                      key={`edge-${i}`}
                      x1={from.x}
                      y1={from.y}
                      x2={tx}
                      y2={ty}
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth={1.5}
                      markerEnd="url(#arrowhead)"
                    />
                  );
                })}

                {/* Nodes */}
                {nodes.filter((n) => filteredNodeIds.has(n.id)).map((node) => {
                  const pos = positions[node.id];
                  if (!pos) return null;
                  const r = nodeRadius(node.citations);
                  const isHighlighted =
                    searchQuery !== '' &&
                    node.name.toLowerCase().includes(searchQuery.toLowerCase());
                  const isSelected = selectedNode === node.id;
                  const isHovered = hoveredNode === node.id;

                  return (
                    <g
                      key={node.id}
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNode(node.id === selectedNode ? null : node.id);
                      }}
                      className="cursor-pointer"
                    >
                      {/* Glow ring for highlighted/selected */}
                      {(isHighlighted || isSelected) && (
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={r + 6}
                          fill="none"
                          stroke={isSelected ? '#facc15' : '#60a5fa'}
                          strokeWidth={2}
                          opacity={0.6}
                        />
                      )}
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={r}
                        fill={tierColor[node.tier] || tierColor.regular}
                        opacity={isHovered ? 0.9 : 0.55}
                        stroke={isHovered ? 'white' : 'transparent'}
                        strokeWidth={1.5}
                      />
                      <text
                        x={pos.x}
                        y={pos.y + r + 14}
                        textAnchor="middle"
                        fontSize="9"
                        fill="rgba(255,255,255,0.6)"
                        className="pointer-events-none select-none"
                      >
                        {node.name.length > 18
                          ? node.name.slice(0, 16) + '...'
                          : node.name}
                      </text>
                      <text
                        x={pos.x}
                        y={pos.y + 4}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="bold"
                        fill="white"
                        className="pointer-events-none select-none"
                      >
                        {node.citations}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Hover tooltip */}
            {hoveredNodeData && positions[hoveredNodeData.id] && (
              <div
                className="absolute z-20 pointer-events-none rounded-lg bg-black/90 backdrop-blur border border-white/10 p-3 text-xs space-y-1 max-w-xs"
                style={{
                  left: Math.min(
                    positions[hoveredNodeData.id].x * zoom + offset.x + 30,
                    450
                  ),
                  top: Math.min(
                    positions[hoveredNodeData.id].y * zoom + offset.y - 10,
                    350
                  ),
                }}
              >
                <div className="font-semibold text-white/90">{hoveredNodeData.name}</div>
                <div className="text-white/50">
                  Tier: <span className="text-white/70 capitalize">{hoveredNodeData.tier}</span>
                </div>
                <div className="text-white/50">
                  Creator: <span className="text-white/70">{hoveredNodeData.creator}</span>
                </div>
                <div className="text-white/50">
                  Citations: <span className="text-white/70">{hoveredNodeData.citations}</span>
                </div>
                <div className="text-white/50">
                  Quality: <span className="text-white/70">{hoveredNodeData.quality}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Stats footer */}
          <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 px-5 py-3 flex items-center gap-4 flex-wrap text-xs text-white/40">
            <span>
              <span className="text-white/70 font-medium">{filteredNodeIds.size}</span> nodes
            </span>
            <span className="text-white/10">|</span>
            <span>
              <span className="text-white/70 font-medium">{filteredEdges.length}</span> edges
            </span>
            <span className="text-white/10">|</span>
            <span>
              <span className="text-white/70 font-medium">{creators.size}</span> creators
            </span>
            <span className="text-white/10">|</span>
            <span>
              <span className="text-green-400 font-medium">{avgQuality}%</span> avg quality
            </span>
          </div>
        </div>

        {/* ── Right panel: selected node ────────────────────────────── */}
        {selectedNodeData && (
          <div className="w-full lg:w-64 shrink-0">
            <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white/90 text-sm leading-tight">
                  {selectedNodeData.name}
                </h3>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-white/30 hover:text-white/60 text-lg leading-none"
                >
                  x
                </button>
              </div>

              <span
                className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                  tierBg[selectedNodeData.tier] || tierBg.regular
                }`}
              >
                {selectedNodeData.tier}
              </span>

              {selectedNodeData.description && (
                <p className="text-xs text-white/50 leading-relaxed">
                  {selectedNodeData.description}
                </p>
              )}

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-white/40">Creator</span>
                  <span className="text-white/70">{selectedNodeData.creator}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Citations</span>
                  <span className="text-white/70">{selectedNodeData.citations}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Quality</span>
                  <span className="text-green-400">{selectedNodeData.quality}%</span>
                </div>
              </div>

              {/* Connected edges */}
              <div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">
                  Connections
                </div>
                <div className="space-y-1">
                  {edges
                    .filter((e) => e.from === selectedNodeData.id || e.to === selectedNodeData.id)
                    .map((e, i) => {
                      const otherId = e.from === selectedNodeData.id ? e.to : e.from;
                      const other = nodeMap[otherId];
                      if (!other) return null;
                      const direction = e.from === selectedNodeData.id ? '->' : '<-';
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 text-[11px] text-white/50"
                        >
                          <span className="text-white/20">{direction}</span>
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: tierColor[other.tier] || tierColor.regular }}
                          />
                          <span className="truncate">{other.name}</span>
                          <span className="text-white/20 ml-auto text-[9px]">{e.label}</span>
                        </div>
                      );
                    })}
                </div>
              </div>

              <button
                onClick={() => { window.dispatchEvent(new CustomEvent('dep-graph:open-dtu', { detail: { nodeId: selectedNode } })); }}
                className="w-full mt-2 px-3 py-2 rounded-lg bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs hover:bg-blue-600/50 transition-colors"
              >
                Open DTU
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
