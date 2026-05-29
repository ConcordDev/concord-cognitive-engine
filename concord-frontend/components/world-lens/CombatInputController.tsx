'use client';

/**
 * CombatInputController — keyboard-only Mac/trackpad combat input.
 *
 * Same five keys (E, F, R, Q, Shift) do different things in different
 * contexts. The substrate (lib/combat/context-engine.js) decides what
 * "ground" / "aerial" / "vehicle" / "hacker" mean; this controller maps
 * tap-vs-hold + context → an action token + dispatches the right server
 * event. Combat Flow recording happens server-side so every press lands
 * in the substrate without per-action HTTP calls.
 *
 * Key map:
 *   E (tap)   → light attack    | air quick-blast    | vehicle mounted shot
 *   E (hold)  → heavy attack    | charged dive/slam  | vehicle ram
 *   F (tap)   → parry/block-1f  | air dodge/boost    | evasive maneuver
 *   F (hold)  → grab/throw      | aerial grab+slam   | hack/breach
 *   R         → kick/sweep      | dive kick          | quick-dismount kick
 *   Q         → dodge/roll      | air dash           | quick turn/drift
 *   Shift     → modifier (held; combines with above for evolved variant)
 *
 * Mouse:
 *   Left click  → shoot / cast spell (aim-from-mouse handled by ConcordiaScene)
 *   Right click → quick context action (optional; data-no-click-sfx friendly)
 *
 * Hold threshold: 220ms. Below = tap, above = hold action fires once.
 *
 * Inputs to the component:
 *   - inputMode: only fires when "combat" or "exploration" (combat sprouts
 *     from exploration when target is in range). Other modes (conversation,
 *     creation, lens_work, driving) suppress the controller — driving has
 *     its own vehicle controls.
 *   - context: the most recent combat context (drives action variants).
 *   - hasTarget: when false, taps still fire combat-ready intent so the
 *     server can lock onto a near-target (combat:lock-on event) — ground
 *     swings without target are still recorded as flow practice though.
 *
 * Output: dispatches existing socket events (combat:attack, combat:dodge,
 * combat:block) plus new ones (combat:grab, combat:kick, combat:modifier-
 * boost) so the server-side flow recorder picks every action up. No
 * HTTP — these are all socket-tier so they hit the same recorder path
 * the existing combat:attack handler does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createInputBuffer } from '@/lib/concordia/combat-input-buffer';
import {
  type KeyAction,
  loadActiveProfile,
  resolveBinding,
} from '@/lib/concordia/keybindings';
import { cameraLookState } from '@/lib/world-lens/camera-look-state';
import { useGamepad, type GamepadButton } from '@/hooks/useGamepad';
import { loadGamepadCombatMap, resolveGamepadButton, type GamepadCombatMap } from '@/lib/concordia/gamepad-combat-map';

// Lock-on read helper. Returns the active locked-target id if the player
// has soft- or hard-locked an enemy via LockOnController. Falls back to
// null so the server picks nearest-in-range as before.
function _lockedTargetId(): string | null {
  return cameraLookState.lockedTargetId ?? null;
}

const HOLD_THRESHOLD_MS = 220;

// Map KeyAction (from the keybinding profile) → resolved action token used
// by the CONTEXT_KEYMAP. The profile only knows about logical actions; the
// context keymap then picks the contextual variant (light → air-blast in
// aerial, etc.).
const ACTION_TO_KEY: Record<KeyAction, 'E' | 'F' | 'R' | 'Q' | 'Shift'> = {
  light: 'E', heavy: 'E', finisher: 'E',
  parry: 'F', grab: 'F',
  kick: 'R',
  dodge: 'Q',
  modifier: 'Shift',
};

type CombatContext = 'ground' | 'aerial' | 'vehicle' | 'hacker' | 'underwater' | 'mixed';

interface SocketLike {
  isConnected: boolean;
  emit: (event: string, payload: unknown) => void;
}

interface Loadout {
  rightHand: { weaponClass: string | null; handedness: 'right' | 'left' | 'two' | 'either' } | null;
  leftHand:  { weaponClass: string | null; handedness: 'right' | 'left' | 'two' | 'either' } | null;
}

interface Props {
  inputMode: string;
  context: CombatContext;
  hasTarget: boolean;
  /** Player id used to stamp action ownership for client-side wiring. */
  playerId: string;
  /** Active world socket — actions are forwarded as socket emits. */
  worldSocket: SocketLike | null;
  /** When true, Shift modifier is currently held — switches to LEFT-HAND mode
      (Biomutant-style). Tapping E with Shift held swings the off-hand. */
  modifierHeld?: boolean;
  /** Current dual-hand loadout — drives two-hand override and per-hand
      damage. When rightHand handedness === 'two' (or both slots reference
      the same item), every E tap routes to a two-hand attack regardless
      of Shift state. */
  loadout?: Loadout | null;
  /** Callback fired on every successful action so the world page can update
      combo counters / recentChain / animation state in lock-step. */
  onAction?: (action: ActionEvent) => void;
}

