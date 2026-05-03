'use client';

import { useEffect } from 'react';

/**
 * WorldVisualHooks — bridges polish-pass interaction events into the
 * existing concordia:particle-effect channel. ParticleEffects already
 * listens to that channel and renders dust/sparkle/burst particle systems
 * at the supplied screen position; this component just makes sure every
 * interaction that should feel visually punchy gets a particle attached.
 *
 * Inputs: playerScreenPos { x, y } in viewport % so particle dispatches
 * have a sane fallback origin when the source event doesn't carry one.
 */

interface Props {
  playerScreenPos?: { x: number; y: number };
}

function dispatchParticles(type: string, position: { x: number; y: number }, count: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('concordia:particle-effect', {
    detail: { type, position, count },
  }));
}

export default function WorldVisualHooks({ playerScreenPos }: Props) {
  // ── NPC dialogue open → small sparkle around the NPC ────────────────────────
  useEffect(() => {
    const onOpen = () => {
      // Position falls back to the player-ish center of the screen since the
      // dialogue event doesn't always carry a 3D pos that's easily projected
      // here. Particle layer renders relative to the supplied viewport %.
      const pos = playerScreenPos ?? { x: 50, y: 50 };
      dispatchParticles('sparkle', pos, 18);
    };
    window.addEventListener('concordia:open-dialogue', onOpen);
    return () => window.removeEventListener('concordia:open-dialogue', onOpen);
  }, [playerScreenPos]);

  // ── Item acquired → golden sparkle burst ────────────────────────────────────
  useEffect(() => {
    const onAcquired = () => {
      // Right side of the screen near where the toast appears
      dispatchParticles('sparkle', { x: 86, y: 78 }, 22);
    };
    window.addEventListener('concordia:item-acquired', onAcquired);
    return () => window.removeEventListener('concordia:item-acquired', onAcquired);
  }, []);

  // ── Level-up → particle column ─────────────────────────────────────────────
  // LevelUpJuiceBridge already dispatches a coin-clink juice event for each
  // level-up message; this layer adds the visual.
  useEffect(() => {
    const onLevelUp = () => {
      const pos = playerScreenPos ?? { x: 50, y: 60 };
      dispatchParticles('burst', pos, 36);
    };
    window.addEventListener('concordia:level-up', onLevelUp);
    return () => window.removeEventListener('concordia:level-up', onLevelUp);
  }, [playerScreenPos]);

  // ── Craft success → small yellow burst at the panel ─────────────────────────
  useEffect(() => {
    const onCraft = () => {
      dispatchParticles('sparkle', { x: 30, y: 50 }, 14);
    };
    window.addEventListener('concordia:craft-success', onCraft);
    return () => window.removeEventListener('concordia:craft-success', onCraft);
  }, []);

  return null;
}
