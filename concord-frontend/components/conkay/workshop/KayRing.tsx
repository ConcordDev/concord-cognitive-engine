'use client';

/**
 * KayRing — ConKay's presence: a ring of arc light, not an avatar.
 *
 * Every frame is a function of real state (the honest-hologram rule):
 *  - listening → the ring's brightness and thickness follow the
 *    microphone's measured level (useMicAmplitude's ref);
 *  - working (a request in flight) → one arc segment turns, an
 *    indeterminate mark that never claims a percentage;
 *  - speaking (speech synthesis actually playing) → a steady breath;
 *  - idle → a dim, still ring.
 * Reduced motion: the ring holds still and only its colour changes.
 */

import { useEffect, useRef } from 'react';

export type KayState = 'idle' | 'listening' | 'working' | 'speaking' | 'unavailable';

export function KayRing({ state, levelRef, size = 56 }: { state: KayState; levelRef?: React.MutableRefObject<number>; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    c.width = size * dpr; c.height = size * dpr;
    let raf = 0;
    let smooth = 0;
    const draw = (t: number) => {
      const st = stateRef.current;
      const w = c.width, h = c.height, cx = w / 2, cy = h / 2;
      const r = w * 0.36;
      g.clearRect(0, 0, w, h);
      const level = st === 'listening' && levelRef ? Math.min(1, levelRef.current * 3) : 0;
      smooth += (level - smooth) * 0.25;
      const breath = st === 'speaking' && !reduced ? 0.5 + 0.5 * Math.sin(t / 380) : 0;
      const base = st === 'unavailable' ? 0.18 : st === 'idle' ? 0.42 : 0.7;
      const alpha = Math.min(1, base + smooth * 0.6 + breath * 0.25);
      const lw = (1.6 + smooth * 5 + breath * 1.5) * dpr;
      // Outer glow.
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.strokeStyle = `rgba(89, 227, 255, ${alpha * 0.25})`;
      g.lineWidth = lw * 4;
      g.stroke();
      // Core ring.
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.strokeStyle = `rgba(150, 240, 255, ${alpha})`;
      g.lineWidth = lw;
      g.stroke();
      // Inner tick ring.
      g.save();
      g.translate(cx, cy);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
        g.lineTo(Math.cos(a) * r * (0.78 + smooth * 0.1), Math.sin(a) * r * (0.78 + smooth * 0.1));
        g.strokeStyle = `rgba(89, 227, 255, ${0.18 + smooth * 0.5})`;
        g.lineWidth = 1 * dpr;
        g.stroke();
      }
      g.restore();
      // Working: one turning arc.
      if (st === 'working') {
        const a0 = reduced ? 0 : (t / 520) % (Math.PI * 2);
        g.beginPath();
        g.arc(cx, cy, r * 1.22, a0, a0 + Math.PI * 0.55);
        g.strokeStyle = 'rgba(89, 227, 255, 0.95)';
        g.lineWidth = 2 * dpr;
        g.lineCap = 'round';
        g.stroke();
      }
      // Core dot.
      g.beginPath();
      g.arc(cx, cy, r * (0.16 + smooth * 0.18), 0, Math.PI * 2);
      g.fillStyle = `rgba(200, 248, 255, ${0.35 + alpha * 0.5})`;
      g.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, size]);

  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden data-kay-state={state} />;
}

export default KayRing;
