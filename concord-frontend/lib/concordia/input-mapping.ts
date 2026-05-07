// Concord Adaptive Control System (CACS)
// Per-mode input profiles with gamepad support, gyro as first-class input,
// community layout sharing, and one-button quick remap.
//
// Inspired by: Elden Ring (face buttons for combat), Hades 2 (low fatigue layout),
// Helldivers 2 (cooperative quick actions), Indiana Jones (gyro aiming),
// Steam Input (community layouts + gyro), Unity New Input System (action maps per mode).

import { InputMode } from './modes';

// ── Types ────────────────────────────────────────────────────────────

export type ControllerType = 'keyboard' | 'xbox' | 'ps5' | 'switch' | 'steamdeck' | 'generic';

export type ActionId =
  | 'move_forward' | 'move_back' | 'move_left' | 'move_right'
  | 'camera_look' | 'camera_zoom'
  | 'jump' | 'sprint' | 'crouch' | 'interact' | 'menu'
  | 'attack_primary' | 'attack_secondary' | 'dodge' | 'block' | 'target_lock'
  | 'hotbar_1' | 'hotbar_2' | 'hotbar_3' | 'hotbar_4' | 'hotbar_5'
  | 'hotbar_6' | 'hotbar_7' | 'hotbar_8' | 'hotbar_9'
  | 'vats'
  | 'throttle' | 'brake' | 'steer' | 'handbrake' | 'horn' | 'gear_up' | 'gear_down' | 'exit_vehicle'
  | 'dialogue_send' | 'dialogue_voice' | 'dialogue_close'
  | 'emote_wheel' | 'quick_message'
  | 'spectator_follow' | 'spectator_time_scrub';

export interface InputBinding {
  primary:   string;    // KeyboardEvent.code or gamepad button name
  secondary?: string;
  gamepad?:  string;    // 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'LS', 'RS', 'DPad_Up', etc.
  gyro?:     'pitch' | 'roll' | 'yaw';
}

export type ModeBindings = Partial<Record<ActionId, InputBinding>>;
export type CACSProfile  = Record<InputMode, ModeBindings>;

// ── Default keyboard/mouse profile ──────────────────────────────────

const KEYBOARD_DEFAULTS: CACSProfile = {
  exploration: {
    move_forward:    { primary: 'KeyW' },
    move_back:       { primary: 'KeyS' },
    move_left:       { primary: 'KeyA' },
    move_right:      { primary: 'KeyD' },
    jump:            { primary: 'Space' },
    sprint:          { primary: 'ShiftLeft' },
    crouch:          { primary: 'ControlLeft' },
    interact:        { primary: 'KeyE' },
    menu:            { primary: 'Escape' },
    emote_wheel:     { primary: 'KeyZ' },
    quick_message:   { primary: 'KeyT' },
  },
  combat: {
    move_forward:    { primary: 'KeyW' },
    move_back:       { primary: 'KeyS' },
    move_left:       { primary: 'KeyA' },
    move_right:      { primary: 'KeyD' },
    attack_primary:  { primary: 'MouseLeft' },
    attack_secondary:{ primary: 'MouseRight' },
    dodge:           { primary: 'KeyQ' },
    block:           { primary: 'ShiftLeft' },
    target_lock:     { primary: 'Tab' },
    vats:            { primary: 'KeyV' },
    hotbar_1:        { primary: 'Digit1' },
    hotbar_2:        { primary: 'Digit2' },
    hotbar_3:        { primary: 'Digit3' },
    hotbar_4:        { primary: 'Digit4' },
    hotbar_5:        { primary: 'Digit5' },
    hotbar_6:        { primary: 'Digit6' },
    hotbar_7:        { primary: 'Digit7' },
    hotbar_8:        { primary: 'Digit8' },
    hotbar_9:        { primary: 'Digit9' },
    menu:            { primary: 'Escape' },
  },
  driving: {
    throttle:        { primary: 'KeyW',      secondary: 'ArrowUp' },
    brake:           { primary: 'KeyS',      secondary: 'ArrowDown' },
    steer:           { primary: 'KeyA',      secondary: 'ArrowLeft' },
    handbrake:       { primary: 'Space' },
    gear_up:         { primary: 'ShiftLeft' },
    gear_down:       { primary: 'ControlLeft' },
    exit_vehicle:    { primary: 'KeyE' },
    horn:            { primary: 'KeyH' },
  },
  conversation: {
    dialogue_send:   { primary: 'Enter' },
    dialogue_voice:  { primary: 'KeyV' },
    dialogue_close:  { primary: 'Escape' },
  },
  creation:   {},
  lens_work:  {},
  social: {
    emote_wheel:     { primary: 'KeyZ' },
    quick_message:   { primary: 'KeyT' },
  },
  spectator: {
    move_forward:        { primary: 'KeyW' },
    move_back:           { primary: 'KeyS' },
    move_left:           { primary: 'KeyA' },
    move_right:          { primary: 'KeyD' },
    jump:                { primary: 'Space' },
    sprint:              { primary: 'ShiftLeft' },
    spectator_follow:    { primary: 'KeyF' },
    spectator_time_scrub:{ primary: 'KeyT' },
    menu:                { primary: 'Escape' },
  },
};

