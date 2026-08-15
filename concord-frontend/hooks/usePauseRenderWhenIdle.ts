/**
 * usePauseRenderWhenIdle.ts
 *
 * Skip rAF frames when nothing is changing — camera still, no NPC animating,
 * no particle event, no input. Big perf win for exploration: standing still
 * in the city looking at landmarks shouldn't burn 60fps.
 *
 * Usage:
 *   const shouldRender = usePauseRenderWhenIdle({ idleMs: 500 });
 *   function gameLoop() {
 *     if (!shouldRender()) return;
 *     // ... do the render ...
 *     requestAnimationFrame(gameLoop);
 *   }
 *
 * Watched signals:
 *   - Camera position/rotation change
 *   - Mouse/touch movement
 *   - Active animation state machines
 *   - Particle system events
 *   - Page visibility (pause when tab hidden)
 */

import { useEffect, useRef, useCallback } from 'react';

export interface PauseRenderOptions {
  /** Time without activity before considering idle (default 500ms) */
  idleMs?: number;
  /** Always render at least every N ms (heartbeat) — default 1000ms */
  heartbeatMs?: number;
  /** Render at this FPS when idle (default 15) — gentle animation */
  idleFps?: number;
  /** Signals that count as activity — function returns true if anything changed */
  activityCheck?: () => boolean;
}

export function usePauseRenderWhenIdle(options: PauseRenderOptions = {}): () => boolean {
  const {
    idleMs = 500,
    heartbeatMs = 1000,
    idleFps = 15,
    activityCheck,
  } = options;

  const lastRenderRef = useRef(performance.now());
  const lastActivityRef = useRef(performance.now());
  const lastHeartbeatRef = useRef(performance.now());
  const lastIdleFrameRef = useRef(0);

  const markActivity = useCallback(() => {
    lastActivityRef.current = performance.now();
  }, []);

  // Listen to input + visibility
  useEffect(() => {
    const onActivity = () => markActivity();
    const onVisibility = () => {
      if (document.hidden) {
        // Tab hidden — pretend we never had activity (effectively pauses)
        lastActivityRef.current = 0;
      } else {
        markActivity();
      }
    };

    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('mousedown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('wheel', onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('mousedown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('wheel', onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [markActivity]);

  return useCallback((): boolean => {
    const now = performance.now();
    const sinceActivity = now - lastActivityRef.current;
    const sinceRender = now - lastRenderRef.current;
    const sinceHeartbeat = now - lastHeartbeatRef.current;

    // Custom activity check (camera moved, anim playing, etc.)
    if (activityCheck?.()) {
      lastActivityRef.current = now;
      lastRenderRef.current = now;
      return true;
    }

    // Active: render every frame
    if (sinceActivity < idleMs) {
      lastRenderRef.current = now;
      return true;
    }

    // Idle: render at idleFps (default 15)
    const idleFrameInterval = 1000 / idleFps;
    if (sinceRender >= idleFrameInterval) {
      lastRenderRef.current = now;
      return true;
    }

    // Force heartbeat render every heartbeatMs (catches any state that changed
    // without explicit signal — physics tick, ambient particles, etc.)
    if (sinceHeartbeat >= heartbeatMs) {
      lastHeartbeatRef.current = now;
      lastRenderRef.current = now;
      return true;
    }

    return false;
  }, [idleMs, heartbeatMs, idleFps, activityCheck]);
}

export default usePauseRenderWhenIdle;
