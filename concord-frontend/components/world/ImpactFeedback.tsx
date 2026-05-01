'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface HitNumber {
  id: number;
  value: number;
  element: 'fire' | 'ice' | 'lightning' | 'poison' | 'physical' | 'heal';
  x: number; // viewport percent
  y: number;
  critical: boolean;
  createdAt: number;
}

interface ShakeState {
  active: boolean;
  intensity: number; // 1-10
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

export function emitHealNumber(value: number) {
  _emitHit?.(value, 'heal', false);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImpactFeedback() {
  const [hitNumbers, setHitNumbers] = useState<HitNumber[]>([]);
  const [shake, setShake] = useState<ShakeState>({ active: false, intensity: 0 });
  const counterRef = useRef(0);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addHit = useCallback((value: number, element: HitNumber['element'], critical = false) => {
    const id = ++counterRef.current;
    // Randomize position around center-ish of screen, cluster toward center
    const x = 40 + Math.random() * 20;
    const y = 35 + Math.random() * 15;
    setHitNumbers((prev) => [
      ...prev.slice(-24),
      { id, value, element, x, y, critical, createdAt: Date.now() },
    ]);
    setTimeout(() => setHitNumbers((prev) => prev.filter((h) => h.id !== id)), 1200);
  }, []);

  const triggerShake = useCallback((intensity: number) => {
    setShake({ active: true, intensity: Math.min(10, Math.max(1, intensity)) });
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    const dur = 150 + intensity * 30;
    shakeTimerRef.current = setTimeout(() => setShake({ active: false, intensity: 0 }), dur);
  }, []);

  // Register global emitters
  useEffect(() => {
    _emitHit = addHit;
    _emitShake = triggerShake;
    return () => {
      _emitHit = null;
      _emitShake = null;
      _emitHeal = null;
    };
  }, [addHit, triggerShake]);

  // CSS shake style
  const shakeStyle = shake.active
    ? {
        transform: `translate(${(Math.random() - 0.5) * shake.intensity * 2}px, ${(Math.random() - 0.5) * shake.intensity}px)`,
        transition: 'transform 50ms ease-out',
      }
    : {};

  return (
    <>
      {/* Screen shake wrapper — wraps the world view content via this overlay */}
      {shake.active && (
        <div className="fixed inset-0 z-[5] pointer-events-none" style={shakeStyle} />
      )}

      {/* Red vignette on damage (enhanced version of basic damageFlash) */}
      {shake.active && shake.intensity >= 3 && (
        <div
          className="fixed inset-0 z-[6] pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, transparent 40%, rgba(220,38,38,${Math.min(0.4, shake.intensity * 0.04)}) 100%)`,
          }}
        />
      )}

      {/* Floating hit numbers */}
      <div className="fixed inset-0 z-[45] pointer-events-none overflow-hidden">
        {hitNumbers.map((hit) => {
          const age = (Date.now() - hit.createdAt) / 1200;
          const opacity = Math.max(0, 1 - age * 1.2);
          const translateY = -age * 80;
          const scale = hit.critical ? 1.4 : 1.0;

          return (
            <div
              key={hit.id}
              className={`absolute font-black select-none ${ELEMENT_COLOR[hit.element]}`}
              style={{
                left: `${hit.x}%`,
                top: `${hit.y}%`,
                opacity,
                transform: `translateY(${translateY}px) scale(${scale})`,
                fontSize: hit.critical ? '1.75rem' : '1.2rem',
                letterSpacing: hit.critical ? '-0.02em' : '0',
                transition: 'opacity 100ms, transform 100ms',
                willChange: 'transform, opacity',
              }}
            >
              {hit.element !== 'physical' && (
                <span className="text-sm mr-0.5">{ELEMENT_SYMBOL[hit.element]}</span>
              )}
              {hit.element === 'heal' ? '+' : '-'}
              {Math.round(Math.abs(hit.value))}
              {hit.critical && (
                <span className="text-xs font-semibold ml-1 text-yellow-300 drop-shadow-none">
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
