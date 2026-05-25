'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Citation {
  from: string;
  to: string;
  amount: number;
  timestamp: string;
}

export interface RoyaltyCascadeVizProps {
  citations?: Citation[];
  selectedDtuId?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_CITATIONS: Citation[] = [
  { from: 'dtu-origin-001', to: 'dtu-derive-A', amount: 120, timestamp: new Date(Date.now() - 86400000 * 5).toISOString() },
  { from: 'dtu-origin-001', to: 'dtu-derive-B', amount: 85, timestamp: new Date(Date.now() - 86400000 * 4).toISOString() },
  { from: 'dtu-derive-A', to: 'dtu-child-A1', amount: 45, timestamp: new Date(Date.now() - 86400000 * 3).toISOString() },
  { from: 'dtu-derive-A', to: 'dtu-child-A2', amount: 30, timestamp: new Date(Date.now() - 86400000 * 2.5).toISOString() },
  { from: 'dtu-derive-B', to: 'dtu-child-B1', amount: 60, timestamp: new Date(Date.now() - 86400000 * 2).toISOString() },
  { from: 'dtu-child-A1', to: 'dtu-grand-X', amount: 20, timestamp: new Date(Date.now() - 86400000 * 1.5).toISOString() },
  { from: 'dtu-child-B1', to: 'dtu-grand-X', amount: 35, timestamp: new Date(Date.now() - 86400000 * 1).toISOString() },
  { from: 'dtu-grand-X', to: 'dtu-hyper-Z', amount: 15, timestamp: new Date(Date.now() - 86400000 * 0.5).toISOString() },
  { from: 'dtu-origin-002', to: 'dtu-derive-B', amount: 40, timestamp: new Date(Date.now() - 86400000 * 3.5).toISOString() },
  { from: 'dtu-child-A2', to: 'dtu-grand-Y', amount: 18, timestamp: new Date(Date.now() - 86400000 * 1.2).toISOString() },
];

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  earned: number;
  paid: number;
  label: string;
  depth: number;
}

interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
  amount: number;
}

interface Particle {
  edge: number;
  t: number;
  speed: number;
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
const NEON_CYAN = '#22d3ee';
const NEON_PURPLE = '#a855f7';
const NODE_FILL = '#0d1117';
const NODE_STROKE_SELECTED = '#facc15';
const EDGE_BASE_ALPHA = 0.35;
const PARTICLE_GLOW = 12;
const NODE_RADIUS = 22;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build adjacency & depth using BFS from roots */
function layoutGraph(citations: Citation[]): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodeIds = new Set<string>();
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  const edgeAmounts = new Map<string, number>();

  for (const c of citations) {
    nodeIds.add(c.from);
    nodeIds.add(c.to);
    childrenOf.set(c.from, [...(childrenOf.get(c.from) || []), c.to]);
    parentsOf.set(c.to, [...(parentsOf.get(c.to) || []), c.from]);
    const key = `${c.from}->${c.to}`;
    edgeAmounts.set(key, (edgeAmounts.get(key) || 0) + c.amount);
  }

  // Find roots (no parents)
  const roots = [...nodeIds].filter(id => !parentsOf.has(id) || parentsOf.get(id)!.length === 0);
  if (roots.length === 0 && nodeIds.size > 0) roots.push([...nodeIds][0]);