// ── Xbox gamepad profile (Elden Ring + Hades 2 layout DNA) ──────────

const XBOX_DEFAULTS: CACSProfile = {
  exploration: {
    move_forward:    { primary: 'LS_Up',    gamepad: 'LS' },
    jump:            { primary: 'Space',    gamepad: 'A' },
    interact:        { primary: 'KeyE',     gamepad: 'X' },
    sprint:          { primary: 'ShiftLeft',gamepad: 'LT' },
    crouch:          { primary: 'ControlLeft', gamepad: 'RS_Click' },
    emote_wheel:     { primary: 'KeyZ',     gamepad: 'DPad_Down' },
    menu:            { primary: 'Escape',   gamepad: 'Menu' },
    camera_look:     { primary: 'Mouse',    gamepad: 'RS' },
  },
  combat: {
    attack_primary:  { primary: 'MouseLeft',   gamepad: 'RB' },   // Elden Ring: RB = light attack
    attack_secondary:{ primary: 'MouseRight',  gamepad: 'RT' },   // RT = heavy attack
    dodge:           { primary: 'KeyQ',         gamepad: 'B'  },   // B = dodge/roll
    block:           { primary: 'ShiftLeft',    gamepad: 'LB' },   // LB = block/guard
    target_lock:     { primary: 'Tab',          gamepad: 'RS_Click' },
    vats:            { primary: 'KeyV',          gamepad: 'DPad_Up' },
    hotbar_1:        { primary: 'Digit1',        gamepad: 'DPad_Left' },
    hotbar_2:        { primary: 'Digit2',        gamepad: 'DPad_Right' },
    menu:            { primary: 'Escape',        gamepad: 'Menu' },
  },
  driving: {
    throttle:        { primary: 'KeyW',          gamepad: 'RT' },
    brake:           { primary: 'KeyS',          gamepad: 'LT' },
    steer:           { primary: 'KeyA',          gamepad: 'LS' },
    handbrake:       { primary: 'Space',         gamepad: 'A'  },
    gear_up:         { primary: 'ShiftLeft',     gamepad: 'RB' },
    gear_down:       { primary: 'ControlLeft',   gamepad: 'LB' },
    exit_vehicle:    { primary: 'KeyE',          gamepad: 'Y'  },
    horn:            { primary: 'KeyH',          gamepad: 'B'  },
  },
  conversation: {
    dialogue_send:   { primary: 'Enter',         gamepad: 'A'  },
    dialogue_voice:  { primary: 'KeyV',          gamepad: 'Y'  },
    dialogue_close:  { primary: 'Escape',        gamepad: 'B'  },
  },
  creation:  {},
  lens_work: {},
  social: {
    emote_wheel:     { primary: 'KeyZ',          gamepad: 'DPad_Down' },
    quick_message:   { primary: 'KeyT',          gamepad: 'DPad_Up'  },
  },
  spectator: {
    spectator_follow:    { primary: 'KeyF',      gamepad: 'X' },
    spectator_time_scrub:{ primary: 'KeyT',      gamepad: 'Y' },
    menu:                { primary: 'Escape',    gamepad: 'Menu' },
  },
};

