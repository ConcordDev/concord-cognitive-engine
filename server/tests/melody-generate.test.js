// server/tests/melody-generate.test.js
// Q46/A#7 — pins lib/melody-generate.js: deterministic seeded
// composition behind creative.generate {kind:"melody"}.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateMelody, parseMelodyPrompt } from "../lib/melody-generate.js";

describe("melody generation", () => {
  it("honors explicit key and tempo cues from the prompt", () => {
    assert.deepEqual(parseMelodyPrompt("a sad song in A minor at 90 bpm"), { rootPc: 9, mode: "minor", tempoBpm: 90 });
    assert.equal(parseMelodyPrompt("bright in G major").rootPc, 7);
    assert.equal(parseMelodyPrompt("bright in G major").mode, "major");
    assert.equal(parseMelodyPrompt("a dark nocturne").mode, "minor", "mood word nudges minor");
    assert.equal(parseMelodyPrompt("a slow ballad").tempoBpm, 76);
    assert.equal(parseMelodyPrompt("an upbeat fast tune").tempoBpm, 132);
    assert.equal(parseMelodyPrompt("anything").tempoBpm, 100, "default tempo");
  });

  it("produces notes that are all in the stated scale, filling every bar exactly", () => {
    const m = generateMelody({ prompt: "a walk in the park in D major", bars: 4 });
    assert.equal(m.key, "D major");
    const scalePcs = new Set([2, 4, 6, 7, 9, 11, 1]); // D major pitch classes
    for (const n of m.notes) assert.ok(scalePcs.has(n.midi % 12), `${n.name} not in D major`);
    const total = m.notes.reduce((s, n) => s + n.durationBeats, 0);
    assert.equal(total, 16, "4 bars of 4 beats");
    // Beats are contiguous.
    let expect = 0;
    for (const n of m.notes) { assert.equal(n.startBeat, expect); expect += n.durationBeats; }
  });

  it("is deterministic per prompt and varies across prompts", () => {
    const a = generateMelody({ prompt: "rainy window" });
    const b = generateMelody({ prompt: "rainy window" });
    assert.deepEqual(a.notes, b.notes);
    const c = generateMelody({ prompt: "sunny highway" });
    assert.notDeepEqual(c.notes.map((n) => n.midi), a.notes.map((n) => n.midi));
  });

  it("emits ABC notation headed by the key and tempo", () => {
    const m = generateMelody({ prompt: "in A minor, gentle" });
    assert.match(m.notation, /K:Amin/);
    assert.match(m.notation, /Q:1\/4=76/);
    assert.equal(m.notes[0].name, "A4", "opens on the tonic");
    assert.equal(m.notes[m.notes.length - 1].name, "A4", "resolves to the tonic");
  });
});
