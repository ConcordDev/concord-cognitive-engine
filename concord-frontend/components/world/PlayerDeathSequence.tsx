'use client';

import { useEffect, useState } from 'react';
import { Skull, RefreshCw } from 'lucide-react';

/**
 * Cinematic death sequence shown when the player's HP reaches zero.
 * Phase 7 of the polish-to-ten plan.
 *
 * Three timed phases:
 *   1. fade-in (0..1500ms)  — black overlay opacity 0→1
 *   2. info     (1500..3000ms) — show "You have fallen" + cause
 *   3. respawn  (3000ms+)      — show respawn button
 *
 * The phase progression is local to the component; clicking respawn
 * still fires the existing onRespawn handler that the world page wires
 * to the `player:respawn` socket flow.
 */
export interface PlayerDeathSequenceProps {
  onRespawn: () => void;
  deathCause?: string;
  killer?: string;
}

type Phase = 'fade' | 'info' | 'respawn';

export function PlayerDeathSequence({
  onRespawn,
  deathCause,
  killer,
}: PlayerDeathSequenceProps) {
  const [phase, setPhase] = useState<Phase>('fade');
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    // Fade-in: tween opacity 0 → 1 over 1500ms via 30ms steps
    let cancelled = false;
    const fadeStart = Date.now();
    const fadeStep = () => {
      if (cancelled) return;
      const t = Math.min(1, (Date.now() - fadeStart) / 1500);
      setOpacity(t);
      if (t < 1) requestAnimationFrame(fadeStep);
    };
    requestAnimationFrame(fadeStep);

    // Wave 1 deferral 1: trigger DoF cinematic mode for the death sequence.
    // ConcordiaScene's post chain listens for this event and ramps the
    // depth-of-field shader. Cleared on unmount.
    try {
      window.dispatchEvent(new CustomEvent('concordia:cinematic-mode', {
        detail: { active: true, strength: 0.7 },
      }));
    } catch { /* event dispatch best-effort */ }

    const toInfo = setTimeout(() => setPhase('info'), 1500);
    const toRespawn = setTimeout(() => setPhase('respawn'), 3000);

    return () => {
      cancelled = true;
      clearTimeout(toInfo);
      clearTimeout(toRespawn);
      try {
        window.dispatchEvent(new CustomEvent('concordia:cinematic-mode', {
          detail: { active: false },
        }));
      } catch { /* event dispatch best-effort */ }
    };
  }, []);

  const showInfo = phase !== 'fade';
  const showRespawn = phase === 'respawn';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: `rgba(0, 0, 0, ${0.85 * opacity})` }}
    >
      <div
        className="text-center max-w-sm transition-opacity duration-700"
        style={{ opacity: showInfo ? 1 : 0 }}
      >
        <Skull className="w-14 h-14 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-red-400 mb-2 tracking-wide">
          You have fallen
        </h2>
        {killer && (
          <p className="text-sm text-gray-300 mb-1">
            Killed by <span className="text-red-300 font-semibold">{killer}</span>
          </p>
        )}
        {deathCause && (
          <p className="text-xs text-gray-400 italic mb-6">{deathCause}</p>
        )}
        {!killer && !deathCause && (
          <p className="text-xs text-gray-400 mb-6">
            Your structures remain intact. Respawn at the nearest district hub.
          </p>
        )}

        <div
          className="transition-opacity duration-500"
          style={{ opacity: showRespawn ? 1 : 0 }}
        >
          <button
            onClick={onRespawn}
            disabled={!showRespawn}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-4 h-4" />
            Respawn
          </button>
        </div>
      </div>
    </div>
  );
}
