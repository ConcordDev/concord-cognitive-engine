// concord-frontend/lib/concordia/gamepad-combat-map.ts
//
// F2 — map Standard-Gamepad buttons to combat actions, with per-button remap
// + localStorage persistence. The CombatInputController subscribes to gamepad
// button-down edges and dispatches the resolved action, mirroring the keyboard
// write-through. Pure resolution so it's unit-testable headless.

import type { GamepadButton } from '@/hooks/useGamepad';
import type { KeyAction } from './keybindings';

/** Combat action a gamepad button maps to, plus the tap/hold variant it fires. */
export interface GamepadActionBinding {
  action: KeyAction;
  variant: 'tap' | 'hold';
}

export type GamepadCombatMap = Partial<Record<GamepadButton, GamepadActionBinding>>;

// Default Standard-Gamepad layout (Souls-like face/shoulder convention).
export const DEFAULT_GAMEPAD_COMBAT_MAP: GamepadCombatMap = {
  X:  { action: 'light',    variant: 'tap' },   // Square — light
  Y:  { action: 'heavy',    variant: 'hold' },  // Triangle — heavy
  RB: { action: 'kick',     variant: 'tap' },   // R1 — kick
  RT: { action: 'finisher', variant: 'tap' },   // R2 — finisher
  LB: { action: 'parry',    variant: 'tap' },   // L1 — parry
  LT: { action: 'grab',     variant: 'hold' },  // L2 — grab
  B:  { action: 'dodge',    variant: 'tap' },   // Circle — dodge
  A:  { action: 'modifier', variant: 'tap' },   // Cross — modifier
};

const STORAGE_KEY = 'concord:gamepad-combat-map';

/** Resolve a pressed gamepad button → its combat binding (or null). */
export function resolveGamepadButton(map: GamepadCombatMap, button: GamepadButton): GamepadActionBinding | null {
  return map[button] ?? null;
}

/**
 * Rebind a gamepad button to an action (pure). If another button already maps
 * to that action, the two swap so an action is never orphaned.
 */
export function remapGamepadButton(map: GamepadCombatMap, button: GamepadButton, action: KeyAction, variant: 'tap' | 'hold'): GamepadCombatMap {
  const next: GamepadCombatMap = { ...map };
  const prevForButton = next[button];
  const collidingButton = (Object.keys(next) as GamepadButton[]).find((b) => b !== button && next[b]?.action === action);
  next[button] = { action, variant };
  if (collidingButton && prevForButton) {
    next[collidingButton] = prevForButton;
  } else if (collidingButton) {
    delete next[collidingButton];
  }
  return next;
}

export function loadGamepadCombatMap(): GamepadCombatMap {
  if (typeof window === 'undefined') return DEFAULT_GAMEPAD_COMBAT_MAP;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_GAMEPAD_COMBAT_MAP;
    const parsed = JSON.parse(raw) as GamepadCombatMap;
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_GAMEPAD_COMBAT_MAP;
  } catch { return DEFAULT_GAMEPAD_COMBAT_MAP; }
}

export function saveGamepadCombatMap(map: GamepadCombatMap): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('concordia:gamepad-map-changed', { detail: { map } }));
}
