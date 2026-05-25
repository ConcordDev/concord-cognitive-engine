'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenomeDTU {
  id: string;
  title: string;
  tier: 'simple' | 'regular' | 'mega' | 'hyper';
  domain: string;
  parentIds: string[];
  childIds: string[];
}

export interface KnowledgeGenomeBrowserProps {
  dtus?: GenomeDTU[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_DTUS: GenomeDTU[] = [
  { id: 'd1', title: 'Set Theory Basics', tier: 'simple', domain: 'math', parentIds: [], childIds: ['d4'] },
  { id: 'd2', title: 'Propositional Logic', tier: 'simple', domain: 'math', parentIds: [], childIds: ['d4', 'd5'] },
  { id: 'd3', title: 'Wave Mechanics', tier: 'simple', domain: 'science', parentIds: [], childIds: ['d6'] },
  { id: 'd7', title: 'Ethical Axioms', tier: 'simple', domain: 'philosophy', parentIds: [], childIds: ['d8'] },
  { id: 'd10', title: 'Color Theory', tier: 'simple', domain: 'art', parentIds: [], childIds: ['d11'] },
  { id: 'd4', title: 'Group Theory', tier: 'regular', domain: 'math', parentIds: ['d1', 'd2'], childIds: ['d9'] },
  { id: 'd5', title: 'Formal Proof Systems', tier: 'regular', domain: 'math', parentIds: ['d2'], childIds: ['d9'] },
  { id: 'd6', title: 'Quantum States', tier: 'regular', domain: 'science', parentIds: ['d3'], childIds: ['d12'] },
  { id: 'd8', title: 'Moral Frameworks', tier: 'regular', domain: 'philosophy', parentIds: ['d7'], childIds: ['d13'] },
  { id: 'd11', title: 'Generative Art', tier: 'regular', domain: 'art', parentIds: ['d10'], childIds: ['d13'] },
  { id: 'd9', title: 'Abstract Algebra', tier: 'mega', domain: 'math', parentIds: ['d4', 'd5'], childIds: ['d14'] },
  { id: 'd12', title: 'Quantum Computing', tier: 'mega', domain: 'science', parentIds: ['d6'], childIds: ['d14'] },
  { id: 'd13', title: 'AI Ethics & Aesthetics', tier: 'mega', domain: 'philosophy', parentIds: ['d8', 'd11'], childIds: ['d14'] },
  { id: 'd14', title: 'Unified Cognition Framework', tier: 'hyper', domain: 'technology', parentIds: ['d9', 'd12', 'd13'], childIds: [] },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_ORDER: Record<string, number> = { simple: 0, regular: 1, mega: 2, hyper: 3 };
const TIER_SIZE: Record<string, number> = { simple: 10, regular: 16, mega: 24, hyper: 34 };
const TIER_LABEL: Record<string, string> = { simple: 'Simple', regular: 'Regular', mega: 'Mega', hyper: 'Hyper' };

const DOMAIN_COLORS: Record<string, string> = {
  math: '#22d3ee',
  science: '#22c55e',
  philosophy: '#a855f7',
  engineering: '#f59e0b',
  art: '#ec4899',
  music: '#8b5cf6',
  history: '#f97316',
  language: '#06b6d4',
  economics: '#eab308',
  law: '#6366f1',
  medicine: '#10b981',
  technology: '#3b82f6',
  default: '#6b7280',
};

function getDomainColor(domain: string): string {
  const key = domain.toLowerCase();
  return DOMAIN_COLORS[key] || DOMAIN_COLORS.default;
}

// ---------------------------------------------------------------------------
// Layout algorithm: position DTUs left-to-right by tier, vertically by domain
// ---------------------------------------------------------------------------

interface LayoutItem {
  dtu: GenomeDTU;
  x: number;
  y: number;
  radius: number;
  color: string;
}

function layoutDTUs(dtus: GenomeDTU[]): { items: LayoutItem[]; width: number; height: number } {
  if (dtus.length === 0) return { items: [], width: 800, height: 400 };

  // Group by tier
  const tierBuckets: Record<string, GenomeDTU[]> = { simple: [], regular: [], mega: [], hyper: [] };
  for (const d of dtus) {
    const tier = d.tier in TIER_ORDER ? d.tier : 'regular';
    tierBuckets[tier].push(d);
  }

  // Sort each bucket by domain for visual coherence
  for (const bucket of Object.values(tierBuckets)) {
    bucket.sort((a, b) => a.domain.localeCompare(b.domain));
  }

  const COLUMN_GAP = 220;
  const PADDING = 60;
  const items: LayoutItem[] = [];

  const tiers = ['simple', 'regular', 'mega', 'hyper'];
  let maxY = 0;

  for (let col = 0; col < tiers.length; col++) {
    const tier = tiers[col];
    const bucket = tierBuckets[tier];
    const radius = TIER_SIZE[tier];
    const x = PADDING + col * COLUMN_GAP + COLUMN_GAP / 2;
    const spacing = radius * 2.8;

    const startY = PADDING + 40;

    bucket.forEach((dtu, i) => {
      const y = startY + i * spacing;
      if (y + radius > maxY) maxY = y + radius;
      items.push({
        dtu,
        x,
        y,
        radius,
        color: getDomainColor(dtu.domain),
      });
    });
  }

  return {
    items,
    width: PADDING * 2 + tiers.length * COLUMN_GAP,
    height: Math.max(maxY + PADDING, 400),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgeGenomeBrowser({ dtus: dtusProp, className }: KnowledgeGenomeBrowserProps) {
  const dtus = dtusProp && dtusProp.length > 0 ? dtusProp : DEMO_DTUS;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 500 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredItem, setHoveredItem] = useState<LayoutItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<LayoutItem | null>(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const { items, width: layoutWidth, height: layoutHeight } = useMemo(() => layoutDTUs(dtus), [dtus]);
  const itemMap = useMemo(() => new Map(items.map(it => [it.dtu.id, it])), [items]);

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

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Column labels
    const tiers = ['simple', 'regular', 'mega', 'hyper'];
    const COLUMN_GAP = 220;
    const PADDING = 60;
    tiers.forEach((tier, col) => {
      const x = PADDING + col * COLUMN_GAP + COLUMN_GAP / 2;
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'center';
      ctx.fillText(TIER_LABEL[tier].toUpperCase(), x, 30);
      // Column divider
      ctx.beginPath();
      ctx.moveTo(PADDING + col * COLUMN_GAP, 40);
      ctx.lineTo(PADDING + col * COLUMN_GAP, layoutHeight);
      ctx.strokeStyle = '#1f293720';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // --- Draw lineage connections ---
    for (const item of items) {
      for (const childId of item.dtu.childIds) {
        const child = itemMap.get(childId);
        if (!child) continue;

        const grad = ctx.createLinearGradient(item.x, item.y, child.x, child.y);
        grad.addColorStop(0, item.color + '50');
        grad.addColorStop(1, child.color + '50');

        ctx.beginPath();
        const cx1 = item.x + (child.x - item.x) * 0.5;
        const cy1 = item.y;
        const cx2 = item.x + (child.x - item.x) * 0.5;
        const cy2 = child.y;
        ctx.moveTo(item.x + item.radius, item.y);
        ctx.bezierCurveTo(cx1, cy1, cx2, cy2, child.x - child.radius, child.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arrowhead
        const angle = Math.atan2(child.y - cy2, child.x - child.radius - cx2);
        const ax = child.x - child.radius - 2;
        const ay = child.y;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 6 * Math.cos(angle - 0.4), ay - 6 * Math.sin(angle - 0.4));
        ctx.lineTo(ax - 6 * Math.cos(angle + 0.4), ay - 6 * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = child.color + '80';
        ctx.fill();
      }
    }

    // Highlight connections for selected item
    const highlightIds = new Set<string>();
    if (selectedItem) {
      highlightIds.add(selectedItem.dtu.id);
      for (const pid of selectedItem.dtu.parentIds) highlightIds.add(pid);
      for (const cid of selectedItem.dtu.childIds) highlightIds.add(cid);
    }

    // --- Draw nodes ---
    for (const item of items) {
      const isHighlighted = highlightIds.size === 0 || highlightIds.has(item.dtu.id);
      const isHovered = hoveredItem?.dtu.id === item.dtu.id;
      const isSelected = selectedItem?.dtu.id === item.dtu.id;
      const alpha = isHighlighted ? 1 : 0.15;

      // Glow
      if (isSelected || isHovered) {
        const glow = ctx.createRadialGradient(item.x, item.y, item.radius * 0.5, item.x, item.y, item.radius * 2.5);
        glow.addColorStop(0, item.color + '40');
        glow.addColorStop(1, item.color + '00');
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.radius * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Circle
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(item.x - item.radius * 0.3, item.y - item.radius * 0.3, 0, item.x, item.y, item.radius);
      grad.addColorStop(0, item.color + 'dd');
      grad.addColorStop(1, item.color + '80');
      ctx.fillStyle = grad;
      ctx.fill();

      // Border
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected ? '#facc15' : item.color;
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.stroke();

      // Label for larger nodes
      if (item.radius >= 16) {
        ctx.font = `bold ${Math.max(8, item.radius * 0.45)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = item.dtu.title.length > 8 ? item.dtu.title.slice(0, 7) + '..' : item.dtu.title;
        ctx.fillText(label, item.x, item.y);
      }

      // Domain tag below node
      ctx.font = '8px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'center';
      ctx.fillText(item.dtu.domain, item.x, item.y + item.radius + 10);

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [canvasSize, items, itemMap, zoom, pan, hoveredItem, selectedItem, layoutWidth, layoutHeight]);

  // Hit detection helper
  const getItemAt = useCallback((mx: number, my: number): LayoutItem | null => {
    const x = (mx - pan.x) / zoom;
    const y = (my - pan.y) / zoom;
    // Check in reverse for top-most first
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (Math.hypot(it.x - x, it.y - y) <= it.radius + 4) return it;
    }
    return null;
  }, [items, pan, zoom]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const item = getItemAt(mx, my);
    setHoveredItem(item);
    if (canvasRef.current) canvasRef.current.style.cursor = item ? 'pointer' : 'grab';
  }, [getItemAt]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const item = getItemAt(mx, my);
    if (item) {
      setSelectedItem(prev => prev?.dtu.id === item.dtu.id ? null : item);
    } else {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    }
  }, [getItemAt]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = hoveredItem ? 'pointer' : 'grab';
  }, [hoveredItem]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.2, Math.min(4, zoom * factor));

    // Zoom toward cursor
    const dx = mx - pan.x;
    const dy = my - pan.y;
    setPan({
      x: mx - dx * (newZoom / zoom),
      y: my - dy * (newZoom / zoom),
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  // Domain summary — must be declared before any conditional early
  // return so the hook order stays stable across renders.
  const domainCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of dtus) {
      counts[d.domain] = (counts[d.domain] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [dtus]);

  if (dtus.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-64 text-gray-400 text-sm bg-lattice-surface border border-lattice-border rounded-xl', className)}>
        No DTU lineage data available
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
          <h3 className="text-sm font-semibold text-white">Knowledge Genome Browser</h3>
          <span className="text-xs text-gray-400">{dtus.length} DTUs</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <button onClick={() => setZoom(z => Math.min(4, z * 1.2))} className="px-2 py-0.5 rounded bg-lattice-elevated border border-lattice-border hover:border-white/20 text-gray-400 hover:text-white transition-colors">+</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.2, z / 1.2))} className="px-2 py-0.5 rounded bg-lattice-elevated border border-lattice-border hover:border-white/20 text-gray-400 hover:text-white transition-colors">-</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="px-2 py-0.5 rounded bg-lattice-elevated border border-lattice-border hover:border-white/20 text-gray-400 hover:text-white transition-colors">Reset</button>
        </div>
      </div>

      {/* Domain legend */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-lattice-border/50 overflow-x-auto">
        {domainCounts.map(([domain, count]) => (
          <span key={domain} className="flex items-center gap-1 text-[10px] text-gray-400 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: getDomainColor(domain) }} />
            {domain} ({count})
          </span>
        ))}
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative w-full" style={{ height: 450 }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%' }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />

        {/* Hover tooltip */}
        {hoveredItem && !selectedItem && (
          <div
            className="absolute z-20 pointer-events-none bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 shadow-xl max-w-[200px]"
            style={{ left: hoveredItem.x * zoom + pan.x + 20, top: hoveredItem.y * zoom + pan.y - 10 }}
          >
            <p className="text-xs font-bold text-white truncate">{hoveredItem.dtu.title}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {TIER_LABEL[hoveredItem.dtu.tier]} &middot; {hoveredItem.dtu.domain}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {hoveredItem.dtu.parentIds.length} parents &middot; {hoveredItem.dtu.childIds.length} children
            </p>
          </div>
        )}
      </div>

      {/* Selected detail panel */}
      {selectedItem && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="border-t border-lattice-border px-4 py-3 bg-lattice-deep"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: selectedItem.color }} />
              <p className="text-sm font-bold text-white">{selectedItem.dtu.title}</p>
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                {TIER_LABEL[selectedItem.dtu.tier]}
              </span>
            </div>
            <button onClick={() => setSelectedItem(null)} className="text-xs text-gray-400 hover:text-white">Close</button>
          </div>
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-gray-400">Domain</p>
              <p className="text-white font-medium">{selectedItem.dtu.domain}</p>
            </div>
            <div>
              <p className="text-gray-400">Parents</p>
              <p className="text-white font-medium">{selectedItem.dtu.parentIds.length}</p>
            </div>
            <div>
              <p className="text-gray-400">Children</p>
              <p className="text-white font-medium">{selectedItem.dtu.childIds.length}</p>
            </div>
            <div>
              <p className="text-gray-400">ID</p>
              <p className="text-white font-mono text-[10px] truncate">{selectedItem.dtu.id}</p>
            </div>
          </div>
          {(selectedItem.dtu.parentIds.length > 0 || selectedItem.dtu.childIds.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedItem.dtu.parentIds.map(pid => {
                const parent = itemMap.get(pid);
                return (
                  <button
                    key={pid}
                    onClick={() => parent && setSelectedItem(parent)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                  >
                    parent: {parent?.dtu.title || pid.slice(0, 8)}
                  </button>
                );
              })}
              {selectedItem.dtu.childIds.map(cid => {
                const child = itemMap.get(cid);
                return (
                  <button
                    key={cid}
                    onClick={() => child && setSelectedItem(child)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
                  >
                    child: {child?.dtu.title || cid.slice(0, 8)}
                  </button>
                );
              })}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
