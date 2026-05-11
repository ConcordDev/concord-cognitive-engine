'use client';

/**
 * EavesdropBubble — when the player is within 12m of an active NPC↔NPC
 * conversation (Layer 13 substrate), surface a small in-world speech
 * bubble above the midpoint with the latest exchange. Click to "lean in"
 * (no-op for now; full barge-in mechanic is a separate sprint).
 *
 * Wraps the Phase 2 npc.eavesdrop macro. Polls every 4s while the
 * player has a known position; subscribes to npc:conversation-bid socket
 * events for instant pop-in on new conversation start.
 */

import { useEffect, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface Conversation {
  id: number;
  npc_a: string;
  npc_b: string;
  a_name?: string;
  b_name?: string;
  ax?: number;
  az?: number;
  bx?: number;
  bz?: number;
  messages_json?: string;
}

interface Props {
  worldId?: string;
  playerPos?: { x: number; z: number };
}

export default function EavesdropBubble({ worldId = 'concordia-hub', playerPos }: Props) {
  const [active, setActive] = useState<Conversation[]>([]);

  useEffect(() => {
    if (!playerPos) return;
    let alive = true;
    const refresh = async () => {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'npc',
          name: 'eavesdrop',
          input: { worldId, x: playerPos.x, z: playerPos.z, radius: 12 },
        }),
      }).catch(() => null);
      const data = r ? await r.json().catch(() => null) : null;
      if (!alive || !data?.ok) return;
      setActive(data.conversations || []);
    };
    void refresh();
    const interval = window.setInterval(refresh, 4_000);
    const off = subscribe(
      'npc:conversation-bid' as Parameters<typeof subscribe>[0],
      () => { void refresh(); },
    );
    return () => {
      alive = false;
      window.clearInterval(interval);
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playerPos.{x,z} are spread explicitly above; ESLint can't see through the optional-chain
  }, [worldId, playerPos?.x, playerPos?.z]);

  if (!active || active.length === 0) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex flex-col gap-1 max-w-md">
      {active.slice(0, 2).map(c => {
        let lastMsg: string | null = null;
        try {
          const msgs = JSON.parse(c.messages_json || '[]');
          if (msgs.length > 0) lastMsg = msgs[msgs.length - 1]?.body ?? msgs[msgs.length - 1]?.text ?? null;
        } catch { /* keep null */ }
        return (
          <div key={c.id} className="bg-zinc-900/90 backdrop-blur-md border border-zinc-700/60 rounded-lg px-3 py-2 shadow-md text-xs animate-fade-in">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-0.5">
              {c.a_name || c.npc_a} ↔ {c.b_name || c.npc_b}
            </div>
            {lastMsg && (
              <div className="text-zinc-100 italic leading-snug">"{lastMsg.slice(0, 140)}"</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
