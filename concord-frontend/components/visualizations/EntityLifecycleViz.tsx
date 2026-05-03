'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityEvent {
  type: string;
  timestamp: number;
  domain: string;
  detail?: string;
}

export interface Entity {
  id: string;
  name: string;
  events: EntityEvent[];
}

export interface EntityLifecycleVizProps {
  entities?: Entity[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_ENTITIES: Entity[] = [
  {
    id: 'e1', name: 'Concordance Engine',
    events: [
      { type: 'creation', timestamp: Date.now() - 86400000 * 6, domain: 'systems' },
      { type: 'exploration', timestamp: Date.now() - 86400000 * 5, domain: 'systems', detail: 'Initial architecture scan' },
      { type: 'growth', timestamp: Date.now() - 86400000 * 3, domain: 'systems', detail: 'Module expansion' },
      { type: 'debate', timestamp: Date.now() - 86400000 * 1.5, domain: 'philosophy', detail: 'Ethical alignment review' },
      { type: 'creation', timestamp: Date.now() - 3600000, domain: 'systems', detail: 'V2 instantiation' },
    ],
  },
  {
    id: 'e2', name: 'Knowledge Lattice',
    events: [
      { type: 'exploration', timestamp: Date.now() - 86400000 * 5.5, domain: 'mathematics' },
      { type: 'creation', timestamp: Date.now() - 86400000 * 4, domain: 'mathematics', detail: 'Graph topology defined' },
      { type: 'growth', timestamp: Date.now() - 86400000 * 2, domain: 'mathematics', detail: 'Node density +400%' },
      { type: 'exploration', timestamp: Date.now() - 86400000 * 0.5, domain: 'physics', detail: 'Cross-domain bridging' },
    ],
  },
  {
    id: 'e3', name: 'Ethics Oracle',
    events: [
      { type: 'creation', timestamp: Date.now() - 86400000 * 4.5, domain: 'philosophy' },
      { type: 'debate', timestamp: Date.now() - 86400000 * 3.5, domain: 'philosophy', detail: 'Trolley problem variants' },
      { type: 'debate', timestamp: Date.now() - 86400000 * 2.5, domain: 'philosophy', detail: 'Consent frameworks' },
      { type: 'growth', timestamp: Date.now() - 86400000 * 1, domain: 'philosophy', detail: 'Axiom set expanded' },
      { type: 'exploration', timestamp: Date.now() - 7200000, domain: 'biology', detail: 'Bio-ethics integration' },
    ],
  },
  {
    id: 'e4', name: 'Quantum Bridge',
    events: [
      { type: 'exploration', timestamp: Date.now() - 86400000 * 3, domain: 'physics' },
      { type: 'creation', timestamp: Date.now() - 86400000 * 2, domain: 'physics', detail: 'Entanglement model' },
      { type: 'growth', timestamp: Date.now() - 86400000 * 0.8, domain: 'physics', detail: 'Decoherence solved' },
    ],
  },
  {
    id: 'e5', name: 'Language Nexus',
    events: [
      { type: 'creation', timestamp: Date.now() - 86400000 * 5, domain: 'linguistics' },
      { type: 'exploration', timestamp: Date.now() - 86400000 * 4, domain: 'linguistics', detail: 'Semantic parsing' },
      { type: 'debate', timestamp: Date.now() - 86400000 * 2.2, domain: 'linguistics', detail: 'Ambiguity resolution' },
      { type: 'growth', timestamp: Date.now() - 86400000 * 0.3, domain: 'linguistics', detail: 'Polyglot expansion' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

const EVENT_COLORS: Record<string, string> = {
  exploration: '#22d3ee',
  creation: '#a855f7',
  debate: '#ec4899',
  growth: '#22c55e',
};
const LANE_BG_ODD = 'rgba(255,255,255,0.015)';
const LANE_HEIGHT = 56;
const HEADER_W = 150;
const DOT_R = 6;
const GLOW_R = 18;
const CANVAS_PAD_RIGHT = 60;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EntityLifecycleViz({ entities: entitiesProp, className }: EntityLifecycleVizProps) {
  const entities = entitiesProp && entitiesProp.length > 0 ? entitiesProp : DEMO_ENTITIES;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const [size, setSize] = useState({ w: 900, h: 400 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; entity: Entity; event: EntityEvent } | null>(null);
  const pulseRef = useRef(0);

  // Time bounds
  const { tMin, tRange } = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const e of entities) for (const ev of e.events) {
      if (ev.timestamp < min) min = ev.timestamp;
      if (ev.timestamp > max) max = ev.timestamp;
    }
    if (!isFinite(min)) { min = Date.now() - 86400000; max = Date.now(); }
    const range = (max - min) || 3600000;
    return { tMin: min - range * 0.05, tRange: range * 1.1 };
  }, [entities]);

  // Resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tsToX = useCallback((ts: number) => {
    return HEADER_W + ((ts - tMin) / tRange) * (size.w - HEADER_W - CANVAS_PAD_RIGHT);
  }, [tMin, tRange, size.w]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let running = true;

    const draw = () => {
      if (!running) return;
      pulseRef.current += 0.025;
      const pulse = Math.sin(pulseRef.current) * 0.5 + 0.5;
      ctx.clearRect(0, 0, size.w, size.h);

      // Draw swim lanes
      for (let i = 0; i < entities.length; i++) {
        const y = i * LANE_HEIGHT;
        if (i % 2 === 1) {
          ctx.fillStyle = LANE_BG_ODD;
          ctx.fillRect(0, y, size.w, LANE_HEIGHT);
        }
        // Lane line
        const cy = y + LANE_HEIGHT / 2;
        ctx.beginPath();
        ctx.moveTo(HEADER_W, cy);
        ctx.lineTo(size.w - 20, cy);
        ctx.strokeStyle = 'rgba(55,65,81,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Entity name
        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#e5e7eb';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(entities[i].name, HEADER_W - 14, cy);

        // Event count
        ctx.font = '9px monospace';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(`${entities[i].events.length} events`, HEADER_W - 14, cy + 14);
      }

      // Draw events
      for (let i = 0; i < entities.length; i++) {
        const cy = i * LANE_HEIGHT + LANE_HEIGHT / 2;
        for (const ev of entities[i].events) {
          const x = tsToX(ev.timestamp);
          const color = EVENT_COLORS[ev.type] || '#22d3ee';

          // Glow
          const glowSize = GLOW_R + pulse * 4;
          const grad = ctx.createRadialGradient(x, cy, 0, x, cy, glowSize);
          grad.addColorStop(0, color + '55');
          grad.addColorStop(1, color + '00');
          ctx.beginPath();
          ctx.arc(x, cy, glowSize, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();

          // Dot
          ctx.beginPath();
          ctx.arc(x, cy, DOT_R, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();

          // Inner highlight
          ctx.beginPath();
          ctx.arc(x - 2, cy - 2, DOT_R * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.fill();
        }
      }

      // Time axis at bottom
      const axisY = entities.length * LANE_HEIGHT + 4;
      ctx.beginPath();
      ctx.moveTo(HEADER_W, axisY);
      ctx.lineTo(size.w - 20, axisY);
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1;
      ctx.stroke();

      const tickCount = Math.max(4, Math.floor((size.w - HEADER_W) / 120));
      for (let i = 0; i <= tickCount; i++) {
        const t = tMin + (tRange * i) / tickCount;
        const x = tsToX(t);
        ctx.beginPath();
        ctx.moveTo(x, axisY);
        ctx.lineTo(x, axisY + 6);
        ctx.strokeStyle = '#4b5563';
        ctx.stroke();
        const d = new Date(t);
        const label = `${d.toLocaleString('en', { month: 'short' })} ${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        ctx.font = '9px monospace';
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, axisY + 18);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [size, entities, tsToX, tMin, tRange]);

  // Mouse interaction
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (let i = 0; i < entities.length; i++) {
      const cy = i * LANE_HEIGHT + LANE_HEIGHT / 2;
      for (const ev of entities[i].events) {
        const x = tsToX(ev.timestamp);
        if (Math.hypot(x - mx, cy - my) < DOT_R + 5) {
          setTooltip({ x: mx, y: my, entity: entities[i], event: ev });
          return;
        }
      }
    }
    setTooltip(null);
  }, [entities, tsToX]);

  const canvasH = entities.length * LANE_HEIGHT + 30;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-neon-cyan animate-pulse" />
          <h3 className="text-sm font-semibold text-white">Entity Activity Timeline</h3>
          <span className="text-xs text-gray-500">{entities.length} entities</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          {Object.entries(EVENT_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1 text-gray-400">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              {type}
            </span>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative w-full" style={{ height: Math.min(canvasH + 20, 460) }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', cursor: tooltip ? 'pointer' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        />
        {tooltip && (
          <div
            className="absolute z-20 pointer-events-none bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 shadow-xl"
            style={{ left: tooltip.x + 18, top: tooltip.y - 14 }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: EVENT_COLORS[tooltip.event.type] || '#22d3ee' }} />
              <span className="text-xs font-bold text-white capitalize">{tooltip.event.type}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple border border-neon-purple/20">
                {tooltip.event.domain}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 font-mono">
              {new Date(tooltip.event.timestamp).toLocaleString()}
            </p>
            <p className="text-xs text-gray-300 mt-0.5">{tooltip.entity.name}</p>
            {tooltip.event.detail && (
              <p className="text-[10px] text-gray-500 mt-1">{tooltip.event.detail}</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
