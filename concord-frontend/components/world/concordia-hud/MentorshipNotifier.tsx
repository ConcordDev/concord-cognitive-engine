'use client';

/**
 * MentorshipNotifier — listens for `mentorship:npc-adopted` socket events
 * and shows a transient toast when an NPC adopts a pattern witnessed
 * from the player's lineage.
 *
 * Phase 8 of the wire-everything pass. The server side fires the event
 * from npc-skill-author when applyEvolution lands a revision biased
 * toward a witnessed demonstration whose caster was a player. This
 * notifier turns that into a player-visible signal.
 *
 * Stacks up to 5 active toasts. Auto-dismisses after 8s. Toast can be
 * dismissed manually too.
 */

import { useEffect, useState } from 'react';

interface AdoptionEvent {
  id: string;
  npcId: string;
  recipeDtuId: string;
  witnessedFromDtuId: string;
  newName?: string;
  revisionNum?: number;
  ts: number;
}

const MAX_TOASTS = 5;
const TOAST_TTL_MS = 8000;

export function MentorshipNotifier() {
  const [events, setEvents] = useState<AdoptionEvent[]>([]);

  useEffect(() => {
    let socket: import('socket.io-client').Socket | null = null;
    let timerIds: ReturnType<typeof setTimeout>[] = [];
    (async () => {
      try {
        const { io } = await import('socket.io-client');
        socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true });
        socket.on('mentorship:npc-adopted', (payload: Omit<AdoptionEvent, 'id'>) => {
          const id = `adopt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          setEvents((cur) => [...cur, { ...payload, id }].slice(-MAX_TOASTS));
          const t = setTimeout(() => {
            setEvents((cur) => cur.filter((e) => e.id !== id));
          }, TOAST_TTL_MS);
          timerIds.push(t);
        });
      } catch { /* socket optional */ }
    })();
    return () => {
      // Remove the listener before tearing the socket down. disconnect() alone
      // would drop it, but an explicit off() is leak-proof if this socket ever
      // becomes shared/reused (this component remounts on every world render).
      try { socket?.off('mentorship:npc-adopted'); } catch { /* ignore */ }
      try { socket?.disconnect(); } catch { /* ignore */ }
      for (const t of timerIds) clearTimeout(t);
      timerIds = [];
    };
  }, []);

  if (events.length === 0) return null;

  return (
    <div
      className="fixed right-3 bottom-20 z-50 flex flex-col gap-1 pointer-events-auto"
      data-testid="mentorship-notifier"
    >
      {events.map((e) => (
        <div
          key={e.id}
          data-adoption-id={e.id}
          data-npc-id={e.npcId}
          className="max-w-[20rem] bg-emerald-950/85 border border-emerald-700/60 rounded-md backdrop-blur-md px-3 py-2 shadow-lg"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">Mentorship</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setEvents((cur) => cur.filter((x) => x.id !== e.id))}
              className="text-[10px] text-emerald-400/70 hover:text-emerald-200"
            >
              ✕
            </button>
          </div>
          <p className="text-[11px] text-emerald-100 leading-snug">
            <span className="font-mono">{e.npcId}</span> adopted a pattern from your lineage.
            {e.newName ? <> Their revision is now <span className="font-mono">{e.newName}</span> (rev {e.revisionNum ?? '?'}).</> : null}
          </p>
        </div>
      ))}
    </div>
  );
}
