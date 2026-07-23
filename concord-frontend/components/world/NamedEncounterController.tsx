'use client';

/**
 * NamedEncounterController — Phase F.
 *
 * Mounts NamedEncounterHUD with state driven by socket events. When
 * `spawn:boss` fires (server emits on /api/lens/run spawn.boss macro),
 * the controller pops the HUD with the boss/npc id + name. Dismiss clears.
 *
 * DET-C batch 2: this previously also subscribed to a `world:named-
 * encounter` event that no server code anywhere ever emitted (verified via
 * the runtime dead-event-listener detector, not grep) — retired rather
 * than wired, because the only real automatic-boss-encounter path
 * (server/emergent/world-boss-cycle.js) broadcasts a differently-shaped
 * `world:boss-spawn` event (`{ activeId, scheduleId, worldId, bossTemplate
 * }`, already surfaced generically via EmergentEventFeed's bridge array)
 * whose `activeId` isn't a real NPC id — NamedEncounterHUD looks up a
 * `creator_id`-scoped skill lineage via `npcId`, so wiring the boss-cycle
 * event into this component would either silently no-op (dishonest-by-
 * omission: the HUD would pop for a "named encounter" with no lineage to
 * show) or require building real world-npc spawning for scheduled bosses
 * first — out of scope for a dead-event fix. `spawn:boss` already covers
 * every case where a real NPC id backs the HUD's lookup.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { subscribe } from '@/lib/realtime/socket';

const NamedEncounterHUD = dynamic(() => import('@/components/world/NamedEncounterHUD'), { ssr: false });

export function NamedEncounterController() {
  const [current, setCurrent] = useState<{ npcId: string; npcName?: string } | null>(null);

  useEffect(() => {
    const off = subscribe('spawn:boss' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as { npcId?: string; archetype?: string };
      if (!ev?.npcId) return;
      setCurrent({ npcId: ev.npcId, npcName: ev.archetype });
    });
    return () => { off(); };
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
