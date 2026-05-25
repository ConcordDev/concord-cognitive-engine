'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Theorem {
  id: string;
  domain: string;
  statement: string;
}

export interface STSVKExplorerProps {
  theorems?: Theorem[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Sample theorems
// ---------------------------------------------------------------------------

const SAMPLE_THEOREMS: Theorem[] = [
  { id: 't1', domain: 'Mathematics', statement: 'x\u00b2 \u2212 x = 0 yields exactly two solutions (0 and 1), forming the binary foundation of all digital logic.' },
  { id: 't2', domain: 'Mathematics', statement: 'Every continuous function on a closed interval attains its maximum and minimum (Extreme Value Theorem).' },
  { id: 't3', domain: 'Physics', statement: 'Energy and mass are interchangeable: E = mc\u00b2 defines the conversion ratio at the speed of light squared.' },
  { id: 't4', domain: 'Physics', statement: 'No information can travel faster than c; causality is preserved across all inertial reference frames.' },
  { id: 't5', domain: 'Computer Science', statement: 'A universal Turing machine can simulate any other Turing machine, establishing the limits of computability.' },
  { id: 't6', domain: 'Computer Science', statement: 'P \u2260 NP remains unresolved: verifying a solution may be fundamentally easier than finding one.' },
  { id: 't7', domain: 'Philosophy', statement: 'Cogito ergo sum \u2014 the act of doubting one\u2019s existence proves a thinking entity must exist.' },
  { id: 't8', domain: 'Biology', statement: 'DNA encodes hereditary information via four nucleotide bases arranged in a double helix structure.' },
  { id: 't9', domain: 'Economics', statement: 'Supply and demand curves intersect at equilibrium; price adjusts to balance allocation in free markets.' },
  { id: 't10', domain: 'Linguistics', statement: 'Universal Grammar posits that the capacity for language acquisition is hard-wired into the human brain.' },
];

// ---------------------------------------------------------------------------
// Domain colors
// ---------------------------------------------------------------------------

const DOMAIN_COLORS: Record<string, string> = {
  'Mathematics': '#22d3ee',
  'Physics': '#a855f7',
  'Computer Science': '#22c55e',
  'Philosophy': '#ec4899',
  'Biology': '#10b981',
  'Economics': '#f59e0b',
  'Linguistics': '#8b5cf6',
};

function getDomainColor(domain: string): string {
  return DOMAIN_COLORS[domain] || '#6b7280';
}

// ---------------------------------------------------------------------------
// Parabola canvas component
// ---------------------------------------------------------------------------

function ParabolaCanvas({ sliderX, onSliderChange, width, height }: {
  sliderX: number;
  onSliderChange: (x: number) => void;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const pulseRef = useRef(0);
  const isDragging = useRef(false);

  const xToCanvas = useCallback((x: number) => {
    const padL = 60, padR = 40;
    return padL + ((x + 1) / 3) * (width - padL - padR);
  }, [width]);

  const yToCanvas = useCallback((y: number) => {
    const padT = 30, padB = 40;
    const plotH = height - padT - padB;
    return padT + (1 - (y + 0.5) / 3) * plotH;
  }, [height]);

  const canvasToX = useCallback((cx: number) => {
    const padL = 60, padR = 40;
    return ((cx - padL) / (width - padL - padR)) * 3 - 1;
  }, [width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let running = true;

    const draw = () => {
      if (!running) return;
      pulseRef.current += 0.03;
      const pulse = Math.sin(pulseRef.current) * 0.5 + 0.5;
      ctx.clearRect(0, 0, width, height);

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#0a0e17');
      bgGrad.addColorStop(1, '#0d1220');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = 'rgba(55,65,81,0.3)';
      ctx.lineWidth = 0.5;
      for (let gx = -1; gx <= 2; gx += 0.5) {
        const cx = xToCanvas(gx);
        ctx.beginPath();
        ctx.moveTo(cx, 20);
        ctx.lineTo(cx, height - 30);
        ctx.stroke();
      }
      for (let gy = -0.5; gy <= 2.5; gy += 0.5) {
        const cy = yToCanvas(gy);
        ctx.beginPath();
        ctx.moveTo(50, cy);
        ctx.lineTo(width - 30, cy);
        ctx.stroke();
      }

      // Axes
      const axisColor = '#4b5563';
      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 1.5;
      const y0 = yToCanvas(0);
      ctx.beginPath();
      ctx.moveTo(50, y0);
      ctx.lineTo(width - 30, y0);
      ctx.stroke();
      const x0 = xToCanvas(0);
      ctx.beginPath();
      ctx.moveTo(x0, 20);
      ctx.lineTo(x0, height - 30);
      ctx.stroke();

      // Axis labels
      ctx.font = '9px monospace';
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'center';
      for (let gx = -1; gx <= 2; gx++) {
        ctx.fillText(gx.toString(), xToCanvas(gx), y0 + 16);
      }
      ctx.textAlign = 'right';
      for (let gy = 0; gy <= 2; gy++) {
        ctx.fillText(gy.toString(), x0 - 8, yToCanvas(gy) + 3);
      }

      // Draw f(x) = x^2 - x
      ctx.beginPath();
      const steps = 200;
      for (let i = 0; i <= steps; i++) {
        const x = -1 + (i / steps) * 3;
        const y = x * x - x;
        const cx = xToCanvas(x);
        const cy = yToCanvas(y);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      const curveGrad = ctx.createLinearGradient(xToCanvas(-1), 0, xToCanvas(2), 0);
      curveGrad.addColorStop(0, '#a855f7');
      curveGrad.addColorStop(0.5, '#22d3ee');
      curveGrad.addColorStop(1, '#ec4899');
      ctx.strokeStyle = curveGrad;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Curve glow
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = -1 + (i / steps) * 3;
        const y = x * x - x;
        const cx = xToCanvas(x);
        const cy = yToCanvas(y);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.strokeStyle = 'rgba(34,211,238,0.15)';
      ctx.lineWidth = 8;
      ctx.stroke();

      // Solution highlights at x=0 and x=1
      const solutions = [0, 1];
      for (const sx of solutions) {
        const cx = xToCanvas(sx);
        const cy = yToCanvas(0);
        const glowR = 16 + pulse * 6;

        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        glow.addColorStop(0, '#22c55e55');
        glow.addColorStop(1, '#22c55e00');
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
        ctx.strokeStyle = '#ffffff40';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#22c55e';
        ctx.textAlign = 'center';
        ctx.fillText(`x=${sx}`, cx, cy - 14);
      }

      // Interactive slider point
      const sxCanvas = xToCanvas(sliderX);
      const sy = sliderX * sliderX - sliderX;
      const syCanvas = yToCanvas(sy);

      // Vertical dashed line
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sxCanvas, syCanvas);
      ctx.lineTo(sxCanvas, y0);
      ctx.strokeStyle = '#ec489960';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Horizontal dashed line
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sxCanvas, syCanvas);
      ctx.lineTo(x0, syCanvas);
      ctx.strokeStyle = '#a855f760';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Slider point glow
      const sliderGlow = ctx.createRadialGradient(sxCanvas, syCanvas, 0, sxCanvas, syCanvas, 20);
      sliderGlow.addColorStop(0, '#ec489966');
      sliderGlow.addColorStop(1, '#ec489900');
      ctx.beginPath();
      ctx.arc(sxCanvas, syCanvas, 20, 0, Math.PI * 2);
      ctx.fillStyle = sliderGlow;
      ctx.fill();

      // Slider dot
      ctx.beginPath();
      ctx.arc(sxCanvas, syCanvas, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ec4899';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Value label
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#e5e7eb';
      ctx.textAlign = 'left';
      ctx.fillText(`f(${sliderX.toFixed(2)}) = ${sy.toFixed(3)}`, sxCanvas + 14, syCanvas - 4);

      // Title
      ctx.font = 'bold 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#e5e7eb';
      ctx.textAlign = 'center';
      ctx.fillText('f(x) = x\u00b2 \u2212 x', width / 2, 18);

      // Binary foundation label
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#22c55e90';
      ctx.fillText('Binary Foundation: solutions at 0 and 1', width / 2, height - 8);

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [width, height, sliderX, xToCanvas, yToCanvas]);

  const handleMouse = useCallback((e: React.MouseEvent<HTMLCanvasElement>, isDown?: boolean) => {
    if (isDown !== undefined) isDragging.current = isDown;
    if (!isDragging.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const newX = Math.max(-0.5, Math.min(1.5, canvasToX(mx)));
    onSliderChange(Math.round(newX * 100) / 100);
  }, [canvasToX, onSliderChange]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
      onMouseDown={(e) => handleMouse(e, true)}
      onMouseMove={(e) => handleMouse(e)}
      onMouseUp={(e) => handleMouse(e, false)}
      onMouseLeave={() => { isDragging.current = false; }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function STSVKExplorer({ theorems: theoremsProp, className }: STSVKExplorerProps) {
  const theorems = theoremsProp && theoremsProp.length > 0 ? theoremsProp : SAMPLE_THEOREMS;
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 220 });
  const [sliderX, setSliderX] = useState(0.5);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect;
      if (width > 0) setCanvasSize({ w: width, h: 220 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Group theorems by domain
  const domains = useMemo(() => {
    const map = new Map<string, Theorem[]>();
    for (const t of theorems) {
      if (!map.has(t.domain)) map.set(t.domain, []);
      map.get(t.domain)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [theorems]);

  const filtered = selectedDomain
    ? domains.filter(([d]) => d === selectedDomain)
    : domains;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-neon-purple animate-pulse" />
          <h3 className="text-sm font-semibold text-white">STSVK Theorem Explorer</h3>
          <span className="text-xs text-gray-400">{theorems.length} theorems</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] flex-wrap">
          <button
            onClick={() => setSelectedDomain(null)}
            className={cn(
              'px-2 py-0.5 rounded border transition-colors',
              !selectedDomain
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-transparent border-lattice-border text-gray-400 hover:text-white hover:border-white/20'
            )}
          >
            All
          </button>
          {domains.map(([domain]) => (
            <button
              key={domain}
              onClick={() => setSelectedDomain(selectedDomain === domain ? null : domain)}
              className={cn(
                'px-2 py-0.5 rounded border transition-colors',
                selectedDomain === domain
                  ? 'border-white/20 text-white'
                  : 'bg-transparent border-lattice-border text-gray-400 hover:text-white hover:border-white/20'
              )}
              style={selectedDomain === domain ? { backgroundColor: getDomainColor(domain) + '20' } : undefined}
            >
              {domain}
            </button>
          ))}
        </div>
      </div>

      {/* Parabola canvas */}
      <div ref={containerRef} className="relative w-full" style={{ height: 220 }}>
        <ParabolaCanvas
          sliderX={sliderX}
          onSliderChange={setSliderX}
          width={canvasSize.w}
          height={canvasSize.h}
        />
      </div>

      {/* Slider control */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-b border-lattice-border/50 bg-lattice-deep/50">
        <span className="text-[10px] text-gray-400 font-mono w-16">x = {sliderX.toFixed(2)}</span>
        <input
          type="range"
          min="-0.5"
          max="1.5"
          step="0.01"
          value={sliderX}
          onChange={(e) => setSliderX(parseFloat(e.target.value))}
          className="flex-1 h-1 appearance-none bg-gradient-to-r from-purple-500 via-cyan-400 to-pink-500 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg"
        />
        <span className="text-[10px] text-gray-400 font-mono w-24">
          f(x) = {(sliderX * sliderX - sliderX).toFixed(4)}
        </span>
      </div>

      {/* Theorem cards grid */}
      <div className="p-4 max-h-[340px] overflow-y-auto">
        {filtered.map(([domain, domainTheorems]) => (
          <div key={domain} className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: getDomainColor(domain) }}
              />
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
                {domain}
              </h4>
              <span className="text-[10px] text-gray-400">{domainTheorems.length} theorem{domainTheorems.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {domainTheorems.map((theorem) => (
                <motion.div
                  key={theorem.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.02 }}
                  className="relative group rounded-lg border p-3 transition-colors cursor-default"
                  style={{
                    borderColor: getDomainColor(domain) + '25',
                    background: `linear-gradient(135deg, ${getDomainColor(domain)}08, transparent)`,
                  }}
                >
                  <div
                    className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{
                      background: `linear-gradient(135deg, ${getDomainColor(domain)}15, transparent)`,
                    }}
                  />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{
                          color: getDomainColor(domain),
                          backgroundColor: getDomainColor(domain) + '15',
                          border: `1px solid ${getDomainColor(domain)}30`,
                        }}
                      >
                        {theorem.id}
                      </span>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">
                      {theorem.statement}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
