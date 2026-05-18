// server/domains/studio-midi.js
//
// Studio Sprint A — Item #6: LLM-backed MIDI generators.
// Three macros that compose constrained MIDI patterns and mint each
// generation as a kind='midi_generation' DTU so the result is
// reusable, citable, and royalty-cascade-eligible.
//
// All three macros share the same shape: validate constraints →
// call subconscious brain with JSON-shape system prompt → parse
// + validate → fall back to deterministic when brain is
// unavailable or returns garbage → mint DTU → return notes.

import crypto from "node:crypto";

const TIMEOUT_MS = 10_000;
const MAX_NOTES_PER_PATTERN = 512;
const KEY_OPTIONS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function keyMidi(key) {
  const i = KEY_OPTIONS.indexOf(String(key || "C"));
  return 60 + (i < 0 ? 0 : i);
}

function validateNote(n) {
  if (!n || typeof n !== "object") return null;
  const tick = Number(n.tick);
  const pitch = Number(n.pitch);
  const velocity = Number(n.velocity);
  const duration = Number(n.duration);
  if (!Number.isFinite(tick) || tick < 0) return null;
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) return null;
  if (!Number.isFinite(velocity) || velocity < 0 || velocity > 127) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return {
    tick: Math.round(tick),
    pitch,
    velocity: Math.round(velocity),
    duration: Math.round(duration),
  };
}

function validateNoteArray(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const n of raw.slice(0, MAX_NOTES_PER_PATTERN)) {
    const v = validateNote(n);
    if (v) out.push(v);
  }
  return out.length > 0 ? out : null;
}

async function callSubconsciousJson(system, prompt) {
  let chat;
  try {
    const router = await import("../lib/brain-router.js");
    if (typeof router.callBrain === "function") {
      chat = (sys, user) => router.callBrain("subconscious", { system: sys, prompt: user });
    }
  } catch { /* router missing */ }
  if (!chat) return null;
  try {
    const timeout = new Promise((_r, reject) => setTimeout(() => reject(new Error("llm_timeout")), TIMEOUT_MS));
    const result = await Promise.race([chat(system, prompt), timeout]);
    const text = typeof result === "string" ? result
      : result?.content || result?.text || result?.message?.content;
    if (typeof text !== "string") return null;
    return parseJsonResult(text);
  } catch {
    return null;
  }
}

function parseJsonResult(text) {
  // Brains love to wrap JSON in prose. Extract the first array or
  // object that parses cleanly.
  const cleaned = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
  }
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
  }
  return null;
}

/* ─── Deterministic fallbacks per generator kind ───────────────── */

function deterministicMelody({ keyRoot, scaleIntervals, lengthBars, density, ticksPerBeat = 480, beatsPerBar = 4 }) {
  const totalTicks = lengthBars * beatsPerBar * ticksPerBeat;
  const notesPerBar = Math.max(2, Math.round(density * 8));
  const out = [];
  // Pseudo-deterministic walk: stay close to the root, weight
  // chord-tones (0, 2, 4 of the scale).
  let cursor = 0;
  const scaleLen = scaleIntervals.length;
  let idx = 0;
  while (cursor < totalTicks && out.length < MAX_NOTES_PER_PATTERN) {
    const interval = scaleIntervals[((idx % scaleLen) + scaleLen) % scaleLen];
    const octave = idx % 7 === 6 ? 1 : 0; // occasional upper-octave lift
    const pitch = clamp(keyRoot + interval + octave * 12, 24, 108);
    const stepTicks = Math.round((beatsPerBar * ticksPerBeat) / notesPerBar);
    out.push({
      tick: cursor,
      pitch,
      velocity: 90,
      duration: Math.round(stepTicks * 0.85),
    });
    cursor += stepTicks;
    // Wander idx by ±2 with seeded bias toward 0/2/4.
    idx += (idx % 3 === 0) ? 2 : ((idx % 2 === 0) ? -1 : 1);
  }
  return out;
}

function deterministicChordProgression({ keyRoot, lengthBars, ticksPerBeat = 480, beatsPerBar = 4 }) {
  // Pop progression: I - V - vi - IV  per bar, looped until we
  // cover lengthBars.
  const pattern = [0, 7, 9, 5];
  const out = [];
  const barTicks = beatsPerBar * ticksPerBeat;
  for (let b = 0; b < lengthBars; b++) {
    const rootOffset = pattern[b % pattern.length];
    const root = keyRoot + rootOffset;
    // Triad: root, 3, 5 (major) — minor would be 0, 3, 7 if degree is min.
    const third = rootOffset === 9 ? 3 : 4;
    const fifth = 7;
    const tick = b * barTicks;
    out.push({ tick, pitch: clamp(root, 24, 108), velocity: 80, duration: barTicks });
    out.push({ tick, pitch: clamp(root + third, 24, 108), velocity: 78, duration: barTicks });
    out.push({ tick, pitch: clamp(root + fifth, 24, 108), velocity: 78, duration: barTicks });
  }
  return out;
}

