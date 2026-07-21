'use client';

/**
 * KillFeed — Phase V5.
 *
 * Opt-in floating ticker top-right. Listens for `combat:kill` and
 * `entity:death` realtime events from the player's current world and
 * shows up to 5 entries, each fading after 8s.
 *
 * Defaults: visible on PvP worlds (lattice-crucible, superhero, crime).
 * Off everywhere else. Toggle persists in localStorage:concordia:killFeed.
 */

import { useEffect, useState } from 'react';
import { Skull, Swords } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface KillEvent {
  ts: number;
  killer: string;
  victim: string;
  skillId?: string;
  isPlayer?: boolean;
}

const STORAGE_KEY = 'concordia:killFeed';
const PVP_WORLDS = new Set(['lattice-crucible', 'superhero', 'crime']);

export function KillFeed({ worldId }: { worldId: string }) {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'on') return true;
      if (stored === 'off') return false;
      return PVP_WORLDS.has(worldId);  // default on for PvP worlds
    } catch { return false; }
  });
  const [events, setEvents] = useState<KillEvent[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (ev: Event) => {
      const next = (ev as CustomEvent).detail?.enabled;
      if (next != null) setEnabled(!!next);
    };
    window.addEventListener('concordia:killfeed-mode-changed', onChange);
    return () => window.removeEventListener('concordia:killfeed-mode-changed', onChange);
  }, []);

  // combat:kill (server.js) fires { attackerId, targetId } — bare user ids,
  // no worldId/skillId/names. entity:death (death-protocol.js) fires
  // { entityId, entityName, cause, ... } for NPC/creature deaths — also no
  // worldId. Neither event carries the killer/victim/skillId/isPlayer shape
  // the old (dead) window-CustomEvent handler assumed; map each shape
  // explicitly instead of guessing a common one.
  useEffect(() => {
    if (!enabled) return;
    const offKill = subscribe<{ attackerId?: string; targetId?: string; worldId?: string }>(
      'combat:kill',
      (data) => {
        if (!data) return;
        if (data.worldId && data.worldId !== worldId) return;
        const k: KillEvent = {
          ts: Date.now(),
          killer: String(data.attackerId ?? 'unknown'),
          victim: String(data.targetId ?? 'unknown'),
          isPlayer: true,
        };
        setEvents((prev) => [k, ...prev].slice(0, 5));
      },
    );
    const offDeath = subscribe<{ entityId?: string; entityName?: string; cause?: string; worldId?: string }>(
      'entity:death',
      (data) => {
        if (!data) return;
        if (data.worldId && data.worldId !== worldId) return;
        const k: KillEvent = {
          ts: Date.now(),
          killer: String(data.cause ?? 'unknown'),
          victim: String(data.entityName ?? data.entityId ?? 'unknown'),
        };
        setEvents((prev) => [k, ...prev].slice(0, 5));
      },
    );
    return () => {
      offKill?.();
      offDeath?.();
    };
  }, [enabled, worldId]);

  // Fade-out: prune entries older than 8s. `.filter()` always allocates a
  // new array even when nothing actually expired — part of a page-wide
  // "Maximum update depth exceeded" cluster found on the World Lens; skip
  // the setState when the filtered result is the same length as the input.
  useEffect(() => {
    if (events.length === 0) return;
    const t = setInterval(() => {
      const cutoff = Date.now() - 8_000;
      setEvents((prev) => {
        const next = prev.filter((e) => e.ts > cutoff);
        return next.length === prev.length ? prev : next;
      });
    }, 1_000);
    return () => clearInterval(t);
  }, [events]);

  if (!enabled || events.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-3 top-40 z-30 flex w-72 flex-col gap-1" aria-live="polite">
      {events.map((e, idx) => {
        const age = Date.now() - e.ts;
        const opacity = Math.max(0.2, 1 - age / 8_000);
        return (
          <div
            key={`${e.ts}-${idx}`}
            style={{ opacity }}
            className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100 backdrop-blur"
          >
            <Skull className="h-3 w-3 shrink-0 text-rose-400" />
            <span className="truncate">
              <span className="font-semibold">{e.killer}</span>
              <span className="text-rose-300/70"> defeated </span>
              <span className="font-semibold">{e.victim}</span>
              {e.skillId && <span className="text-rose-300/70"> with {e.skillId}</span>}
            </span>
            {e.isPlayer && <Swords className="h-3 w-3 shrink-0 text-amber-400" />}
          </div>
        );
      })}
    </div>
  );
}

export function setKillFeedEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    window.dispatchEvent(new CustomEvent('concordia:killfeed-mode-changed', { detail: { enabled } }));
  } catch { /* localStorage may be disabled */ }
}
