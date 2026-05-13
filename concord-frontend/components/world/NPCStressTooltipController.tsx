'use client';

/**
 * NPCStressTooltipController — Phase H1
 *
 * Listens for the existing `concordia:npc-look-at` CustomEvent
 * (already emitted by AvatarSystem3D raycaster on hover/look). Looks
 * up the NPC's stress + coping trait via nemesis.for_npc, then mounts
 * the NPCStressTooltip near the screen center until look-at clears.
 */

import { useEffect, useState } from 'react';
import { NPCStressTooltip } from '@/components/concordia/NPCStressTooltip';

interface HoverState {
  npcId: string;
  stress: number;
  copingTrait?: string;
}

export function NPCStressTooltipController() {
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let abort: AbortController | null = null;
    function onLookAt(e: Event) {
      const detail = (e as CustomEvent).detail as { npcId?: string } | undefined;
      if (!detail?.npcId) { setHover(null); return; }
      // Fetch stress once per look-at.
      abort?.abort();
      abort = new AbortController();
      fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'nemesis', name: 'for_npc', input: { npcId: detail.npcId } }),
        signal: abort.signal,
      }).then((r) => r.json()).then((j) => {
        const stress = j?.result?.stress?.raw ?? 0;
        const copingTrait = j?.result?.stress?.copingTrait;
        setHover({ npcId: detail.npcId!, stress, copingTrait });
      }).catch(() => { /* abort/optional */ });
    }
    window.addEventListener('concordia:npc-look-at', onLookAt);
    return () => {
      window.removeEventListener('concordia:npc-look-at', onLookAt);
      abort?.abort();
    };
  }, []);

  if (!hover || hover.stress < 50) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-32 z-40 pointer-events-none">
      <NPCStressTooltip
        npcId={hover.npcId}
        stress={hover.stress}
        copingTrait={hover.copingTrait as 'drink' | 'reckless' | 'paranoid' | 'withdraw' | 'cruel' | undefined}
        compact
      />
    </div>
  );
}
