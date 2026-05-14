'use client';

/**
 * QuestDiscoveryController — Phase H3
 *
 * Subscribes to quest:lattice-born + quest:ecology-born sockets and
 * pushes the resulting discoveries into QuestDiscovery's notable-events
 * stream via emitNotableEvent. The QuestDiscovery panel itself stays
 * self-mounted and renders the merged feed.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { QuestDiscovery, emitNotableEvent } from '@/components/world-lens/QuestDiscovery';

export function QuestDiscoveryController() {
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(subscribe('quest:lattice-born' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as { questId?: string; title?: string; driftType?: string; ts?: number };
      if (!ev?.questId) return;
      emitNotableEvent({
        id: ev.questId,
        kind: 'lattice-quest',
        title: ev.title || 'Lattice quest discovered',
        subtitle: ev.driftType ? `drift: ${ev.driftType}` : undefined,
        ts: ev.ts ?? Date.now(),
      } as never);
    }));
    offs.push(subscribe('quest:ecology-born' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as { questId?: string; title?: string; ecologyKind?: string; ts?: number };
      if (!ev?.questId) return;
      emitNotableEvent({
        id: ev.questId,
        kind: 'ecology-quest',
        title: ev.title || 'Ecology quest discovered',
        subtitle: ev.ecologyKind ? `ecology: ${ev.ecologyKind}` : undefined,
        ts: ev.ts ?? Date.now(),
      } as never);
    }));
    return () => { for (const off of offs) off(); };
  }, []);

  return <QuestDiscovery />;
}
