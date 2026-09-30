'use client';

/**
 * Shared types + canvas viz for the tick lens.
 * Extracted from lenses/tick/page.tsx — no behavior changes.
 */

import { useState, useEffect, useRef } from 'react';
import { Heart } from 'lucide-react';

export interface TickEvent {
  id: string;
  type: string;
  signal: number;
  stress: number;
  timestamp: string;
  organ?: string;
}

export type TickViewTab = 'stream' | 'stats' | 'timeline' | 'health' | 'monitor' | 'rate';

// ============================================================================
// Heartbeat Pulse Visualization
// ============================================================================

export function HeartbeatPulse({ isLive, lastTickTime }: { isLive: boolean; lastTickTime: number | null }) {
  const [pulse, setPulse] = useState(false);
  const prevTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastTickTime && lastTickTime !== prevTickRef.current) {
      prevTickRef.current = lastTickTime;
      setPulse(true);
      const timeout = setTimeout(() => setPulse(false), 400);
      return () => clearTimeout(timeout);
    }
  }, [lastTickTime]);

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center justify-center">
        {/* Outer ring pulse */}
        <div
          className={`absolute w-12 h-12 rounded-full transition-all duration-500 ${
            pulse ? 'scale-150 opacity-0' : 'scale-100 opacity-0'
          }`}
          style={{ backgroundColor: isLive ? 'rgba(0,255,200,0.2)' : 'rgba(107,114,128,0.1)' }}
        />
        {/* Inner pulse ring */}
        <div
          className={`absolute w-10 h-10 rounded-full transition-all duration-300 ${
            pulse ? 'scale-125 opacity-0' : 'scale-100 opacity-0'
          }`}
          style={{ backgroundColor: isLive ? 'rgba(0,255,200,0.3)' : 'rgba(107,114,128,0.15)' }}
        />
        {/* Core heartbeat dot */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
            pulse ? 'scale-110' : 'scale-100'
          }`}
          style={{
            backgroundColor: isLive ? (pulse ? 'rgba(0,255,200,0.4)' : 'rgba(0,255,200,0.15)') : 'rgba(107,114,128,0.1)',
            boxShadow: pulse && isLive ? '0 0 20px rgba(0,255,200,0.4)' : 'none',
          }}
        >
          <Heart
            className={`w-4 h-4 transition-all duration-200 ${pulse ? 'scale-125' : 'scale-100'}`}
            style={{ color: isLive ? '#00ffc8' : '#6b7280' }}
            fill={pulse && isLive ? '#00ffc8' : 'none'}
          />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color: isLive ? '#00ffc8' : '#6b7280' }}>
          {isLive ? 'Live' : 'Paused'}
        </p>
        <p className="text-[10px] text-gray-400 font-mono">
          {lastTickTime ? `Last: ${new Date(lastTickTime).toLocaleTimeString()}` : 'Waiting...'}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// ECG-style Heartbeat Line Canvas
// ============================================================================

export function HeartbeatLineCanvas({ ticks, isLive }: { ticks: TickEvent[]; isLive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const midY = h / 2;

    // Background
    ctx.fillStyle = 'rgba(5,5,16,0.9)';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x < w; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    if (ticks.length === 0) {
      // Flat line
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.strokeStyle = 'rgba(107,114,128,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return;
    }

    // Draw ECG-like trace
    const displayTicks = ticks.slice(0, 60);
    const segmentWidth = w / Math.max(displayTicks.length, 1);

    ctx.beginPath();
    ctx.moveTo(0, midY);

    displayTicks.forEach((tick, i) => {
      const x = i * segmentWidth;
      const amplitude = tick.signal * (h * 0.35);
      const stressBoost = tick.stress * (h * 0.1);

      // ECG-like pattern per tick: small bump, big spike, recovery
      const p1 = x + segmentWidth * 0.15;
      const p2 = x + segmentWidth * 0.3;
      const p3 = x + segmentWidth * 0.45;
      const p4 = x + segmentWidth * 0.55;
      const p5 = x + segmentWidth * 0.75;

      ctx.lineTo(p1, midY - amplitude * 0.2);           // small P-wave bump
      ctx.lineTo(p2, midY + stressBoost * 0.3);          // small dip
      ctx.lineTo(p3, midY - amplitude - stressBoost);     // main QRS spike up
      ctx.lineTo(p4, midY + amplitude * 0.4);             // recovery dip
      ctx.lineTo(p5, midY - amplitude * 0.15);            // T-wave bump
      ctx.lineTo(x + segmentWidth, midY);                 // return to baseline
    });

    // Gradient stroke
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(0,255,200,0.3)');
    gradient.addColorStop(0.5, isLive ? '#00ffc8' : '#6b7280');
    gradient.addColorStop(1, isLive ? '#00ffc8' : '#6b7280');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Glow effect
    ctx.shadowColor = isLive ? '#00ffc8' : '#6b7280';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    offsetRef.current += 1;
  }, [ticks, isLive]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ============================================================================
// Event Timeline Canvas
// ============================================================================

export function EventTimelineCanvas({ ticks }: { ticks: TickEvent[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || ticks.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const padding = { top: 20, bottom: 30, left: 50, right: 20 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Background
    ctx.fillStyle = 'rgba(5,5,16,0.8)';
    ctx.fillRect(0, 0, w, h);

    const timestamps = ticks.map(t => new Date(t.timestamp).getTime());
    const minT = Math.min(...timestamps);
    const maxT = Math.max(...timestamps);
    const timeRange = maxT - minT || 1;

    // Draw timeline axis
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, h - padding.bottom);
    ctx.lineTo(w - padding.right, h - padding.bottom);
    ctx.stroke();

    // Y-axis label
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('signal', padding.left - 8, padding.top + 10);
    ctx.fillText('stress', padding.left - 8, padding.top + plotH * 0.6 + 10);

    // Time labels
    ctx.textAlign = 'center';
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const t = minT + (timeRange * i / tickCount);
      const x = padding.left + (plotW * i / tickCount);
      ctx.fillText(new Date(t).toLocaleTimeString(), x, h - 8);

      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, h - padding.bottom);
      ctx.stroke();
    }

    // Plot events as dots along timeline
    const typeColors: Record<string, string> = {
      kernel: '#00ffc8',
      error: '#ef4444',
      warning: '#eab308',
      info: '#3b82f6',
      synthesis: '#a855f7',
    };

    ticks.forEach(tick => {
      const ts = new Date(tick.timestamp).getTime();
      const x = padding.left + ((ts - minT) / timeRange) * plotW;
      const signalY = padding.top + (1 - tick.signal) * plotH * 0.45;
      const stressY = padding.top + plotH * 0.55 + (1 - tick.stress) * plotH * 0.4;
      const color = typeColors[tick.type] || '#00ffc8';

      // Signal dot
      ctx.beginPath();
      ctx.arc(x, signalY, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Stress dot (smaller, below)
      ctx.beginPath();
      ctx.arc(x, stressY, 2, 0, Math.PI * 2);
      ctx.fillStyle = tick.stress > 0.2 ? '#ef4444' : '#6b7280';
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Divider between signal and stress
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + plotH * 0.5);
    ctx.lineTo(w - padding.right, padding.top + plotH * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [ticks]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ============================================================================
// Main Page Component
// ============================================================================
