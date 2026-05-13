'use client';

import React, { useState, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeType = 'Component' | 'Material' | 'Structure' | 'Infrastructure' | 'Policy';

interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  creator: string;
  citations: number;
  validationStatus: 'verified' | 'pending' | 'failed';
  royaltyCC: number;
  description: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
  weight: number;
}

interface LayoutPosition {
  x: number;
  y: number;
}

// ── Seed Data ──────────────────────────────────────────────────────────────────

const NODES: GraphNode[] = [
  { id: 'n1', name: 'USB-A Beam 6m', type: 'Component', creator: 'eng.martinez', citations: 3204, validationStatus: 'verified', royaltyCC: 320, description: 'Primary structural beam, USB-A profile, 6-meter span.' },
  { id: 'n2', name: 'USB-A Material', type: 'Material', creator: 'mat.johnson', citations: 890, validationStatus: 'verified', royaltyCC: 89, description: 'Composite USB-A material specification and properties.' },
  { id: 'n3', name: 'Seismic Foundation Class 7', type: 'Component', creator: 'eng.tanaka', citations: 412, validationStatus: 'verified', royaltyCC: 41, description: 'Foundation system rated for Class 7 seismic zones.' },
  { id: 'n4', name: 'Steel Column WF', type: 'Component', creator: 'eng.martinez', citations: 287, validationStatus: 'pending', royaltyCC: 29, description: 'Wide-flange steel column, standard connection points.' },
  { id: 'n5', name: 'Riverside Library', type: 'Structure', creator: 'arch.wong', citations: 156, validationStatus: 'verified', royaltyCC: 78, description: 'Public library structure using USB-A beam system.' },
  { id: 'n6', name: 'Main St Bridge', type: 'Infrastructure', creator: 'eng.chen', citations: 203, validationStatus: 'verified', royaltyCC: 101, description: 'Pedestrian bridge spanning Main Street, 24m.' },
  { id: 'n7', name: 'District 7 Tower', type: 'Structure', creator: 'arch.patel', citations: 98, validationStatus: 'pending', royaltyCC: 49, description: 'Mixed-use tower in District 7, 12 stories.' },
  { id: 'n8', name: 'USB-A Beam 8m Fork', type: 'Component', creator: 'eng.chen', citations: 64, validationStatus: 'verified', royaltyCC: 32, description: 'Extended 8m variant forked from USB-A Beam 6m.' },
  { id: 'n9', name: 'Building Code IBC-2024', type: 'Policy', creator: 'gov.standards', citations: 1420, validationStatus: 'verified', royaltyCC: 71, description: 'International Building Code 2024 compliance reference.' },
  { id: 'n10', name: 'Bridge Quest', type: 'Infrastructure', creator: 'quest.master', citations: 37, validationStatus: 'failed', royaltyCC: 37, description: 'Community quest: Design a bridge for the Northern Pass.' },
];

const EDGES: GraphEdge[] = [
  { from: 'n2', to: 'n1', label: 'material-of', weight: 3 },
  { from: 'n1', to: 'n5', label: 'used-in', weight: 2 },
  { from: 'n1', to: 'n6', label: 'used-in', weight: 2 },
  { from: 'n1', to: 'n7', label: 'used-in', weight: 1 },
  { from: 'n3', to: 'n5', label: 'foundation-for', weight: 2 },
  { from: 'n3', to: 'n7', label: 'foundation-for', weight: 2 },
  { from: 'n4', to: 'n5', label: 'column-for', weight: 1 },
  { from: 'n4', to: 'n6', label: 'column-for', weight: 1 },
  { from: 'n1', to: 'n8', label: 'forked-to', weight: 2 },
  { from: 'n9', to: 'n1', label: 'governs', weight: 1 },
  { from: 'n9', to: 'n3', label: 'governs', weight: 1 },
  { from: 'n6', to: 'n10', label: 'quest-target', weight: 1 },
];

// ── Layouts ────────────────────────────────────────────────────────────────────