export interface ActionEvent {
  key: 'E' | 'F' | 'R' | 'Q' | 'Shift';
  variant: 'tap' | 'hold' | 'double-tap';
  resolved: ResolvedAction;
  context: CombatContext;
  modifier: boolean;
  /** Dual-hand: which hand actually fired ('right'/'left'/'two'). */
  hand?: 'right' | 'left' | 'two';
  /** True for double-tap finishers. */
  finisher?: boolean;
}

type ResolvedAction =
  | 'attack-light'
  | 'attack-heavy'
  | 'parry'
  | 'grab'
  | 'kick'
  | 'dodge'
  | 'modifier-boost'
  | 'air-blast'
  | 'air-dive'
  | 'air-dodge'
  | 'aerial-grab'
  | 'air-dash'
  | 'mounted-shot'
  | 'vehicle-ram'
  | 'evasive'
  | 'hack-breach'
  | 'dismount-kick'
  | 'drift';

const CONTEXT_KEYMAP: Record<CombatContext, Record<string, { tap: ResolvedAction; hold?: ResolvedAction }>> = {
  ground:     { E: { tap: 'attack-light',  hold: 'attack-heavy' },
                F: { tap: 'parry',         hold: 'grab'         },
                R: { tap: 'kick' },
                Q: { tap: 'dodge' },
                Shift: { tap: 'modifier-boost' } },
  aerial:     { E: { tap: 'air-blast',     hold: 'air-dive'     },
                F: { tap: 'air-dodge',     hold: 'aerial-grab'  },
                R: { tap: 'kick' },        // dive kick — same action token, server flags by context
                Q: { tap: 'air-dash' },
                Shift: { tap: 'modifier-boost' } },
  vehicle:    { E: { tap: 'mounted-shot',  hold: 'vehicle-ram'  },
                F: { tap: 'evasive',       hold: 'hack-breach'  },
                R: { tap: 'dismount-kick' },
                Q: { tap: 'drift' },
                Shift: { tap: 'modifier-boost' } },
  hacker:     { E: { tap: 'attack-light',  hold: 'hack-breach'  },
                F: { tap: 'parry',         hold: 'hack-breach'  },
                R: { tap: 'kick' },
                Q: { tap: 'air-dash' },
                Shift: { tap: 'modifier-boost' } },
  underwater: { E: { tap: 'attack-light',  hold: 'attack-heavy' },
                F: { tap: 'grab',          hold: 'grab'         },
                R: { tap: 'kick' },
                Q: { tap: 'dodge' },
                Shift: { tap: 'modifier-boost' } },
  mixed:      { E: { tap: 'attack-light',  hold: 'attack-heavy' },
                F: { tap: 'parry',         hold: 'grab'         },
                R: { tap: 'kick' },
                Q: { tap: 'dodge' },
                Shift: { tap: 'modifier-boost' } },
};

