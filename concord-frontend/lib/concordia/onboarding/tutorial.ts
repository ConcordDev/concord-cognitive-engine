// Progressive onboarding — introduces one concept at a time.
// Never shows more than 3 controls at once in the first 15 minutes.
// Each step advances on a specific player action or timeout.

export type TutorialStep =
  | 'movement-basic'
  | 'camera-control'
  | 'sprint'
  | 'first-npc'
  | 'first-dialogue'
  | 'first-creation'
  | 'first-combat-intro'
  | 'first-combat-hotbar'
  | 'lens-portal-intro'
  | 'social-intro'
  | 'done';

export type PlayerAction =
  | 'moved-significant-distance'
  | 'rotated-camera'
  | 'sprinted'
  | 'near-npc'
  | 'completed-dialogue'
  | 'opened-creation'
  | 'placed-object'
  | 'entered-combat'
  | 'used-hotbar-skill'
  | 'entered-lens-portal'
  | 'sent-quick-message';

export interface TutorialHint {
  message: string;
  duration: number; // ms to display
  position: 'bottom-center' | 'top-center' | 'bottom-right';
  controls?: string[]; // shown as keybind badges (max 3)
}

export interface TutorialState {
  step: TutorialStep;
  skipped: boolean;
  stepsCompleted: TutorialStep[];
  startedAt: number;
  hintsEnabled: boolean;
}

// Step → required player action to advance
const ADVANCE_ON: Record<TutorialStep, PlayerAction | null> = {
  'movement-basic': 'moved-significant-distance',
  'camera-control': 'rotated-camera',
  sprint: 'sprinted',
  'first-npc': 'near-npc',
  'first-dialogue': 'completed-dialogue',
  'first-creation': 'placed-object',
  'first-combat-intro': 'entered-combat',
  'first-combat-hotbar': 'used-hotbar-skill',
  'lens-portal-intro': 'entered-lens-portal',
  'social-intro': 'sent-quick-message',
  done: null,
};

const STEP_ORDER: TutorialStep[] = [
  'movement-basic',
  'camera-control',
  'sprint',
  'first-npc',
  'first-dialogue',
  'first-creation',
  'first-combat-intro',
  'first-combat-hotbar',
  'lens-portal-intro',
  'social-intro',
  'done',
];

// Hints shown at each step. Max 3 controls per step.
const STEP_HINTS: Record<TutorialStep, TutorialHint | null> = {
  'movement-basic': {
    message: 'Use WASD or the left joystick to move around.',
    duration: 8000,
    position: 'bottom-center',
    controls: ['W', 'A', 'S', 'D'],
  },
  'camera-control': {
    message: 'Move your mouse to look around.',
    duration: 6000,
    position: 'bottom-center',
    controls: ['Mouse'],
  },
  sprint: {
    message: 'Hold Shift to sprint.',
    duration: 5000,
    position: 'bottom-center',
    controls: ['Shift'],
  },
  'first-npc': {
    message: "Someone's nearby. Press E to talk to them.",
    duration: 8000,
    position: 'bottom-center',
    controls: ['E'],
  },
  'first-dialogue': {
    message: 'Type or speak to respond. Press Enter to send.',
    duration: 8000,
    position: 'bottom-center',
    controls: ['Enter', '🎤'],
  },
  'first-creation': {
    message: 'Find a creation terminal to build something. Press E to open it.',
    duration: 10000,
    position: 'bottom-center',
    controls: ['E'],
  },
  'first-combat-intro': {
    message: 'An enemy! Left-click to attack. Q to dodge.',
    duration: 6000,
    position: 'bottom-center',
    controls: ['LClick', 'Q'],
  },
  'first-combat-hotbar': {
    message: 'Press 1–9 to activate combat skills from your hotbar.',
    duration: 6000,
    position: 'bottom-center',
    controls: ['1', '2', '3'],
  },
  'lens-portal-intro': {
    message: 'Lens portals connect Concordia to the knowledge substrate. Press E to enter.',
    duration: 10000,
    position: 'bottom-center',
    controls: ['E'],
  },
  'social-intro': {
    message: 'Other players are nearby. Use the quick message bar or hold Z for emotes.',
    duration: 8000,
    position: 'bottom-center',
    controls: ['Z', 'Quick messages'],
  },
  done: null,
};

const STORAGE_KEY = 'concordia:tutorial:state';

// ── TutorialManager ──────────────────────────────────────────────────

export class TutorialManager {
  private _state: TutorialState;
  private _hintCallback: ((hint: TutorialHint | null) => void) | null = null;

  constructor() {
    this._state = this._load();
  }

  get state(): TutorialState {
    return this._state;
  }
  get isDone(): boolean {
    return this._state.skipped || this._state.step === 'done';
  }
  get hintsEnabled(): boolean {
    return this._state.hintsEnabled;
  }

  onHint(cb: (hint: TutorialHint | null) => void) {
    this._hintCallback = cb;
  }

  start() {
    if (this._state.skipped) return;
    this._showHint(this._state.step);
  }

  skip(withHints = false) {
    this._state = { ...this._state, skipped: true, hintsEnabled: withHints };
    this._save();
    this._hintCallback?.(null);
  }

  enableHints() {
    this._state = { ...this._state, hintsEnabled: true };
    this._save();
  }

  disableHints() {
    this._state = { ...this._state, hintsEnabled: false };
    this._save();
    this._hintCallback?.(null);
  }

  toggleHints() {
    if (this._state.hintsEnabled) this.disableHints();
    else this.enableHints();
  }

  advance(action: PlayerAction) {
    if (this.isDone) return;
    const required = ADVANCE_ON[this._state.step];
    if (required !== action) return;

    const currentIdx = STEP_ORDER.indexOf(this._state.step);
    const nextStep = STEP_ORDER[currentIdx + 1] ?? 'done';

    this._state = {
      ...this._state,
      step: nextStep,
      stepsCompleted: [...this._state.stepsCompleted, this._state.step],
    };
    this._save();
    this._showHint(nextStep);
  }

  replay(step: TutorialStep) {
    const hint = STEP_HINTS[step];
    if (hint) this._hintCallback?.(hint);
  }

  private _showHint(step: TutorialStep) {
    const hint = STEP_HINTS[step];
    this._hintCallback?.(hint ?? null);
  }

  private _load(): TutorialState {
    if (typeof window === 'undefined') return this._defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as TutorialState;
    } catch {
      /* ignore */
    }
    return this._defaultState();
  }

  private _save() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
    } catch {
      /* ignore */
    }
  }

  private _defaultState(): TutorialState {
    return {
      step: 'movement-basic',
      skipped: false,
      stepsCompleted: [],
      startedAt: Date.now(),
      hintsEnabled: false,
    };
  }
}

export const tutorialManager = new TutorialManager();

// Tutorial topic labels for HelpMenu
export const TUTORIAL_TOPICS: Record<TutorialStep, string> = {
  'movement-basic': 'Basic Movement',
  'camera-control': 'Camera Control',
  sprint: 'Sprinting',
  'first-npc': 'Talking to NPCs',
  'first-dialogue': 'Dialogue System',
  'first-creation': 'Creating Objects',
  'first-combat-intro': 'Combat Basics',
  'first-combat-hotbar': 'Combat Hotbar',
  'lens-portal-intro': 'Lens Portals',
  'social-intro': 'Multiplayer',
  done: '',
};
