'use client';

/**
 * useGamepad — Standard Gamepad API integration for Concordia.
 *
 * Polls navigator.getGamepads() each animation frame and emits typed
 * input events: per-frame axis state (left stick / right stick), button
 * down/up edges, and a continuous "any input this frame" tick.
 *
 * Standard mapping (works for Xbox One/Series, DualShock, DualSense via
 * Edge/Chromium):
 *   axes[0/1] — left stick X/Y (walk)
 *   axes[2/3] — right stick X/Y (camera)
 *   buttons[0]  A / Cross    — primary interact / jump
 *   buttons[1]  B / Circle   — cancel / dodge
 *   buttons[2]  X / Square   — attack / cast
 *   buttons[3]  Y / Triangle — menu / inventory
 *   buttons[4]  LB / L1      — block
 *   buttons[5]  RB / R1      — secondary attack
 *   buttons[6]  LT / L2      — aim down sights
 *   buttons[7]  RT / R2      — heavy attack
 *   buttons[8]  Back/Share   — map
 *   buttons[9]  Start/Options— pause / commune wheel
 *   buttons[10] LS click     — sprint toggle
 *   buttons[11] RS click     — recenter camera
 *   buttons[12-15] dpad U/D/L/R — quick-slot swap
 *
 * This works in console browsers (Xbox Edge, PS5/PS4 WebKit, Steam
 * Deck Chromium) the same as desktop because the Gamepad API is part
 * of the standard browser surface — no native console SDK needed.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export type GamepadButton =
  | 'A' | 'B' | 'X' | 'Y'
  | 'LB' | 'RB' | 'LT' | 'RT'
  | 'Back' | 'Start'
  | 'LS' | 'RS'
  | 'DUp' | 'DDown' | 'DLeft' | 'DRight'
  | 'Home';

/**
 * Controller flavor — drives glyph rendering so Xbox players see Ⓐ,
 * PlayStation players see ⓧ, and Switch / generic users see Standard.
 * Detection from `Gamepad.id` is the only reliable signal in browsers
 * because there's no platform-vendor field on the API.
 */
export type ControllerFlavor =
  | 'xbox'        // Xbox One / Series / 360
  | 'playstation' // DualSense / DualShock 4
  | 'switch'      // Joy-Con / Pro Controller
  | 'steam'       // Steam Controller / Steam Deck builtin
  | 'generic';

const FLAVOR_PATTERNS: Array<[RegExp, ControllerFlavor]> = [
  [/xbox|xinput|microsoft/i, 'xbox'],
  [/dualsense|dualshock|playstation|sony|wireless controller/i, 'playstation'],
  [/joy.?con|pro controller|nintendo|switch/i, 'switch'],
  [/steam/i, 'steam'],
];

export function detectControllerFlavor(id: string | undefined | null): ControllerFlavor {
  if (!id) return 'generic';
  for (const [re, flavor] of FLAVOR_PATTERNS) {
    if (re.test(id)) return flavor;
  }
  return 'generic';
}

/**
 * Per-flavor glyph table. Used by HUD prompts so the player sees the
 * button label they actually have on their controller, not a generic
 * "A". Strings are emoji + circled-letter unicode that render well on
 * console browsers without custom fonts.
 */
export const BUTTON_GLYPHS: Record<ControllerFlavor, Partial<Record<GamepadButton, string>>> = {
  xbox: {
    A: 'Ⓐ', B: 'Ⓑ', X: 'Ⓧ', Y: 'Ⓨ',
    LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT',
    Back: 'View', Start: 'Menu', LS: 'L3', RS: 'R3',
    DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→',
  },
  playstation: {
    A: '✕', B: '◯', X: '◻', Y: '△',
    LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2',
    Back: 'Create', Start: 'Options', LS: 'L3', RS: 'R3',
    DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→',
  },
  switch: {
    A: 'Ⓑ', B: 'Ⓐ', X: 'Ⓨ', Y: 'Ⓧ',  // Switch swaps A/B + X/Y vs Xbox
    LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR',
    Back: '−', Start: '+', LS: 'L3', RS: 'R3',
    DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→',
  },
  steam: {
    A: 'Ⓐ', B: 'Ⓑ', X: 'Ⓧ', Y: 'Ⓨ',
    LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT',
    Back: 'Back', Start: 'Start', LS: 'L3', RS: 'R3',
    DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→',
  },
  generic: {
    A: 'A', B: 'B', X: 'X', Y: 'Y',
    LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT',
    Back: 'Back', Start: 'Start', LS: 'L3', RS: 'R3',
    DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→',
  },
};

/** Lookup helper for HUD prompts. Falls back to button name if glyph missing. */
export function glyphFor(flavor: ControllerFlavor, btn: GamepadButton): string {
  return BUTTON_GLYPHS[flavor][btn] ?? btn;
}

const BUTTON_INDEX: Record<number, GamepadButton> = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y',
  4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'Back', 9: 'Start',
  10: 'LS', 11: 'RS',
  12: 'DUp', 13: 'DDown', 14: 'DLeft', 15: 'DRight',
  16: 'Home',
};

