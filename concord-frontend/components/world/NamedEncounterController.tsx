'use client';

/**
 * NamedEncounterController — Phase F.
 *
 * Mounts NamedEncounterHUD with state driven by socket events. When
 * `spawn:boss` fires (server emits on /api/lens/run spawn.boss macro)
 * or `world:named-encounter` fires, the controller pops the HUD with
 * the boss/npc id + name. Dismiss clears.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { subscribe } from '@/lib/realtime/socket';

const NamedEncounterHUD = dynamic(() => import('@/components/world/NamedEncounterHUD'), { ssr: false });

export function NamedEncounterController() {
  const [current, setCurrent] = useState<{ npcId: string; npcName?: string } | null>(null);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(subscribe('spawn:boss' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as { npcId?: string; archetype?: string };
      if (!ev?.npcId) return;
      setCurrent({ npcId: ev.npcId, npcName: ev.archetype });
    }));
    offs.push(subscribe('world:named-encounter' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as { npcId?: string; npcName?: string };
      if (!ev?.npcId) return;
      setCurrent({ npcId: ev.npcId, npcName: ev.npcName });
    }));
    return () => { for (const off of offs) off(); };
  }, []);

  if (!current) return null;
  return (
    <NamedEncounterHUD
      npcId={current.npcId}
      npcName={current.npcName}
      onDismiss={() => setCurrent(null)}
    />
  );
}
