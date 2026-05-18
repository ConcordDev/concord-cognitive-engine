/**
 * Voice leading — pick chord voicings that minimise total semitone
 * movement between adjacent chords.
 *
 * Used by the Chord Stamp Tool (Item #3) so progressions sound smooth
 * out of the box instead of every chord jumping to root position.
 *
 * Algorithm: each chord exposes a small set of inversion candidates
 * (root, 1st, 2nd, drop-2, drop-3). For each adjacent pair we score
 * by `sum(|noteB - matchedNoteA|)` after pairing voices nearest-first
 * (greedy assignment). The DP picks the inversion-per-chord that
 * minimises the running total. O(N · K²) where N = chord count and
 * K = inversion candidates per chord (≤ 6).
 *
 * Pure functions — no side effects, no audio.
 */

export type Quality =
  | 'maj' | 'min' | '7' | 'maj7' | 'min7' | 'sus2' | 'sus4'
  | 'dim' | 'dim7' | 'aug' | 'min7b5' | 'add9' | '6' | 'min6';

export interface Chord {
  /** Root pitch class as a MIDI note in octave 4 (e.g. C4 = 60, G4 = 67). */
  root: number;
  quality: Quality;
  /** Pretty label, e.g. "Cmaj7". */
  label: string;
}

/** A specific voicing — actual MIDI notes for an inversion of `chord`. */
export interface Voicing {
  chord: Chord;
  notes: number[];        // sorted ascending
  inversion: number;      // 0 = root, 1 = 1st inv, …
  variant: string;        // 'root' | 'inv1' | 'inv2' | 'drop2' | 'drop3'
}

const QUALITY_INTERVALS: Record<Quality, number[]> = {
  maj:    [0, 4, 7],
  min:    [0, 3, 7],
  '7':    [0, 4, 7, 10],
  maj7:   [0, 4, 7, 11],
  min7:   [0, 3, 7, 10],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
  dim:    [0, 3, 6],
  dim7:   [0, 3, 6, 9],
  aug:    [0, 4, 8],
  min7b5: [0, 3, 6, 10],
  add9:   [0, 4, 7, 14],
  '6':    [0, 4, 7, 9],
  min6:   [0, 3, 7, 9],
};

export function chordToneIntervals(quality: Quality): number[] {
  return QUALITY_INTERVALS[quality] ?? QUALITY_INTERVALS.maj;
}

/** All canonical inversions + drop voicings for a chord, octave-anchored to `root`. */
export function candidateVoicings(chord: Chord): Voicing[] {
  const ints = chordToneIntervals(chord.quality);
  const baseNotes = ints.map(i => chord.root + i);
  const out: Voicing[] = [];
  // Inversions: rotate the lowest note up by an octave.
  for (let i = 0; i < baseNotes.length; i++) {
    const notes = [...baseNotes];
    for (let j = 0; j < i; j++) notes[j] += 12;
    notes.sort((a, b) => a - b);
    out.push({
      chord,
      notes,
      inversion: i,
      variant: i === 0 ? 'root' : `inv${i}`,
    });
  }
  // Drop-2: take the 2nd-from-top voice and drop it an octave.
  if (baseNotes.length >= 4) {
    const closed = [...baseNotes].sort((a, b) => a - b);
    const drop2 = [...closed];
    drop2[drop2.length - 2] -= 12;
    drop2.sort((a, b) => a - b);
    out.push({ chord, notes: drop2, inversion: 0, variant: 'drop2' });
    // Drop-3: take the 3rd-from-top down an octave.
    const drop3 = [...closed];
    drop3[drop3.length - 3] -= 12;
    drop3.sort((a, b) => a - b);
    out.push({ chord, notes: drop3, inversion: 0, variant: 'drop3' });
  }
  return out;
}

/**
 * Cost of moving from voicing A to voicing B. Greedy nearest-note
 * pairing — for the small N (3-5 notes) this is good enough; the
 * Hungarian-optimal pairing is theoretically tighter but not
 * audibly different for chord voicings.
 */
export function transitionCost(a: Voicing, b: Voicing): number {
  const remaining = [...b.notes];
  let cost = 0;
  for (const noteA of a.notes) {
    if (remaining.length === 0) break;
    let bestIdx = 0;
    let best = Math.abs(noteA - remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = Math.abs(noteA - remaining[i]);
      if (d < best) { best = d; bestIdx = i; }
    }
    cost += best;
    remaining.splice(bestIdx, 1);
  }
  // Penalise voicings that drift outside a sane octave range.
  const lo = Math.min(...b.notes);
  const hi = Math.max(...b.notes);
  if (lo < 36) cost += (36 - lo) * 0.5;  // too low (sub-C2)
  if (hi > 84) cost += (hi - 84) * 0.5;  // too high (above C6)
  return cost;
}

/**
 * Lead-voice cost: penalises melody notes leaping more than 4
 * semitones. Used in melody-led mode so the top voice tracks the
 * melody as closely as possible.
 */
function topVoiceCost(prevTop: number | null, voicing: Voicing): number {
  if (prevTop === null) return 0;
  const top = Math.max(...voicing.notes);
  return Math.abs(top - prevTop) > 4 ? Math.abs(top - prevTop) - 4 : 0;
}

export type VoiceLeadingMode = 'smooth' | 'melody-led' | 'bass-led';