function deterministicRhythm({ lengthBars, density, swing, timeSig = [4, 4], ticksPerBeat = 480 }) {
  const [beatsPerBar, division] = timeSig;
  void division;
  const totalTicks = lengthBars * beatsPerBar * ticksPerBeat;
  const stepsPerBar = Math.max(4, Math.round(density * 16));
  const stepTicks = Math.round((beatsPerBar * ticksPerBeat) / stepsPerBar);
  // 4-piece kit: kick=36, snare=38, closed-hat=42, open-hat=46.
  const out = [];
  let cursor = 0;
  let stepIdx = 0;
  while (cursor < totalTicks) {
    const beatPos = stepIdx % stepsPerBar;
    // Kick on 1 and the "and of 3" (steps 0 and ~stepsPerBar*0.5).
    if (beatPos === 0 || beatPos === Math.floor(stepsPerBar * 0.5)) {
      out.push({ tick: cursor, pitch: 36, velocity: 110, duration: stepTicks });
    }
    // Snare on 2 and 4 (steps stepsPerBar*0.25, stepsPerBar*0.75).
    if (beatPos === Math.floor(stepsPerBar * 0.25) || beatPos === Math.floor(stepsPerBar * 0.75)) {
      out.push({ tick: cursor, pitch: 38, velocity: 100, duration: stepTicks });
    }
    // Closed hat on every step.
    let hatTick = cursor;
    if (beatPos % 2 === 1 && swing > 0) {
      hatTick += Math.round(stepTicks * swing * 0.5);
    }
    out.push({ tick: hatTick, pitch: 42, velocity: 70, duration: Math.round(stepTicks * 0.5) });
    cursor += stepTicks;
    stepIdx += 1;
    if (out.length >= MAX_NOTES_PER_PATTERN) break;
  }
  return out;
}

/* ─── DTU mint helper ──────────────────────────────────────────── */

