/**
 * Cinematic director — Sprint D / Z1 + EE1
 *
 * Listens for high-priority events (ruler_assassinated, scheme_completed,
 * festival_decree, building_collapsed_critical, etc.) and orchestrates a
 * camera + audio + time-scale sequence.
 *
 * Two paths:
 *   1. Auto-event templates (Z1) — director picks from a small library
 *      of authored camera shapes (over_shoulder, crane_pull, dolly_in,
 *      whip_pan, dutch_tilt, match_cut). Cheap fallback for any event.
 *   2. Authored DSL sequences (EE1) — JSON files in `content/cinematics/`
 *      register full per-shot camera + music + time-scale sequences for
 *      known story beats (e.g. vela_first_reveal). Override the template
 *      pick when the trigger matches.
 *
 * Director takes camera control from CameraControls.tsx for the sequence
 * duration, restores afterward. Keys: ESC always cancels (post-skippable_after_ms).
 */

import { setTimeScale } from '../concordia/use-time-scale';

export type CameraTemplateId =
  | 'over_shoulder'
  | 'reverse_over_shoulder'
  | 'crane_pull'
  | 'crane_drop'
  | 'dolly_in'
  | 'dolly_out'
  | 'whip_pan'
  | 'dutch_tilt'
  | 'match_cut'
  | 'close_on'
  | 'pull_back';

export interface CameraShot {
  camera:        CameraTemplateId;
  /** Subject the camera frames (e.g. 'player' or NPC id). */
  subject?:      string;
  target_npc?:   string;
  duration_ms:   number;
  easing?:       'linear' | 'ease_in_quad' | 'ease_out_quad' | 'ease_in_out_quad';
  /** Time scale during this shot. 1 = normal, 0.2 = slow-mo, 0 = pause. */
  time_scale?:   number;
  /** Music stem layer to enable for this shot (EE3 hooks here). */
  music_layer?:  string;
  /** Audio sting (one-shot) at shot start. */
  audio_sting?:  string;
}

export interface CinematicSequence {
  id:                 string;
  trigger:            string;        // event name e.g. 'quest:the_handshake_revelation:phase_4'
  /** When true, lock player input for the sequence duration. */
  lockInput:          boolean;
  duration_ms:        number;
  shots:              CameraShot[];
  /** Allow ESC-skip after this many ms (so the player can't skip the
   *  hero reveal in 0.5s but isn't trapped on a 12s sequence). */
  skippable_after_ms: number;
  /** Optional music track id whose stems load for this sequence. */
  music_track?:       string;
}

interface ActiveSequence {
  seq:           CinematicSequence;
  startedAt:     number;
  currentShot:   number;
  /** Resolves when the sequence ends. */
  finishPromise: Promise<void>;
  cancel:        () => void;
}

const sequences = new Map<string, CinematicSequence>();
let active: ActiveSequence | null = null;
const triggerListeners = new Map<string, ((event: unknown) => void)[]>();

/**
 * Register an authored sequence (EE1). Caller (content-seeder) loads
 * each `content/cinematics/*.json` and calls this once.
 */
export function registerSequence(seq: CinematicSequence): void {
  sequences.set(seq.id, seq);
}

export function getSequence(id: string): CinematicSequence | null {
  return sequences.get(id) ?? null;
}

export function listSequences(): CinematicSequence[] {
  return Array.from(sequences.values());
}

/** Map an incoming event name to its registered sequence id (if any). */
function findSequenceForTrigger(triggerName: string): CinematicSequence | null {
  for (const seq of sequences.values()) {
    if (seq.trigger === triggerName) return seq;
  }
  return null;
}

/**
 * Auto-event templates — used when no authored DSL sequence is registered
 * for the trigger. Keep small and obvious; authored sequences take over
 * for known story beats.
 */
const AUTO_TEMPLATES: Record<string, CameraShot[]> = {
  'kingdom:ruler_assassinated': [
    { camera: 'close_on',  duration_ms: 1200, time_scale: 0.2, audio_sting: 'tragedy' },
    { camera: 'pull_back', duration_ms: 2400, easing: 'ease_out_quad' },
  ],
  'kingdom:player_deposed': [
    { camera: 'crane_drop', duration_ms: 2200, time_scale: 0.5, audio_sting: 'tragedy' },
    { camera: 'pull_back',  duration_ms: 1800 },
  ],
  'scheme:exposed': [
    { camera: 'whip_pan',  duration_ms: 600, audio_sting: 'reveal' },
    { camera: 'close_on',  duration_ms: 1400, time_scale: 0.5 },
  ],
  // Concordia Phase 15 — extended trigger coverage.
  'scheme:complete': [
    { camera: 'whip_pan',  duration_ms: 500, time_scale: 0.4, audio_sting: 'scheme_resolved' },
    { camera: 'close_on',  duration_ms: 1500, time_scale: 0.6 },
    { camera: 'pull_back', duration_ms: 1200 },
  ],
  'dynasty:heir_acceded': [
    { camera: 'crane_drop', duration_ms: 1800, audio_sting: 'inheritance' },
    { camera: 'close_on',   duration_ms: 2200, time_scale: 0.4 },
  ],
  'combat:hero_kill': [
    { camera: 'whip_pan',  duration_ms: 400, time_scale: 0.3, audio_sting: 'killshot' },
    { camera: 'close_on',  duration_ms: 1000, time_scale: 0.25 },
    { camera: 'pull_back', duration_ms: 900 },
  ],
  'combat:bloodline_fire_cast': [
    { camera: 'dutch_tilt', duration_ms: 800, time_scale: 0.6, audio_sting: 'sanguire_chord' },
    { camera: 'pull_back',  duration_ms: 1200 },
  ],
  'refusal:compound': [
    { camera: 'close_on',  duration_ms: 2000, time_scale: 0.15, audio_sting: 'concordia_deep_cold' },
    { camera: 'pull_back', duration_ms: 2400, easing: 'ease_in_out_cubic' },
  ],
  'world:building-state-collapsed': [
    { camera: 'dutch_tilt', duration_ms: 1100, time_scale: 0.45 },
    { camera: 'pull_back',  duration_ms: 1100 },
  ],
  'kingdom:festival_decree': [
    { camera: 'crane_drop',    duration_ms: 1400 },
    { camera: 'pull_back',     duration_ms: 2000 },
  ],
  'quest:complete': [
    { camera: 'close_on',  duration_ms: 1000, audio_sting: 'resolution' },
    { camera: 'pull_back', duration_ms: 1500 },
  ],
  'ark:archive_unlocked': [
    { camera: 'crane_drop', duration_ms: 2400, audio_sting: 'archive_chord' },
    { camera: 'close_on',   duration_ms: 1800, time_scale: 0.35 },
    { camera: 'pull_back',  duration_ms: 2200 },
  ],
  'vela:reveal': [
    { camera: 'whip_pan',  duration_ms: 500, audio_sting: 'vela_chord' },
    { camera: 'close_on',  duration_ms: 2500, time_scale: 0.3 },
    { camera: 'pull_back', duration_ms: 2000 },
  ],
};