export interface GamepadState {
  connected: boolean;
  id: string;
  /** [-1, 1] each axis. */
  leftStick: { x: number; y: number };
  rightStick: { x: number; y: number };
  /** Continuous values for analog triggers; 0..1. */
  triggers: { LT: number; RT: number };
  /** Currently pressed buttons (snapshot — read inside the consumer's
      own rAF if you need per-frame state). */
  pressed: Set<GamepadButton>;
}

export interface UseGamepadHandlers {
  /** Edge: button just went down this frame. */
  onButtonDown?: (btn: GamepadButton, gp: GamepadState) => void;
  /** Edge: button just went up this frame. */
  onButtonUp?: (btn: GamepadButton, gp: GamepadState) => void;
  /** Per-frame axis tick. Called every animation frame while
      a controller is connected, even if no input changed. */
  onTick?: (gp: GamepadState) => void;
  /** Connect / disconnect notification. */
  onConnect?: (gp: GamepadState) => void;
  onDisconnect?: () => void;
}

export interface UseGamepadOptions {
  /** Deadzone for stick inputs (default 0.15). Below this magnitude
      the axis reads as 0 to avoid drift on aging analog hardware. */
  deadzone?: number;
  /** True to disable polling without unmounting (e.g. when chat is
      focused). Default false. */
  paused?: boolean;
}

const DEFAULT_DEADZONE = 0.15;

function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0;
  // Re-scale so the usable range stays linear from deadzone..1.
  const sign = value < 0 ? -1 : 1;
  return sign * ((Math.abs(value) - deadzone) / (1 - deadzone));
}

/**
 * Mount once in the world lens (or any controller-aware surface). The
 * hook polls every animation frame while a controller is connected,
 * fires edge-triggered button events, and exposes a live state ref.
 */
export function useGamepad(handlers: UseGamepadHandlers = {}, options: UseGamepadOptions = {}) {
  const { deadzone = DEFAULT_DEADZONE, paused = false } = options;
  const [connected, setConnected] = useState(false);
  const [pad, setPad] = useState<{ id: string } | null>(null);

  // Refs avoid re-creating the rAF loop when handlers change identity.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Track previous button state for edge detection.
  const prevButtonsRef = useRef<boolean[]>(new Array(17).fill(false));

  useEffect(() => {
    const onGamepadConnected = (e: GamepadEvent) => {
      setConnected(true);
      setPad({ id: e.gamepad.id });
      handlersRef.current.onConnect?.(buildState(e.gamepad, deadzone));
    };
    const onGamepadDisconnected = () => {
      setConnected(false);
      setPad(null);
      handlersRef.current.onDisconnect?.();
      prevButtonsRef.current = new Array(17).fill(false);
    };
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

    let rafId = 0;
    const tick = () => {
      if (!pausedRef.current) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = Array.from(gamepads).find((g) => g && g.connected) || null;
        if (gp) {
          if (!connected) setConnected(true);
          if (!pad || pad.id !== gp.id) setPad({ id: gp.id });
          const state = buildState(gp, deadzone);
          // Edge detection.
          for (let i = 0; i < gp.buttons.length; i += 1) {
            const wasPressed = prevButtonsRef.current[i];
            const isPressed = !!gp.buttons[i]?.pressed;
            if (isPressed && !wasPressed) {
              const btn = BUTTON_INDEX[i];
              if (btn) handlersRef.current.onButtonDown?.(btn, state);
            } else if (!isPressed && wasPressed) {
              const btn = BUTTON_INDEX[i];
              if (btn) handlersRef.current.onButtonUp?.(btn, state);
            }
            prevButtonsRef.current[i] = isPressed;
          }
          handlersRef.current.onTick?.(state);
        } else if (connected) {
          // No gamepad seen this frame, but we still believed one was
          // connected — leave state alone; gamepaddisconnected will
          // arrive separately if it really vanished.
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadzone]);

  /** Imperative read of the current state (useful inside game-loop
      ticks where you don't want React state updates). */
  const readState = useCallback((): GamepadState | null => {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(gamepads).find((g) => g && g.connected) || null;
    return gp ? buildState(gp, deadzone) : null;
  }, [deadzone]);

  const flavor: ControllerFlavor = pad ? detectControllerFlavor(pad.id) : 'generic';
  return { connected, pad, flavor, readState };
}

function buildState(gp: Gamepad, deadzone: number): GamepadState {
  const pressed = new Set<GamepadButton>();
  for (let i = 0; i < gp.buttons.length; i += 1) {
    const btn = BUTTON_INDEX[i];
    if (btn && gp.buttons[i]?.pressed) pressed.add(btn);
  }
  return {
    connected: gp.connected,
    id: gp.id,
    leftStick: {
      x: applyDeadzone(gp.axes[0] || 0, deadzone),
      y: applyDeadzone(gp.axes[1] || 0, deadzone),
    },
    rightStick: {
      x: applyDeadzone(gp.axes[2] || 0, deadzone),
      y: applyDeadzone(gp.axes[3] || 0, deadzone),
    },
    triggers: {
      LT: gp.buttons[6]?.value ?? 0,
      RT: gp.buttons[7]?.value ?? 0,
    },
    pressed,
  };
}