// ── Profile registry ─────────────────────────────────────────────────

// Steam Deck profile — same physical layout as Xbox (the Deck reports
// itself as a generic Xinput-style gamepad through navigator.getGamepads).
// Bindings are identical to XBOX_DEFAULTS, with two adjustments noted in
// CLAUDE.md: trackpad-as-mouse for camera_look in conversation mode (the
// Deck's right trackpad maps cleanly), and gyro reserved for fine-aim
// in firearm modes (planned, not yet wired).
const STEAMDECK_DEFAULTS: CACSProfile = XBOX_DEFAULTS;

const BUILT_IN_PROFILES: Record<ControllerType, CACSProfile> = {
  keyboard:  KEYBOARD_DEFAULTS,
  xbox:      XBOX_DEFAULTS,
  ps5:       XBOX_DEFAULTS,     // same button positions, re-label display only
  switch:    XBOX_DEFAULTS,
  steamdeck: STEAMDECK_DEFAULTS,
  generic:   KEYBOARD_DEFAULTS,
};

const STORAGE_KEY = 'concordia:cacs:custom';

// ── CACS class ────────────────────────────────────────────────────────

export class CACSystem {
  private _controller: ControllerType = 'keyboard';
  private _custom: Partial<CACSProfile> = {};

  constructor() {
    this._detectController();
    this._loadCustom();
  }

  get controller(): ControllerType { return this._controller; }

  setController(type: ControllerType) {
    this._controller = type;
  }

  /** Return binding for a specific action in a given mode. */
  binding(mode: InputMode, action: ActionId): InputBinding | undefined {
    return (
      this._custom[mode]?.[action] ??
      BUILT_IN_PROFILES[this._controller][mode]?.[action]
    );
  }

  /** Override a single binding. Persists to localStorage. */
  remap(mode: InputMode, action: ActionId, binding: InputBinding) {
    if (!this._custom[mode]) this._custom[mode] = {};
    this._custom[mode]![action] = binding;
    this._saveCustom();
  }

  /** Export current custom profile as JSON (for community sharing). */
  exportProfile(): string {
    return JSON.stringify({ controller: this._controller, custom: this._custom }, null, 2);
  }

  /** Import a community profile JSON string. */
  importProfile(json: string) {
    try {
      const parsed = JSON.parse(json) as { controller?: ControllerType; custom?: Partial<CACSProfile> };
      if (parsed.controller) this._controller = parsed.controller;
      if (parsed.custom) this._custom = parsed.custom;
      this._saveCustom();
    } catch { /* invalid JSON */ }
  }

  resetMode(mode: InputMode) {
    delete this._custom[mode];
    this._saveCustom();
  }

  private _detectController() {
    if (typeof navigator === 'undefined') return;
    // Steam Deck identifies its OS in the user agent (SteamOS / SteamDeck).
    // Detect first so the gamepad fallback below doesn't mis-classify the
    // Deck's Xinput controller as a generic Xbox pad.
    const ua = (navigator.userAgent || '').toLowerCase();
    if (ua.includes('steamdeck') || ua.includes('steam deck') || ua.includes('valve')) {
      this._controller = 'steamdeck';
      return;
    }
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    for (const pad of pads) {
      if (!pad) continue;
      const id = pad.id.toLowerCase();
      if (id.includes('steam') || id.includes('valve') || id.includes('28de')) this._controller = 'steamdeck';
      else if (id.includes('xbox') || id.includes('045e')) this._controller = 'xbox';
      else if (id.includes('dualshock') || id.includes('054c')) this._controller = 'ps5';
      else if (id.includes('switch') || id.includes('057e')) this._controller = 'switch';
      else this._controller = 'generic';
      break;
    }
  }

  private _loadCustom() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this._custom = JSON.parse(raw);
    } catch { /* ignore */ }
  }

  private _saveCustom() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._custom));
    } catch { /* ignore */ }
  }
}

export const cacs = new CACSystem();
