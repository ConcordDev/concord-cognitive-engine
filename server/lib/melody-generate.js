// server/lib/melody-generate.js
//
// Deterministic melody generation for creative.generate {kind:"melody"}
// (Q46/A#7). No LLM and no audio synthesis: a seeded algorithmic
// composition — the prompt seeds a PRNG (same prompt → same melody),
// light prompt cues pick the key/tempo (an explicit "in A minor",
// "120 bpm"; mood words nudge mode/tempo), and a scale-degree random
// walk with phrase anchors writes the line. Output is structured
// notes (MIDI + names + beat positions) plus an ABC-notation string,
// so callers can render, play, or edit it downstream.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};
const ROOT_PC = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };

function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseMelodyPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  let mode = null;
  let rootPc = null;
  const keyMatch = text.match(/\b([a-g](?:#|b)?)\s*(major|minor)\b/) || text.match(/\bin\s+([a-g](?:#|b)?)\b/);
  if (keyMatch) {
    rootPc = ROOT_PC[keyMatch[1]] ?? null;
    if (keyMatch[2]) mode = keyMatch[2];
  }
  if (mode === null) {
    if (/\b(minor|dark|melanchol|sad|somber|moody|noir)\b/.test(text)) mode = "minor";
    else mode = "major";
  }
  if (rootPc === null) rootPc = 0; // C
  let tempoBpm = 100;
  const bpmMatch = text.match(/(\d{2,3})\s*bpm/);
  if (bpmMatch) tempoBpm = Math.min(200, Math.max(40, parseInt(bpmMatch[1], 10)));
  else if (/\b(slow|ballad|gentle|calm)\b/.test(text)) tempoBpm = 76;
  else if (/\b(fast|upbeat|driving|energetic)\b/.test(text)) tempoBpm = 132;
  return { rootPc, mode, tempoBpm };
}

const midiName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
// ABC pitch: middle C (MIDI 60) = C; lowercase = +1 octave; , suffix = -1.
function abcPitch(midi) {
  const name = NOTE_NAMES[midi % 12];
  const letter = name[0];
  const acc = name.includes("#") ? "^" : "";
  const octave = Math.floor(midi / 12) - 1; // 4 = middle-C octave in MIDI terms
  if (octave >= 5) return acc + letter.toLowerCase() + "'".repeat(octave - 5);
  if (octave === 4) return acc + letter;
  return acc + letter + ",".repeat(4 - octave);
}
const abcDur = (beats) => (beats === 1 ? "" : beats === 0.5 ? "/2" : beats === 2 ? "2" : beats === 1.5 ? "3/2" : String(beats));

/**
 * Generate a melody for a prompt. Deterministic: identical prompts
 * produce identical output. `bars` defaults to 4 (16 quarter beats).
 */
export function generateMelody({ prompt, bars = 4 } = {}) {
  const text = String(prompt || "").trim();
  const { rootPc, mode, tempoBpm } = parseMelodyPrompt(text);
  const scale = SCALES[mode];
  const rand = mulberry32(fnv1a(text || "melody"));
  const barCount = Math.min(16, Math.max(1, Math.round(Number(bars) || 4)));
  const tonicMidi = 60 + rootPc; // root at middle-C octave

  // Rhythm: per bar, a pattern of note durations summing to 4 beats.
  const RHYTHMS = [
    [1, 1, 1, 1],
    [1, 0.5, 0.5, 1, 1],
    [2, 1, 1],
    [1, 1, 2],
    [0.5, 0.5, 1, 1, 1],
    [1.5, 0.5, 2],
    [2, 2],
    [1, 1, 0.5, 0.5, 1],
  ];

  const notes = [];
  let degree = 0; // scale-degree index into an extended range (can exceed one octave)
  const degreeToMidi = (deg) => {
    const oct = Math.floor(deg / 7);
    const idx = ((deg % 7) + 7) % 7;
    return tonicMidi + oct * 12 + scale[idx];
  };

  let beat = 0;
  for (let bar = 0; bar < barCount; bar++) {
    const rhythm = RHYTHMS[Math.floor(rand() * RHYTHMS.length)];
    for (let i = 0; i < rhythm.length; i++) {
      const isBarStart = i === 0;
      const isLastNote = bar === barCount - 1 && i === rhythm.length - 1;
      const isPhraseEnd = i === rhythm.length - 1 && !isLastNote;
      if (isLastNote) degree = 0; // final note: tonic
      else if (bar === 0 && isBarStart) degree = 0; // open on the tonic
      else if (isPhraseEnd) degree = rand() < 0.5 ? 0 : 4; // phrase cadence: tonic or dominant
      else {
        // Random walk: mostly stepwise, occasional leap, gentle pull
        // back toward the tonic register when far out.
        const roll = rand();
        let step = 0;
        if (roll < 0.45) step = rand() < 0.5 ? -1 : 1;
        else if (roll < 0.75) step = rand() < 0.5 ? -2 : 2;
        else if (roll < 0.9) step = 0;
        else step = rand() < 0.5 ? -4 : 3;
        degree += step;
        if (degree > 9) degree -= 2;
        if (degree < -2) degree += 2;
      }
      const midi = degreeToMidi(degree);
      notes.push({
        midi,
        name: midiName(midi),
        degree: ((degree % 7) + 7) % 7 + 1,
        startBeat: beat,
        durationBeats: rhythm[i],
      });
      beat += rhythm[i];
    }
  }

  const abcBody = notes.map((n) => abcPitch(n.midi) + abcDur(n.durationBeats)).join(" ");
  const keyName = `${NOTE_NAMES[rootPc]} ${mode}`;
  return {
    kind: "melody",
    prompt: text,
    key: keyName,
    mode,
    tempoBpm,
    bars: barCount,
    beatsPerBar: 4,
    noteCount: notes.length,
    notes,
    melody: notes.map((n) => n.name).join(" "),
    notation: `X:1\nT:${text.slice(0, 60) || "Generated melody"}\nM:4/4\nL:1/4\nQ:1/4=${tempoBpm}\nK:${NOTE_NAMES[rootPc]}${mode === "minor" ? "min" : ""}\n${abcBody}`,
    generator: "deterministic-seeded-composition (no LLM)",
  };
}
