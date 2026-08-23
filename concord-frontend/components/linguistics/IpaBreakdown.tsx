'use client';

/**
 * IpaBreakdown — a real phoneme-by-phoneme visualization of an IPA
 * transcription string. Segmentation and vowel/consonant classification use
 * the actual IPA chart's own character inventory (fixed linguistic fact,
 * not a guess or a model call) — a base letter followed by any combining
 * diacritics/length marks/aspiration/palatalization/tie-bar continuations
 * forms one phoneme "segment"; stress marks (ˈ ˌ) and the syllable-break
 * dot render as boundary markers between segments, not as phonemes
 * themselves.
 */

// The IPA vowel inventory (per the official IPA chart) — used only to color
// a segment as vowel vs consonant. Anything not in this set that isn't a
// diacritic/boundary is treated as a consonant.
const IPA_VOWELS = new Set([
  'i', 'y', 'ɨ', 'ʉ', 'ɯ', 'u', 'ɪ', 'ʏ', 'ʊ',
  'e', 'ø', 'ɘ', 'ɵ', 'ɤ', 'o', 'ə', 'ɛ', 'œ', 'ɜ', 'ɞ', 'ʌ', 'ɔ',
  'æ', 'ɐ', 'a', 'ɶ', 'ɑ', 'ɒ',
]);

// Combining diacritics + suprasegmental modifiers that attach to the
// PRECEDING base character rather than starting a new segment: length
// mark, nasalization, aspiration, palatalization/labialization/velarization
// superscripts, syllabicity, and the tie bar used for affricates/co-articulated
// segments (t͡ʃ, k͡p).
const IPA_MODIFIERS = new Set([
  'ː', 'ˑ', '̃', 'ʰ', 'ʲ', 'ʷ', 'ˠ', 'ˤ', '̥', '̬', '̩', '̯', '͡', '͜', '̪', '̺', '̻',
]);

// Boundary markers — real IPA prosodic notation, rendered as separators
// between phoneme chips rather than as a phoneme.
const IPA_BOUNDARIES = new Set(['ˈ', 'ˌ', '.', '‿', '|', '‖']);

interface IpaSegment {
  text: string;
  kind: 'vowel' | 'consonant' | 'boundary';
}

export function segmentIpa(raw: string): IpaSegment[] {
  // Strip the conventional phonemic/phonetic transcription delimiters —
  // shown separately as a badge, not as part of any phoneme.
  const stripped = raw.trim().replace(/^[/[]/, '').replace(/[/\]]$/, '');
  const segments: IpaSegment[] = [];
  // Set when the tie bar (͡ / ͜) was just appended — the tie bar joins TWO
  // base characters into one affricate/co-articulated unit (t͡ʃ, k͡p), so the
  // NEXT base character must also fold into the current segment rather than
  // starting a new one.
  let expectTieContinuation = false;
  for (const ch of Array.from(stripped)) {
    if (IPA_BOUNDARIES.has(ch)) {
      segments.push({ text: ch, kind: 'boundary' });
      expectTieContinuation = false;
      continue;
    }
    const last = segments.length > 0 ? segments[segments.length - 1] : null;
    if (expectTieContinuation && last && last.kind !== 'boundary') {
      segments[segments.length - 1] = { ...last, text: last.text + ch };
      expectTieContinuation = false;
      continue;
    }
    if (IPA_MODIFIERS.has(ch) && last && last.kind !== 'boundary') {
      segments[segments.length - 1] = { ...last, text: last.text + ch };
      if (ch === '͡' || ch === '͜') expectTieContinuation = true;
      continue;
    }
    segments.push({ text: ch, kind: IPA_VOWELS.has(ch) ? 'vowel' : 'consonant' });
  }
  return segments;
}

export function IpaBreakdown({ ipa }: { ipa: string }) {
  const delimiter = ipa.trim().startsWith('/') ? 'phonemic (/…/ — abstract, contrastive)'
    : ipa.trim().startsWith('[') ? 'phonetic ([…] — precise, physically realized)'
    : null;
  const segments = segmentIpa(ipa);
  const phonemeCount = segments.filter((s) => s.kind !== 'boundary').length;

  return (
    <div className="space-y-1.5">
      {delimiter && <p className="text-[10px] text-gray-500">{delimiter}</p>}
      <div className="flex flex-wrap items-center gap-1" role="list" aria-label="IPA phoneme breakdown">
        {segments.map((s, i) =>
          s.kind === 'boundary' ? (
            <span key={i} className="text-gray-600 text-sm px-0.5" aria-hidden="true">
              {s.text === '.' ? '·' : s.text}
            </span>
          ) : (
            <span
              key={i}
              role="listitem"
              title={s.kind === 'vowel' ? 'vowel' : 'consonant'}
              className={`inline-flex items-center justify-center min-w-[1.6rem] px-1.5 py-0.5 rounded font-mono text-sm border ${
                s.kind === 'vowel'
                  ? 'bg-rose-400/10 border-rose-400/30 text-rose-300'
                  : 'bg-cyan-400/10 border-cyan-400/30 text-cyan-300'
              }`}
            >
              {s.text}
            </span>
          ),
        )}
      </div>
      <p className="text-[10px] text-gray-500">
        {phonemeCount} phoneme{phonemeCount === 1 ? '' : 's'} ·{' '}
        <span className="text-rose-300">vowel</span> / <span className="text-cyan-300">consonant</span>
      </p>
    </div>
  );
}

export default IpaBreakdown;
