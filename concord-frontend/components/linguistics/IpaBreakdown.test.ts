import { describe, it, expect } from 'vitest';
import { segmentIpa } from './IpaBreakdown';

describe('segmentIpa', () => {
  it('strips phonemic slashes and segments a real transcription into phonemes + one stress boundary', () => {
    const segs = segmentIpa('/səˈɹɛndɪpɪti/');
    const phonemes = segs.filter((s) => s.kind !== 'boundary').map((s) => s.text);
    expect(phonemes).toEqual(['s', 'ə', 'ɹ', 'ɛ', 'n', 'd', 'ɪ', 'p', 'ɪ', 't', 'i']);
    expect(segs.filter((s) => s.kind === 'boundary').map((s) => s.text)).toEqual(['ˈ']);
  });

  it('treats stress marks and syllable dots as boundaries, not phonemes', () => {
    const segs = segmentIpa('/ˈsɛr.ənˌdɪp.ɪ.ti/');
    const boundaries = segs.filter((s) => s.kind === 'boundary');
    expect(boundaries.length).toBeGreaterThan(0);
    expect(boundaries.every((b) => ['ˈ', 'ˌ', '.'].includes(b.text))).toBe(true);
  });

  it('classifies known IPA vowels and consonants correctly', () => {
    const segs = segmentIpa('/kæt/');
    expect(segs.map((s) => ({ text: s.text, kind: s.kind }))).toEqual([
      { text: 'k', kind: 'consonant' },
      { text: 'æ', kind: 'vowel' },
      { text: 't', kind: 'consonant' },
    ]);
  });

  it('attaches a length mark to the preceding base character as one segment', () => {
    const segs = segmentIpa('/biː/');
    const phonemes = segs.filter((s) => s.kind !== 'boundary');
    expect(phonemes.map((s) => s.text)).toEqual(['b', 'iː']);
  });

  it('attaches a tie bar affricate as one segment', () => {
    const segs = segmentIpa('/t͡ʃiz/');
    const phonemes = segs.filter((s) => s.kind !== 'boundary');
    expect(phonemes[0].text).toBe('t͡ʃ');
  });
});
