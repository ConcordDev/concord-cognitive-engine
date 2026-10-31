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
  easing?:       'linear' | 'ease_in_quad' | 'ease_out_quad' | 'ease_in_out_quad' | 'ease_in_cubic' | 'ease_out_cubic' | 'ease_in_out_cubic';
  /** Time scale during this shot. 1 = normal, 0.2 = slow-mo, 0 = pause. */
  time_scale?:   number;
  /** Music stem layer to enable for this shot (EE3 hooks here). */
  music_layer?:  string;
  /** Audio sting (one-shot) at shot start. */
  audio_sting?:  string;
}

export interface CinematicSequence {
  id:                 string;
  /** Optional human-facing label + blurb for catalog UIs (narrative-walk). */
  name?:              string;
  summary?:           string;
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
  /** Set by cancel(); the playback loop checks it on every tick. */
  cancelled:     boolean;
  /** Transport state (Q56 remainder): pause folds the current shot's
   *  effective elapsed into shotBaseMs and freezes it; resume restarts
   *  shotStartedAt. seekRequest is consumed by the playback loop, which
   *  jumps to the target shot and re-applies its state. */
  paused:        boolean;
  shotBaseMs:    number;
  shotStartedAt: number;
  seekRequest:   { shotIndex: number; offsetMs: number } | null;
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

  let resolveFn: () => void = () => undefined;
  const finishPromise = new Promise<void>((resolve) => { resolveFn = resolve; });

  const sequence: CinematicSequence = authored ?? {
    id, trigger: triggerName, lockInput, duration_ms: durationMs,
    shots, skippable_after_ms: skippable, music_track: musicTrack,
  };

  const record: ActiveSequence = {
    seq: sequence,
    startedAt: performance.now(),
    currentShot: 0,
    finishPromise,
    cancel: () => { record.cancelled = true; },
    cancelled: false,
    paused: false,
    shotBaseMs: 0,
    shotStartedAt: performance.now(),
    seekRequest: null,
  };
  active = record;

  // ESC handler — only effective after skippable window. The window is
  // measured in playback time, so pausing doesn't unlock the skip.
  const escHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!active) return;
    if (sequenceElapsedMs(active) > active.seq.skippable_after_ms) active.cancel();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', escHandler);

  // Emit a director:start event so the world page knows to lock input + show letterbox.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:cinematic-start', {
      detail: { id, lockInput, durationMs, eventDetail, musicTrack },
    }));
  }

  // Run shots sequentially. The wait is polled rather than a bare
  // setTimeout so the transport can pause it, seek within/across shots,
  // and cancel it while paused (Q56 remainder).
  (async () => {
    let i = 0;
    let pendingOffsetMs = 0;
    while (i < shots.length) {
      if (record.cancelled || active !== record) break;
      record.currentShot = i;
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
      record.shotBaseMs = pendingOffsetMs;
      pendingOffsetMs = 0;
      record.shotStartedAt = performance.now();
      const outcome = await waitCurrentShot(record, shot.duration_ms);
      if (outcome === 'seek' && record.seekRequest) {
        i = record.seekRequest.shotIndex;
        pendingOffsetMs = record.seekRequest.offsetMs;
        record.seekRequest = null;
        continue;
      }
      if (outcome === 'cancelled') break;
      i += 1;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', escHandler);
      window.dispatchEvent(new CustomEvent('concordia:cinematic-end', {
        detail: { id, cancelled: record.cancelled },
      }));
    }
    if (active === record) active = null;
    setTimeScale(1.0);   // ensure normal time restored
    resolveFn();
  })();

  return finishPromise;
}

/** Effective elapsed within the active shot: the banked base plus the
 *  running segment — frozen while paused. */
function shotElapsedMs(record: ActiveSequence): number {
  if (record.paused) return record.shotBaseMs;
  return record.shotBaseMs + (performance.now() - record.shotStartedAt);
}

/** Playback-position elapsed for the whole sequence. */
function sequenceElapsedMs(record: ActiveSequence): number {
  let prior = 0;
  const shots = record.seq.shots;
  for (let k = 0; k < record.currentShot && k < shots.length; k++) {
    prior += shots[k].duration_ms;
  }
  const current = shots[record.currentShot];
  const within = current ? Math.min(shotElapsedMs(record), current.duration_ms) : 0;
  return Math.min(prior + within, record.seq.duration_ms);
}

