'use client';

// ButcheringMinigame — needle-timing minigame that converts a
// quality multiplier (0.5–2.0) into the qualityMultiplier param for
// POST /api/world/creature/:corpseId/butcher. Clean cuts → richer
// drops; hacks → torn hide. Same template as GatheringMinigame so the
// muscle memory carries over.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSoundscape } from '@/components/world-lens/SoundscapeEngine';

interface ButcheringMinigameProps {
  toolTier: number;        // 0-4 — wider sweet spot at higher tiers
  speciesName: string;
  onComplete: (qualityMultiplier: number) => void;
  onCancel: () => void;
}

const NEEDLE_SPEED_BASE = 140; // px/s — faster than gathering: butchering rewards reflex
const ZONE_WIDTH_BY_TIER = [24, 38, 54, 72, 92];
const BAR_WIDTH = 320;
const TOTAL_CUTS = 3;

export default function ButcheringMinigame({ toolTier, speciesName, onComplete, onCancel }: ButcheringMinigameProps) {
  const [cuts, setCuts] = useState(0);
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
  const zoneWidth = ZONE_WIDTH_BY_TIER[Math.max(0, Math.min(4, toolTier))];

  const repositionZone = useCallback(() => {
    const margin = zoneWidth / 2 + 8;
    setZonePos(margin + Math.random() * (BAR_WIDTH - margin * 2));
  }, [zoneWidth]);

  // Needle animation
  useEffect(() => {
    if (done) return;
    function tick(t: number) {
      if (lastTimeRef.current == null) lastTimeRef.current = t;
      const dt = (t - lastTimeRef.current) / 1000;
      lastTimeRef.current = t;
      const speed = NEEDLE_SPEED_BASE + cuts * 35; // faster each cut
      posRef.current += dirRef.current * speed * dt;
      if (posRef.current >= BAR_WIDTH) { posRef.current = BAR_WIDTH; dirRef.current = -1; }
      if (posRef.current <= 0) { posRef.current = 0; dirRef.current = 1; }
      setNeedlePos(posRef.current);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [cuts, done]);

  const onCut = useCallback(() => {
    if (done) return;
    const inZone = Math.abs(needlePos - zonePos) <= zoneWidth / 2;
    const newHits = hits + (inZone ? 1 : 0);
    const newCuts = cuts + 1;
    setHits(newHits);
    setCuts(newCuts);
    setShowHit(inZone ? 'hit' : 'miss');
    setTimeout(() => setShowHit(null), 250);
    repositionZone();

    if (newCuts >= TOTAL_CUTS) {
      setDone(true);
      // Quality multiplier: 0 hits=0.5, 1 hit=1.0, 2 hits=1.5, 3 hits=2.0
      const q = 0.5 + newHits * 0.5;
      if (newHits === TOTAL_CUTS) triggerSFX('gather-full');
      setTimeout(() => onComplete(q), 700);
    }
  }, [cuts, hits, needlePos, zonePos, zoneWidth, repositionZone, onComplete, done, triggerSFX]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
      <div className="bg-black/90 border border-red-500/30 rounded-2xl p-6 w-full max-w-sm mx-4 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-base">Butchering: {speciesName}</h3>
          <button onClick={onCancel} className="text-xs text-white/40 hover:text-white">cancel</button>
        </div>

        <div className="text-xs text-white/60 text-center">
          Cut when the needle is over the bright band. Cleaner cuts = better hides + extra drops.
        </div>

        <div className="relative h-12 bg-white/5 border border-white/10 rounded-md" style={{ width: BAR_WIDTH }}>
          {/* Sweet spot */}
          <div
            className="absolute top-0 bottom-0 bg-red-400/30 border-l border-r border-red-400"
            style={{ left: zonePos - zoneWidth / 2, width: zoneWidth }}
          />
          {/* Needle */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white"
            style={{ left: needlePos }}
          />
          {/* Hit/miss flash */}
          {showHit && (
            <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${showHit === 'hit' ? 'text-emerald-300' : 'text-red-400'}`}>
              <span className="text-xs font-bold uppercase tracking-widest">{showHit}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-white/60">
          <span>Cut {cuts} / {TOTAL_CUTS}</span>
          <span>Hits {hits}</span>
        </div>

        <button
          onClick={onCut}
          disabled={done}
          className="w-full py-2.5 bg-red-500/20 border border-red-500/40 rounded-md font-semibold text-sm text-white hover:bg-red-500/30 disabled:opacity-50"
        >
          Cut
        </button>
      </div>
    </div>
  );
}
