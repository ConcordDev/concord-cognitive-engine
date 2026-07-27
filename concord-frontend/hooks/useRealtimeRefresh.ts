'use client';

// useRealtimeRefresh — the "emit-on-change + slow backstop poll" pattern.
//
// Many HUDs polled a REST endpoint on a tight setInterval even when the server
// already pushes a socket event for the same data. This hook converts them to
// push: it subscribes to one or more SocketEvents and calls refresh() the moment
// any fires, while keeping a SLOW backstop poll (default 30s) so a missed event
// or a reconnect gap still self-heals. Net effect: instant updates, ~10–30x less
// network than the old tight polls, and resilient to dropped sockets.
//
// The backstop poll runs through useSmartPolling (not a raw setInterval) so it
// inherits Page Visibility pausing (a backgrounded tab stops polling entirely —
// this hook has 22 real callers today, so a hidden tab with several of them
// mounted was still generating a steady drip of backstop requests for nobody)
// and jitter (many callers share the same default 30s backstopMs, so without
// jitter they'd tend toward firing in lockstep). See hooks/useSmartPolling.ts.
//
// Usage:
//   useRealtimeRefresh(['world:drift-alert'], refresh, { backstopMs: 30000 });

import { useEffect, useRef } from 'react';
import { subscribe, type SocketEvent } from '@/lib/realtime/socket';
import { useSmartPolling } from '@/hooks/useSmartPolling';

export interface RealtimeRefreshOpts {
  /** Slow safety-net poll interval in ms (0 disables the backstop). Default 30s. */
  backstopMs?: number;
  /** Run refresh once on mount. Default true. */
  immediate?: boolean;
  /** When false, neither subscribes nor polls (e.g. panel closed). Default true. */
  enabled?: boolean;
}

export function useRealtimeRefresh(
  events: SocketEvent[],
  refresh: () => void,
  opts: RealtimeRefreshOpts = {},
): void {
  const { backstopMs = 30000, immediate = true, enabled = true } = opts;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    const fire = () => { try { refreshRef.current(); } catch { /* swallow */ } };
    if (immediate) fire();

    // Push: instant refresh on any of the subscribed events.
    const unsubs = events.map((evt) => subscribe(evt, () => fire()));

    return () => {
      for (const u of unsubs) u();
    };
    // events is intentionally spread into the dep list so a changed event set
    // re-subscribes; refresh is read via ref so it doesn't churn subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, immediate, events.join('|')]);

  // Backstop: a slow, visibility-paused, jittered poll so missed events /
  // reconnect gaps self-heal (see useSmartPolling's own doc comment). Its own
  // `immediate: false` is deliberate — the effect above already fires once on
  // mount when `immediate` is true, so a second immediate fire here would be
  // a duplicate on every mount.
  useSmartPolling(
    () => { try { refreshRef.current(); } catch { /* swallow */ } },
    backstopMs,
    { enabled: enabled && backstopMs > 0, immediate: false }
  );
}

export default useRealtimeRefresh;
