'use client';

import React, {
  useRef,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from 'react';

const _panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

export type VFXType =
  | 'construction-sparkles'
  | 'validation-pass'
  | 'validation-fail'
  | 'rain'
  | 'snow'
  | 'fire'
  | 'water-flow'
  | 'electrical-arcs'
  | 'celebration'
  | 'forge-glow'
  // Wave 1 deferral 4: impact dust on knockback wall hits, kill blows.
  | 'dust';

export type WeatherVFX = 'rain' | 'snow' | 'wind-debris' | 'none';

export interface Position2D {
  x: number;
  y: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifetime: number;
  maxLifetime: number;
  color: string;
  size: number;
  alpha: number;
  gravity: number;
}

export interface ParticleEmitter {
  id: string;
  position: Position2D;
  type: VFXType;
  rate: number; // particles per second
  active: boolean;
}

export interface WeatherState {
  type: WeatherVFX;
  intensity: number; // 0-1
  windAngle: number; // degrees
  windStrength: number; // 0-1
}

export interface AccumulationState {
  snowCoverage: number; // 0-1
  puddleCoverage: number; // 0-1
}

export interface ParticleEffectsAPI {
  triggerVFX: (type: VFXType, position: Position2D, count?: number) => void;
  setWeatherVFX: (weather: WeatherState | null) => void;
  addEmitter: (emitter: ParticleEmitter) => void;
  removeEmitter: (id: string) => void;
}

interface ParticleEffectsProps {
  canvasWidth: number;
  canvasHeight: number;
  emitters: ParticleEmitter[];
  weather: WeatherState | null;
  active: boolean;
  children?: React.ReactNode;
}

// ── VFX Color Config ──────────────────────────────────────────────

const vfxColors: Record<VFXType, string[]> = {
  'construction-sparkles': ['#FFD700', '#FFA500', '#FFE066', '#FFCC33'],
  'validation-pass': ['#22C55E', '#4ADE80', '#86EFAC', '#BBFCCD'],
  'validation-fail': ['#EF4444', '#F87171', '#FCA5A5', '#FF6B6B'],
  rain: ['#60A5FA', '#93C5FD', '#BFDBFE'],
  snow: ['#F0F9FF', '#E0F2FE', '#DBEAFE', '#FFFFFF'],
  fire: ['#EF4444', '#F97316', '#FBBF24', '#FDE68A'],
  'water-flow': ['#3B82F6', '#60A5FA', '#93C5FD'],
  'electrical-arcs': ['#A78BFA', '#818CF8', '#E0E7FF', '#FFFFFF'],
  celebration: ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899'],
  'forge-glow': ['#F97316', '#FB923C', '#FDBA74', '#FDE68A'],
  // Dust: gray-brown puff with off-white highlights. Reads as kicked-up
  // debris on hard impact.
  dust: ['#9CA3AF', '#A8A29E', '#D6D3D1', '#E7E5E4', '#78716C'],
};

const vfxGravity: Record<VFXType, number> = {
  'construction-sparkles': -0.02,
  'validation-pass': -0.01,
  'validation-fail': 0.01,
  rain: 0.15,
  snow: 0.02,
  fire: -0.05,
  'water-flow': 0.03,
  'electrical-arcs': 0,
  celebration: 0.04,
  'forge-glow': -0.03,
  // Dust settles slowly downward
  dust: 0.04,
};

// ── Context ───────────────────────────────────────────────────────

const ParticleContext = createContext<ParticleEffectsAPI | null>(null);

export function useParticleEffects(): ParticleEffectsAPI {
  const ctx = useContext(ParticleContext);
  if (!ctx) {
    throw new Error('useParticleEffects must be used within a ParticleEffects provider');
  }
  return ctx;
}

// ── Particle Spawner ──────────────────────────────────────────────

function spawnParticle(type: VFXType, position: Position2D): Particle {
  const colors = vfxColors[type];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.5 + Math.random() * 2;

  return {
    x: position.x + (Math.random() - 0.5) * 20,
    y: position.y + (Math.random() - 0.5) * 20,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    lifetime: 0,
    maxLifetime: 30 + Math.random() * 60,
    color,
    size: 1 + Math.random() * 3,
    alpha: 0.8 + Math.random() * 0.2,
    gravity: vfxGravity[type],
  };
}

function spawnWeatherParticle(
  type: WeatherVFX,
  width: number,
  height: number,
  windAngle: number,
  windStrength: number,
): Particle {
  const colors: Record<WeatherVFX, string[]> = {
    rain: ['#60A5FA', '#93C5FD'],
    snow: ['#F0F9FF', '#FFFFFF', '#E0F2FE'],
    'wind-debris': ['#92400E', '#78716C', '#57534E'],
    none: [],
  };

  const c = colors[type] || ['#FFFFFF'];
  const color = c[Math.floor(Math.random() * c.length)];
  const windRad = (windAngle * Math.PI) / 180;

  return {
    x: Math.random() * width,
    y: -10,
    vx: Math.cos(windRad) * windStrength * 2,
    vy: type === 'rain' ? 4 + Math.random() * 3 : type === 'snow' ? 0.5 + Math.random() : 1 + Math.random() * 2,
    lifetime: 0,
    maxLifetime: type === 'rain' ? 40 + Math.random() * 20 : 80 + Math.random() * 60,
    color,
    size: type === 'rain' ? 1 : type === 'snow' ? 2 + Math.random() * 2 : 1 + Math.random(),
    alpha: type === 'rain' ? 0.4 : 0.7,
    gravity: type === 'rain' ? 0.1 : type === 'snow' ? 0.005 : 0.02,
  };
}

// ── Component ─────────────────────────────────────────────────────

export default function ParticleEffects({
  canvasWidth,
  canvasHeight,
  emitters: externalEmitters,
  weather: externalWeather,
  active,
  children,
}: ParticleEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const emittersRef = useRef<Map<string, ParticleEmitter>>(new Map());
  const weatherRef = useRef<WeatherState | null>(externalWeather);
  const accumulationRef = useRef<AccumulationState>({ snowCoverage: 0, puddleCoverage: 0 });
  const frameRef = useRef<number>(0);

  // Sync external emitters
  useEffect(() => {
    const map = new Map<string, ParticleEmitter>();
    externalEmitters.forEach((e) => map.set(e.id, e));
    emittersRef.current = map;
  }, [externalEmitters]);

  // Sync external weather
  useEffect(() => {
    weatherRef.current = externalWeather;
  }, [externalWeather]);

  // Trigger a burst of particles
  const triggerVFX = useCallback((type: VFXType, position: Position2D, count = 20) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push(spawnParticle(type, position));
    }
  }, []);

  // Wave 1 deferral 4: window-event dispatch so sibling components can fire
  // particle effects without being inside this provider. Mirrors the
  // SoundscapeEngine `concordia:soundscape-command` pattern.
  // detail: { type: VFXType, position: { x, y }, count?: number }
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { type?: VFXType; position?: Position2D; count?: number }
        | undefined;
      if (!detail?.type || !detail.position) return;
      triggerVFX(detail.type, detail.position, detail.count ?? 12);
    };
    window.addEventListener('concordia:particle-effect', handler);
    return () => window.removeEventListener('concordia:particle-effect', handler);
  }, [triggerVFX]);

  const setWeatherVFX = useCallback((weather: WeatherState | null) => {
    weatherRef.current = weather;
  }, []);

  const addEmitter = useCallback((emitter: ParticleEmitter) => {
    emittersRef.current.set(emitter.id, emitter);
  }, []);

  const removeEmitter = useCallback((id: string) => {
    emittersRef.current.delete(id);
  }, []);

  // Render loop
  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastEmitTime = 0;

    const render = (time: number) => {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      const dt = 1; // fixed step

      // Emit from emitters
      const elapsed = time - lastEmitTime;
      if (elapsed > 50) {
        lastEmitTime = time;
        emittersRef.current.forEach((emitter) => {
          if (!emitter.active) return;
          const count = Math.ceil(emitter.rate / 20);
          for (let i = 0; i < count; i++) {
            particlesRef.current.push(spawnParticle(emitter.type, emitter.position));
          }
        });

        // Weather particles
        const w = weatherRef.current;
        if (w && w.type !== 'none') {
          const count = Math.ceil(w.intensity * 5);
          for (let i = 0; i < count; i++) {
            particlesRef.current.push(
              spawnWeatherParticle(w.type, canvasWidth, canvasHeight, w.windAngle, w.windStrength),
            );
          }

          // Accumulation
          if (w.type === 'snow') {
            accumulationRef.current.snowCoverage = Math.min(
              1,
              accumulationRef.current.snowCoverage + 0.0001 * w.intensity,
            );
          } else if (w.type === 'rain') {
            accumulationRef.current.puddleCoverage = Math.min(
              1,
              accumulationRef.current.puddleCoverage + 0.0001 * w.intensity,
            );
            accumulationRef.current.snowCoverage = Math.max(
              0,
              accumulationRef.current.snowCoverage - 0.001,
            );
          }
        }
      }

      // Update and draw particles
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.lifetime += dt;
        if (p.lifetime > p.maxLifetime) continue;

        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;

        const lifePct = p.lifetime / p.maxLifetime;
        const alpha = p.alpha * (1 - lifePct);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        alive.push(p);
      }
      particlesRef.current = alive;

      // Draw accumulation overlays
      const acc = accumulationRef.current;
      if (acc.snowCoverage > 0.01) {
        ctx.globalAlpha = acc.snowCoverage * 0.15;
        ctx.fillStyle = '#F0F9FF';
        ctx.fillRect(0, canvasHeight * 0.85, canvasWidth, canvasHeight * 0.15);
      }
      if (acc.puddleCoverage > 0.01) {
        ctx.globalAlpha = acc.puddleCoverage * 0.1;
        ctx.fillStyle = '#3B82F6';
        ctx.fillRect(0, canvasHeight * 0.9, canvasWidth, canvasHeight * 0.1);
      }

      ctx.globalAlpha = 1;

      frameRef.current = requestAnimationFrame(render);
    };

    frameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  }, [active, canvasWidth, canvasHeight]);

  const api: ParticleEffectsAPI = {
    triggerVFX,
    setWeatherVFX,
    addEmitter,
    removeEmitter,
  };

  return (
    <ParticleContext.Provider value={api}>
      <div className="relative" style={{ width: canvasWidth, height: canvasHeight }}>
        {children}
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="absolute inset-0 pointer-events-none z-30"
        />
      </div>
    </ParticleContext.Provider>
  );
}
