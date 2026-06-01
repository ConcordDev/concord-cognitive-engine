/**
 * Phase Z7 — shared juice / SFX dispatch helpers.
 *
 * The canonical event channels for game-feel (verified against existing
 * world HUDs):
 *
 * - SFX: `window.dispatchEvent(new CustomEvent('concordia:soundscape-command',
 *        { detail: { action: 'triggerSFX', sfxId } }))`
 *        Consumed by `concord-frontend/components/world-lens/SoundscapeEngine.tsx`.
 *
 * - Game-juice (screen shake, flash, milestone fanfare):
 *   `window.dispatchEvent(new CustomEvent('concordia:game-juice',
 *    { detail: { trigger, opts? } }))`
 *   Consumed by `concord-frontend/components/world-lens/GameJuice.tsx`.
 *
 * Use these helpers from every new HUD / modal so the Phase D surfaces
 * read with the same audible+visible feedback as the original combat
 * layer.
 */

/**
 * Shared motion-duration tokens (ms). One source of truth for animation/transition
 * timing across every HUD, overlay, and juice surface — so "fast" means the same
 * thing everywhere and a feel pass tunes one table, not 40 scattered magic numbers.
 *
 * Tiers follow the industry-convergent ranges (Material 3 easing-and-duration specs
 * + NN/g "Animation Duration" guidance + Val Head "How fast should your UI
 * animations be"): routine UI 160–240ms, entrance/exit 240–360ms, large moves to
 * ~400ms. Entrances run a touch longer than exits (objects appearing need more time
 * to read than objects leaving).
 *
 *   instant  80   micro-feedback (press flash, toggle)
 *   fast    160   component state changes (hover, focus, small slide)
 *   base    240   default UI transition (panel content, tab switch)
 *   slow    360   large/entrance motion (modal open, full-screen panel)
 *   enter   280   element appearing on screen
 *   exit    200   element leaving screen (faster than its entrance)
 */
export const MOTION = {
  instant: 80,
  fast: 160,
  base: 240,
  slow: 360,
  enter: 280,
  exit: 200,
} as const;

export type MotionToken = keyof typeof MOTION;

/** Resolve a motion token (or a raw ms number) to milliseconds. */
export function durationMs(token: MotionToken | number): number {
  return typeof token === 'number' ? token : MOTION[token];
}

export type JuiceTrigger =
  | 'menu-open'
  | 'menu-close'
  | 'success'
  | 'failure'
  | 'milestone'
  | 'damage'
  | 'level-up'
  | 'discovery';

interface JuiceOpts {
  magnitude?: number;
  value?: number | string;
  targetId?: string;
  attackerId?: string;
  position?: { x: number; y: number; z: number };
  sourcePosition?: { x: number; y: number; z: number };
}

export function juice(trigger: JuiceTrigger, opts?: JuiceOpts): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('concordia:game-juice', { detail: { trigger, opts } })
    );
  } catch {
    /* swallow */
  }
}

export function sfx(sfxId: string, opts?: { volume?: number }): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('concordia:soundscape-command', {
        detail: { action: 'triggerSFX', sfxId, ...(opts || {}) },
      })
    );
  } catch {
    /* swallow */
  }
}

/** Shortcut: open a menu / HUD with a soft SFX + slide-in juice. */
export function menuOpen(sfxId: string = 'ui_menu_open'): void {
  sfx(sfxId);
  juice('menu-open');
}

/** Shortcut: success action (plant a crop, mint a spell, win a hand). */
export function successJuice(sfxId: string = 'ui_success'): void {
  sfx(sfxId);
  juice('success');
}

/** Shortcut: milestone (S-grade karaoke, all targets found, run ends well). */
export function milestoneJuice(sfxId: string = 'ui_milestone'): void {
  sfx(sfxId);
  juice('milestone');
}

/** Shortcut: failure (wrong cite, missed window, expired order). */
export function failureJuice(sfxId: string = 'ui_failure'): void {
  sfx(sfxId);
  juice('failure');
}

/** Shortcut: discovery (new evidence, new region, new lineage). */
export function discoveryJuice(sfxId: string = 'ui_discovery'): void {
  sfx(sfxId);
  juice('discovery');
}
