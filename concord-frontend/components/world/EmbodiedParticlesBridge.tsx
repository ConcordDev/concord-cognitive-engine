'use client';

/**
 * EmbodiedParticlesBridge — drives foot-step dust + cold-breath puffs
 * + per-terrain footstep audio.
 *
 * Hooks into the foot-plant event the gait system already emits via
 * `concordia:foot-plant` window CustomEvent — fired by AvatarSystem3D's
 * stride-phase detector when a leg's phase crosses the contact mark.
 *
 * The bridge:
 *  - on foot-plant → calls playFootstep(ctx, material, wet) on a single
 *    shared AudioContext + spawns a small dust puff at the foot position
 *    tinted by terrain material.
 *  - per-frame → calls cold-breath tick at the player's head position
 *    if the active world's ambient temperature is below the visibility
 *    threshold (read from the existing `concordia:embodied-signal`
 *    window event that the environment-sensor heartbeat publishes).
 */

import { useEffect, useRef } from 'react';
import type { FootDustAPI } from '@/lib/world-lens/footstep-dust';
import type { ColdBreathAPI } from '@/lib/world-lens/cold-breath';
import type { TerrainMaterial } from '@/lib/world-lens/footstep-audio';

interface FootPlantDetail {
  side?: 'L' | 'R';
  position?: { x: number; y: number; z: number };
  material?: string;
  wet?: boolean;
  intensity?: number;
}

interface EmbodiedSignalDetail {
  temperature?: number;
  thermal_os?: { ambient_temp?: number };
}

export default function EmbodiedParticlesBridge() {
  const dustRef    = useRef<FootDustAPI | null>(null);
  const breathRef  = useRef<ColdBreathAPI | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef     = useRef<number | null>(null);
  const headPosRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 1.6, z: 0 });
  const lookDirRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 1 });
  const exertionRef = useRef<number>(1);

  useEffect(() => {
    let disposed = false;

    async function init(event: Event) {
      if (disposed || dustRef.current) return;
      const detail = (event as CustomEvent).detail as { scene?: unknown } | undefined;
      const scene = detail?.scene;
      if (!scene) return;
      const THREE = await import('three');
      const { createFootDust } = await import('@/lib/world-lens/footstep-dust');
      const { createColdBreath } = await import('@/lib/world-lens/cold-breath');
      dustRef.current = createFootDust(THREE, scene as Parameters<typeof createFootDust>[1]);
      breathRef.current = createColdBreath(THREE, scene as Parameters<typeof createColdBreath>[1]);

      // Audio context, lazily resumed on user gesture
      try {
        const AudioCtor = (window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }).AudioContext ?? (window as unknown as {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
        if (AudioCtor) {
          audioCtxRef.current = new AudioCtor();
          const onUserGesture = () => {
            if (audioCtxRef.current?.state === 'suspended') {
              audioCtxRef.current.resume().catch(() => undefined);
            }
            window.removeEventListener('pointerdown', onUserGesture);
            window.removeEventListener('keydown', onUserGesture);
          };
          window.addEventListener('pointerdown', onUserGesture, { once: true });
          window.addEventListener('keydown', onUserGesture, { once: true });
        }
      } catch { /* audio optional */ }

      const tick = () => {
        if (disposed) return;
        const now = performance.now() / 1000;
        dustRef.current?.tick(now);
        breathRef.current?.setExertion(exertionRef.current);
        breathRef.current?.tick(now, headPosRef.current, lookDirRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    function onSceneReady(e: Event) { init(e); }

    // Foot-plant event handler
    async function onFootPlant(e: Event) {
      const detail = (e as CustomEvent).detail as FootPlantDetail | undefined;
      if (!detail?.position) return;
      const material = (await import('@/lib/world-lens/footstep-audio'))
        .normalizeTerrainMaterial(detail.material);
      const wet = detail.wet === true;
      const intensity = typeof detail.intensity === 'number' ? detail.intensity : 1;
      // Dust
      dustRef.current?.spawn(detail.position, material as TerrainMaterial, intensity);
      // Audio
      if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
        try {
          const { playFootstep } = await import('@/lib/world-lens/footstep-audio');
          playFootstep(audioCtxRef.current, material as TerrainMaterial, wet, intensity);
        } catch { /* audio optional */ }
      }
    }

    // Listen for embodied signal updates so cold-breath knows temperature
    function onEmbodiedSignal(e: Event) {
      const detail = (e as CustomEvent).detail as EmbodiedSignalDetail | undefined;
      const temp =
        detail?.temperature ??
        detail?.thermal_os?.ambient_temp ??
        undefined;
      if (typeof temp === 'number') breathRef.current?.setTemperature(temp);
    }

    // Player position + look direction broadcast by ConcordiaScene's camera-sync
    function onCameraSync(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { position?: { x: number; y: number; z: number }; target?: { x: number; y: number; z: number } }
        | undefined;
      if (detail?.position) {
        headPosRef.current = { x: detail.position.x, y: detail.position.y + 1.5, z: detail.position.z };
      }
      if (detail?.position && detail.target) {
        const dx = detail.target.x - detail.position.x;
        const dz = detail.target.z - detail.position.z;
        const dl = Math.hypot(dx, dz) || 1;
        lookDirRef.current = { x: dx / dl, y: 0, z: dz / dl };
      }
    }

    // Combat / sprint bumps exertion
    function onExertion(e: Event) {
      const detail = (e as CustomEvent).detail as { level?: number } | undefined;
      if (typeof detail?.level === 'number') exertionRef.current = detail.level;
    }

    window.addEventListener('concordia:scene-ready', onSceneReady as EventListener);
    if ((window as unknown as { __concordiaScene?: unknown }).__concordiaScene) {
      onSceneReady(new CustomEvent('concordia:scene-ready', {
        detail: { scene: (window as unknown as { __concordiaScene?: unknown }).__concordiaScene },
      }));
    }
    window.addEventListener('concordia:foot-plant',      onFootPlant as EventListener);
    window.addEventListener('concordia:embodied-signal', onEmbodiedSignal as EventListener);
    window.addEventListener('concordia:camera-sync',     onCameraSync as EventListener);
    window.addEventListener('concordia:exertion',        onExertion as EventListener);

    return () => {
      disposed = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('concordia:scene-ready',      onSceneReady as EventListener);
      window.removeEventListener('concordia:foot-plant',       onFootPlant as EventListener);
      window.removeEventListener('concordia:embodied-signal',  onEmbodiedSignal as EventListener);
      window.removeEventListener('concordia:camera-sync',      onCameraSync as EventListener);
      window.removeEventListener('concordia:exertion',         onExertion as EventListener);
      try { dustRef.current?.dispose(); } catch { /* idempotent */ }
      try { breathRef.current?.dispose(); } catch { /* idempotent */ }
      try { audioCtxRef.current?.close(); } catch { /* idempotent */ }
      dustRef.current = null;
      breathRef.current = null;
    };
  }, []);

  return null;
}