const COMBAT_MODES = new Set(['combat', 'exploration', 'social']);

/**
 * Build the live set of bound keys from the active profile so the keydown
 * filter knows which keys to capture. Recomputed when the profile changes.
 */
function buildValidKeySet(): Set<string> {
  const profile = loadActiveProfile();
  const keys = new Set<string>();
  for (const b of Object.values(profile.bindings)) keys.add(b.key);
  // Always allow the canonical defaults so a partial remap doesn't strand
  // any context-keymap action that has no profile equivalent (the CONTEXT_KEYMAP
  // entries assume E/F/R/Q/Shift are at least observable so the system can
  // route).
  ['e', 'f', 'r', 'q', 'shift'].forEach((k) => keys.add(k));
  return keys;
}

const DOUBLE_TAP_WINDOW_MS = 280;

export default function CombatInputController({
  inputMode, context, hasTarget: _hasTarget, playerId, worldSocket, modifierHeld, loadout, onAction,
}: Props) {
  // Track per-key press time to differentiate tap vs hold
  const downAtRef = useRef<Map<string, number>>(new Map());
  // Per-key cooldown so a long hold doesn't repeat-fire
  const lastFireAtRef = useRef<Map<string, number>>(new Map());
  // Whether the active key has already fired its hold action (so we don't
  // also fire the tap on keyup)
  const holdFiredRef = useRef<Set<string>>(new Set());
  // Per-key last-tap time for double-tap detection
  const lastTapAtRef = useRef<Map<string, number>>(new Map());
  // A2 — input buffer: a press made during the previous action's cooldown is
  // held briefly and fired the instant the cooldown lifts (fighting-game feel),
  // instead of being dropped.
  const inputBufferRef = useRef(createInputBuffer());

  // Live valid-key set rebuilt when the profile changes
  const [validKeys, setValidKeys] = useState<Set<string>>(buildValidKeySet);
  useEffect(() => {
    function refresh() { setValidKeys(buildValidKeySet()); }
    refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('concordia:keybindings-changed', refresh);
      return () => window.removeEventListener('concordia:keybindings-changed', refresh);
    }
  }, []);

  // Resolve which hand is active. Two-handed weapon → 'two' regardless of
  // modifier state. Otherwise modifier (Shift held) → 'left'; default 'right'.
  const resolveHand = useCallback((): 'right' | 'left' | 'two' => {
    const r = loadout?.rightHand;
    const l = loadout?.leftHand;
    if (r && l && r === l) return 'two';
    if (r?.handedness === 'two') return 'two';
    if (modifierHeld && l) return 'left';
    return 'right';
  }, [loadout, modifierHeld]);

  /**
   * Translate the raw (key, variant) into the canonical key letter the
   * CONTEXT_KEYMAP expects. The active profile may have remapped, e.g.,
   * 'r' → 'parry' (which maps to F in CONTEXT_KEYMAP). When the profile
   * has no binding for the press, fall back to the literal key.
   */
  function profileResolve(rawKey: string, variant: 'tap' | 'hold' | 'double-tap'): {
    key: 'E' | 'F' | 'R' | 'Q' | 'Shift';
    action: KeyAction | null;
  } | null {
    const k = rawKey.toLowerCase();
    const action = resolveBinding(k, variant);
    if (action) return { key: ACTION_TO_KEY[action], action };
    if (['e', 'f', 'r', 'q', 'shift'].includes(k)) {
      const upper = k === 'shift' ? 'Shift' : (k.toUpperCase() as 'E' | 'F' | 'R' | 'Q');
      return { key: upper, action: null };
    }
    return null;
  }

  const dispatchAction = useCallback((key: ActionEvent['key'], variant: 'tap' | 'hold' | 'double-tap') => {
    const map = CONTEXT_KEYMAP[context] ?? CONTEXT_KEYMAP.ground;
    const entry = map[key];
    if (!entry) return;
    const resolved: ResolvedAction = variant === 'hold' && entry.hold ? entry.hold : entry.tap;
    const hand = resolveHand();
    const finisher = variant === 'double-tap';
    const evt: ActionEvent = { key, variant, resolved, context, modifier: !!modifierHeld, hand, finisher };

    // Route to the right socket event so the existing flow recorder picks
    // the action up. Each action token maps cleanly:
    //   attack-light/heavy/air-blast/air-dive/mounted-shot/vehicle-ram →
    //                                                 combat:attack (heavy flag)
    //   parry/air-dodge/evasive          → combat:dodge (wasParry / mode flag)
    //   dodge/air-dash/drift             → combat:dodge (no parry flag)
    //   grab/aerial-grab/hack-breach     → combat:grab (new event; logged as
    //                                                 'grapple' action)
    //   kick/dismount-kick               → combat:kick (new event; logged as
    //                                                 'kick' action server-
    //                                                 side, mapped to 'attack
    //                                                 -light' for the recorder
    //                                                 since the substrate has
    //                                                 no kick action token —
    //                                                 distinguish via meta)
    //   modifier-boost                   → combat:modifier (held boost flag)
    // G2.1 — client-side prediction. Combat input → feedback was a full socket
    // round-trip (no local swing), breaking the ≤16ms feel bar. Play the local
    // player's swing/kick/dodge animation IMMEDIATELY on input via the same
    // concordia:combat-anim event AvatarSystem3D consumes, so the body moves on
    // the same frame as the keypress. Damage stays server-authoritative (the
    // authoritative combat:impact still drives the target reaction); the
    // predicted motion is the attacker's own cosmetic swing, so there's nothing
    // to reconcile — the server never contradicts it. Light attacks also get a
    // tiny predicted attacker hit-pause for weight.
    if (playerId && typeof window !== 'undefined') {
      const predAnim = resolved.startsWith('attack') || resolved.includes('blast') || resolved.includes('ram') || resolved.includes('shot')
        ? (variant === 'hold' || resolved.includes('heavy') ? 'attack-heavy' : 'attack-light')
        : resolved === 'kick' || resolved === 'dismount-kick' ? 'kick'
        : (resolved === 'dodge' || resolved === 'air-dash' || resolved === 'drift') ? 'dodge'
        : (resolved === 'parry' || resolved === 'evasive' || resolved === 'air-dodge') ? 'block'
        : null;
      if (predAnim) {
        window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
          detail: { entityId: playerId, animation: predAnim, predicted: true },
        }));
      }
    }

    if (!worldSocket?.isConnected) {
      onAction?.(evt);
      return;
    }
    const heavy = variant === 'hold' || resolved.includes('heavy') || resolved.includes('ram') || resolved.includes('dive') || resolved.includes('breach');
    // Two-hand weapons hit harder + slower. Finishers hit harder still.
    const baseDamage = heavy ? 18 : 10;
    const handMul    = hand === 'two' ? 1.4 : hand === 'left' ? 0.85 : 1.0;
    const finisherMul = finisher ? 1.6 : 1.0;
    switch (resolved) {
      case 'attack-light':
      case 'attack-heavy':
      case 'air-blast':
      case 'air-dive':
      case 'mounted-shot':
      case 'vehicle-ram':
        worldSocket.emit('combat:attack', {
          targetId: _lockedTargetId(), // null → server picks nearest; locked → respect player choice
          baseDamage: Math.round(baseDamage * handMul * finisherMul),
          range: 3,
          armorPierce: heavy ? 1 : 0,
          heavy,
          style: resolved,
          modifier: !!modifierHeld,
          hand,
          finisher,
        });
        break;
      case 'parry':
      case 'evasive':
      case 'air-dodge':
        worldSocket.emit('combat:dodge', {
          direction: 'back',
          wasParry: true,
          style: resolved,
        });
        break;
      case 'dodge':
      case 'air-dash':
      case 'drift':
        worldSocket.emit('combat:dodge', {
          direction: 'back',
          wasParry: false,
          style: resolved,
        });
        break;
      case 'grab':
      case 'aerial-grab':
      case 'hack-breach':
        // No dedicated server event yet — emit as combat:attack with style
        // so the flow recorder logs the action correctly. The combat-flow
        // server hook tags the action 'grapple' when style starts with
        // 'grab'/'aerial-grab', otherwise 'attack-heavy'.
        worldSocket.emit('combat:attack', {
          targetId: _lockedTargetId(),
          baseDamage: 12,
          range: 2,
          armorPierce: 0,
          heavy: false,
          style: resolved,
          actionOverride: resolved.includes('hack') ? 'attack-light' : 'grapple',
        });
        break;
      case 'kick':
      case 'dismount-kick':
        worldSocket.emit('combat:attack', {
          targetId: _lockedTargetId(),
          baseDamage: 14,
          range: 3,
          armorPierce: 0,
          heavy: false,
          style: resolved,
          actionOverride: 'attack-heavy',
        });
        break;
      case 'modifier-boost':
        // Modifier is a transient flag that scales the *next* action up
        // by tier. The server does the actual scaling when subsequent
        // events arrive with modifier:true.
        break;
    }
    onAction?.(evt);
  }, [context, modifierHeld, worldSocket, onAction, resolveHand]);

  // F2 — gamepad write-through. The keyboard path is the canonical one; a
  // connected Standard Gamepad dispatches the SAME combat actions through the
  // same dispatchAction, resolved via the (remappable) gamepad→action map.
  const dispatchRef = useRef(dispatchAction);
  dispatchRef.current = dispatchAction;
  const gamepadMapRef = useRef<GamepadCombatMap>(loadGamepadCombatMap());
  useEffect(() => {
    function refresh() { gamepadMapRef.current = loadGamepadCombatMap(); }
    window.addEventListener('concordia:gamepad-map-changed', refresh);
    return () => window.removeEventListener('concordia:gamepad-map-changed', refresh);
  }, []);
  const combatActiveRef = useRef(false);
  combatActiveRef.current = COMBAT_MODES.has(inputMode);
  useGamepad({
    onButtonDown: (button: GamepadButton) => {
      if (!combatActiveRef.current) return;
      const binding = resolveGamepadButton(gamepadMapRef.current, button);
      if (!binding) return;
      dispatchRef.current(ACTION_TO_KEY[binding.action], binding.variant);
    },
  });

  // Keydown: stamp the time, schedule the hold-fire timer.
  useEffect(() => {
    if (!COMBAT_MODES.has(inputMode)) return;

    function onDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const k = e.key.toLowerCase();
      if (!validKeys.has(k)) return;
      // Repeats during a hold should NOT re-stamp downAt — only the first
      // press counts so the hold timing is honest.
      if (downAtRef.current.has(k)) return;
      downAtRef.current.set(k, performance.now());
      holdFiredRef.current.delete(k);
    }

    function onUp(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const k = e.key.toLowerCase();
      if (!validKeys.has(k)) return;
      const downAt = downAtRef.current.get(k);
      downAtRef.current.delete(k);
      if (downAt == null) return;
      const heldMs = performance.now() - downAt;
      // 200ms cooldown per key so spam doesn't outpace the server tick.
      // A2 — instead of dropping a press made during the cooldown, buffer it;
      // the 50ms tick flushes it the instant the cooldown lifts.
      const lastFire = lastFireAtRef.current.get(k) ?? 0;
      if (performance.now() - lastFire < 200) {
        inputBufferRef.current.push(k, performance.now(), 'tap');
        return;
      }
      lastFireAtRef.current.set(k, performance.now());

      // If we already fired the hold during the keyhold tick, skip the tap
      if (holdFiredRef.current.has(k)) {
        holdFiredRef.current.delete(k);
        lastTapAtRef.current.delete(k); // hold breaks any pending double-tap
        return;
      }
      // Double-tap detection: any key bound to a 'double-tap' action in the
      // active profile is eligible. By default that's only E (finisher), but
      // the two_handed_bruiser preset binds R double-tap → kick.
      const profile = loadActiveProfile();
      const hasDoubleTapBinding = Object.values(profile.bindings).some(
        (b) => b.key === k && b.variant === 'double-tap',
      );

      if (hasDoubleTapBinding && heldMs < HOLD_THRESHOLD_MS) {
        const lastTap = lastTapAtRef.current.get(k) ?? 0;
        const now = performance.now();
        if (lastTap && now - lastTap < DOUBLE_TAP_WINDOW_MS) {
          lastTapAtRef.current.delete(k);
          const r = profileResolve(k, 'double-tap');
          if (r) dispatchAction(r.key, 'double-tap');
          return;
        }
        lastTapAtRef.current.set(k, now);
        setTimeout(() => {
          if (lastTapAtRef.current.get(k) === now) {
            lastTapAtRef.current.delete(k);
            const r = profileResolve(k, 'tap');
            if (r) dispatchAction(r.key, 'tap');
          }
        }, DOUBLE_TAP_WINDOW_MS + 10);
        return;
      }

      const variant: 'tap' | 'hold' = heldMs >= HOLD_THRESHOLD_MS ? 'hold' : 'tap';
      const r = profileResolve(k, variant);
      if (!r) return;
      dispatchAction(r.key, variant);
    }

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [inputMode, dispatchAction, validKeys]);

  // Hold-fire timer: while a key is held past HOLD_THRESHOLD_MS, fire the
  // hold action immediately (don't wait for keyup). This is the genuine
  // "hold E for heavy" feel — heavy attack lands at the moment you commit,
  // not when you release.
  useEffect(() => {
    if (!COMBAT_MODES.has(inputMode)) return;
    const interval = setInterval(() => {
      const now = performance.now();
      for (const [k, downAt] of downAtRef.current.entries()) {
        if (holdFiredRef.current.has(k)) continue;
        if (now - downAt < HOLD_THRESHOLD_MS) continue;
        // Resolve via the active profile first; a remapped hold (e.g.
        // 'r' hold = grab) lands the right action.
        const r = profileResolve(k, 'hold');
        if (!r) continue;
        const map = CONTEXT_KEYMAP[context] ?? CONTEXT_KEYMAP.ground;
        const entry = map[r.key];
        if (!entry?.hold) continue;
        holdFiredRef.current.add(k);
        const lastFire = lastFireAtRef.current.get(k) ?? 0;
        if (performance.now() - lastFire < 200) continue;
        lastFireAtRef.current.set(k, performance.now());
        dispatchAction(r.key, 'hold');
      }
      // A2 — flush a buffered press once its key's cooldown has lifted.
      const buf = inputBufferRef.current.peek(now);
      if (buf) {
        const lastFire = lastFireAtRef.current.get(buf.action) ?? 0;
        if (now - lastFire >= 200) {
          inputBufferRef.current.take(now);
          lastFireAtRef.current.set(buf.action, now);
          const r = profileResolve(buf.action, (buf.variant as 'tap' | 'hold') || 'tap');
          if (r) dispatchAction(r.key, (buf.variant as 'tap' | 'hold') || 'tap');
        }
      }
    }, 50);
    return () => clearInterval(interval);
  }, [inputMode, context, dispatchAction]);

  // Mouse: left-click = shoot / cast (when ranged or spell equipped).
  // Right-click suppression — we don't want browser context menu in combat.
  useEffect(() => {
    if (!COMBAT_MODES.has(inputMode)) return;
    function onContextMenu(e: MouseEvent) {
      // Only suppress when the click is on the canvas (world view), not
      // panel/UI. data-tutorial-target=crafting-button etc. all keep their
      // default behaviour.
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, [role="button"], input, textarea, [data-keep-context-menu]')) return;
      e.preventDefault();
    }
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [inputMode]);

  return null;
}
