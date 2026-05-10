'use client';

/**
 * SeasonalEffects — Sprint C / Track B2
 *
 * Subscribes to `world:season-transition` and `world:weather` socket events
 * and renders season-appropriate visual layers above the active world:
 *
 *   - deep_winter / late_winter   → snow particle drift (slanted by wind)
 *   - early_spring                 → patchy snow + tree buds (alpha overlay)
 *   - high_summer                  → golden tint + heat shimmer
 *   - autumn                       → leaf-fall particle drift
 *
 * The component sits above the canvas as a fixed-position overlay and uses
 * a single `<canvas>` for particle motion (CPU-driven, ~50 sprites max so
 * the 60fps tick stays cheap on integrated GPUs).
 */

import React, { useEffect, useRef, useState } from 'react';

type Season =
  | 'deep_winter' | 'late_winter' | 'early_spring' | 'late_spring'
  | 'high_summer' | 'autumn';

interface WeatherEvent {
  worldId?: string;
  windDirection?: number; // radians
  kind?: string;
}

interface SeasonEvent {
  worldId?: string;
  toSeason?: Season;
}

type ParticleKind = 'snow' | 'leaf' | 'pollen' | 'none';

const PARTICLE_BY_SEASON: Record<Season, ParticleKind> = {
  deep_winter:  'snow',
  late_winter:  'snow',
  early_spring: 'pollen',
  late_spring:  'none',
  high_summer:  'none',
  autumn:       'leaf',
};

const TINT_BY_SEASON: Record<Season, string | null> = {
  deep_winter:  'rgba(180, 200, 220, 0.10)',
  late_winter:  'rgba(190, 210, 220, 0.06)',
  early_spring: 'rgba(180, 220, 180, 0.05)',
  late_spring:  null,
  high_summer:  'rgba(255, 220, 130, 0.06)',
  autumn:       'rgba(220, 160, 90, 0.08)',
};

const PARTICLE_COUNT = 50;

interface Particle { x: number; y: number; vx: number; vy: number; r: number; }

interface Props { worldId: string; }

export default function SeasonalEffects({ worldId }: Props) {
  const [season, setSeason] = useState<Season | null>(null);
  const [windDir, setWindDir] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);

  // Listen for socket events bridged via `window` CustomEvents (the world
  // lens already does this for other socket-aware components).
  useEffect(() => {
    const onSeason = (e: Event) => {
      const ce = e as CustomEvent<SeasonEvent>;
      if (ce.detail?.worldId && ce.detail.worldId !== worldId) return;
      if (ce.detail?.toSeason) setSeason(ce.detail.toSeason);
    };
    const onWeather = (e: Event) => {
      const ce = e as CustomEvent<WeatherEvent>;
      if (ce.detail?.worldId && ce.detail.worldId !== worldId) return;
      if (typeof ce.detail?.windDirection === 'number') setWindDir(ce.detail.windDirection);
    };
    window.addEventListener('concordia:season-transition', onSeason as EventListener);
    window.addEventListener('concordia:weather', onWeather as EventListener);
    return () => {
      window.removeEventListener('concordia:season-transition', onSeason as EventListener);
      window.removeEventListener('concordia:weather', onWeather as EventListener);
    };
  }, [worldId]);

  // Initial fetch of current season (best-effort — endpoint may 404 on
  // minimal builds, in which case we fall back to no overlay).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'seasons', name: 'current', input: { worldId } }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j?.season) setSeason(j.season as Season);
      } catch { /* fine */ }
    })();
    return () => { cancelled = true; };
  }, [worldId]);

  // Allocate particles when season changes.
  useEffect(() => {
    if (!season) { particlesRef.current = []; return; }
    const kind = PARTICLE_BY_SEASON[season];
    if (kind === 'none') { particlesRef.current = []; return; }
    const w = window.innerWidth;
    const h = window.innerHeight;
    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 0, vy: 0,
      r: kind === 'leaf' ? 4 + Math.random() * 4 : 2 + Math.random() * 2,
    }));
  }, [season]);

  // Animation loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !season) return;
    const kind = PARTICLE_BY_SEASON[season];
    if (kind === 'none') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const baseFallSpeed = kind === 'leaf' ? 1.5 : kind === 'pollen' ? 0.6 : 1.2;
    const tick = () => {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = kind === 'snow' ? 'rgba(240,245,255,0.85)'
                  : kind === 'leaf' ? 'rgba(220,140,80,0.85)'
                  : 'rgba(220,220,180,0.6)';
      const windX = Math.sin(windDir) * 0.6;
      for (const p of particlesRef.current) {
        p.vx = (p.vx * 0.95) + windX;
        p.vy = baseFallSpeed + (Math.random() - 0.5) * 0.2;
        p.x += p.vx;
        p.y += p.vy;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        if (p.x > w + 10) p.x = -10;
        if (p.x < -10) p.x = w + 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [season, windDir]);

  if (!season) return null;
  const tint = TINT_BY_SEASON[season];

  return (
    <>
      {tint && (
        <div
          aria-hidden
          style={{
            position: 'fixed', inset: 0, zIndex: 5, pointerEvents: 'none',
            background: tint,
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 6, pointerEvents: 'none',
        }}
      />
    </>
  );
}
