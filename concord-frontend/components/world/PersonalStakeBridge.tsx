'use client';

/**
 * Legibility Wave 2 — the systemic, routed through YOUR thread.
 *
 * The server's personal-stake resolver (server/lib/personal-stake.js) scores
 * each emergent event against the online player's own stakes (faction standing,
 * a grudge held against them, a thing they foresaw) and broadcasts ONE enriched
 * `world:personal-stake` tagged `forUserId`. This bridge filters to the current
 * player and turns it into a prominent, felt moment: a thread-line toast + a
 * juice flourish keyed to the stake's severity — not another equal feed row.
 *
 * `worldPos` rides along for a future 3D-anchored marker; v1 surfaces the
 * prominent toast + juice (the moment lands wherever the player is — "the
 * faction you backed is losing" matters regardless of where you stand).
 *
 * No JSX. Mount once near GameJuice in the world page.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { juice } from '@/lib/concordia/juice';
import { useUIStore } from '@/store/ui';

interface PersonalStake {
  forUserId?: string;
  kind?: string;
  headline?: string | null;
  thread?: string | null;
  reason?: string;
  severity?: 'low' | 'medium' | 'high';
  juiceKind?: 'milestone' | 'discovery' | 'failure' | 'success';
  worldPos?: { x: number; y: number; z: number } | null;
}

export function PersonalStakeBridge({ currentUserId }: { currentUserId?: string }) {
  useEffect(() => {
    const addToast = useUIStore.getState().addToast;
    const off = subscribe<PersonalStake>('world:personal-stake' as never, (m) => {
      // Only my thread (realtimeEmit broadcasts; the payload is tagged).
      if (m.forUserId && currentUserId && m.forUserId !== currentUserId) return;
      const head = m.headline || 'The world shifts';
      const line = m.thread ? `${head} — ${m.thread}` : head;
      addToast({
        type: m.juiceKind === 'failure' ? 'info' : 'success',
        message: `✦ ${line}`,
        duration: 9000,
      });
      try {
        juice((m.juiceKind as never) || 'milestone', { value: m.thread || head });
      } catch { /* juice is best-effort */ }
    });
    return () => { off(); };
  }, [currentUserId]);

  return null;
}
