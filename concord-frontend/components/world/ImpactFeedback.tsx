'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type HitSeverity = 'light' | 'heavy' | 'crit' | 'kill';

interface HitNumber {
  id: number;
  value: number;
  element: 'fire' | 'ice' | 'lightning' | 'poison' | 'physical' | 'heal';
  x: number;        // viewport percent
  y: number;
  driftX: number;   // px horizontal drift over lifetime
  rotation: number; // initial rotation deg
  critical: boolean;
  createdAt: number;
}

interface ShakeState {
  active: boolean;
  intensity: number; // 1-10
}

interface HitStopState {
  active: boolean;
  severity: HitSeverity;
}

// ── Element color map ─────────────────────────────────────────────────────────

const ELEMENT_COLOR: Record<HitNumber['element'], string> = {
  fire: 'text-orange-400 drop-shadow-[0_0_6px_rgba(251,146,60,0.9)]',
  ice: 'text-cyan-300 drop-shadow-[0_0_6px_rgba(147,197,253,0.9)]',
  lightning: 'text-yellow-300 drop-shadow-[0_0_6px_rgba(253,224,71,0.9)]',
  poison: 'text-green-400 drop-shadow-[0_0_6px_rgba(74,222,128,0.9)]',
  physical: 'text-white drop-shadow-[0_0_4px_rgba(255,255,255,0.6)]',
  heal: 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.9)]',
};

const ELEMENT_SYMBOL: Record<HitNumber['element'], string> = {
  fire: '🔥',
  ice: '❄',
  lightning: '⚡',
  poison: '☠',
  physical: '',
  heal: '✦',
};

// ── Public API — call these from the world page ────────────────────────────────

let _emitHit: ((value: number, element: HitNumber['element'], critical?: boolean) => void) | null =
  null;
let _emitShake: ((intensity: number) => void) | null = null;
let _emitHeal: ((value: number) => void) | null = null;
let _emitStop: ((durationMs: number, severity?: HitSeverity) => void) | null = null;

export function emitHitNumber(
  value: number,
  element: HitNumber['element'] = 'physical',
  critical = false
) {
  _emitHit?.(value, element, critical);
}

export function emitScreenShake(intensity: number) {
  _emitShake?.(intensity);
}

/**
 * Brief brightness + contrast flash that makes hits feel physically weighty.
 * durationMs: 60–80ms light, 100–140ms heavy, 140–180ms crit, 220–280ms kill.
 * severity controls hit-pause zoom strength (kill > crit > heavy > light).
 */
export function emitHitStop(durationMs = 80, severity: HitSeverity = 'light'): void {
  _emitStop?.(durationMs, severity);
  // Visual-polish Wave 5 — RGB-split pulse on every impact via window event;
  // ConcordiaScene's chromatic-aberration post pass listens for it.
  try {
    const mag = severity === 'kill' ? 0.030
              : severity === 'crit' ? 0.022
              : severity === 'heavy' ? 0.015
              : 0.010;
    const dur = severity === 'kill' ? 360
              : severity === 'crit' ? 300
              : severity === 'heavy' ? 240
              : 180;
    window.dispatchEvent(new CustomEvent('concordia:chromatic-pulse', {
      detail: { magnitude: mag, durationMs: dur },
    }));
  } catch { /* SSR-safe */ }
}

