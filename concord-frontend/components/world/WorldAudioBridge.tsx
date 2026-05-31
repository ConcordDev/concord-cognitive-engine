'use client';

/**
 * WAVE 6 — parametric world audio bridge. Subscribes to the world-state socket
 * events (building damage/collapse, combat impacts, ambient ecosystem) and maps
 * each to a synth directive via the pure, tested worldAudioDirectiveFor, then
 * dispatches concordia:world-audio — which SoundscapeEngine synthesizes into a
 * one-shot oscillator (no samples; from gameplay params). Flag-gated
 * (CONCORD_WORLD_AUDIO via client-config; off → no subscriptions, == today).
 * No JSX — mount once near GameJuice.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { worldAudioDirectiveFor } from '@/lib/concordia/world-audio';
import { getClientConfigSync } from '@/hooks/useClientConfig';

const AUDIO_EVENTS = ['world:building-state', 'combat:hit', 'world:explosion', 'world:ambient'];

export function WorldAudioBridge() {
  useEffect(() => {
    if (!getClientConfigSync().flags?.worldAudio) return;
    const offs: Array<() => void> = [];
    for (const name of AUDIO_EVENTS) {
      offs.push(
        subscribe<Record<string, unknown>>(name as never, (m) => {
          const d = worldAudioDirectiveFor(name, m || {});
          if (!d) return;
          try { window.dispatchEvent(new CustomEvent('concordia:world-audio', { detail: d })); } catch { /* best-effort */ }
        }),
      );
    }
    return () => { for (const off of offs) off(); };
  }, []);
  return null;
}
