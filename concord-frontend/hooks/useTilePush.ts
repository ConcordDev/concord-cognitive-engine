'use client';

/**
 * useTilePush — auto-invalidate lens queries on realtime events.
 *
 * Phase 11 (Item 8) — the manifest declares `realtimeEvents` per lens
 * but nothing turned that declaration into actual UI feedback until
 * now.  This hook reads the manifest, subscribes to each event via
 * the socket layer, and:
 *   1) invalidates a list of React Query keys so stale data refetches
 *   2) returns a `flashId` that goes through 'idle' → 'on' → 'idle'
 *      after each event so a wrapping <FlashHighlight> can pulse the
 *      relevant tile
 *
 *   const { flashKey } = useTilePush({
 *     lensId: 'world',
 *     queryKeys: [['lens-data', 'world']],
 *   });
 *   <FlashHighlight flashKey={flashKey}>{rows}</FlashHighlight>
 *
 * No fake "newness" — the flash only fires when a real socket event
 * arrives.  No-op when the lens declares no realtimeEvents.
 */

import { useEffect, useRef, useState } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { getLensManifest } from '@/lib/lenses/manifest';

export interface UseTilePushOptions {
  lensId: string;
  /** React Query keys to invalidate on each event. */
  queryKeys?: QueryKey[];
  /** Override the manifest's realtimeEvents (rare). */
  events?: string[];
  /** Set false to disable. */
  enabled?: boolean;
  /** Flash duration in ms. Default 900. */
  flashDurationMs?: number;
}

export interface UseTilePushReturn {
  /** Monotonically incremented on each event — drive CSS animation reset off it. */
  flashKey: number;
  /** Active = true between event and flashDurationMs later. */
  isFlashing: boolean;
  /** Last event name that fired. */
  lastEvent: string | null;
}

export function useTilePush(options: UseTilePushOptions): UseTilePushReturn {
  const { lensId, queryKeys = [], events, enabled = true, flashDurationMs = 900 } = options;
  const queryClient = useQueryClient();
  const [flashKey, setFlashKey] = useState(0);
  const [isFlashing, setIsFlashing] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pull the manifest's events when no override given.
  const manifestEvents = (() => {
    if (events) return events;
    try {
      const m = getLensManifest(lensId);
      return Array.isArray(m?.realtimeEvents) ? m.realtimeEvents : [];
    } catch { return []; }
  })();

  useEffect(() => {
    if (!enabled || manifestEvents.length === 0) return;
    let unsubs: Array<() => void> = [];
    let cancelled = false;

    (async () => {
      try {
        const mod = await import('@/lib/realtime/socket').catch(() => null);
        const socket = mod?.getSocket?.();
        if (!socket || cancelled) return;
        for (const evt of manifestEvents) {
          const handler = () => {
            // Refetch the requested query keys.
            for (const qk of queryKeys) {
              try { queryClient.invalidateQueries({ queryKey: qk }); } catch { /* ignore */ }
            }
            setLastEvent(evt);
            setFlashKey((k) => k + 1);
            setIsFlashing(true);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => setIsFlashing(false), flashDurationMs);
          };
          socket.on(evt, handler);
          unsubs.push(() => socket.off(evt, handler));
        }
      } catch {
        /* socket layer unavailable */
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach(fn => { try { fn(); } catch { /* ignore */ } });
      unsubs = [];
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lensId, manifestEvents.join(','), queryKeys.length, flashDurationMs]);

  return { flashKey, isFlashing, lastEvent };
}

export default useTilePush;
