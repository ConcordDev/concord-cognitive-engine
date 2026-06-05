'use client';

// concord-frontend/components/conkay/ConKaySurface.tsx
//
// ConKay's holographic surface: an ambient particle field (canvas, rAF-driven —
// cheap, single loop, capped count) behind the conversation, plus a state HUD.
// The field's behavior is driven by the REAL state machine — idle (slow drift),
// listening (particles orient inward + pulse), processing (swirl — the brain is
// working), presenting (assemble), acting (flare). Honors prefers-reduced-motion
// (renders a calm static glow, no animation). This is the P0 2D surface; the
// Three.js/WebGPU port (Concordia) is the P1/P2 upgrade — same state contract.

import { useEffect, useRef } from 'react';
import { Mic, Volume2, VolumeX, Loader2, Sparkles } from 'lucide-react';
import type { ConKayState } from './conkay-persona';
import { CONKAY_NAME } from './conkay-persona';

const STATE_LABEL: Record<ConKayState, string> = {
  idle: 'Listening for you',
  listening: 'Listening…',
  processing: 'Thinking…',
  presenting: 'Here it is',
  acting: 'Working…',
};
const STATE_COLOR: Record<ConKayState, string> = {
  idle: '#22d3ee', listening: '#34d399', processing: '#a855f7', presenting: '#00d4ff', acting: '#fbbf24',
};

interface P { x: number; y: number; vx: number; vy: number; r: number; }

export function ConKaySurface({
  state, muted, onToggleMute, listening, speaking, voiceSupported,
}: {
  state: ConKayState;
  muted: boolean;
  onToggleMute: () => void;
  listening: boolean;
  speaking: boolean;
  voiceSupported: boolean;
}) {
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

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const N = reduced ? 0 : Math.min(80, Math.max(26, Math.floor((w * h) / 9000)));
    for (let i = 0; i < N; i++) {
      particles.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, r: Math.random() * 1.6 + 0.4 });
    }

    const hexToRgb = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      const [r, g, b] = hexToRgb(STATE_COLOR[stateRef.current]);
      const grad = ctx.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, Math.max(w, h) * 0.5);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.16)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // a calm static core so reduced-motion still reads as "ConKay is here"
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
      const [r, g, b] = hexToRgb(STATE_COLOR[st]);
      const cx = w / 2, cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      // ambient radial glow keyed to state
      const glow = st === 'processing' || st === 'acting' ? 0.12 : st === 'presenting' ? 0.10 : st === 'listening' ? 0.08 : 0.05;
      const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, Math.max(w, h) * 0.55);
      bg.addColorStop(0, `rgba(${r},${g},${b},${glow})`);
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // move particles per state
      for (const p of particles) {
        if (st === 'processing' || st === 'acting') {
          const dx = p.x - cx, dy = p.y - cy;
          const ang = Math.atan2(dy, dx) + 0.03;
          const dist = Math.max(8, Math.hypot(dx, dy));
          p.x = cx + Math.cos(ang) * dist + (Math.random() - 0.5) * 0.6;
          p.y = cy + Math.sin(ang) * dist + (Math.random() - 0.5) * 0.6;
        } else if (st === 'listening') {
          p.x += (cx - p.x) * 0.005 + Math.sin(t * 1.5 + p.r) * 0.25;
          p.y += (cy - p.y) * 0.005 + Math.cos(t * 1.5 + p.r) * 0.25;
        } else {
          p.x += p.vx; p.y += p.vy;
        }
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      }

      // constellation links — the "holographic" mesh (capped distance)
      const LINK = 64;
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const bp = particles[j];
          const dx = a.x - bp.x, dy = a.y - bp.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            const alpha = (1 - Math.sqrt(d2) / LINK) * 0.18;
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
          }
        }
      }
      // particles on top
      for (const p of particles) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r},${g},${b},${st === 'idle' ? 0.5 : 0.75})`;
        ctx.arc(p.x, p.y, p.r + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // central reactor core — ConKay's "presence", reacts to state
      const baseR = Math.min(w, h) * 0.16;
      const pulse = st === 'listening' ? 1 + Math.sin(t * 3) * 0.18
        : st === 'presenting' ? 1 + Math.sin(t * 6) * 0.10
        : st === 'idle' ? 1 + Math.sin(t * 1.2) * 0.06 : 1;
      const coreR = baseR * pulse;
      const core = ctx.createRadialGradient(cx, cy, 1, cx, cy, coreR);
      core.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
      core.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`);
      core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
      // rotating arc when the brain is working
      if (st === 'processing' || st === 'acting') {
        ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 1.25, t * 3 % (Math.PI * 2), (t * 3 % (Math.PI * 2)) + Math.PI * 0.6);
        ctx.stroke();
      }
      // crisp inner dot
      ctx.fillStyle = `rgba(${r},${g},${b},1)`;
      ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill();

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full border border-cyan-400/25 bg-lattice-void/70 px-3 py-1.5 backdrop-blur-md">
        <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-[12px] font-semibold tracking-wide text-cyan-100">{CONKAY_NAME}</span>
        <span className="flex items-center gap-1 text-[11px]" style={{ color: STATE_COLOR[state] }}>
          {state === 'processing' || state === 'acting' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {STATE_LABEL[state]}
        </span>
        {voiceSupported && (
          <button onClick={onToggleMute} title={muted ? 'Unmute voice' : 'Mute voice'}
            className="ml-1 grid h-6 w-6 place-items-center rounded-full hover:bg-white/10">
            {muted ? <VolumeX className="h-3.5 w-3.5 text-zinc-400" />
              : speaking ? <Volume2 className="h-3.5 w-3.5 text-cyan-300" />
              : listening ? <Mic className="h-3.5 w-3.5 text-emerald-300" />
              : <Volume2 className="h-3.5 w-3.5 text-zinc-300" />}
          </button>
        )}
      </div>
    </>
  );
}

export default ConKaySurface;
