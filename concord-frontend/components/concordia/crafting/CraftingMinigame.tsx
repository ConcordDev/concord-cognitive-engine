'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSoundscape } from '@/components/world-lens/SoundscapeEngine';

interface CraftingMinigameProps {
  skillLevel: number;     // 1-500+ — determines sweet spot width
  itemName: string;
  onComplete: (multiplier: number) => void; // 0.5–1.5
  onCancel: () => void;
}

// Sweet spot: center band in the bar. Width scales with skill.
const BAR_HEIGHT = 200;
const SPOT_MIN_HEIGHT = 20;  // Tier 0, skill 1
const SPOT_MAX_HEIGHT = 120; // Legendary skill
const FILL_SPEED = 80;       // px/s base filling speed

function computeSpotHeight(skillLevel: number): number {
  const t = Math.min(skillLevel / 500, 1);
  return SPOT_MIN_HEIGHT + t * (SPOT_MAX_HEIGHT - SPOT_MIN_HEIGHT);
}

function computeMultiplier(fillPos: number, spotTop: number, spotHeight: number): number {
  if (fillPos < spotTop || fillPos > spotTop + spotHeight) return 0.5;
  // Center of spot = 1.5, edges = 1.0
  const center = spotTop + spotHeight / 2;
  const dist = Math.abs(fillPos - center) / (spotHeight / 2);
  return 1.0 + (1 - dist) * 0.5;
}

export function CraftingMinigame({ skillLevel, itemName, onComplete, onCancel }: CraftingMinigameProps) {
  const spotHeight = computeSpotHeight(skillLevel);
  const spotTop = (BAR_HEIGHT - spotHeight) / 2;

  const [fillPos, setFillPos] = useState(0);
  const [holding, setHolding] = useState(false);
  const [released, setReleased] = useState(false);
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const { triggerSFX } = useSoundscape();

  const fillRef = useRef(0);
  const holdingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const speed = FILL_SPEED;
    const animate = (ts: number) => {
      if (lastTimeRef.current === null) lastTimeRef.current = ts;
      const dt = (ts - lastTimeRef.current) / 1000;
      lastTimeRef.current = ts;

      if (holdingRef.current) {
        fillRef.current = Math.min(fillRef.current + speed * dt, BAR_HEIGHT);
      } else if (fillRef.current > 0) {
        fillRef.current = Math.max(fillRef.current - speed * 1.5 * dt, 0);
      }
      setFillPos(fillRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const handlePress = useCallback(() => {
    if (released) return;
    holdingRef.current = true;
    setHolding(true);
  }, [released]);

  const handleRelease = useCallback(() => {
    if (released) return;
    holdingRef.current = false;
    setHolding(false);
    setReleased(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const m = Math.round(computeMultiplier(fillRef.current, spotTop, spotHeight) * 10) / 10;
    setMultiplier(m);
    triggerSFX(m >= 1.0 ? 'craft-release-good' : 'craft-release-bad');
    setTimeout(() => onComplete(m), 900);
  }, [released, spotTop, spotHeight, onComplete, triggerSFX]);

  const qualityLabel = multiplier === null ? '' :
    multiplier >= 1.4 ? 'Masterwork!' :
    multiplier >= 1.1 ? 'Good' :
    multiplier >= 0.9 ? 'Standard' : 'Poor';

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
      <div className="bg-black/90 border border-white/10 rounded-2xl p-6 w-full max-w-xs mx-4 flex flex-col gap-4 items-center">
        <div className="flex items-center justify-between w-full">
          <h3 className="text-white font-bold text-base">Crafting: {itemName}</h3>
          <button onClick={onCancel} className="text-white/30 hover:text-white text-lg">✕</button>
        </div>

        <p className="text-white/50 text-xs text-center">
          {released ? '' : 'Hold the button to fill. Release inside the green zone.'}
        </p>

        {/* Vertical bar */}
        <div className="relative rounded-xl overflow-hidden bg-white/5 border border-white/10" style={{ width: 56, height: BAR_HEIGHT }}>
          {/* Sweet spot */}
          <div
            className="absolute w-full bg-green-500/30 border-y border-green-500/60"
            style={{ top: spotTop, height: spotHeight }}
          />
          {/* Fill */}
          <div
            className="absolute bottom-0 w-full bg-blue-500/80 transition-none rounded-b-xl"
            style={{ height: fillPos }}
          />
          {/* Release marker */}
          {released && (
            <div
              className="absolute w-full h-0.5 bg-white"
              style={{ bottom: fillPos - 1 }}
            />
          )}
        </div>

        {multiplier !== null ? (
          <div className={`text-lg font-bold ${multiplier >= 1.1 ? 'text-green-400' : multiplier >= 0.9 ? 'text-yellow-400' : 'text-red-400'}`}>
            {qualityLabel} — ×{multiplier}
          </div>
        ) : (
          <button
            onMouseDown={handlePress}
            onMouseUp={handleRelease}
            onTouchStart={handlePress}
            onTouchEnd={handleRelease}
            className={`px-8 py-3 rounded-xl font-bold text-sm transition-all select-none ${
              holding
                ? 'bg-blue-500 text-white scale-95'
                : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
            }`}
          >
            {holding ? 'Holding…' : 'Hold to Craft'}
          </button>
        )}

        <p className="text-white/20 text-[10px] font-mono">Skill {Math.floor(skillLevel)} — zone {Math.round(spotHeight)}px</p>
      </div>
    </div>
  );
}