  // BFS to assign depth
  const depthOf = new Map<string, number>();
  const queue = roots.map(r => ({ id: r, depth: 0 }));
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (depthOf.has(id)) continue;
    depthOf.set(id, depth);
    for (const child of childrenOf.get(id) || []) {
      if (!depthOf.has(child)) queue.push({ id: child, depth: depth + 1 });
    }
  }
  // Assign orphans
  for (const id of nodeIds) {
    if (!depthOf.has(id)) depthOf.set(id, 0);
  }

  const maxDepth = Math.max(...depthOf.values(), 0);
  const depthBuckets = new Map<number, string[]>();
  for (const [id, d] of depthOf) {
    depthBuckets.set(d, [...(depthBuckets.get(d) || []), id]);
  }

  // Compute earned/paid per node
  const earned = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const c of citations) {
    earned.set(c.to, (earned.get(c.to) || 0) + c.amount);
    paid.set(c.from, (paid.get(c.from) || 0) + c.amount);
  }

  // Layout positions: spread nodes in columns by depth
  const HORIZONTAL_GAP = 180;
  const VERTICAL_GAP = 80;
  const nodeMap = new Map<string, LayoutNode>();

  for (let d = 0; d <= maxDepth; d++) {
    const bucket = depthBuckets.get(d) || [];
    const x = 80 + d * HORIZONTAL_GAP;
    const totalHeight = (bucket.length - 1) * VERTICAL_GAP;
    bucket.forEach((id, i) => {
      const y = 80 + i * VERTICAL_GAP - totalHeight / 2 + 200;
      const node: LayoutNode = {
        id,
        x,
        y,
        earned: earned.get(id) || 0,
        paid: paid.get(id) || 0,
        label: id.length > 10 ? id.slice(0, 4) + '..' + id.slice(-4) : id,
        depth: d,
      };
      nodeMap.set(id, node);
    });
  }

  const edges: LayoutEdge[] = [];
  for (const c of citations) {
    const from = nodeMap.get(c.from);
    const to = nodeMap.get(c.to);
    if (from && to) {
      // Deduplicate by summing amounts already done above
      const key = `${c.from}->${c.to}`;
      if (!edges.find(e => e.from.id === c.from && e.to.id === c.to)) {
        edges.push({ from, to, amount: edgeAmounts.get(key) || c.amount });
      }
    }
  }

  return { nodes: [...nodeMap.values()], edges };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RoyaltyCascadeViz({ citations: citationsProp, selectedDtuId, className }: RoyaltyCascadeVizProps) {
  const citations = citationsProp && citationsProp.length > 0 ? citationsProp : DEMO_CITATIONS;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 500 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const { nodes, edges } = useMemo(() => layoutGraph(citations), [citations]);

  // Maximums for thickness scaling
  const maxAmount = useMemo(() => Math.max(...edges.map(e => e.amount), 1), [edges]);

  // Initialize particles
  useEffect(() => {
    const ps: Particle[] = [];
    edges.forEach((_, i) => {
      const count = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < count; j++) {
        ps.push({ edge: i, t: Math.random(), speed: 0.002 + Math.random() * 0.004 });
      }
    });
    particlesRef.current = ps;
  }, [edges]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setCanvasSize({ w: width, h: height });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let running = true;

    const draw = () => {
      if (!running) return;
      ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
      ctx.save();
      ctx.translate(panOffset.x, panOffset.y);

      // --- Draw edges ---
      for (const edge of edges) {
        const thickness = 1.5 + (edge.amount / maxAmount) * 6;
        const grad = ctx.createLinearGradient(edge.from.x, edge.from.y, edge.to.x, edge.to.y);
        grad.addColorStop(0, NEON_PURPLE + '90');
        grad.addColorStop(1, NEON_CYAN + '90');

        ctx.beginPath();
        // Bezier curve for smoother look
        const cx1 = edge.from.x + (edge.to.x - edge.from.x) * 0.4;
        const cy1 = edge.from.y;
        const cx2 = edge.from.x + (edge.to.x - edge.from.x) * 0.6;
        const cy2 = edge.to.y;
        ctx.moveTo(edge.from.x, edge.from.y);
        ctx.bezierCurveTo(cx1, cy1, cx2, cy2, edge.to.x, edge.to.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = thickness;
        ctx.globalAlpha = EDGE_BASE_ALPHA;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Amount label on edge midpoint
        const mx = (edge.from.x + edge.to.x) / 2;
        const my = (edge.from.y + edge.to.y) / 2 - 8;
        ctx.font = '10px monospace';
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'center';
        ctx.fillText(`${edge.amount} CC`, mx, my);
      }

      // --- Draw particles ---
      const particles = particlesRef.current;
      for (const p of particles) {
        const edge = edges[p.edge];
        if (!edge) continue;
        p.t += p.speed;
        if (p.t > 1) p.t -= 1;

        const t = p.t;
        const cx1 = edge.from.x + (edge.to.x - edge.from.x) * 0.4;
        const cy1 = edge.from.y;
        const cx2 = edge.from.x + (edge.to.x - edge.from.x) * 0.6;
        const cy2 = edge.to.y;

        // Cubic bezier point
        const mt = 1 - t;
        const px = mt * mt * mt * edge.from.x + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t * edge.to.x;
        const py = mt * mt * mt * edge.from.y + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * edge.to.y;

        // Glow
        const grd = ctx.createRadialGradient(px, py, 0, px, py, PARTICLE_GLOW);
        grd.addColorStop(0, NEON_CYAN + 'cc');
        grd.addColorStop(1, NEON_CYAN + '00');
        ctx.beginPath();
        ctx.arc(px, py, PARTICLE_GLOW, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      // --- Draw nodes ---
      for (const node of nodes) {
        const isSelected = selectedDtuId === node.id || selectedNode?.id === node.id;
        const isHovered = hoveredNode?.id === node.id;
        const radius = NODE_RADIUS + (isSelected ? 4 : 0) + (isHovered ? 2 : 0);

        // Outer glow for selected
        if (isSelected) {
          const glow = ctx.createRadialGradient(node.x, node.y, radius - 4, node.x, node.y, radius + 16);
          glow.addColorStop(0, NODE_STROKE_SELECTED + '40');
          glow.addColorStop(1, NODE_STROKE_SELECTED + '00');
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 16, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = NODE_FILL;
        ctx.fill();

        // Border — earned vs paid gradient
        const borderGrad = ctx.createLinearGradient(node.x - radius, node.y, node.x + radius, node.y);
        if (node.earned > 0 && node.paid > 0) {
          borderGrad.addColorStop(0, NEON_CYAN);
          borderGrad.addColorStop(1, NEON_PURPLE);
        } else if (node.earned > 0) {
          borderGrad.addColorStop(0, NEON_CYAN);
          borderGrad.addColorStop(1, NEON_CYAN);
        } else {
          borderGrad.addColorStop(0, NEON_PURPLE);
          borderGrad.addColorStop(1, NEON_PURPLE);
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? NODE_STROKE_SELECTED : borderGrad;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();

        // Label
        ctx.font = 'bold 10px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#e5e7eb';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x, node.y);

        // Earned badge
        if (node.earned > 0) {
          const badgeX = node.x + radius * 0.7;
          const badgeY = node.y - radius * 0.7;
          ctx.beginPath();
          ctx.arc(badgeX, badgeY, 10, 0, Math.PI * 2);
          ctx.fillStyle = '#064e3b';
          ctx.fill();
          ctx.strokeStyle = NEON_CYAN;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.font = 'bold 7px monospace';
          ctx.fillStyle = NEON_CYAN;
          ctx.fillText(`+${node.earned}`, badgeX, badgeY);
        }
      }

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [canvasSize, nodes, edges, maxAmount, hoveredNode, selectedNode, selectedDtuId, panOffset]);

  // Mouse interaction
  const getNodeAt = useCallback((mx: number, my: number) => {
    const x = mx - panOffset.x;
    const y = my - panOffset.y;
    return nodes.find(n => Math.hypot(n.x - x, n.y - y) <= NODE_RADIUS + 4) || null;
  }, [nodes, panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const node = getNodeAt(mx, my);
    setHoveredNode(node);
    if (canvasRef.current) canvasRef.current.style.cursor = node ? 'pointer' : 'grab';
  }, [getNodeAt]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = getNodeAt(mx, my);
    if (node) {
      setSelectedNode(node);
    } else {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    }
  }, [getNodeAt]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = hoveredNode ? 'pointer' : 'grab';
  }, [hoveredNode]);

  if (citations.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-64 text-gray-400 text-sm bg-lattice-surface border border-lattice-border rounded-xl', className)}>
        No citation flow data available yet
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('relative bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-neon-cyan animate-pulse" />
          <h3 className="text-sm font-semibold text-white">Royalty Cascade Flow</h3>
          <span className="text-xs text-gray-400">{nodes.length} DTUs &middot; {edges.length} flows</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: NEON_CYAN }} /> Earned</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: NEON_PURPLE }} /> Paid out</span>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative w-full" style={{ height: 420 }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%' }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {/* Tooltip */}
        {hoveredNode && (
          <div
            className="absolute z-20 pointer-events-none bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 shadow-xl"
            style={{ left: hoveredNode.x + panOffset.x + 30, top: hoveredNode.y + panOffset.y - 20 }}
          >
            <p className="text-xs font-bold text-white mb-1 font-mono">{hoveredNode.id}</p>
            <div className="flex gap-3 text-[10px]">
              <span className="text-cyan-400">Earned: {hoveredNode.earned} CC</span>
              <span className="text-purple-400">Paid: {hoveredNode.paid} CC</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">Depth: {hoveredNode.depth}</p>
          </div>
        )}
      </div>

      {/* Selected node detail panel */}
      {selectedNode && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="border-t border-lattice-border px-4 py-3 bg-lattice-deep"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-white font-mono">{selectedNode.id}</p>
            <button onClick={() => setSelectedNode(null)} className="text-xs text-gray-400 hover:text-white">Close</button>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-gray-400 mb-0.5">Earned (incoming)</p>
              <p className="text-lg font-bold text-cyan-400">{selectedNode.earned} CC</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Paid out (outgoing)</p>
              <p className="text-lg font-bold text-purple-400">{selectedNode.paid} CC</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Net royalty</p>
              <p className={cn('text-lg font-bold', selectedNode.earned - selectedNode.paid >= 0 ? 'text-neon-green' : 'text-red-400')}>
                {selectedNode.earned - selectedNode.paid >= 0 ? '+' : ''}{selectedNode.earned - selectedNode.paid} CC
              </p>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-gray-400">
            Citation chain depth: {selectedNode.depth} &middot;
            Connections: {edges.filter(e => e.from.id === selectedNode.id || e.to.id === selectedNode.id).length}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
