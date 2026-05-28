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
