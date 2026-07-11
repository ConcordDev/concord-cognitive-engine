'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Shared fix for the "cancel doesn't cancel" bug in the crafting minigames
 * (GatheringMinigame / CraftingMinigame / ButcheringMinigame): each shows a
 * brief hit/miss flourish after the final action, then fires a real
 * backend-mutating `onComplete` via `setTimeout`. If the player clicks
 * cancel (or the parent otherwise unmounts the minigame) during that
 * window, a bare `setTimeout` keeps the timer alive and still invokes the
 * stale `onComplete` closure after the component is gone.
 *
 * `scheduleComplete` replaces the raw `setTimeout(() => onComplete(x), ms)`
 * call. `cancelPendingComplete` clears the pending timer immediately (call
 * it from the cancel button handler) and the hook also clears it on
 * unmount for any other reason, so a stale mutation can never fire once
 * the player has walked away.
 */
export function useCancelableCompletion<T>(onComplete: (value: T) => void) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingComplete = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Unmount for ANY reason (explicit cancel, parent navigating away,
  // corpse despawning, etc.) must never let a queued completion fire.
  useEffect(() => cancelPendingComplete, [cancelPendingComplete]);

  const scheduleComplete = useCallback((value: T, delayMs: number) => {
    cancelPendingComplete();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      onComplete(value);
    }, delayMs);
  }, [cancelPendingComplete, onComplete]);

  return { scheduleComplete, cancelPendingComplete };
}
