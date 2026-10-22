/**
 * Non-destructive Pitch Editor edits. Audio assets stay immutable.
 * The derived buffer is cached by hash and is not part of the project.
 */

export const PITCH_ANALYSIS_VERSION = 1;

export interface F0Frame {
  /** Seconds from the start of the clip buffer. */
  t: number;
  hz: number;
  conf: number;
  rms: number;
}

export interface PitchNoteEdit {
  id: string;
  startSec: number;
  endSec: number;
  /** Median detected MIDI note (display and snap origin). */
  midi: number;
  /** Median detected frequency. The dry ratio is built around this. */
  hz: number;
  /** Semitone the note moves toward when pitch center is above 0. */
  targetMidi: number;
  /** Free-cents offset from targetMidi, -100…100. Alt-drag writes this. */
  cents: number;
  /** 0 leaves the median, 100 moves it fully onto the target. */
  center: number;
  /** 0 keeps slow pitch motion, 100 flattens it, 200 inverts it. */
  drift: number;
  /** 100 keeps motion above ~5 Hz, 0 removes it, 200 exaggerates it. */
  vibrato: number;
  gainDb: number;
}

export interface PitchEditDoc {
  version: 1;
  analysisVersion: number;
  assetId: string;
  /** Floor applied with max() so a macro never lowers a per-note amount. */
  macroCenter: number;
  macroDrift: number;
  notes: PitchNoteEdit[];
}

export interface PitchAnalysis {
  version: number;
  hopSec: number;
  frames: F0Frame[];
  notes: PitchNoteEdit[];
  /** False when the f0 track is unstable or more than one voice is present. */
  singleVoice: boolean;
}

export const PITCH_EDITOR_POLY_MESSAGE = 'Pitch Editor only works on a single voice';
export const PITCH_EDITOR_MONO_MESSAGE = 'Pitch Editor works on a mono clip.';