type ShotWaitOutcome = 'done' | 'cancelled' | 'seek';

/** Poll the current shot's clock until it completes, the sequence is
 *  cancelled, or a seek is requested. Polling (25ms) is what makes the
 *  wait pausable and seekable; the tick checks seek/cancel even while
 *  paused, so neither can deadlock against a frozen clock. */
function waitCurrentShot(record: ActiveSequence, durationMs: number): Promise<ShotWaitOutcome> {
  return new Promise((resolve) => {
    const tick = () => {
      if (record.cancelled || active !== record) return resolve('cancelled');
      if (record.seekRequest) return resolve('seek');
      if (shotElapsedMs(record) >= durationMs) return resolve('done');
      setTimeout(tick, 25);
    };
    setTimeout(tick, 25);
  });
}

function emitPlayback(record: ActiveSequence): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('concordia:cinematic-playback', {
    detail: {
      id: record.seq.id,
      paused: record.paused,
      elapsedMs: sequenceElapsedMs(record),
      durationMs: record.seq.duration_ms,
      currentShot: record.currentShot,
      shotCount: record.seq.shots.length,
    },
  }));
}

/** Snapshot of the transport state for UIs (the world surface's clock,
 *  the camera-controls transport). Null when nothing is playing. */
export function getPlaybackState(): {
  id: string; paused: boolean; elapsedMs: number; durationMs: number;
  currentShot: number; shotCount: number;
} | null {
  if (!active) return null;
  return {
    id: active.seq.id,
    paused: active.paused,
    elapsedMs: sequenceElapsedMs(active),
    durationMs: active.seq.duration_ms,
    currentShot: active.currentShot,
    shotCount: active.seq.shots.length,
  };
}

/** Freeze playback at the current position. No-op when idle or already
 *  paused. The sequence clock (and the ESC skippable window) freeze
 *  with it; the camera holds the current shot. */
export function pauseActiveSequence(): void {
  if (!active || active.paused) return;
  active.shotBaseMs = shotElapsedMs(active);
  active.paused = true;
  emitPlayback(active);
}

/** Resume a paused sequence from the frozen position. */
export function resumeActiveSequence(): void {
  if (!active || !active.paused) return;
  active.paused = false;
  active.shotStartedAt = performance.now();
  emitPlayback(active);
}

/** Seek to an absolute playback position (ms, clamped to the sequence).
 *  The target shot's state (camera, time-scale, sting) is re-applied as
 *  the loop lands on it. Works while paused — the position moves and
 *  playback stays frozen there until resumed. */
export function seekActiveSequence(elapsedMs: number): void {
  if (!active) return;
  const shots = active.seq.shots;
  const target = Math.max(0, Math.min(elapsedMs, active.seq.duration_ms));
  let acc = 0;
  let shotIndex = shots.length - 1;
  let offsetMs = shots.length ? shots[shots.length - 1].duration_ms : 0;
  for (let k = 0; k < shots.length; k++) {
    if (target < acc + shots[k].duration_ms || k === shots.length - 1) {
      shotIndex = k;
      offsetMs = target - acc;
      break;
    }
    acc += shots[k].duration_ms;
  }
  active.seekRequest = { shotIndex, offsetMs };
  // The playback event reports the requested position immediately; the
  // loop applies it on its next tick (≤25ms) and re-emits the shot.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:cinematic-playback', {
      detail: {
        id: active.seq.id, paused: active.paused, elapsedMs: target,
        durationMs: active.seq.duration_ms, currentShot: shotIndex,
        shotCount: shots.length, seek: true,
      },
    }));
  }
}

/** Skip to the previous/next shot boundary (the transport's skip
 *  buttons). delta is in shots, typically ±1. */
export function skipActiveShot(delta: number): void {
  if (!active) return;
  const shots = active.seq.shots;
  const targetShot = Math.max(0, Math.min(active.currentShot + delta, shots.length - 1));
  let acc = 0;
  for (let k = 0; k < targetShot; k++) acc += shots[k].duration_ms;
  // Skipping forward from the last shot goes to the end (the sequence
  // finishes); anywhere else it lands on the target shot's start.
  if (delta > 0 && active.currentShot === shots.length - 1) {
    seekActiveSequence(active.seq.duration_ms);
    return;
  }
  seekActiveSequence(acc);
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
