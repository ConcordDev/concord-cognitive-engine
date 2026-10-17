// server/tests/studio-compose.test.js
//
// studio.compose deterministic song generation and project persistence.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerStudioActions from "../domains/studio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`studio.${name}`);
  if (!fn) throw new Error(`studio.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerStudioActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u_compose" }, userId: "u_compose" };

function scaleSemitones(scale) {
  return scale === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
}

function isInScale(pitch, rootSemi, scale) {
  const semi = pitch % 12;
  const intervals = scaleSemitones(scale);
  return intervals.includes((semi - rootSemi + 12) % 12);
}

function rootSemitone(key) {
  const table = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
  return table[key] ?? 0;
}

describe("studio.compose", () => {
  it("creates a deterministic song for the same seed", () => {
    const a = call("compose", ctxA, { title: "Seed Test", genre: "lofi", seed: 42, bars: 4 });
    const b = call("compose", ctxA, { title: "Seed Test", genre: "lofi", seed: 42, bars: 4 });
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(b.ok, true);
    assert.equal(JSON.stringify(a.result.song.tracks), JSON.stringify(b.result.song.tracks));
    assert.equal(a.result.project.id, a.result.project.id);
    assert.notEqual(a.result.project.id, b.result.project.id); // projects are different
  });

  it("differs for different seeds", () => {
    const a = call("compose", ctxA, { title: "Seed A", genre: "lofi", seed: 1, bars: 4 });
    const b = call("compose", ctxA, { title: "Seed B", genre: "lofi", seed: 2, bars: 4 });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.notEqual(
      JSON.stringify(a.result.song.tracks.find(t => t.role === "melody")?.notes),
      JSON.stringify(b.result.song.tracks.find(t => t.role === "melody")?.notes),
    );
  });

  it("persists a project with daw tracks/clips/notes", () => {
    const r = call("compose", ctxA, { title: "Persist", genre: "pop", bars: 4 });
    assert.equal(r.ok, true);
    const projectId = r.result.project.id;
    const stored = call("project-get", ctxA, { id: projectId });
    assert.equal(stored.ok, true);
    const daw = stored.result.project.daw;
    assert.ok(daw, "daw snapshot stored");
    assert.equal(daw.tracks.length, 3, "chords/bass/melody tracks");
    for (const track of daw.tracks) {
      assert.ok(Array.isArray(track.clips) && track.clips.length > 0, `${track.name} has clips`);
      assert.ok(Array.isArray(track.clips[0].midiNotes) && track.clips[0].midiNotes.length > 0, `${track.name} has notes`);
      assert.ok(track.instrumentId, `${track.name} has instrument`);
    }
    assert.ok(daw.synthPresets && daw.synthPresets["pad-warm"], "pad preset stored");
    assert.ok(daw.synthPresets["sub-bass"], "bass preset stored");
    assert.ok(daw.synthPresets["saw-lead"], "lead preset stored");
  });

  it("clamps bpm and bars", () => {
    const r = call("compose", ctxA, { title: "Clamp", genre: "lofi", bpm: 500, bars: 32 });
    assert.equal(r.ok, true);
    assert.equal(r.result.song.bpm, 180);
    assert.equal(r.result.song.bars, 16);
  });

  it("computes durationSec correctly", () => {
    const r = call("compose", ctxA, { title: "Dur", genre: "lofi", bpm: 60, bars: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.song.durationSec, 16);
  });

  it("keeps notes within MIDI range and inside the scale", () => {
    const r = call("compose", ctxA, { title: "Range", genre: "jazz", key: "F#", scale: "major", bars: 8 });
    assert.equal(r.ok, true);
    const rootSemi = rootSemitone("F#");
    for (const track of r.result.song.tracks) {
      for (const note of track.notes) {
        assert.ok(note.pitch >= 0 && note.pitch <= 127, `pitch ${note.pitch} in MIDI range`);
        if (track.role !== "bass") {
          assert.ok(isInScale(note.pitch, rootSemi, "major"), `pitch ${note.pitch} in F# major`);
        }
      }
    }
  });

  it("returns a project summary with id/name/bpm/key", () => {
    const r = call("compose", ctxA, { title: "Summary", genre: "edm", key: "C", scale: "minor", bpm: 128, bars: 8 });
    assert.equal(r.ok, true);
    assert.ok(r.result.project.id);
    assert.equal(r.result.project.name, "Summary");
    assert.equal(r.result.project.bpm, 128);
    assert.equal(r.result.project.key, "C");
  });

  it("uses per-genre defaults when inputs omitted", () => {
    const r = call("compose", ctxA, { title: "Defaults" });
    assert.equal(r.ok, true);
    assert.equal(r.result.song.genre, "lofi");
    assert.equal(r.result.song.bpm, 85);
    assert.equal(r.result.song.key, "C");
    assert.equal(r.result.song.scale, "major");
    assert.equal(r.result.song.bars, 8);
  });

  it("rejects unknown key or scale", () => {
    assert.equal(call("compose", ctxA, { title: "Bad Key", key: "H#" }).ok, false);
    assert.equal(call("compose", ctxA, { title: "Bad Scale", scale: "dorian" }).ok, false);
  });

  it("melody resolves to the tonic on the last bar", () => {
    const r = call("compose", ctxA, { title: "Resolve", genre: "lofi", key: "C", scale: "major", bars: 4, seed: 123 });
    assert.equal(r.ok, true);
    const melody = r.result.song.tracks.find(t => t.role === "melody")?.notes || [];
    const lastNote = melody[melody.length - 1];
    assert.ok(lastNote, "melody has notes");
    assert.equal(lastNote.pitch % 12, rootSemitone("C"), "last note is tonic C");
  });
});

describe("studio.compose key parsing (INC-127 review)", () => {
  for (const [input, key, scale] of [["Am", "A", "minor"], ["E minor", "E", "minor"], ["c#", "C#", "major"], ["F# major", "F#", "major"], ["Eb", "Eb", "major"], ["B♭m", "Bb", "minor"]]) {
    it(`accepts key "${input}"`, () => {
      const r = call("compose", ctxA, { genre: "lofi", key: input, scale: "major", seed: 1, bars: 4 });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.result.song.key, key);
      assert.equal(r.result.song.scale, scale);
    });
  }
  it("rejects nonsense keys with a helpful error", () => {
    const r = call("compose", ctxA, { genre: "lofi", key: "H minor" });
    assert.equal(r.ok, false);
    assert.match(r.error, /key not recognized/);
  });
  it("persists the DAW snapshot so Studio can reopen it via project-get", () => {
    const r = call("compose", ctxA, { title: "Reopen Me", genre: "lofi", seed: 3 });
    const g = call("project-get", ctxA, { id: r.result.project.id });
    assert.equal(g.ok, true, JSON.stringify(g));
    const daw = g.result.project.daw;
    assert.ok(daw && Array.isArray(daw.tracks) && daw.tracks.length >= 3);
    assert.ok(daw.tracks.some((t) => t.clips?.some((c) => (c.midiNotes || []).length > 0)));
  });
});
