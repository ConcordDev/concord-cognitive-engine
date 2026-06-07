'use client';

// concord-frontend/components/conkay/ConKaySurface.tsx
//
// The 2D fallback field (canvas, rAF — cheap, single loop, capped count) used
// when WebGL is unavailable or prefers-reduced-motion is set. Field only — the
// status HUD lives in ConKayHud, mounted separately by ConKayBackdrop. The
// behavior is driven by the real state machine: idle (drift), listening
// (orient inward + breathe), processing/acting (swirl), presenting (assemble).

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { ConKayState } from './conkay-persona';
import { CONKAY_STATE_COLOR } from './ConKayHud';

interface P { x: number; y: number; vx: number; vy: number; r: number; }

export function ConKaySurface({ state, className }: { state: ConKayState; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<ConKayState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let w = 0, h = 0;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const particles: P[] = [];
    const hexToRgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const N = reduced ? 0 : Math.min(110, Math.max(30, Math.floor((w * h) / 9000)));
    for (let i = 0; i < N; i++) particles.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, r: Math.random() * 1.6 + 0.4 });

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      const [r, g, b] = hexToRgb(CONKAY_STATE_COLOR[stateRef.current]);
      const grad = ctx.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, Math.max(w, h) * 0.5);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.14)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 2.4, 0, Math.PI * 2); ctx.fill();
    };

    if (reduced) {
      drawStatic();
      const onResize = () => { resize(); drawStatic(); };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    let t = 0;
    const loop = () => {
      t += 0.016;
      const st = stateRef.current;
      const [r, g, b] = hexToRgb(CONKAY_STATE_COLOR[st]);
      const cx = w / 2, cy = h / 2;
      ctx.clearRect(0, 0, w, h);
      const glow = st === 'processing' || st === 'acting' ? 0.12 : st === 'presenting' ? 0.10 : st === 'listening' ? 0.08 : 0.05;
      const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, Math.max(w, h) * 0.55);
      bg.addColorStop(0, `rgba(${r},${g},${b},${glow})`); bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

      for (const p of particles) {
        if (st === 'processing' || st === 'acting') {
          const dx = p.x - cx, dy = p.y - cy, ang = Math.atan2(dy, dx) + 0.03, dist = Math.max(8, Math.hypot(dx, dy));
          p.x = cx + Math.cos(ang) * dist + (Math.random() - 0.5) * 0.6; p.y = cy + Math.sin(ang) * dist + (Math.random() - 0.5) * 0.6;
        } else if (st === 'listening') {
          p.x += (cx - p.x) * 0.005 + Math.sin(t * 1.5 + p.r) * 0.25; p.y += (cy - p.y) * 0.005 + Math.cos(t * 1.5 + p.r) * 0.25;
        } else { p.x += p.vx; p.y += p.vy; }
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0; if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      }
      const LINK = 70; ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const bp = particles[j]; const dx = a.x - bp.x, dy = a.y - bp.y, d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) { const alpha = (1 - Math.sqrt(d2) / LINK) * 0.16; ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bp.x, bp.y); ctx.stroke(); }
        }
      }
      for (const p of particles) { ctx.beginPath(); ctx.fillStyle = `rgba(${r},${g},${b},${st === 'idle' ? 0.5 : 0.75})`; ctx.arc(p.x, p.y, p.r + 0.4, 0, Math.PI * 2); ctx.fill(); }

      const baseR = Math.min(w, h) * 0.14;
      const pulse = st === 'listening' ? 1 + Math.sin(t * 3) * 0.18 : st === 'presenting' ? 1 + Math.sin(t * 6) * 0.1 : st === 'idle' ? 1 + Math.sin(t * 1.2) * 0.06 : 1;
      const coreR = baseR * pulse;
      const core = ctx.createRadialGradient(cx, cy, 1, cx, cy, coreR);
      core.addColorStop(0, `rgba(${r},${g},${b},0.9)`); core.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`); core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
      if (st === 'processing' || st === 'acting') { ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, baseR * 1.3, t * 3 % (Math.PI * 2), (t * 3 % (Math.PI * 2)) + Math.PI * 0.6); ctx.stroke(); }
      ctx.fillStyle = `rgba(${r},${g},${b},1)`; ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill();

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={cn('h-full w-full', className)} />;
}

export default ConKaySurface;