/**
 * Subscribe to a trigger event. The director listens for these events
 * and runs a sequence (authored DSL preferred, auto-template otherwise).
 *
 * Hook into existing window CustomEvent dispatchers (already used by
 * Sprint B/C combat-juice + npc-perception bridge).
 */
export function subscribeTrigger(triggerName: string, handler: (event: unknown) => void): () => void {
  const list = triggerListeners.get(triggerName) ?? [];
  list.push(handler);
  triggerListeners.set(triggerName, list);
  if (typeof window !== 'undefined') {
    window.addEventListener(triggerName, handler as EventListener);
  }
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener(triggerName, handler as EventListener);
    }
    const arr = triggerListeners.get(triggerName) ?? [];
    triggerListeners.set(triggerName, arr.filter(h => h !== handler));
  };
}

/**
 * Run a sequence. Returns a promise that resolves when the sequence
 * completes (or is cancelled).
 *
 * If a sequence is already running, the new one is queued (only one
 * cinematic at a time).
 */
export function playSequence(triggerName: string, eventDetail: unknown = null): Promise<void> {
  // If an active sequence is running, queue or drop.
  if (active) {
    // Drop new sequence if active not yet skippable.
    return active.finishPromise;
  }

  const authored = findSequenceForTrigger(triggerName);
  let shots: CameraShot[];
  let lockInput = true;
  let skippable = 800;
  let durationMs = 0;
  let id: string;
  let musicTrack: string | undefined;

  if (authored) {
    shots = authored.shots;
    lockInput = authored.lockInput;
    skippable = authored.skippable_after_ms;
    durationMs = authored.duration_ms;
    id = authored.id;
    musicTrack = authored.music_track;
  } else if (AUTO_TEMPLATES[triggerName]) {
    shots = AUTO_TEMPLATES[triggerName];
    durationMs = shots.reduce((sum, s) => sum + s.duration_ms, 0);
    skippable = Math.min(800, durationMs / 2);
    id = `auto:${triggerName}`;
  } else {
    return Promise.resolve();
  }

  let cancelled = false;
  let resolveFn: () => void = () => undefined;
  const finishPromise = new Promise<void>((resolve) => { resolveFn = resolve; });

  const sequence: CinematicSequence = authored ?? {
    id, trigger: triggerName, lockInput, duration_ms: durationMs,
    shots, skippable_after_ms: skippable, music_track: musicTrack,
  };

  active = {
    seq: sequence,
    startedAt: performance.now(),
    currentShot: 0,
    finishPromise,
    cancel: () => { cancelled = true; },
  };

  // ESC handler — only effective after skippable window.
  const escHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!active) return;
    const elapsed = performance.now() - active.startedAt;
    if (elapsed > active.seq.skippable_after_ms) active.cancel();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', escHandler);

  // Emit a director:start event so the world page knows to lock input + show letterbox.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:cinematic-start', {
      detail: { id, lockInput, durationMs, eventDetail, musicTrack },
    }));
  }

  // Run shots sequentially.
  (async () => {
    for (let i = 0; i < shots.length; i++) {
      if (cancelled) break;
      if (!active) break;
      active.currentShot = i;
      const shot = shots[i];
      // Apply time-scale + music layer + audio sting + camera.
      if (typeof shot.time_scale === 'number') {
        setTimeScale(shot.time_scale, shot.duration_ms);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('concordia:cinematic-shot', {
          detail: { sequenceId: id, shotIndex: i, ...shot },
        }));
      }
      await new Promise<void>(r => setTimeout(r, shot.duration_ms));
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', escHandler);
      window.dispatchEvent(new CustomEvent('concordia:cinematic-end', {
        detail: { id, cancelled },
      }));
    }
    active = null;
    setTimeScale(1.0);   // ensure normal time restored
    resolveFn();
  })();

  return finishPromise;
}

export function isCinematicActive(): boolean {
  return active !== null;
}

export function cancelActiveSequence(): void {
  active?.cancel();
}

export const DIRECTOR_CONSTANTS = Object.freeze({
  AUTO_TEMPLATES,
});
