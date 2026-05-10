// server/lib/sonic-glyph.js
//
// Phase 9.3 (idea #18) — Glyph spell composition as music.
//
// Each base-6 glyph maps to a frequency. Composed spell → chord
// progression. Returns a Web Audio API-compatible note schedule
// the frontend can play via OscillatorNode + scheduled gain envelopes.
//
// Mapping: base-6 numerical layer (0..5) → octave-aligned scale degree
// in C minor (C, D, Eb, F, G, Ab → digits 0..5). Higher glyph layers
// shift octave. Composition order = chord progression order.

const C_MINOR_BASE = [
  // octave 4
  261.63, // C4 (digit 0)
  293.66, // D4 (digit 1)
  311.13, // Eb4 (digit 2)
  349.23, // F4 (digit 3)
  392.00, // G4 (digit 4)
  415.30, // Ab4 (digit 5)
];

function freqForGlyph(numericalGlyph) {
  if (typeof numericalGlyph !== "string" && typeof numericalGlyph !== "number") return null;
  const s = String(numericalGlyph);
  // Take last digit as scale degree (0..5).
  const deg = parseInt(s.slice(-1), 6);
  if (isNaN(deg)) return null;
  // Other digits = octave layers; sum and modulate.
  let octaveShift = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const d = parseInt(s[i], 6);
    if (!isNaN(d)) octaveShift += Math.floor(d / 2);
  }
  const baseFreq = C_MINOR_BASE[deg] || C_MINOR_BASE[0];
  return baseFreq * Math.pow(2, Math.min(2, octaveShift));
}

export function spellToChord(components = []) {
  if (!Array.isArray(components) || components.length === 0) return { ok: false, reason: "no_components" };

  // Each component contributes a note. Chord = stacked frequencies.
  const notes = [];
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    const glyph = c.numericalGlyph || c.numerical || c.glyph || c.id;
    const freq = freqForGlyph(glyph);
    if (freq == null) continue;
    notes.push({
      freq,
      glyph,
      element: c.element || "physical",
      duration_ms: 600 + (i * 80),
      velocity: 0.6,
      offset_ms: i * 120,
    });
  }
  if (notes.length === 0) return { ok: false, reason: "no_valid_glyphs" };

  // Total duration is the longest note's offset + duration.
  const totalDuration = Math.max(...notes.map(n => n.offset_ms + n.duration_ms));
  return {
    ok: true,
    notes,
    durationMs: totalDuration,
    voicing: "stacked",
    waveform: "sine",
    envelope: { attack_ms: 50, decay_ms: 200, sustain: 0.4, release_ms: 400 },
  };
}

export function spellSummary(components = []) {
  const chord = spellToChord(components);
  if (!chord.ok) return { ok: false, reason: chord.reason };
  return {
    ok: true,
    note_count: chord.notes.length,
    duration_ms: chord.durationMs,
    dominant_freq: chord.notes[0]?.freq,
    chord,
  };
}
