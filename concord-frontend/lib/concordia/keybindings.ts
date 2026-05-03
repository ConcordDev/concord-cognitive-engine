/**
 * keybindings.ts — Custom controls profile for Flow Combat.
 *
 * The CombatInputController reads this map at every keypress, so remapping
 * is instant. Persisted to localStorage so a refresh keeps the profile.
 *
 * Important: action tokens (light, heavy, finisher, parry, grab, kick,
 * dodge, modifier) are STABLE — only the key codes change. The Combat Flow
 * substrate stores actions, not keys, so all evolved combos keep working
 * after a remap.
 *
 * Presets bundled (matches the spec):
 *   default            — balanced
 *   aggressive         — E-heavy, F slightly nerfed
 *   defensive          — F-heavy, parry/block-first
 *   dual_wield         — easier hand-switching
 *   two_handed_bruiser — heavy attacks all on E
 */

export type KeyAction =
  | 'light'      // E tap default
  | 'heavy'      // E hold default
  | 'finisher'   // E double-tap default
  | 'parry'      // F tap default
  | 'grab'       // F hold default
  | 'kick'       // R default
  | 'dodge'      // Q default
  | 'modifier';  // Shift default (also acts as left-hand toggle)

export interface KeyBinding {
  key: string;        // KeyboardEvent.key (lower-cased) — e.g. 'e', 'f', 'shift'
  variant: 'tap' | 'hold' | 'double-tap';
}

export interface KeyProfile {
  id: string;
  name: string;
  bindings: Record<KeyAction, KeyBinding>;
}

export const DEFAULT_PROFILE: KeyProfile = {
  id: 'default',
  name: 'Default (Recommended)',
  bindings: {
    light:    { key: 'e', variant: 'tap' },
    heavy:    { key: 'e', variant: 'hold' },
    finisher: { key: 'e', variant: 'double-tap' },
    parry:    { key: 'f', variant: 'tap' },
    grab:     { key: 'f', variant: 'hold' },
    kick:     { key: 'r', variant: 'tap' },
    dodge:    { key: 'q', variant: 'tap' },
    modifier: { key: 'shift', variant: 'tap' },
  },
};

export const PRESETS: KeyProfile[] = [
  DEFAULT_PROFILE,
  {
    id: 'aggressive',
    name: 'Aggressive (More E-based)',
    bindings: {
      ...DEFAULT_PROFILE.bindings,
      // F gets remapped slightly — kick on F-tap so the player has a chain
      // of three offensive options on one key, parry moves to Q.
      kick:  { key: 'f', variant: 'tap' },
      parry: { key: 'q', variant: 'tap' },
      dodge: { key: 'r', variant: 'tap' },
    },
  },
  {
    id: 'defensive',
    name: 'Defensive (More F-based)',
    bindings: {
      ...DEFAULT_PROFILE.bindings,
      // F is the safe-side: parry tap, block hold (held = grab default but
      // on this profile hold keeps the parry stance up = block).
      grab:  { key: 'r', variant: 'tap' },     // grab moves to R-tap
      kick:  { key: 'r', variant: 'hold' },    // kick on R-hold
      dodge: { key: 'q', variant: 'tap' },
    },
  },
  {
    id: 'dual_wield',
    name: 'Dual-Wield Specialist',
    bindings: {
      ...DEFAULT_PROFILE.bindings,
      // No layout change vs default — but the modifier key is more
      // ergonomically placed on dedicated hand-toggle key for fast
      // alternation (left ctrl). Tap to lock left hand, tap again to
      // unlock — covered in the controller's modifierToggle path.
      modifier: { key: 'control', variant: 'tap' },
    },
  },
  {
    id: 'two_handed_bruiser',
    name: 'Two-Handed Bruiser',
    bindings: {
      ...DEFAULT_PROFILE.bindings,
      // All offensive verbs cluster on E for committed heavy play.
      kick:     { key: 'e', variant: 'double-tap' },  // E×2 = kick instead of finisher
      finisher: { key: 'r', variant: 'tap' },         // finisher moves to R
    },
  },
];

const STORAGE_KEY = 'concord:keybindings:profile';

let _activeProfile: KeyProfile = DEFAULT_PROFILE;

export function loadActiveProfile(): KeyProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw) as KeyProfile;
    if (parsed?.id && parsed?.bindings) {
      _activeProfile = parsed;
      return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_PROFILE;
}

export function saveActiveProfile(p: KeyProfile): void {
  _activeProfile = p;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:keybindings-changed', { detail: { profile: p } }));
  }
}

export function getActiveProfile(): KeyProfile {
  return _activeProfile;
}

/**
 * Resolve a keypress into the bound action token, if any. Returns null
 * when the key isn't bound.
 */
export function resolveBinding(key: string, variant: 'tap' | 'hold' | 'double-tap'): KeyAction | null {
  const k = (key || '').toLowerCase();
  for (const [action, b] of Object.entries(_activeProfile.bindings) as Array<[KeyAction, KeyBinding]>) {
    if (b.key === k && b.variant === variant) return action;
  }
  return null;
}

/** Reset to the bundled default. */
export function resetToDefault(): void {
  saveActiveProfile(DEFAULT_PROFILE);
}
