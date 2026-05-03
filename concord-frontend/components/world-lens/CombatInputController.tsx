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

import { useCallback, useEffect, useRef } from 'react';

const HOLD_THRESHOLD_MS = 220;

type CombatContext = 'ground' | 'aerial' | 'vehicle' | 'hacker' | 'underwater' | 'mixed';

interface SocketLike {
  isConnected: boolean;
  emit: (event: string, payload: unknown) => void;
}

interface Props {
  inputMode: string;
  context: CombatContext;
  hasTarget: boolean;
  /** Player id used to stamp action ownership for client-side wiring. */
  playerId: string;
  /** Active world socket — actions are forwarded as socket emits. */
  worldSocket: SocketLike | null;
  /** When true, Shift modifier is currently held (drives evolved variants). */
  modifierHeld?: boolean;
  /** Callback fired on every successful action so the world page can update
      combo counters / recentChain / animation state in lock-step. */
  onAction?: (action: ActionEvent) => void;
}

export interface ActionEvent {
  key: 'E' | 'F' | 'R' | 'Q' | 'Shift';
  variant: 'tap' | 'hold';
  resolved: ResolvedAction;
  context: CombatContext;
  modifier: boolean;
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

const VALID_KEYS = new Set(['e', 'f', 'r', 'q', 'shift']);
const COMBAT_MODES = new Set(['combat', 'exploration', 'social']);

export default function CombatInputController({
  inputMode, context, hasTarget, playerId, worldSocket, modifierHeld, onAction,
}: Props) {
  // Track per-key press time to differentiate tap vs hold
  const downAtRef = useRef<Map<string, number>>(new Map());
  // Per-key cooldown so a long hold doesn't repeat-fire
  const lastFireAtRef = useRef<Map<string, number>>(new Map());
  // Whether the active key has already fired its hold action (so we don't
  // also fire the tap on keyup)
  const holdFiredRef = useRef<Set<string>>(new Set());

  const dispatchAction = useCallback((key: ActionEvent['key'], variant: 'tap' | 'hold') => {
    const map = CONTEXT_KEYMAP[context] ?? CONTEXT_KEYMAP.ground;
    const entry = map[key];
    if (!entry) return;
    const resolved: ResolvedAction = variant === 'hold' && entry.hold ? entry.hold : entry.tap;
    const evt: ActionEvent = { key, variant, resolved, context, modifier: !!modifierHeld };

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
    if (!worldSocket?.isConnected) {
      onAction?.(evt);
      return;
    }
    const heavy = variant === 'hold' || resolved.includes('heavy') || resolved.includes('ram') || resolved.includes('dive') || resolved.includes('breach');
    switch (resolved) {
      case 'attack-light':
      case 'attack-heavy':
      case 'air-blast':
      case 'air-dive':
      case 'mounted-shot':
      case 'vehicle-ram':
        worldSocket.emit('combat:attack', {
          targetId: null, // server picks nearest in range when null
          baseDamage: heavy ? 18 : 10,
          range: 3,
          armorPierce: heavy ? 1 : 0,
          heavy,
          style: resolved,
          modifier: !!modifierHeld,
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
          targetId: null,
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
          targetId: null,
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
  }, [context, modifierHeld, worldSocket, onAction]);

  // Keydown: stamp the time, schedule the hold-fire timer.
  useEffect(() => {
    if (!COMBAT_MODES.has(inputMode)) return;

    function onDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const k = e.key.toLowerCase();
      if (!VALID_KEYS.has(k)) return;
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
      if (!VALID_KEYS.has(k)) return;
      const downAt = downAtRef.current.get(k);
      downAtRef.current.delete(k);
      if (downAt == null) return;
      const heldMs = performance.now() - downAt;
      // 200ms cooldown per key so spam doesn't outpace the server tick
      const lastFire = lastFireAtRef.current.get(k) ?? 0;
      if (performance.now() - lastFire < 200) return;
      lastFireAtRef.current.set(k, performance.now());

      // If we already fired the hold during the keyhold tick, skip the tap
      if (holdFiredRef.current.has(k)) {
        holdFiredRef.current.delete(k);
        return;
      }
      const variant: 'tap' | 'hold' = heldMs >= HOLD_THRESHOLD_MS ? 'hold' : 'tap';
      const upper = k === 'shift' ? 'Shift' : (k.toUpperCase() as 'E' | 'F' | 'R' | 'Q');
      dispatchAction(upper, variant);
    }

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [inputMode, dispatchAction]);

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
        // Fire hold variant once
        const upper = k === 'shift' ? 'Shift' : (k.toUpperCase() as 'E' | 'F' | 'R' | 'Q');
        const map = CONTEXT_KEYMAP[context] ?? CONTEXT_KEYMAP.ground;
        const entry = map[upper];
        if (!entry?.hold) continue;
        holdFiredRef.current.add(k);
        const lastFire = lastFireAtRef.current.get(k) ?? 0;
        if (performance.now() - lastFire < 200) continue;
        lastFireAtRef.current.set(k, performance.now());
        dispatchAction(upper, 'hold');
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
