'use client';

/**
 * GenomeGraph
 * -----------
 * Canvas-based force-directed visualization of a learner's knowledge genome.
 * - Node color encodes mastery (gray -> yellow -> green)
 * - Nodes marked as gaps are highlighted in red
 * - Click a node to select it (fires onSelect callback with the DTU id)
 * - Light-weight spring/repulsion simulation (no external deps)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface GenomeNode {
  id: string;
  title: string;
  domain?: string;
  mastery?: number; // 0..1
  gap?: boolean;
  tier?: string;
}

export interface GenomeEdge {
  source: string;
  target: string;
}

export interface GenomeGraphProps {
  nodes: GenomeNode[];
  edges?: GenomeEdge[];
  height?: number;
  className?: string;
  onSelect?: (node: GenomeNode) => void;
  selectedId?: string | null;
}

interface SimNode extends GenomeNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function masteryColor(mastery: number, gap: boolean): string {
  if (gap) return '#ef4444'; // red-500
  // gray (0) -> yellow (0.5) -> green (1)
  const m = Math.max(0, Math.min(1, mastery));
  if (m < 0.5) {
    // gray #6b7280 -> yellow #eab308
    const t = m / 0.5;
    const r = Math.round(107 + (234 - 107) * t);
    const g = Math.round(114 + (179 - 114) * t);
    const b = Math.round(128 + (8 - 128) * t);
    return `rgb(${r},${g},${b})`;
  } else {
    // yellow #eab308 -> green #22c55e
    const t = (m - 0.5) / 0.5;
    const r = Math.round(234 + (34 - 234) * t);
    const g = Math.round(179 + (197 - 179) * t);
    const b = Math.round(8 + (94 - 8) * t);
    return `rgb(${r},${g},${b})`;
  }
}

export function GenomeGraph({
  nodes,
  edges = [],
  height = 420,
  className,
  onSelect,
  selectedId = null,
}: GenomeGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 800, h: height });

  // simulation nodes held in a ref so we mutate without re-render
  const simRef = useRef<SimNode[]>([]);
  const edgeRef = useRef<GenomeEdge[]>([]);

  // Rebuild simulation whenever inputs change
  useEffect(() => {
    const w = containerRef.current?.clientWidth || dims.w;
    const h = height;
    setDims({ w, h });
    simRef.current = nodes.map((n, i) => {
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      const radius = Math.min(w, h) * 0.35;
      return {
        ...n,
        x: w / 2 + Math.cos(angle) * radius,
        y: h / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    edgeRef.current = edges.filter(
      e => nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target),
    );
  }, [nodes, edges, height, dims.w]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDims(prev => ({ ...prev, w: entry.contentRect.width }));
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const tick = () => {
      const sim = simRef.current;
      const es = edgeRef.current;
      const w = dims.w;
      const h = dims.h;

      // Physics: repulsion + spring + center gravity
      const repulsion = 1800;
      const springLen = 90;
      const springK = 0.02;
      const damping = 0.85;
      const gravity = 0.012;

      for (let i = 0; i < sim.length; i++) {
        const a = sim[i];
        for (let j = i + 1; j < sim.length; j++) {
          const b = sim[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          const f = repulsion / d2;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      for (const e of es) {
        const a = sim.find(n => n.id === e.source);
        const b = sim.find(n => n.id === e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const diff = d - springLen;
        const fx = (dx / d) * diff * springK;
        const fy = (dy / d) * diff * springK;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      for (const n of sim) {
        n.vx += (w / 2 - n.x) * gravity;
        n.vy += (h / 2 - n.y) * gravity;
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
        // bounds
        n.x = Math.max(24, Math.min(w - 24, n.x));
        n.y = Math.max(24, Math.min(h - 24, n.y));
      }

      // Render
      ctx.clearRect(0, 0, w, h);

      // edges
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      for (const e of es) {
        const a = sim.find(n => n.id === e.source);
        const b = sim.find(n => n.id === e.target);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // nodes
      for (const n of sim) {
        const isSelected = n.id === selectedId;
        const isHovered = n.id === hoveredId;
        const mastery = n.mastery ?? 0;
        const color = masteryColor(mastery, !!n.gap);
        const r = isSelected ? 14 : isHovered ? 12 : 10;
        // glow for gaps
        if (n.gap) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.strokeStyle = isSelected ? '#22d3ee' : 'rgba(15, 23, 42, 0.8)';
        ctx.stroke();

        if (isHovered || isSelected) {
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(n.title.slice(0, 32), n.x, n.y - r - 6);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dims, hoveredId, selectedId]);

  // Interaction
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let found: string | null = null;
    for (const n of simRef.current) {
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy <= 16 * 16) {
        found = n.id;
        break;
      }
    }
    setHoveredId(found);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const n of simRef.current) {
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy <= 16 * 16) {
        onSelect?.(n);
        return;
      }
    }
  };

  const legend = useMemo(
    () => [
      { label: 'Unknown', color: '#6b7280' },
      { label: 'Learning', color: '#eab308' },
      { label: 'Mastered', color: '#22c55e' },
      { label: 'Gap', color: '#ef4444' },
    ],
    [],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full rounded-xl border border-lattice-border bg-lattice-surface overflow-hidden',
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        width={dims.w}
        height={dims.h}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredId(null)}
        onClick={handleClick}
        className="block w-full cursor-pointer"
        style={{ height: `${dims.h}px` }}
      />
      <div className="absolute top-2 right-2 flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-md px-2 py-1">
        {legend.map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: l.color }}
            />
            <span className="text-[10px] text-gray-300">{l.label}</span>
          </div>
        ))}
      </div>
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          No genome data. Start learning to populate your knowledge graph.
        </div>
      )}
    </div>
  );
}

export default GenomeGraph;
