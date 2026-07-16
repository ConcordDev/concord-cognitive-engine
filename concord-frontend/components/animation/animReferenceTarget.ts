/**
 * animReferenceTarget — cross-tab pointer to "the frame currently open in
 * the Animation Studio," so the Reference tab's "Import onto frame" action
 * knows what to target even though Studio and Reference are separate tabs
 * that unmount each other (`app/lenses/animation/page.tsx` renders only the
 * active tab's content).
 *
 * Honest scope: this is a pointer, not a live session. `AnimStudio` writes
 * it whenever the open animation or the selected frame changes; it is NOT
 * cleared on unmount, so switching tabs keeps pointing at "the frame you
 * were last looking at." If that animation/frame has since been deleted,
 * the import macro call itself returns a real `{ ok:false, error }` — the
 * reference-images panel surfaces that honestly rather than assuming the
 * pointer is still valid.
 */

export interface ActiveFrameTarget {
  animId: string;
  frameId: string;
  animTitle: string;
  frameIndex: number;
  frameCount: number;
}

const STORAGE_KEY = 'concord:animation:activeFrame';
export const ACTIVE_FRAME_EVENT = 'anim:active-frame';

export function setActiveFrameTarget(target: ActiveFrameTarget): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
  } catch {
    /* best effort — an in-memory-only fallback isn't worth the complexity */
  }
  try {
    window.dispatchEvent(new CustomEvent<ActiveFrameTarget>(ACTIVE_FRAME_EVENT, { detail: target }));
  } catch {
    /* best effort */
  }
}

export function getActiveFrameTarget(): ActiveFrameTarget | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveFrameTarget;
    if (!parsed?.animId || !parsed?.frameId) return null;
    return parsed;
  } catch {
    return null;
  }
}