function mintGenerationDtu(db, { userId, title, generator, notes, constraints }) {
  if (!db) return { ok: false, reason: "no_db" };
  const id = `mg_${crypto.randomUUID()}`;
  const meta = {
    type: "midi_generation",
    generator,                  // 'melody' | 'chord_progression' | 'rhythm'
    constraints,
    note_count: notes.length,
    notes,
  };
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
      VALUES (?, 'midi_generation', ?, ?, ?, unixepoch())
    `).run(id, title, userId, JSON.stringify(meta));
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
  return { ok: true, dtuId: id, title, notes, meta };
}

/* ─── Macro registrations ─────────────────────────────────────── */

export default function registerStudioMidiMacros(register) {
  // ── melody ──
  register("studio", "generate_melody", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };

    const key = KEY_OPTIONS.includes(input.key) ? input.key : "C";
    const scaleName = SCALES[input.scale] ? input.scale : "major";
    const scaleIntervals = SCALES[scaleName];
    const lengthBars = clamp(parseInt(input.lengthBars) || 4, 1, 32);
    const density = clamp(Number(input.density) || 0.6, 0.1, 1.0);
    const mood = String(input.mood || "neutral").slice(0, 40);
    const ticksPerBeat = clamp(parseInt(input.ticksPerBeat) || 480, 24, 1920);

    const keyRoot = keyMidi(key);
    const constraints = { key, scale: scaleName, lengthBars, density, mood, ticksPerBeat };

    let notes = null;
    if (input.deterministic !== true) {
      const system = `You compose short MIDI melodies. Respond with ONLY a JSON array. Each element: {"tick":int,"pitch":int 0-127,"velocity":int 0-127,"duration":int}. Use ticks where one beat = ${ticksPerBeat}. Stay within the named scale. No commentary, no markdown, just the JSON array.`;
      const prompt = `Compose a ${mood} melody in ${key} ${scaleName} for ${lengthBars} bars. Note density: ${density.toFixed(2)} (0=sparse, 1=busy). Keep pitches between ${keyRoot - 12} and ${keyRoot + 24}. Return the JSON array now.`;
      const raw = await callSubconsciousJson(system, prompt);
      notes = validateNoteArray(raw);
    }
    if (!notes) {
      notes = deterministicMelody({ keyRoot, scaleIntervals, lengthBars, density, ticksPerBeat });
    }

    const title = `Melody in ${key} ${scaleName} (${lengthBars} bars)`;
    return mintGenerationDtu(ctx.db, {
      userId, title, generator: "melody", notes, constraints,
    });
  }, { note: "compose a constrained MIDI melody", requiresLLM: true });

  // ── chord progression ──
  register("studio", "generate_chord_progression", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };

    const key = KEY_OPTIONS.includes(input.key) ? input.key : "C";
    const mood = String(input.mood || "neutral").slice(0, 40);
    const lengthBars = clamp(parseInt(input.lengthBars) || 4, 1, 32);
    const voiceLeading = ["smooth", "melody-led", "bass-led"].includes(input.voiceLeading)
      ? input.voiceLeading : "smooth";
    const ticksPerBeat = clamp(parseInt(input.ticksPerBeat) || 480, 24, 1920);

    const keyRoot = keyMidi(key);
    const constraints = { key, mood, lengthBars, voiceLeading, ticksPerBeat };

    let notes = null;
    if (input.deterministic !== true) {
      const system = `You compose chord progressions as MIDI notes. Respond with ONLY a JSON array of {"tick","pitch","velocity","duration"} objects. Three notes per chord (root/third/fifth). Hold each chord for one bar (${ticksPerBeat * 4} ticks). No commentary.`;
      const prompt = `Compose a ${mood} chord progression in ${key} major, ${lengthBars} bars long. Voice-leading: ${voiceLeading}. Pitches between ${keyRoot - 12} and ${keyRoot + 18}. Return the JSON array now.`;
      const raw = await callSubconsciousJson(system, prompt);
      notes = validateNoteArray(raw);
    }
    if (!notes) {
      notes = deterministicChordProgression({ keyRoot, lengthBars, ticksPerBeat });
    }

    const title = `Chord progression in ${key} (${lengthBars} bars)`;
    return mintGenerationDtu(ctx.db, {
      userId, title, generator: "chord_progression", notes, constraints,
    });
  }, { note: "compose a constrained MIDI chord progression", requiresLLM: true });

  // ── rhythm ──
  register("studio", "generate_rhythm", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };

    const timeSig = Array.isArray(input.timeSignature) && input.timeSignature.length === 2
      ? [clamp(parseInt(input.timeSignature[0]) || 4, 1, 16),
         clamp(parseInt(input.timeSignature[1]) || 4, 1, 16)]
      : [4, 4];
    const density = clamp(Number(input.density) || 0.7, 0.1, 1.0);
    const swing = clamp(Number(input.swing) || 0, 0, 0.6);
    const lengthBars = clamp(parseInt(input.lengthBars) || 4, 1, 32);
    const ticksPerBeat = clamp(parseInt(input.ticksPerBeat) || 480, 24, 1920);
    const genre = String(input.genre || "neutral").slice(0, 40);

    const constraints = { timeSignature: timeSig, density, swing, lengthBars, genre, ticksPerBeat };

    let notes = null;
    if (input.deterministic !== true) {
      const system = `You compose drum patterns as MIDI notes. Respond with ONLY a JSON array of {"tick","pitch","velocity","duration"} objects. Use General MIDI drums: kick=36, snare=38, closed-hat=42, open-hat=46. One bar = ${ticksPerBeat * timeSig[0]} ticks. No commentary.`;
      const prompt = `Compose a ${genre} drum pattern, ${lengthBars} bars long, time signature ${timeSig[0]}/${timeSig[1]}, density ${density.toFixed(2)}, swing ${swing.toFixed(2)}. Return the JSON array now.`;
      const raw = await callSubconsciousJson(system, prompt);
      notes = validateNoteArray(raw);
    }
    if (!notes) {
      notes = deterministicRhythm({ lengthBars, density, swing, timeSig, ticksPerBeat });
    }

    const title = `${genre} rhythm (${lengthBars} bars, ${timeSig.join("/")})`;
    return mintGenerationDtu(ctx.db, {
      userId, title, generator: "rhythm", notes, constraints,
    });
  }, { note: "compose a constrained MIDI drum pattern", requiresLLM: true });
}

// Exported for unit-tests; not part of the public API.
export const _internal = {
  validateNoteArray, parseJsonResult,
  deterministicMelody, deterministicChordProgression, deterministicRhythm,
  SCALES,
};
