'use client';

/**
 * Resonance instrument primitives — types, canvases, meters, legend,
 * thresholds, pair cards, sparkline, export. Extracted from the fat page.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Info,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Scan,
  GitBranch,
  Signal,
  X,
  Layers,
  Target,
} from 'lucide-react';

export interface ResonancePair {
  a: { id: string; title: string; domain: string };
  b: { id: string; title: string; domain: string };
  invOverlap: number;
  tokOverlap: number;
  resonance: number;
  sharedInvariants: string[];
}

export interface BoundaryScan {
  ok: boolean;
  // Present when ok is false (e.g. "Insufficient DTU density for boundary
  // detection") or when the scan resolved to a real zero-signal reading with
  // an explanatory reason ("frontier_too_small", "insufficient_domain_diversity").
  error?: string;
  reason?: string;
  count?: number;
  signal: number;
  classification: string;
  timestamp: string;
  frontier: { size: number; density: number; avgCrispness: number };
  interior: { size: number; avgCrispness: number };
  gradient: number;
  coherenceDirection: number;
  crossDomainAlignment: {
    domainsScanned: number;
    pairsFound: number;
    topResonance: number;
    avgResonance: number;
    topPairs: ResonancePair[];
  };
}

export interface HistoryPoint {
  signal: number;
  classification: string;
  gradient: number;
  coherence: number;
  pairs: number;
  topResonance: number;
  frontier: number;
  timestamp: string;
}

export interface ThresholdConfig {
  strongResonance: number;
  moderateResonance: number;
  weakSignal: number;
}

// Shape of GET /api/lattice/resonance (register("lattice","resonance")) — the
// lattice-wide homeostasis/repair snapshot used for the Health tab meters.
// NOT the boundary-scan shape; kept distinct from BoundaryScan/HistoryPoint above.
export interface LatticeHealth {
  ok: boolean;
  coherence: number;
  resonance: {
    homeostasis: number;
    continuity: number;
    suffering: number;
    contradictionLoad: number;
    repairRate: number;
    accepts: number;
    rejections: number;
  };
  timestamp: string;
}

export type ViewMode = 'live' | 'pairs' | 'history' | 'health' | 'growth';

// ============================================================================
// Constants
// ============================================================================

export const CLASSIFICATION_META: Record<string, { label: string; color: string; glow: string; description: string }> = {
  strong_resonance: {
    label: 'STRONG RESONANCE',
    color: '#00ffc8',
    glow: 'rgba(0, 255, 200, 0.4)',
    description: 'High cross-domain invariant alignment with low semantic overlap. Genuine structural correspondence detected.',
  },
  moderate_resonance: {
    label: 'MODERATE SIGNAL',
    color: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.3)',
    description: 'Partial alignment across domains. Some shared constraint structure with moderate semantic distance.',
  },
  weak_signal: {
    label: 'WEAK SIGNAL',
    color: '#eab308',
    glow: 'rgba(234, 179, 8, 0.2)',
    description: 'Minimal cross-domain alignment. Low invariant overlap or high semantic similarity reducing signal.',
  },
  noise_floor: {
    label: 'NOISE FLOOR',
    color: '#6b7280',
    glow: 'rgba(107, 114, 128, 0.1)',
    description: 'No meaningful resonance detected. Signal indistinguishable from random alignment.',
  },
};

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  strongResonance: 0.30,
  moderateResonance: 0.10,
  weakSignal: 0.03,
};

// ============================================================================
// Signal Classification Legend
// ============================================================================

export function SignalClassificationLegend({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border border-white/5 rounded-lg overflow-hidden" style={{ background: 'rgba(10,10,20,0.8)' }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        <span className="flex items-center gap-2">
          <Info className="w-3.5 h-3.5" />
          Signal Classification Legend
        </span>
        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-2.5 border-t border-white/5 pt-3">
              {Object.entries(CLASSIFICATION_META).map(([key, meta]) => (
                <div key={key} className="flex items-start gap-3">
                  <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                    <span
                      className="w-3 h-3 rounded-full border"
                      style={{ backgroundColor: meta.color + '40', borderColor: meta.color }}
                    />
                    <span className="text-[11px] font-mono font-bold w-36" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">{meta.description}</p>
                </div>
              ))}
              <div className="pt-2 border-t border-white/5">
                <p className="text-[10px] text-gray-400 italic">
                  Resonance measures structural alignment between DTUs across different domains through shared invariants.
                  High invariant overlap + low semantic overlap = genuine constraint geometry correspondence.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Threshold Configuration Panel
// ============================================================================

export function ThresholdConfigPanel({
  thresholds,
  onChange,
  isOpen,
  onToggle,
}: {
  thresholds: ThresholdConfig;
  onChange: (t: ThresholdConfig) => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const handleSliderChange = (key: keyof ThresholdConfig, value: number) => {
    onChange({ ...thresholds, [key]: value });
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_THRESHOLDS });
  };

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden" style={{ background: 'rgba(10,10,20,0.8)' }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-300 transition-colors"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Threshold Configuration
        </span>
        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-4 border-t border-white/5 pt-3">
              {([
                { key: 'strongResonance' as const, label: 'Strong Resonance', color: '#00ffc8', min: 0.1, max: 0.8, step: 0.01 },
                { key: 'moderateResonance' as const, label: 'Moderate Signal', color: '#a855f7', min: 0.03, max: 0.5, step: 0.01 },
                { key: 'weakSignal' as const, label: 'Weak Signal', color: '#eab308', min: 0.01, max: 0.2, step: 0.005 },
              ]).map(({ key, label, color, min, max, step }) => (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-mono" style={{ color }}>
                      {label}
                    </label>
                    <span className="text-[11px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                      {(thresholds[key] * 100).toFixed(1)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={thresholds[key]}
                    onChange={(e) => handleSliderChange(key, parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, ${color} 0%, ${color} ${((thresholds[key] - min) / (max - min)) * 100}%, rgba(255,255,255,0.05) ${((thresholds[key] - min) / (max - min)) * 100}%, rgba(255,255,255,0.05) 100%)`,
                      accentColor: color,
                    }}
                  />
                  <div className="flex justify-between text-[9px] text-gray-700 font-mono">
                    <span>{(min * 100).toFixed(0)}%</span>
                    <span>{(max * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <p className="text-[10px] text-gray-400">
                  Thresholds determine signal classification boundaries for pair analysis.
                </p>
                <button
                  onClick={handleReset}
                  className="text-[10px] text-gray-400 hover:text-white px-2 py-1 rounded border border-white/5 hover:border-white/10 transition-colors"
                >
                  Reset Defaults
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Resonance Field Canvas — Animated boundary visualization
// ============================================================================

export function ResonanceFieldCanvas({
  signal,
  gradient,
  coherence,
  classification,
  scanning,
}: {
  signal: number;
  gradient: number;
  coherence: number;
  classification: string;
  scanning: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const resize = () => {
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const cx = w / 2;
      const cy = h / 2;
      const t = timeRef.current;

      ctx.clearRect(0, 0, w, h);

      const meta = CLASSIFICATION_META[classification] || CLASSIFICATION_META.noise_floor;

      // --- Background field ---
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
      bgGrad.addColorStop(0, `rgba(10, 10, 20, 0.95)`);
      bgGrad.addColorStop(0.5, `rgba(5, 5, 15, 0.98)`);
      bgGrad.addColorStop(1, `rgba(0, 0, 5, 1)`);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // --- Boundary rings (the constraint gradient visualization) ---
      const ringCount = 8;
      for (let i = 0; i < ringCount; i++) {
        const baseRadius = (Math.min(w, h) * 0.35) * ((i + 1) / ringCount);
        const wobble = Math.sin(t * 0.015 + i * 0.8) * (gradient * 15);
        const radius = baseRadius + wobble;

        const boundaryProximity = i / ringCount;
        const alpha = (0.03 + signal * 0.12) * (0.3 + boundaryProximity * 0.7);

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = meta.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1 + boundaryProximity * 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // --- Cross-domain alignment threads ---
      const threadCount = Math.floor(signal * 12);
      for (let i = 0; i < threadCount; i++) {
        const angle1 = (i / threadCount) * Math.PI * 2 + t * 0.003;
        const angle2 = angle1 + Math.PI * (0.3 + coherence * 0.7);
        const r1 = Math.min(w, h) * 0.15;
        const r2 = Math.min(w, h) * (0.25 + gradient * 0.15);

        const x1 = cx + Math.cos(angle1) * r1;
        const y1 = cy + Math.sin(angle1) * r1;
        const x2 = cx + Math.cos(angle2) * r2;
        const y2 = cy + Math.sin(angle2) * r2;

        const ctrlX = cx + Math.cos((angle1 + angle2) / 2) * (r1 + r2) * 0.3;
        const ctrlY = cy + Math.sin((angle1 + angle2) / 2) * (r1 + r2) * 0.3;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(ctrlX, ctrlY, x2, y2);
        ctx.strokeStyle = meta.color;
        ctx.globalAlpha = 0.1 + signal * 0.15;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2 + signal * 2, 0, Math.PI * 2);
          ctx.fillStyle = meta.color;
          ctx.globalAlpha = 0.4 + signal * 0.4;
          ctx.fill();
          ctx.globalAlpha = 1;
        });
      }

      // --- Core pulse (the signal strength) ---
      const pulseBase = 20 + signal * 30;
      const pulse = pulseBase + Math.sin(t * 0.04) * (5 + signal * 10);

      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse);
      coreGrad.addColorStop(0, meta.color);
      coreGrad.addColorStop(0.4, meta.glow);
      coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.beginPath();
      ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
      ctx.fillStyle = coreGrad;
      ctx.fill();

      // --- Scan sweep (when actively scanning) ---
      if (scanning) {
        const sweepAngle = (t * 0.05) % (Math.PI * 2);
        const sweepRadius = Math.min(w, h) * 0.4;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, sweepRadius, sweepAngle, sweepAngle + 0.3);
        ctx.closePath();

        const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sweepRadius);
        sweepGrad.addColorStop(0, 'rgba(0, 255, 200, 0.15)');
        sweepGrad.addColorStop(1, 'rgba(0, 255, 200, 0)');
        ctx.fillStyle = sweepGrad;
        ctx.fill();
      }

      // --- x² - x = 0 fixed point markers (x=0 and x=1) ---
      const x0Radius = Math.min(w, h) * 0.38;
      ctx.beginPath();
      ctx.arc(cx, cy, x0Radius, 0, Math.PI * 2);
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      const x1Radius = Math.min(w, h) * 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, x1Radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, 0.15)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.textAlign = 'center';
      ctx.fillText('x = 0', cx, cy - x0Radius - 6);
      ctx.fillText('x = 1', cx, cy - x1Radius - 6);

      timeRef.current += 1;
      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [signal, gradient, coherence, classification, scanning]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ============================================================================
// Resonance Spectrum Canvas — Animated frequency spectrum visualization
// ============================================================================

export function ResonanceSpectrumCanvas({
  signal,
  gradient,
  coherence,
  classification,
  topResonance,
  pairsFound,
  scanning,
}: {
  signal: number;
  gradient: number;
  coherence: number;
  classification: string;
  topResonance: number;
  pairsFound: number;
  scanning: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const binsRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const BAR_COUNT = 64;

    // Initialize frequency bins if needed
    if (binsRef.current.length !== BAR_COUNT) {
      binsRef.current = new Array(BAR_COUNT).fill(0);
    }

    const resize = () => {
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const t = timeRef.current;

      ctx.clearRect(0, 0, w, h);

      // Dark background
      ctx.fillStyle = 'rgba(5, 5, 16, 1)';
      ctx.fillRect(0, 0, w, h);

      const meta = CLASSIFICATION_META[classification] || CLASSIFICATION_META.noise_floor;

      // Subtle grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Generate target spectrum from data values
      const bins = binsRef.current;
      for (let i = 0; i < BAR_COUNT; i++) {
        const norm = i / BAR_COUNT;

        // Base shape: combination of resonance data parameters
        // Low frequencies driven by signal strength, mid by gradient, high by coherence
        const lowBand = Math.exp(-norm * 3) * signal;
        const midBand = Math.exp(-Math.pow((norm - 0.35) * 4, 2)) * gradient;
        const hiBand = Math.exp(-Math.pow((norm - 0.7) * 5, 2)) * coherence;
        const pairsPeak = Math.exp(-Math.pow((norm - 0.5) * 3, 2)) * Math.min(1, pairsFound / 20);

        // Composite target value
        let target = (lowBand + midBand * 0.8 + hiBand * 0.6 + pairsPeak * 0.4) * 0.7;

        // Add animated oscillation per-bin
        target += Math.sin(t * 0.03 + i * 0.4) * 0.08 * signal;
        target += Math.sin(t * 0.017 + i * 0.7) * 0.05 * gradient;
        target += Math.cos(t * 0.023 + i * 0.3) * 0.04 * coherence;

        // Extra energy during scanning
        if (scanning) {
          const scanWave = Math.sin(t * 0.08 - i * 0.15);
          target += Math.max(0, scanWave) * 0.25;
        }

        target = Math.max(0.02, Math.min(1, target));

        // Smooth interpolation toward target
        bins[i] += (target - bins[i]) * 0.12;
      }

      // Draw frequency bars
      const barWidth = (w - (BAR_COUNT - 1) * 1.5) / BAR_COUNT;
      const maxBarHeight = h * 0.85;

      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (barWidth + 1.5);
        const barH = bins[i] * maxBarHeight;
        const y = h - barH;
        const norm = i / BAR_COUNT;

        // Color: cyan -> purple -> green across the spectrum
        let r: number, g: number, b: number;
        if (norm < 0.4) {
          // Cyan to purple
          const t2 = norm / 0.4;
          r = Math.round(0 + t2 * 168);
          g = Math.round(255 - t2 * 170);
          b = Math.round(200 + t2 * 47);
        } else {
          // Purple to green
          const t2 = (norm - 0.4) / 0.6;
          r = Math.round(168 - t2 * 128);
          g = Math.round(85 + t2 * 170);
          b = Math.round(247 - t2 * 147);
        }

        // Intensity based on bar height
        const intensity = 0.5 + bins[i] * 0.5;

        // Bar gradient (bottom bright, top fades)
        const barGrad = ctx.createLinearGradient(x, h, x, y);
        barGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${intensity})`);
        barGrad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${intensity * 0.7})`);
        barGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${intensity * 0.3})`);

        ctx.fillStyle = barGrad;
        ctx.fillRect(x, y, barWidth, barH);

        // Glow cap on top of each bar
        if (bins[i] > 0.1) {
          const capGrad = ctx.createRadialGradient(
            x + barWidth / 2, y, 0,
            x + barWidth / 2, y, barWidth * 1.5
          );
          capGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.4 * bins[i]})`);
          capGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = capGrad;
          ctx.fillRect(x - barWidth * 0.5, y - barWidth, barWidth * 2, barWidth * 2);
        }
      }

      // Mirror reflection (subtle)
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.scale(1, -1);
      ctx.translate(0, -h * 2);
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (barWidth + 1.5);
        const barH = bins[i] * maxBarHeight * 0.3;
        const norm = i / BAR_COUNT;

        let r2: number, g2: number, b2: number;
        if (norm < 0.4) {
          const t2 = norm / 0.4;
          r2 = Math.round(0 + t2 * 168);
          g2 = Math.round(255 - t2 * 170);
          b2 = Math.round(200 + t2 * 47);
        } else {
          const t2 = (norm - 0.4) / 0.6;
          r2 = Math.round(168 - t2 * 128);
          g2 = Math.round(85 + t2 * 170);
          b2 = Math.round(247 - t2 * 147);
        }

        ctx.fillStyle = `rgba(${r2}, ${g2}, ${b2}, 0.5)`;
        ctx.fillRect(x, h, barWidth, barH);
      }
      ctx.restore();

      // Waveform overlay line connecting bar peaks
      ctx.beginPath();
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (barWidth + 1.5) + barWidth / 2;
        const y = h - bins[i] * maxBarHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = meta.color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Frequency band labels
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.textAlign = 'center';
      const labels = ['SIG', 'INV', 'TOK', 'COH', 'RES'];
      labels.forEach((lbl, idx) => {
        const lx = ((idx + 0.5) / labels.length) * w;
        ctx.fillText(lbl, lx, h - 3);
      });

      // Top-right resonance value
      ctx.textAlign = 'right';
      ctx.font = '10px monospace';
      ctx.fillStyle = meta.color;
      ctx.globalAlpha = 0.6;
      ctx.fillText(`peak: ${(topResonance * 100).toFixed(1)}%`, w - 6, 14);
      ctx.globalAlpha = 1;

      timeRef.current += 1;
      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [signal, gradient, coherence, classification, topResonance, pairsFound, scanning]);

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}

// ============================================================================
// Signal Meter — Vertical bar showing current resonance strength
// ============================================================================

export function SignalMeter({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  const hue = value > 0.7 ? 160 : value > 0.4 ? 270 : value > 0.15 ? 45 : 0;
  const color = `hsl(${hue}, 80%, 60%)`;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-3 h-24 bg-[#0a0a14] rounded-full overflow-hidden relative border border-white/5">
        <motion.div
          className="absolute bottom-0 w-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ height: 0 }}
          animate={{ height: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[10px] text-gray-400 font-mono">{label}</span>
      <span className="text-xs font-mono" style={{ color }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

// ============================================================================
// Resonance Pair Card — Shows a single cross-domain alignment
// ============================================================================

export function PairCard({ pair, rank, thresholds }: { pair: ResonancePair; rank: number; thresholds: ThresholdConfig }) {
  const [expanded, setExpanded] = useState(false);
  const meta = pair.resonance >= thresholds.strongResonance
    ? CLASSIFICATION_META.strong_resonance
    : pair.resonance >= thresholds.moderateResonance
      ? CLASSIFICATION_META.moderate_resonance
      : CLASSIFICATION_META.weak_signal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05 }}
      className="border border-white/5 rounded-lg p-3 hover:border-white/10 transition-colors cursor-pointer"
      style={{ background: `linear-gradient(135deg, rgba(10,10,20,0.9), ${meta.glow.replace(')', ',0.05)')})` }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: meta.glow, color: meta.color }}>
              {pair.a.domain}
            </span>
            <GitBranch className="w-3 h-3 text-gray-600" />
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: meta.glow, color: meta.color }}>
              {pair.b.domain}
            </span>
          </div>
          <p className="text-xs text-gray-400 truncate">{pair.a.title}</p>
          <p className="text-xs text-gray-400 truncate">{pair.b.title}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-lg font-mono font-bold" style={{ color: meta.color }}>
            {(pair.resonance * 100).toFixed(1)}
          </p>
          <p className="text-[10px] text-gray-400">resonance</p>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
              <div className="flex gap-4 text-[11px]">
                <span className="text-gray-400">
                  Invariant overlap: <span className="text-white font-mono">{(pair.invOverlap * 100).toFixed(1)}%</span>
                </span>
                <span className="text-gray-400">
                  Semantic distance: <span className="text-white font-mono">{((1 - pair.tokOverlap) * 100).toFixed(1)}%</span>
                </span>
              </div>
              {pair.sharedInvariants.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1">Shared invariants:</p>
                  {pair.sharedInvariants.map((inv, i) => (
                    <p key={i} className="text-[11px] text-gray-400 font-mono pl-2 border-l border-white/10">
                      {inv}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-400 italic">
                High invariant overlap + low semantic overlap = alignment from constraint geometry, not content.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================================
// History Sparkline
// ============================================================================

export function HistorySparkline({ readings }: { readings: HistoryPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || readings.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const padding = 4;

    const maxSignal = Math.max(...readings.map(r => r.signal), 0.1);

    ctx.beginPath();
    readings.forEach((r, i) => {
      const x = padding + (i / (readings.length - 1)) * (w - padding * 2);
      const y = h - padding - (r.signal / maxSignal) * (h - padding * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#00ffc8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const lastX = padding + ((readings.length - 1) / (readings.length - 1)) * (w - padding * 2);
    ctx.lineTo(lastX, h);
    ctx.lineTo(padding, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0, 255, 200, 0.15)');
    grad.addColorStop(1, 'rgba(0, 255, 200, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }, [readings]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ============================================================================
// Export helper
// ============================================================================

export function exportResonanceData(scan: BoundaryScan | undefined, history: HistoryPoint[], format: 'json' | 'csv') {
  if (!scan && history.length === 0) return;

  let content: string;
  let filename: string;
  let mimeType: string;

  if (format === 'json') {
    const exportData = {
      exportedAt: new Date().toISOString(),
      currentScan: scan ? {
        signal: scan.signal,
        classification: scan.classification,
        timestamp: scan.timestamp,
        gradient: scan.gradient,
        coherenceDirection: scan.coherenceDirection,
        frontier: scan.frontier,
        interior: scan.interior,
        crossDomainAlignment: scan.crossDomainAlignment,
      } : null,
      history,
    };
    content = JSON.stringify(exportData, null, 2);
    filename = `resonance-export-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    mimeType = 'application/json';
  } else {
    const rows: string[] = ['timestamp,signal,classification,gradient,coherence,pairs,topResonance,frontier'];
    for (const r of history) {
      rows.push([
        r.timestamp,
        r.signal.toFixed(4),
        r.classification,
        r.gradient.toFixed(4),
        r.coherence.toFixed(4),
        r.pairs,
        r.topResonance.toFixed(4),
        r.frontier,
      ].join(','));
    }
    content = rows.join('\n');
    filename = `resonance-export-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    mimeType = 'text/csv';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
