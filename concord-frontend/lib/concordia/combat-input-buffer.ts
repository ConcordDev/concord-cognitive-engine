// concord-frontend/lib/concordia/combat-input-buffer.ts
//
// A2 / F3.3 — input buffering + animation-cancel windows.
//
// Fighting-game feel: a press made slightly too early (during the previous
// action's recovery) should still fire the instant the action becomes
// available, instead of being dropped. And a committed attack should be
// cancellable into a dodge once it's ≥50% through recovery (whiff-cancel).
//
// Pure + deterministic so the model is unit-tested; CombatInputController owns
// the timers and consumes these.

export interface BufferedInput {
  action: string;
  at: number;       // timestamp (ms) of the press
  variant?: string;
}

/** Default buffer window — ~5–6 frames at 60fps. Tuned to 90ms (E2, depth
 *  plan): 110ms sat at the top of the proven 50–110ms range (SF6 ≈5f), which
 *  over-buffers and can fire a queued special a beat late; 90ms keeps the
 *  forgiveness without the lag. */
export const DEFAULT_BUFFER_MS = 90;
/** Recovery fraction at/after which a committed action can be cancelled. */
export const CANCEL_THRESHOLD = 0.5;

export interface InputBuffer {
  push(action: string, now: number, variant?: string): void;
  /** The freshest still-valid buffered input at `now`, or null. Consuming clears it. */
  take(now: number): BufferedInput | null;
  peek(now: number): BufferedInput | null;
  clear(): void;
}

/**
 * A 1-deep "latest wins" input buffer: a press is held for `windowMs`; if the
 * action becomes available within that window it fires, else it's discarded.
 * Latest-wins so a player can override a buffered light with a buffered heavy.
 */
export function createInputBuffer(windowMs: number = DEFAULT_BUFFER_MS): InputBuffer {
  let pending: BufferedInput | null = null;
  const fresh = (now: number) => (pending && now - pending.at <= windowMs ? pending : null);
  return {
    push(action, now, variant) { pending = { action, at: now, variant }; },
    peek(now) { return fresh(now); },
    take(now) {
      const v = fresh(now);
      if (v) pending = null;
      return v;
    },
    clear() { pending = null; },
  };
}

/**
 * Whether a committed action can be cancelled into another at this recovery
 * fraction (0 = just hit, 1 = fully recovered). Cancel opens at the threshold.
 */
export function canCancel(recoveryFraction: number, threshold: number = CANCEL_THRESHOLD): boolean {
  return (Number(recoveryFraction) || 0) >= threshold;
}

/**
 * Given the time since an action started, its total duration, and a cancel
 * threshold, report { recoveryFraction, cancellable }.
 */
export function cancelState(elapsedMs: number, durationMs: number, threshold: number = CANCEL_THRESHOLD) {
  const frac = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 1;
  return { recoveryFraction: Math.round(frac * 1000) / 1000, cancellable: canCancel(frac, threshold) };
}
