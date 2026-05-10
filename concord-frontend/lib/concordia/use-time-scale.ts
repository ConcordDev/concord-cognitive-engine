/**
 * Global time scale — Sprint D / Z2
 *
 * Single source of truth for game-time scaling. Physics step `dt`,
 * animation mixers, motor integration, and SoundscapeEngine all read
 * from this. Combat hit-stop, cinematic slow-mo, photo-mode pause
 * use this single source.
 *
 * Storage: window.__concordia_time_scale__ (number, default 1.0).
 * Update: setTimeScale(value, durationMs?) — value 0 = pause; 0.2 = slow-mo;
 *         duration auto-restores to 1.0 after.
 *
 * Per-frame consumers multiply their delta by getTimeScale().
 */

const KEY = '__concordia_time_scale__';
const RESTORE_KEY = '__concordia_time_scale_restore__';

declare global {
  interface Window {
    __concordia_time_scale__?: number;
    __concordia_time_scale_restore__?: number;
  }
}

export function getTimeScale(): number {
  if (typeof window === 'undefined') return 1.0;
  // Check restore window.
  const restore = (window as Window)[RESTORE_KEY] as number | undefined;
  if (typeof restore === 'number' && performance.now() >= restore) {
    (window as Window)[KEY] = 1.0;
    delete (window as Window)[RESTORE_KEY];
  }
  return (window as Window)[KEY] ?? 1.0;
}

/**
 * Set the time scale. Optional durationMs auto-restores to 1.0 after the
 * window elapses. Pass undefined to leave the setting indefinite (e.g.
 * for photo mode pause).
 */
export function setTimeScale(value: number, durationMs?: number): void {
  if (typeof window === 'undefined') return;
  const v = Math.max(0, Math.min(2, value));
  (window as Window)[KEY] = v;
  if (durationMs && durationMs > 0) {
    (window as Window)[RESTORE_KEY] = performance.now() + durationMs;
  } else {
    delete (window as Window)[RESTORE_KEY];
  }
  try {
    window.dispatchEvent(new CustomEvent('concordia:time-scale', { detail: { value: v, durationMs } }));
  } catch { /* noop */ }
}

/** Convenience: pause everything. */
export function pause(): void { setTimeScale(0); }
/** Convenience: resume normal time. */
export function resume(): void { setTimeScale(1); }
/** Convenience: slow-mo for a window. */
export function slowMo(scale = 0.25, durationMs = 1000): void {
  setTimeScale(scale, durationMs);
}
/** Convenience: hit-stop (50-150ms full pause). */
export function hitStop(durationMs = 90): void {
  setTimeScale(0, durationMs);
}

/** React hook returning the current time scale, re-rendering on change. */
export function useTimeScaleListener(callback: (scale: number) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ value: number }>).detail;
    if (detail) callback(detail.value);
  };
  window.addEventListener('concordia:time-scale', handler);
  return () => window.removeEventListener('concordia:time-scale', handler);
}

export const TIME_SCALE_CONSTANTS = Object.freeze({
  DEFAULT: 1.0,
  HIT_STOP_MS_LIGHT: 60,
  HIT_STOP_MS_HEAVY: 120,
  HIT_STOP_MS_KILL: 220,
  SLOW_MO_DEFAULT: 0.25,
});