export function emitHealNumber(value: number) {
  _emitHit?.(value, 'heal', false);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImpactFeedback() {
  const [hitNumbers, setHitNumbers] = useState<HitNumber[]>([]);
  const [shake, setShake] = useState<ShakeState>({ active: false, intensity: 0 });
  const [hitStop, setHitStop] = useState<HitStopState>({ active: false, severity: 'light' });
  const counterRef = useRef(0);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hitStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addHit = useCallback((value: number, element: HitNumber['element'], critical = false) => {
    const id = ++counterRef.current;
    // Cluster around center, jitter so multi-hits don't overlap
    const x = 42 + Math.random() * 16;
    const y = 36 + Math.random() * 12;
    // Sideways drift: ±60px for normal, ±100px for crits
    const driftX = (Math.random() - 0.5) * (critical ? 200 : 120);
    // Slight rotation jitter — crits tilt more for impact
    const rotation = (Math.random() - 0.5) * (critical ? 16 : 8);
    setHitNumbers((prev) => [
      ...prev.slice(-24),
      { id, value, element, x, y, driftX, rotation, critical, createdAt: Date.now() },
    ]);
    const lifeMs = critical ? 1500 : 1100;
    setTimeout(() => setHitNumbers((prev) => prev.filter((h) => h.id !== id)), lifeMs);
  }, []);

  const triggerShake = useCallback((intensity: number) => {
    setShake({ active: true, intensity: Math.min(10, Math.max(1, intensity)) });
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    const dur = 150 + intensity * 30;
    shakeTimerRef.current = setTimeout(() => setShake({ active: false, intensity: 0 }), dur);
  }, []);

  const triggerHitStop = useCallback((durationMs: number, severity: HitSeverity = 'light') => {
    setHitStop({ active: true, severity });
    if (hitStopTimerRef.current) clearTimeout(hitStopTimerRef.current);
    hitStopTimerRef.current = setTimeout(
      () => setHitStop({ active: false, severity: 'light' }),
      Math.max(40, durationMs),
    );
  }, []);

  // Register global emitters
  useEffect(() => {
    _emitHit = addHit;
    _emitShake = triggerShake;
    _emitStop = triggerHitStop;
    return () => {
      _emitHit = null;
      _emitShake = null;
      _emitHeal = null;
      _emitStop = null;
    };
  }, [addHit, triggerShake, triggerHitStop]);

  // CSS shake style — random jitter on each render frame for genuine motion
  const shakeStyle = shake.active
    ? {
        transform: `translate(${(Math.random() - 0.5) * shake.intensity * 2}px, ${(Math.random() - 0.5) * shake.intensity}px)`,
        transition: 'transform 50ms ease-out',
      }
    : {};

  // Hit-stop config by severity — controls flash strength + zoom + tint
  const hitStopCfg: Record<HitSeverity, {
    brightness: number;
    saturation: number;
    contrast: number;
    zoom: number;
    tint: string;
  }> = {
    light: { brightness: 1.35, saturation: 1.20, contrast: 1.05, zoom: 1.000, tint: 'rgba(255,255,255,0.05)' },
    heavy: { brightness: 1.50, saturation: 1.30, contrast: 1.10, zoom: 1.005, tint: 'rgba(255,200,140,0.07)' },
    crit:  { brightness: 1.70, saturation: 1.45, contrast: 1.15, zoom: 1.012, tint: 'rgba(255,220,80,0.10)' },
    kill:  { brightness: 1.85, saturation: 1.55, contrast: 1.20, zoom: 1.020, tint: 'rgba(255,90,60,0.13)' },
  };

  return (
    <>
      {/* Hit-stop: brightness + saturation spike + transient zoom on impact */}
      {hitStop.active && (() => {
        const cfg = hitStopCfg[hitStop.severity];
        return (
          <div
            className="fixed inset-0 z-[7] pointer-events-none"
            style={{
              backdropFilter: `brightness(${cfg.brightness}) saturate(${cfg.saturation}) contrast(${cfg.contrast})`,
              WebkitBackdropFilter: `brightness(${cfg.brightness}) saturate(${cfg.saturation}) contrast(${cfg.contrast})`,
              background: `radial-gradient(circle at 50% 50%, ${cfg.tint} 0%, transparent 70%)`,
              transform: `scale(${cfg.zoom})`,
              transformOrigin: '50% 45%',
              transition: 'transform 60ms ease-out',
            }}
          />
        );
      })()}

      {/* Screen shake wrapper */}
      {shake.active && (
        <div className="fixed inset-0 z-[5] pointer-events-none" style={shakeStyle} />
      )}

      {/* Red vignette on heavy damage (intensity ≥ 3) */}
      {shake.active && shake.intensity >= 3 && (
        <div
          className="fixed inset-0 z-[6] pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, transparent 40%, rgba(220,38,38,${Math.min(0.4, shake.intensity * 0.04)}) 100%)`,
          }}
        />
      )}

      {/* Floating hit numbers — scale-pop spawn + parabolic arc + horizontal drift */}
      <div className="fixed inset-0 z-[45] pointer-events-none overflow-hidden">
        {hitNumbers.map((hit) => {
          const lifeMs = hit.critical ? 1500 : 1100;
          const age = (Date.now() - hit.createdAt) / lifeMs; // 0..1
          const ageClamp = Math.max(0, Math.min(1, age));

          // Scale-pop: 0.3 → peak (1.4 normal / 1.7 crit) → settle to 1.0/1.4
          // Pop window 0..0.10 of lifetime
          const popProgress = Math.min(1, ageClamp / 0.10);
          const popScale = popProgress < 0.5
            ? 0.3 + popProgress * 2 * (hit.critical ? 1.7 : 1.4 - 0.3)
            : (hit.critical ? 1.7 : 1.4) - (popProgress - 0.5) * 2 * ((hit.critical ? 1.7 : 1.4) - (hit.critical ? 1.4 : 1.0));
          const restScale = hit.critical ? 1.4 : 1.0;
          const scale = ageClamp < 0.10 ? popScale : restScale;

          // Parabolic arc: y = -h * (1 - (1 - 2t)^2) using rise-then-fade
          // Rises ~120px (normal) / ~160px (crit) at peak (t=0.5), then falls slightly
          const arcHeight = hit.critical ? 160 : 120;
          const t = ageClamp;
          const translateY = -arcHeight * (4 * t * (1 - t) * 0.65 + t * 0.55);
          const translateX = hit.driftX * t;

          // Opacity: full until 60%, fade out
          const opacity = ageClamp < 0.6 ? 1 : Math.max(0, 1 - (ageClamp - 0.6) / 0.4);

          // Crit tilt drifts toward 0 over life; normal stays subtle
          const rot = hit.rotation * (1 - ageClamp * 0.6);

          return (
            <div
              key={hit.id}
              className={`absolute font-black select-none ${ELEMENT_COLOR[hit.element]}`}
              style={{
                left: `${hit.x}%`,
                top: `${hit.y}%`,
                opacity,
                transform: `translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${rot}deg)`,
                fontSize: hit.critical ? '2rem' : '1.25rem',
                letterSpacing: hit.critical ? '-0.03em' : '0',
                textShadow: hit.critical
                  ? '0 2px 8px rgba(0,0,0,0.85), 0 0 14px rgba(253,224,71,0.6)'
                  : '0 2px 4px rgba(0,0,0,0.7)',
                willChange: 'transform, opacity',
              }}
            >
              {hit.element !== 'physical' && (
                <span className="text-sm mr-0.5">{ELEMENT_SYMBOL[hit.element]}</span>
              )}
              {hit.element === 'heal' ? '+' : '-'}
              {Math.round(Math.abs(hit.value))}
              {hit.critical && (
                <span
                  className="text-xs font-bold ml-1 text-yellow-200"
                  style={{
                    textShadow: '0 0 6px rgba(253,224,71,0.9)',
                  }}
                >
                  CRIT!
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
