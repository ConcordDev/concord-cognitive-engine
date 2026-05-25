'use client';

/**
 * NpcArrivedTicker — Phase T surfacing.
 *
 * Bottom-right ambient ticker that lists `npc:travelled` socket events
 * fired in the last 5 minutes. Lets the player see "Postmaster Ria
 * arrived from concord-link-frontier" so cross-world NPC movement
 * reads as a visible thing in the world.
 *
 * Mounted in /lenses/world page next to the other ambient overlays.
 */

import { useEffect, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface Arrival {
  id: string;
  npcId: string;
  fromWorldId?: string;
  toWorldId?: string;
  reason?: string;
  ts: number;
}

const TTL_MS = 5 * 60_000;
const MAX_ROWS = 8;

export default function NpcArrivedTicker({ worldId }: { worldId: string }) {
  const [arrivals, setArrivals] = useState<Arrival[]>([]);

  useEffect(() => {
    const off = subscribe('npc:travelled' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as Partial<Arrival>;
      const id = ev?.npcId;
      if (!id) return;
      // Only show arrivals INTO the world we're currently viewing.
      if (ev.toWorldId && ev.toWorldId !== worldId) return;
      const arrival: Arrival = {
        id: `${id}-${Date.now()}`,
        npcId: id,
        fromWorldId: ev.fromWorldId,
        toWorldId: ev.toWorldId,
        reason: ev.reason,
        ts: Date.now(),
      };
      setArrivals((prev) => [arrival, ...prev].slice(0, MAX_ROWS));
    });
    const sweep = window.setInterval(() => {
      setArrivals((prev) => prev.filter((a) => Date.now() - a.ts < TTL_MS));
    }, 30_000);
    return () => {
      off?.();
      window.clearInterval(sweep);
    };
  }, [worldId]);

  if (arrivals.length === 0) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', bottom: 80, right: 16, zIndex: 50,
        maxWidth: 320, pointerEvents: 'none',
      }}
    >
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
        Cross-world arrivals
      </div>
      {arrivals.map((a) => (
        <div
          key={a.id}
          style={{
            background: 'rgba(12,12,12,0.85)',
            color: '#ddd',
            border: '1px solid #2a2a2a',
            borderRadius: 4,
            padding: '4px 8px',
            font: '11px/1.4 -apple-system, system-ui',
            marginBottom: 3,
            backdropFilter: 'blur(4px)',
          }}
        >
          <span className="text-[#fce8a8]">{a.npcId}</span> arrived
          {a.fromWorldId ? <> from <span className="text-[#bcd]">{a.fromWorldId}</span></> : null}
          {a.reason ? <span style={{ color: '#888', marginLeft: 6 }}>· {a.reason}</span> : null}
        </div>
      ))}
    </div>
  );
}
