/**
 * World Lens plan Phase 2 ("Activate Existing Rendering") — Photo Mode's
 * P-key toggle. Extracted out of app/lenses/world/page.tsx's
 * `handlePhotoModeKey` keydown effect so the guard logic (which key, which
 * focus state, which combat/dialogue state) is a pure, independently
 * testable predicate instead of only reachable by mounting the ~9,000-line
 * page in jsdom.
 *
 * page.tsx still owns the `useEffect`/`addEventListener('keydown', ...)`
 * wiring and the `useState` calls — those are React lifecycle concerns and
 * stay there. This module only owns the two decisions that were previously
 * un-unit-testable buried inside the handler: (1) should THIS keydown event
 * toggle Photo Mode, and (2) where does the capture canvas come from.
 */

export interface PhotoModeKeyContext {
  /** Truthy when a dialogue panel is open — Photo Mode is gated out of dialogue. */
  dialogueNPC: unknown;
  /** Truthy when the player currently has a combat target — Photo Mode is gated out of combat. */
  combatTarget: unknown;
}

/**
 * True if `e` should toggle Photo Mode open/closed. Matches the page's
 * other single-key bindings (e.g. the E-key portal/dialogue effect):
 * case-insensitive key match, ignore keystrokes aimed at a text input /
 * textarea / contenteditable element, and never fire while the player is
 * in dialogue or has a live combat target.
 */
export function shouldTogglePhotoMode(e: Pick<KeyboardEvent, 'key' | 'target'>, ctx: PhotoModeKeyContext): boolean {
  if (e.key !== 'p' && e.key !== 'P') return false;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return false;
  if (ctx.dialogueNPC || ctx.combatTarget) return false;
  return true;
}

/**
 * Resolves the live WebGL canvas for Photo Mode's screenshot/save-to-gallery
 * paths from the same `__concordiaRenderer` window global ConcordiaScene.tsx
 * already exposes for WebXR. Returns null (never throws) when the renderer
 * hasn't mounted yet or the global is absent.
 */
export function resolvePhotoModeCanvas(win: Window): HTMLCanvasElement | null {
  try {
    const renderer = (win as unknown as { __concordiaRenderer?: { domElement?: HTMLCanvasElement } }).__concordiaRenderer;
    return renderer?.domElement ?? null;
  } catch {
    return null;
  }
}
