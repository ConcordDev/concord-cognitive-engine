'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSoundscape } from '@/components/world-lens/SoundscapeEngine';

interface GatheringMinigameProps {
  toolTier: number;       // 0-4 — determines zone width
  resourceName: string;
  onComplete: (score: number) => void; // score 0-3 (clicks in zone)
  onCancel: () => void;
}

const NEEDLE_SPEED_BASE = 120; // px/s
const ZONE_WIDTH_BY_TIER = [28, 44, 62, 80, 100]; // px — wider at higher tiers
const BAR_WIDTH = 320;
const TOTAL_CLICKS = 3;

export function GatheringMinigame({ toolTier, resourceName, onComplete, onCancel }: GatheringMinigameProps) {
  const [clicks, setClicks] = useState(0);
  const [hits, setHits] = useState(0);
  const [needlePos, setNeedlePos] = useState(0);
  const [zonePos, setZonePos] = useState(80);
  const [showHit, setShowHit] = useState<'hit' | 'miss' | null>(null);
  const [done, setDone] = useState(false);
  const { triggerSFX } = useSoundscape();

  const dirRef = useRef(1);
  const posRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  const zoneWidth = ZONE_WIDTH_BY_TIER[Math.min(toolTier, 4)] ?? 44;

  // Randomise zone position on each click
  const repositionZone = useCallback(() => {
    const maxLeft = BAR_WIDTH - zoneWidth - 10;
    setZonePos(Math.floor(10 + Math.random() * maxLeft));
  }, [zoneWidth]);

  // Animate the needle
  useEffect(() => {
    const speed = NEEDLE_SPEED_BASE - toolTier * 10; // faster at low tier = harder
    const animate = (ts: number) => {
      if (lastTimeRef.current === null) lastTimeRef.current = ts;
      const dt = (ts - lastTimeRef.current) / 1000;
      lastTimeRef.current = ts;

      posRef.current += dirRef.current * speed * dt;
      if (posRef.current >= BAR_WIDTH) { posRef.current = BAR_WIDTH; dirRef.current = -1; }
      if (posRef.current <= 0) { posRef.current = 0; dirRef.current = 1; }
      setNeedlePos(posRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [toolTier]);

  const handleClick = useCallback(() => {
    if (done) return;
    const inZone = posRef.current >= zonePos && posRef.current <= zonePos + zoneWidth;
    const newHits = hits + (inZone ? 1 : 0);
    const newClicks = clicks + 1;

    triggerSFX(inZone ? 'gather-success' : 'gather-miss');
    setShowHit(inZone ? 'hit' : 'miss');
    setTimeout(() => setShowHit(null), 600);
    setHits(newHits);
    setClicks(newClicks);
    repositionZone();

    if (newClicks >= TOTAL_CLICKS) {
      setDone(true);
      if (newHits === TOTAL_CLICKS) triggerSFX('gather-full');
      setTimeout(() => onComplete(newHits), 700);
    }
  }, [done, hits, clicks, zonePos, zoneWidth, repositionZone, onComplete, triggerSFX]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
      <div className="bg-black/90 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-base">Gathering: {resourceName}</h3>
          <button onClick={onCancel} className="text-white/30 hover:text-white text-lg">✕</button>
        </div>

        <p className="text-white/50 text-xs text-center">Click when the needle is in the highlighted zone — {TOTAL_CLICKS - clicks} click{TOTAL_CLICKS - clicks !== 1 ? 's' : ''} remaining</p>

        {/* Progress pips */}
        <div className="flex gap-2 justify-center">
          {Array.from({ length: TOTAL_CLICKS }).map((_, i) => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${
              i < clicks
                ? i < hits || (i === clicks - 1 && showHit === 'hit')
                  ? 'border-green-400 bg-green-400'
                  : 'border-red-500 bg-red-500'
                : 'border-white/20'
            }`} />
          ))}
        </div>

        {/* Rhythm bar */}
        <div
          className="relative h-10 bg-white/5 rounded-xl overflow-hidden cursor-pointer select-none"
          style={{ width: BAR_WIDTH }}
          onClick={handleClick}
        >
          {/* Green zone */}
          <div
            className="absolute top-0 h-full rounded bg-green-500/30 border border-green-500/60 transition-all duration-150"
            style={{ left: zonePos, width: zoneWidth }}
          />
          {/* Needle */}
          <div
            className="absolute top-0 w-0.5 h-full bg-white rounded-full"
            style={{ left: needlePos }}
          />
          {/* Hit/miss flash */}
          {showHit && (
            <div className={`absolute inset-0 flex items-center justify-center text-lg font-bold transition-opacity ${showHit === 'hit' ? 'text-green-400' : 'text-red-400'}`}>
              {showHit === 'hit' ? '✓' : '✗'}
            </div>
          )}
        </div>

        <p className="text-white/20 text-[10px] text-center font-mono">
          Tier {toolTier} tool — zone width {zoneWidth}px
        </p>
      </div>
    </div>
  );
}