function radialLayout(): Record<string, LayoutPosition> {
  const cx = 300, cy = 200;
  const rings: Record<string, { r: number; nodes: string[] }> = {
    center: { r: 0, nodes: ['n1'] },
    ring1: { r: 110, nodes: ['n2', 'n3', 'n4'] },
    ring2: { r: 190, nodes: ['n5', 'n6', 'n7'] },
    ring3: { r: 260, nodes: ['n8', 'n9', 'n10'] },
  };
  const pos: Record<string, LayoutPosition> = {};
  Object.values(rings).forEach(({ r, nodes }) => {
    nodes.forEach((id, i) => {
      if (r === 0) { pos[id] = { x: cx, y: cy }; return; }
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      pos[id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  });
  return pos;
}

function hierarchicalLayout(): Record<string, LayoutPosition> {
  const layers: string[][] = [
    ['n9'],
    ['n2', 'n3', 'n4'],
    ['n1'],
    ['n5', 'n6', 'n7', 'n8'],
    ['n10'],
  ];
  const pos: Record<string, LayoutPosition> = {};
  layers.forEach((layer, li) => {
    const y = 40 + li * 80;
    const spacing = 600 / (layer.length + 1);
    layer.forEach((id, ni) => {
      pos[id] = { x: spacing * (ni + 1), y };
    });
  });
  return pos;
}

function forceDirectedLayout(): Record<string, LayoutPosition> {
  // Pseudo force-directed: manually tuned positions that look organic
  return {
    n1: { x: 300, y: 190 },
    n2: { x: 140, y: 130 },
    n3: { x: 440, y: 100 },
    n4: { x: 160, y: 280 },
    n5: { x: 460, y: 240 },
    n6: { x: 320, y: 340 },
    n7: { x: 510, y: 150 },
    n8: { x: 120, y: 50 },
    n9: { x: 80, y: 200 },
    n10: { x: 440, y: 360 },
  };
}

const LAYOUTS: Record<string, () => Record<string, LayoutPosition>> = {
  radial: radialLayout,
  hierarchical: hierarchicalLayout,
  'force-directed': forceDirectedLayout,
};

// ── Color maps ─────────────────────────────────────────────────────────────────

const typeColor: Record<NodeType, string> = {
  Component: '#60a5fa',
  Material: '#4ade80',
  Structure: '#fb923c',
  Infrastructure: '#c084fc',
  Policy: '#f87171',
};

const typeBg: Record<NodeType, string> = {
  Component: 'bg-blue-500/20 text-blue-300',
  Material: 'bg-green-500/20 text-green-300',
  Structure: 'bg-orange-500/20 text-orange-300',
  Infrastructure: 'bg-purple-500/20 text-purple-300',
  Policy: 'bg-red-500/20 text-red-300',
};

const validationBadge: Record<string, string> = {
  verified: 'bg-green-500/20 text-green-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  failed: 'bg-red-500/20 text-red-400',
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function DependencyGraphViewer() {
  const [layoutName, setLayoutName] = useState<string>('radial');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showRoyaltyFlow, setShowRoyaltyFlow] = useState(false);
  const [minCitations, setMinCitations] = useState(0);
  const [typeFilters, setTypeFilters] = useState<Record<NodeType, boolean>>({
    Component: true,
    Material: true,
    Structure: true,
    Infrastructure: true,
    Policy: true,
  });

  // Dragging state for pan
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const positions = useMemo(() => LAYOUTS[layoutName](), [layoutName]);

  const filteredNodeIds = useMemo(() => {
    return new Set(
      NODES.filter(
        (n) =>
          typeFilters[n.type] &&
          n.citations >= minCitations &&
          (searchQuery === '' || n.name.toLowerCase().includes(searchQuery.toLowerCase()))
      ).map((n) => n.id)
    );
  }, [typeFilters, minCitations, searchQuery]);

  const filteredEdges = useMemo(
    () => EDGES.filter((e) => filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to)),
    [filteredNodeIds]
  );

  const nodeRadius = (citations: number) => {
    const min = 20, max = 50;
    const maxCite = 3204;
    return min + ((citations / maxCite) * (max - min));
  };

  const nodeMap = useMemo(() => {
    const m: Record<string, GraphNode> = {};
    NODES.forEach((n) => (m[n.id] = n));
    return m;
  }, []);

  const selectedNodeData = selectedNode ? nodeMap[selectedNode] : null;
  const hoveredNodeData = hoveredNode ? nodeMap[hoveredNode] : null;

  const totalRoyalty = NODES.reduce((s, n) => s + n.royaltyCC, 0);
  const creators = new Set(NODES.map((n) => n.creator));

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

  const toggleType = (t: NodeType) => {
    setTypeFilters((prev) => ({ ...prev, [t]: !prev[t] }));
  };

  const handleExport = () => {
    const data = { nodes: NODES, edges: EDGES, layout: positions };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dependency-graph.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Keyframe animation style for royalty flow dots
  const royaltyAnimStyle = `
    @keyframes flowDot {
      0% { offset-distance: 0%; opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { offset-distance: 100%; opacity: 0; }
    }
  `;

  return (
    <div className="w-full max-w-7xl mx-auto p-4 font-mono text-sm text-white/90">
      {showRoyaltyFlow && <style>{royaltyAnimStyle}</style>}

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

          {/* Type filters */}
          <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-4">
            <label className="block text-xs text-white/40 uppercase tracking-wider mb-2">
              Node Types
            </label>
            <div className="space-y-2">
              {(Object.keys(typeFilters) as NodeType[]).map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={typeFilters[t]}
                    onChange={() => toggleType(t)}
                    className="rounded border-white/20 bg-black/40 text-blue-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: typeColor[t] }}
                  />
                  <span className="text-xs text-white/60 group-hover:text-white/80">{t}</span>
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
              max={1000}
              step={10}
              value={minCitations}
              onChange={(e) => setMinCitations(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Royalty toggle */}
          <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showRoyaltyFlow}
                onChange={() => setShowRoyaltyFlow(!showRoyaltyFlow)}
                className="rounded border-white/20 bg-black/40 text-blue-500 focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-xs text-white/60">Royalty Flow</span>
            </label>
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
            {Object.keys(LAYOUTS).map((l) => (
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
                  if (!from || !to) return null;
                  const r = nodeRadius(nodeMap[edge.to].citations);
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  const nx = dx / dist;
                  const ny = dy / dist;
                  const tx = to.x - nx * r;
                  const ty = to.y - ny * r;

                  return (
                    <g key={`edge-${i}`}>
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={tx}
                        y2={ty}
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth={edge.weight}
                        markerEnd="url(#arrowhead)"
                      />
                      {showRoyaltyFlow && (
                        <>
                          <circle r="3" fill="#60a5fa" opacity="0.8">
                            <animateMotion
                              dur={`${2 + i * 0.3}s`}
                              repeatCount="indefinite"
                              path={`M${from.x},${from.y} L${tx},${ty}`}
                            />
                          </circle>
                          <circle r="2" fill="#818cf8" opacity="0.6">
                            <animateMotion
                              dur={`${2 + i * 0.3}s`}
                              repeatCount="indefinite"
                              begin={`${1 + i * 0.15}s`}
                              path={`M${from.x},${from.y} L${tx},${ty}`}
                            />
                          </circle>
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Nodes */}
                {NODES.filter((n) => filteredNodeIds.has(n.id)).map((node) => {
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
                        fill={typeColor[node.type]}
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
                  Type: <span className="text-white/70">{hoveredNodeData.type}</span>
                </div>
                <div className="text-white/50">
                  Creator: <span className="text-white/70">{hoveredNodeData.creator}</span>
                </div>
                <div className="text-white/50">
                  Citations: <span className="text-white/70">{hoveredNodeData.citations}</span>
                </div>
                <div className="text-white/50">
                  Status:{' '}
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                      validationBadge[hoveredNodeData.validationStatus]
                    }`}
                  >
                    {hoveredNodeData.validationStatus}
                  </span>
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
              <span className="text-yellow-400 font-medium">{totalRoyalty} CC</span> total royalty
              flow
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
                  typeBg[selectedNodeData.type]
                }`}
              >
                {selectedNodeData.type}
              </span>

              <p className="text-xs text-white/50 leading-relaxed">
                {selectedNodeData.description}
              </p>

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
                  <span className="text-white/40">Royalty</span>
                  <span className="text-yellow-400">{selectedNodeData.royaltyCC} CC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Validation</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      validationBadge[selectedNodeData.validationStatus]
                    }`}
                  >
                    {selectedNodeData.validationStatus}
                  </span>
                </div>
              </div>

              {/* Connected edges */}
              <div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">
                  Connections
                </div>
                <div className="space-y-1">
                  {EDGES.filter(
                    (e) => e.from === selectedNodeData.id || e.to === selectedNodeData.id
                  ).map((e, i) => {
                    const otherId =
                      e.from === selectedNodeData.id ? e.to : e.from;
                    const other = nodeMap[otherId];
                    const direction =
                      e.from === selectedNodeData.id ? '->' : '<-';
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 text-[11px] text-white/50"
                      >
                        <span className="text-white/20">{direction}</span>
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: typeColor[other.type] }}
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
