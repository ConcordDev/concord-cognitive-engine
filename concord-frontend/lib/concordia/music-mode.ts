// concord-frontend/lib/concordia/music-mode.ts
//
// Track 1 — adaptive music. The SoundscapeEngine's district profiles carry
// chord voicings as semitone offsets; this recolors a chord's QUALITY (major
// vs minor) without changing its root/function, so the same procedural score
// can darken on low-HP/boss tension and brighten on victory. Pure + total.
//
//   minor  — flatten the major-quality scale degrees by a semitone
//            (M3→m3, M6→m6, M7→m7): a major triad [0,4,7] → [0,3,7].
//   major  — the inverse (m3→M3, m6→M6, m7→M7): [0,3,7] → [0,4,7].
//   neutral— identity (the authored voicing, unchanged).
//
// Roots, 4ths, 5ths (pitch classes 0/5/7) are left alone so the chord keeps its
// harmonic function; only the colour tone moves. Octave-agnostic (works on
// offsets like 12/16 too via pitch-class).

export type MusicMode = 'neutral' | 'minor' | 'major';

function pitchClass(semi: number): number {
  return ((semi % 12) + 12) % 12;
}

/** Recolor a single semitone offset toward the target mode. Pure. */
export function recolorSemitone(semi: number, mode: MusicMode): number {
  if (mode === 'neutral') return semi;
  const pc = pitchClass(semi);
  if (mode === 'minor') {
    // Major-quality degrees → minor (down a semitone).
    if (pc === 4 || pc === 9 || pc === 11) return semi - 1;
    return semi;
  }
  // major: minor-quality degrees → major (up a semitone).
  if (pc === 3 || pc === 8 || pc === 10) return semi + 1;
  return semi;
}

/** Recolor an entire chord (array of semitone offsets). Pure — returns a new array. */
export function recolorChord(chord: number[], mode: MusicMode): number[] {
  if (mode === 'neutral') return chord.slice();
  return chord.map((s) => recolorSemitone(s, mode));
}

/**
 * Map a combat-intensity scalar (0..1, typically driven by HP / boss state) to a
 * mode: calm stays neutral, rising danger darkens to minor. Victory is set
 * explicitly by the caller (→ 'major'), not derived from intensity.
 */
export function modeForIntensity(intensity: number): MusicMode {
  if (intensity >= 0.6) return 'minor';
  return 'neutral';
}