export interface VoiceLeadResult {
  voicings: Voicing[];
  totalCost: number;
}

/**
 * Pick a voicing per chord that minimises total movement under the
 * chosen mode. Returns one voicing per chord.
 */
export function leadProgression(
  chords: Chord[],
  mode: VoiceLeadingMode = 'smooth',
): VoiceLeadResult {
  if (chords.length === 0) return { voicings: [], totalCost: 0 };
  const candidates = chords.map(candidateVoicings);
  // DP: dp[i][k] = cost of best path ending in candidates[i][k].
  const N = chords.length;
  const dp: number[][] = candidates.map(c => c.map(() => Infinity));
  const back: number[][] = candidates.map(c => c.map(() => -1));
  // Seed: cost of opening on each candidate (prefer root-position +
  // mid-range for the first chord so we don't start in the cellar).
  for (let k = 0; k < candidates[0].length; k++) {
    const v = candidates[0][k];
    const mid = (Math.min(...v.notes) + Math.max(...v.notes)) / 2;
    dp[0][k] = Math.abs(mid - 60) * 0.25 + (v.variant === 'root' ? 0 : 1);
  }
  for (let i = 1; i < N; i++) {
    for (let k = 0; k < candidates[i].length; k++) {
      const vk = candidates[i][k];
      for (let j = 0; j < candidates[i - 1].length; j++) {
        const vj = candidates[i - 1][j];
        let edge = transitionCost(vj, vk);
        if (mode === 'melody-led') {
          edge += topVoiceCost(Math.max(...vj.notes), vk) * 0.8;
        } else if (mode === 'bass-led') {
          // Bass-led: keep the bottom voice contiguous.
          edge += Math.abs(Math.min(...vj.notes) - Math.min(...vk.notes)) * 0.6;
        }
        const total = dp[i - 1][j] + edge;
        if (total < dp[i][k]) {
          dp[i][k] = total;
          back[i][k] = j;
        }
      }
    }
  }
  // Backtrack from the cheapest endpoint.
  let lastBest = 0;
  for (let k = 1; k < dp[N - 1].length; k++) {
    if (dp[N - 1][k] < dp[N - 1][lastBest]) lastBest = k;
  }
  const path: number[] = [lastBest];
  for (let i = N - 1; i > 0; i--) {
    path.unshift(back[i][path[0]]);
  }
  const voicings = path.map((k, i) => candidates[i][k]);
  return { voicings, totalCost: dp[N - 1][lastBest] };
}

/* ─── Chord parsing + diatonic helpers ─── */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_ALIASES: Record<string, number> = {
  'Db': 1, 'Eb': 3, 'Gb': 6, 'Ab': 8, 'Bb': 10,
};

/** Parse e.g. "Cmaj7", "F#m", "Bbm7" → { root: midi, quality }. */
export function parseChord(label: string): Chord | null {
  const m = /^([A-G])([#b])?(.*)$/.exec(label.trim());
  if (!m) return null;
  const noteName = m[1] + (m[2] ?? '');
  let pc = NOTE_NAMES.indexOf(noteName as typeof NOTE_NAMES[number]);
  if (pc < 0) {
    const flat = FLAT_ALIASES[noteName];
    if (flat === undefined) return null;
    pc = flat;
  }
  const suffix = m[3].toLowerCase();
  let quality: Quality = 'maj';
  if (suffix === '') quality = 'maj';
  else if (suffix === 'm' || suffix === 'min') quality = 'min';
  else if (suffix === '7') quality = '7';
  else if (suffix === 'maj7' || suffix === 'M7' || suffix === 'Δ7') quality = 'maj7';
  else if (suffix === 'm7' || suffix === 'min7') quality = 'min7';
  else if (suffix === 'sus2') quality = 'sus2';
  else if (suffix === 'sus' || suffix === 'sus4') quality = 'sus4';
  else if (suffix === 'dim' || suffix === '°') quality = 'dim';
  else if (suffix === 'dim7' || suffix === '°7') quality = 'dim7';
  else if (suffix === 'aug' || suffix === '+') quality = 'aug';
  else if (suffix === 'm7b5' || suffix === 'ø7') quality = 'min7b5';
  else if (suffix === 'add9') quality = 'add9';
  else if (suffix === '6') quality = '6';
  else if (suffix === 'm6' || suffix === 'min6') quality = 'min6';
  else return null;
  const root = 60 + pc; // anchor at octave 4
  return { root, quality, label };
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/** Diatonic triads for a key, returned in scale-degree order I..vii°. */
export function diatonicChords(keyRootMidi: number, mode: 'major' | 'minor'): Chord[] {
  const scale = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  // Major: I=maj ii=min iii=min IV=maj V=maj vi=min vii°=dim
  // Minor (natural): i=min ii°=dim III=maj iv=min v=min VI=maj VII=maj
  const majQuals: Quality[] = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
  const minQuals: Quality[] = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'];
  const quals = mode === 'major' ? majQuals : minQuals;
  return scale.map((interval, i) => {
    const root = keyRootMidi + interval;
    const pc = ((root % 12) + 12) % 12;
    const name = NOTE_NAMES[pc];
    const q = quals[i];
    const label = q === 'maj' ? name
      : q === 'min' ? `${name}m`
      : q === 'dim' ? `${name}°`
      : `${name}${q}`;
    return { root, quality: q, label };
  });
}
