/** Fired after a wellness write succeeds so sibling panels refetch. */
export const WELLNESS_CHANGED = 'concord:wellness-changed';

export function notifyWellnessChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(WELLNESS_CHANGED));
}
