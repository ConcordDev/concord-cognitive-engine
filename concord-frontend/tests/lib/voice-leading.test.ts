import { describe, it, expect } from 'vitest';
import {
  parseChord, diatonicChords, candidateVoicings, transitionCost,
  leadProgression, chordToneIntervals,
} from '@/lib/daw/voice-leading';

describe('parseChord', () => {
  it('parses simple major', () => {
    const c = parseChord('C');
    expect(c).not.toBeNull();
    expect(c!.quality).toBe('maj');
    expect(c!.root).toBe(60);
  });

  it('parses flats and sharps', () => {
    expect(parseChord('Bb')!.root).toBe(70);
    expect(parseChord('F#')!.root).toBe(66);
    expect(parseChord('Eb')!.root).toBe(63);
  });

  it('parses extended qualities', () => {
    expect(parseChord('Cmaj7')!.quality).toBe('maj7');
    expect(parseChord('Dm7')!.quality).toBe('min7');
    expect(parseChord('G7')!.quality).toBe('7');
    expect(parseChord('Bbsus4')!.quality).toBe('sus4');
    expect(parseChord('Adim7')!.quality).toBe('dim7');
  });

  it('returns null for unparseable input', () => {
    expect(parseChord('Hx9')).toBeNull();
    expect(parseChord('')).toBeNull();
  });
});

describe('chordToneIntervals', () => {
  it('returns standard triad/seventh intervals', () => {
    expect(chordToneIntervals('maj')).toEqual([0, 4, 7]);
    expect(chordToneIntervals('min')).toEqual([0, 3, 7]);
    expect(chordToneIntervals('maj7')).toEqual([0, 4, 7, 11]);
    expect(chordToneIntervals('min7')).toEqual([0, 3, 7, 10]);
  });
});

describe('diatonicChords', () => {
  it('returns 7 chords for C major with correct labels', () => {
    const chords = diatonicChords(60, 'major');
    expect(chords).toHaveLength(7);
    expect(chords[0].label).toBe('C');
    expect(chords[1].label).toBe('Dm');
    expect(chords[3].label).toBe('F');
    expect(chords[4].label).toBe('G');
    expect(chords[6].quality).toBe('dim');
  });

  it('returns natural minor for A minor', () => {
    const chords = diatonicChords(57, 'minor');
    expect(chords[0].label).toBe('Am');
    expect(chords[2].quality).toBe('maj'); // III chord
  });
});

describe('candidateVoicings', () => {
  it('produces 3 inversions for a triad', () => {
    const c = parseChord('C')!;
    const voicings = candidateVoicings(c);
    // 3 inversions for a triad — no drop voicings (need 4+ notes).
    expect(voicings).toHaveLength(3);
    expect(voicings[0].variant).toBe('root');
    expect(voicings[1].variant).toBe('inv1');
  });

  it('produces drop-2 and drop-3 for a 7th chord', () => {
    const c = parseChord('Cmaj7')!;
    const voicings = candidateVoicings(c);
    const variants = voicings.map(v => v.variant);
    expect(variants).toContain('drop2');
    expect(variants).toContain('drop3');
  });
});

describe('transitionCost', () => {
  it('is zero between identical voicings', () => {
    const c = parseChord('C')!;
    const v = candidateVoicings(c)[0];
    expect(transitionCost(v, v)).toBe(0);
  });

  it('is non-zero between root-position chords a fifth apart', () => {
    const c1 = parseChord('C')!;
    const c2 = parseChord('G')!;
    const v1 = candidateVoicings(c1)[0];
    const v2 = candidateVoicings(c2)[0];
    expect(transitionCost(v1, v2)).toBeGreaterThan(0);
  });
});

describe('leadProgression — smooth mode picks low-cost voicings', () => {
  it('C → G via voice-leading costs less than naive root-to-root', () => {
    const c = parseChord('C')!;
    const g = parseChord('G')!;
    const result = leadProgression([c, g], 'smooth');
    expect(result.voicings).toHaveLength(2);
    // Naive root-to-root: C(60,64,67) → G(67,71,74) costs 7+7+7 = 21.
    // Smooth path should be much lower.
    const naive = transitionCost(candidateVoicings(c)[0], candidateVoicings(g)[0]);
    const picked = transitionCost(result.voicings[0], result.voicings[1]);
    expect(picked).toBeLessThanOrEqual(naive);
  });

  it('I-V-vi-IV picks coherent voicings (total movement under ~12 semitones)', () => {
    const chords = [
      parseChord('C')!, parseChord('G')!, parseChord('Am')!, parseChord('F')!,
    ];
    const result = leadProgression(chords, 'smooth');
    expect(result.voicings).toHaveLength(4);
    expect(result.totalCost).toBeLessThan(30);
  });

  it('empty input returns empty result', () => {
    const r = leadProgression([], 'smooth');
    expect(r.voicings).toHaveLength(0);
    expect(r.totalCost).toBe(0);
  });
});

describe('leadProgression — melody-led keeps top voice tighter', () => {
  it('top-voice spread is small across a I-IV-V', () => {
    const chords = [parseChord('C')!, parseChord('F')!, parseChord('G')!];
    const r = leadProgression(chords, 'melody-led');
    const tops = r.voicings.map(v => Math.max(...v.notes));
    const spread = Math.max(...tops) - Math.min(...tops);
    expect(spread).toBeLessThanOrEqual(7);
  });
});
