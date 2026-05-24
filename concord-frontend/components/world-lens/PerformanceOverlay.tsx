'use client';

/**
 * PerformanceOverlay
 *
 * Toggleable HUD that surfaces FPS, frame time, draw calls, triangles, and
 * texture memory. Pulls from `concordia:perf-budget` events emitted by the
 * scene loop and posts a rolling sample to /api/world/perf-telemetry every
 * 30s so the server can aggregate frame-budget breaches across the player
 * base. Also dispatches `concordia:perf-alert` when sustained FPS drops
 * below threshold so other systems (auto-downgrade, GameJuice) can react.
 *
 * Toggle with backtick (`) or via prop.
 */

import { useEffect, useRef, useState } from 'react';

export interface PerformanceSample {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
  textureMemory: number;
  maxFrameTime: number; // budget ceiling, ms
}

interface PerformanceOverlayProps {
  visible?: boolean;
  reportEndpoint?: string;
  reportIntervalMs?: number;
  budgetFrameTimeMs?: number; // default 16.67 = 60fps
}

const PANEL =
  'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg font-mono text-[11px]';

export default function PerformanceOverlay({
  visible: visibleProp,
  reportEndpoint = '/api/world/perf-telemetry',
  reportIntervalMs = 30_000,
  budgetFrameTimeMs = 16.67,
}: PerformanceOverlayProps) {
  const [visible, setVisible] = useState(visibleProp ?? false);
  const [sample, setSample] = useState<PerformanceSample>({
    fps: 0,
    frameTime: 0,
    drawCalls: 0,
    triangles: 0,
    textureMemory: 0,
    maxFrameTime: budgetFrameTimeMs,
  });

  const sampleRingRef = useRef<PerformanceSample[]>([]);
  const lastAlertRef = useRef(0);
  const lastReportRef = useRef(0);

  useEffect(() => {
    if (typeof visibleProp === 'boolean') setVisible(visibleProp);
  }, [visibleProp]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '`' || e.key === '~') setVisible((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onBudget(ev: Event) {
      const detail = (ev as CustomEvent).detail as Partial<PerformanceSample> | undefined;
      if (!detail) return;
      const next: PerformanceSample = {
        fps: Math.round(detail.fps ?? 0),
        frameTime: Math.round((detail.frameTime ?? 0) * 10) / 10,
        drawCalls: detail.drawCalls ?? 0,
        triangles: detail.triangles ?? 0,
        textureMemory: detail.textureMemory ?? 0,
        maxFrameTime: budgetFrameTimeMs,
      };
      setSample(next);

      sampleRingRef.current.push(next);
      if (sampleRingRef.current.length > 240) sampleRingRef.current.shift();

      // Alert when we exceed budget for 2 consecutive seconds (~120 frames @ 60fps)
      const tail = sampleRingRef.current.slice(-120);
      const breaching = tail.length >= 60 && tail.every((s) => s.frameTime > budgetFrameTimeMs * 1.4);
      if (breaching && Date.now() - lastAlertRef.current > 10_000) {
        lastAlertRef.current = Date.now();
        const avgFps = Math.round(tail.reduce((a, s) => a + s.fps, 0) / tail.length);
        window.dispatchEvent(
          new CustomEvent('concordia:perf-alert', {
            detail: {
              kind: 'frame-budget-exceeded',
              avgFps,
              avgFrameTime: tail.reduce((a, s) => a + s.frameTime, 0) / tail.length,
            },
          })
        );
      }
    }
    window.addEventListener('concordia:perf-budget', onBudget);
    return () => window.removeEventListener('concordia:perf-budget', onBudget);
  }, [budgetFrameTimeMs]);

  // Periodic telemetry POST so the server can aggregate breaches across users.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() - lastReportRef.current < reportIntervalMs) return;
      lastReportRef.current = Date.now();
      const ring = sampleRingRef.current;
      if (!ring.length) return;
      const avgFps = ring.reduce((a, s) => a + s.fps, 0) / ring.length;
      const avgFrameTime = ring.reduce((a, s) => a + s.frameTime, 0) / ring.length;
      const breaches = ring.filter((s) => s.frameTime > budgetFrameTimeMs * 1.4).length;
      const payload = {
        avgFps: Math.round(avgFps * 10) / 10,
        avgFrameTime: Math.round(avgFrameTime * 10) / 10,
        breaches,
        samples: ring.length,
        budget: budgetFrameTimeMs,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : 'unknown',
      };
      try {
        fetch(reportEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include',
        }).catch(() => { /* telemetry silent */ });
      } catch { /* fetch unavailable in SSR */ }
    }, reportIntervalMs);
    return () => window.clearInterval(id);
  }, [reportEndpoint, reportIntervalMs, budgetFrameTimeMs]);

  if (!visible) return null;

  const overBudget = sample.frameTime > budgetFrameTimeMs * 1.2;
  const dangerous = sample.frameTime > budgetFrameTimeMs * 1.6;

  return (
    <div className={`${PANEL} fixed top-4 right-4 z-[60] p-3 min-w-[200px]`}>
      <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">
        Concordia Telemetry
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-gray-400">FPS</span>
        <span className={dangerous ? 'text-red-400' : overBudget ? 'text-yellow-400' : 'text-green-400'}>
          {sample.fps}
        </span>
        <span className="text-gray-400">Frame ms</span>
        <span className={dangerous ? 'text-red-400' : overBudget ? 'text-yellow-400' : 'text-green-400'}>
          {sample.frameTime.toFixed(1)} / {budgetFrameTimeMs.toFixed(1)}
        </span>
        <span className="text-gray-400">Draws</span>
        <span className="text-cyan-300">{sample.drawCalls.toLocaleString()}</span>
        <span className="text-gray-400">Tris</span>
        <span className="text-cyan-300">{(sample.triangles / 1000).toFixed(1)}k</span>
        <span className="text-gray-400">Tex MB</span>
        <span className="text-cyan-300">{Math.round(sample.textureMemory)}</span>
      </div>
      <div className="mt-2 text-[9px] text-gray-400">
        Toggle with <kbd className="px-1 border border-white/20 rounded">`</kbd>
      </div>
    </div>
  );
}
