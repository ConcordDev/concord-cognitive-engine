'use client';

/**
 * WAVE 6 — generative-adaptive score bridge. Sibling to EmergentJuiceBridge:
 * subscribes to the emergent socket events and recolors the music in real time
 * by dispatching `concordia:soundscape-command` (which SoundscapeEngine already
 * routes to setMusicCombatIntensity / setMusicMode). The mapping is the pure,
 * tested `scoreDirectivesFor`; this bridge is only the socket→command plumbing.
 * Flag-gated (CONCORD_ADAPTIVE_SCORE via client-config; off → no subscriptions,
 * == today). No JSX — mount once near GameJuice in the world page.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { scoreDirectivesFor } from '@/lib/concordia/adaptive-score';
import { getClientConfigSync } from '@/hooks/useClientConfig';

const SCORED_EVENTS = [
  'faction:war-declared',
  'world:crisis',
  'world:crisis-resolved',
  'faction:alliance-formed',
  'kingdom:founded',
  'kingdom:fallen',
  'npc:scheme-resolved',
  'refusal:compound-threshold',
];

export function AdaptiveScoreBridge() {
  useEffect(() => {
    if (!getClientConfigSync().flags?.adaptiveScore) return;
    const offs: Array<() => void> = [];
    const dispatch = (detail: unknown) => {
      try { window.dispatchEvent(new CustomEvent('concordia:soundscape-command', { detail })); } catch { /* best-effort */ }
    };
    for (const name of SCORED_EVENTS) {
      offs.push(
        subscribe<Record<string, unknown>>(name as never, (m) => {
          for (const d of scoreDirectivesFor(name, m || {})) dispatch(d);
        }),
      );
    }
    return () => { for (const off of offs) off(); };
  }, []);
  return null;
}
