'use client';

import { useEffect, useRef } from 'react';

/**
 * useSmartPolling — a background poller that does two things none of this
 * codebase's ~219 raw `setInterval`-based pollers do today:
 *
 *   1. Pauses while the tab is hidden (Page Visibility API) instead of
 *      burning requests nobody can see — a hidden tab polling every 3s wastes
 *      ~1,200 requests/hour for zero user-visible benefit. Fires an immediate
 *      catch-up poll when the tab becomes visible again instead of waiting
 *      out a stale interval, matching the SWR/TanStack "revalidate on focus"
 *      convention.
 *   2. Jitters each interval by a configurable fraction (default ±10%) so
 *      many components that happen to share the same POLL_MS constant (this
 *      codebase has several: 1000/2000/2500/3000/15000/30000 — see CLAUDE.md
 *      "Phase D first-draft constants") don't all fire in exact lockstep.
 *
 * This is a complementary, PROACTIVE lever to the api/client.ts read-backoff
 * fix (which is REACTIVE — it only engages after a 429 has already happened).
 * Reducing needless background traffic in the first place is what actually
 * keeps a shared rate-limit bucket healthy; the backoff is the fallback for
 * when it isn't.
 *
 * Deliberately non-breaking: existing `setInterval` call sites are
 * unaffected. This is opt-in infrastructure for new/touched pollers — a
 * codebase-wide migration of all 219 sites is a separate, larger effort.
 */
export interface UseSmartPollingOptions {
  /** Poll once immediately on mount, and again on tab-visible after being hidden. Default true. */
  immediate?: boolean;
  /** Jitter as a fraction of intervalMs, e.g. 0.1 = ±10%. Default 0.1. */
  jitter?: number;
  /** Set false to pause polling without unmounting the caller (e.g. gated on auth/feature flag). Default true. */
  enabled?: boolean;
}

export function useSmartPolling(
  callback: () => void,
  intervalMs: number,
  options: UseSmartPollingOptions = {}
): void {
  const { immediate = true, jitter = 0.1, enabled = true } = options;

  // Always call the LATEST callback without re-arming the timer on every
  // caller re-render (the standard "saved callback ref" pattern — otherwise
  // an inline arrow function passed as `callback` would restart the interval
  // on every render).
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs <= 0 || typeof document === 'undefined') return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const jitteredDelay = () => {
      const spread = intervalMs * jitter;
      return Math.max(0, intervalMs + (Math.random() * 2 - 1) * spread);
    };

    const scheduleNext = () => {
      if (cancelled) return;
      timeoutId = setTimeout(tick, jitteredDelay());
    };

    function tick() {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        callbackRef.current();
      }
      scheduleNext();
    }

    const onVisibilityChange = () => {
      if (immediate && document.visibilityState === 'visible') {
        callbackRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (immediate && document.visibilityState === 'visible') {
      callbackRef.current();
    }
    scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled, immediate, jitter]);
}
