'use client';

/**
 * useLensRealtime — typed, lens-scoped realtime subscription.
 *
 * Thin typed wrapper over the existing event bus + socket singleton.
 * Adds:
 *   - typed event names (constrained to SocketEvent)
 *   - optional dev-mode payload shape validation against event-shapes
 *   - lens-active gating (only fire when the calling lens is active)
 *   - one-call multi-event subscription with auto-cleanup
 *   - room helpers (joinRoom / leaveRoom on mount/unmount)
 *
 * Use this hook in any lens that needs to react to realtime events.
 * Do NOT use it for one-shot fetches — that's TanStack Query's job.
 */

import { useEffect, useRef } from 'react';

import { onEvent } from '@/lib/realtime/event-bus';
import { emit as socketEmit, joinRoom, leaveRoom, type SocketEvent } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

export type LensRealtimeHandler<T = unknown> = (data: T) => void;

export type LensRealtimeMap = Partial<Record<SocketEvent, LensRealtimeHandler>>;

export interface UseLensRealtimeOptions {
  /** Lens id; if provided + onlyWhenActive=true, handlers fire only when this lens is active. */
  lensId?: string;
  /** Default true: only deliver events while the lens is the active one in the UI store. */
  onlyWhenActive?: boolean;
  /** Optional list of socket rooms to join on mount and leave on unmount. */
  rooms?: string[];
}

export interface UseLensRealtimeReturn {
  emit: (event: string, data?: unknown) => void;
}

export function useLensRealtime(
  events: LensRealtimeMap,
  options: UseLensRealtimeOptions = {}
): UseLensRealtimeReturn {
  const { lensId, onlyWhenActive = false, rooms } = options;

  // Latest map ref — avoids re-subscribing when handler identities change.
  const mapRef = useRef<LensRealtimeMap>(events);
  mapRef.current = events;

  // Subscribe to events.
  const eventKey = Object.keys(events).sort().join(',');
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    for (const eventName of Object.keys(mapRef.current)) {
      const e = eventName as SocketEvent;
      const handler = (data: unknown) => {
        if (onlyWhenActive && lensId) {
          const active = useUIStore.getState().activeLens;
          if (active !== lensId) return;
        }
        if (process.env.NODE_ENV !== 'production') {
          validatePayloadShape(e, data);
        }
        const fn = mapRef.current[e];
        fn?.(data);
      };
      unsubs.push(onEvent(e, handler));
    }
    return () => {
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventKey, lensId, onlyWhenActive]);

  // Join/leave rooms.
  const roomsKey = rooms?.join(',') ?? '';
  useEffect(() => {
    if (!rooms || rooms.length === 0) return;
    rooms.forEach((r) => joinRoom(r));
    return () => {
      rooms.forEach((r) => leaveRoom(r));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomsKey]);

  return { emit: socketEmit };
}

// ── Dev-only shape validation ────────────────────────────────────────────────
//
// The server pins event payload shapes in `server/lib/event-shapes.js`. We
// don't import that file directly (it's CJS + server-side), but we replicate
// the smallest possible signal: warn if a "required" looking field is missing
// from a payload we know about. This is best-effort — never blocks delivery.

const EXPECTED_FIELDS: Partial<Record<SocketEvent, string[]>> = {
  'dtu:created': ['id'],
  'dtu:updated': ['id'],
  'dtu:deleted': ['id'],
  'dtu:promoted': ['id'],
  'chat:status': ['status'],
  'chat:token': ['token'],
  'system:alert': ['message'],
  'attention:allocation': ['allocation'],
  'comment:added': ['dtuId'],
};

function validatePayloadShape(event: SocketEvent, data: unknown) {
  const expected = EXPECTED_FIELDS[event];
  if (!expected) return;
  if (!data || typeof data !== 'object') {
    console.warn(`[useLensRealtime] ${event}: payload is not an object`, data);
    return;
  }
  const obj = data as Record<string, unknown>;
  for (const field of expected) {
    if (obj[field] === undefined) {
      console.warn(`[useLensRealtime] ${event}: missing expected field "${field}"`, data);
    }
  }
}
