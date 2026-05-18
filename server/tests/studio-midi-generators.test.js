// Tier-2 contract test — Studio Sprint A #6: MIDI generator macros.
//
// We exercise the deterministic-fallback path explicitly (no brain
// needed). The LLM-routed code path is gated by `requiresLLM: true`
// and is exercised in the dev-server e2e step.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerStudioMidiMacros, { _internal } from "../domains/studio-midi.js";

function makeFakeDb() {
  const dtus = new Map();
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...args) => {
          if (s.startsWith("INSERT INTO dtus")) {
            const [id, title, creator, meta] = args;
            dtus.set(id, { id, kind: "midi_generation", title, creator_id: creator, meta_json: meta });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: () => null,
        all: () => [],
      };
    },
    _tables: { dtus },
  };
}

function makeRegistry() {
  const macros = new Map();
  const register = (domain, name, handler, opts) => {
    macros.set(`${domain}.${name}`, { handler, opts });
  };
  registerStudioMidiMacros(register);
  return macros;
}

const baseCtx = (db) => ({ db, actor: { userId: "u_test" } });

describe("studio.generate_melody (deterministic)", () => {
  it("rejects when no actor is supplied", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_melody").handler({ db: makeFakeDb() }, { deterministic: true });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_actor");
  });

  it("composes a valid melody from default constraints", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    const out = await macros.get("studio.generate_melody").handler(baseCtx(db), { deterministic: true });
    assert.equal(out.ok, true);
    assert.equal(out.meta.generator, "melody");
    assert.ok(out.notes.length > 0);
    for (const n of out.notes) {
      assert.ok(Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127);
      assert.ok(n.duration > 0);
    }
  });

  it("clamps lengthBars to [1, 32]", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_melody").handler(baseCtx(makeFakeDb()), {
      deterministic: true, lengthBars: 999,
    });
    assert.equal(out.ok, true);
    assert.equal(out.meta.constraints.lengthBars, 32);
  });

  it("falls back to 'C' for unknown keys", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_melody").handler(baseCtx(makeFakeDb()), {
      deterministic: true, key: "Hx",
    });
    assert.equal(out.ok, true);
    assert.equal(out.meta.constraints.key, "C");
  });

  it("falls back to 'major' scale for unknown scales", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_melody").handler(baseCtx(makeFakeDb()), {
      deterministic: true, scale: "nonsense_scale",
    });
    assert.equal(out.meta.constraints.scale, "major");
  });

  it("title includes the key and scale", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_melody").handler(baseCtx(makeFakeDb()), {
      deterministic: true, key: "F#", scale: "phrygian",
    });
    assert.match(out.title, /F#/);
    assert.match(out.title, /phrygian/);
  });
});

describe("studio.generate_chord_progression (deterministic)", () => {
  it("composes 3 notes per bar (triad)", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_chord_progression").handler(baseCtx(makeFakeDb()), {
      deterministic: true, lengthBars: 4,
    });
    assert.equal(out.ok, true);
    assert.equal(out.notes.length, 12); // 4 bars * 3 notes
  });

  it("each chord uses the same tick (all voices stack)", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_chord_progression").handler(baseCtx(makeFakeDb()), {
      deterministic: true, lengthBars: 2,
    });
    const ticks = new Set(out.notes.map(n => n.tick));
    assert.equal(ticks.size, 2);
  });

  it("captures voiceLeading in meta constraints", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_chord_progression").handler(baseCtx(makeFakeDb()), {
      deterministic: true, voiceLeading: "melody-led",
    });
    assert.equal(out.meta.constraints.voiceLeading, "melody-led");
  });
});

describe("studio.generate_rhythm (deterministic)", () => {
  it("produces kick + snare + hat MIDI pitches", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_rhythm").handler(baseCtx(makeFakeDb()), {
      deterministic: true, lengthBars: 2,
    });
    assert.equal(out.ok, true);
    const pitches = new Set(out.notes.map(n => n.pitch));
    assert.ok(pitches.has(36), "should have kick (36)");
    assert.ok(pitches.has(38), "should have snare (38)");
    assert.ok(pitches.has(42), "should have closed-hat (42)");
  });

  it("rejects malformed time signature gracefully (uses 4/4 default)", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_rhythm").handler(baseCtx(makeFakeDb()), {
      deterministic: true, timeSignature: "garbage",
    });
    assert.deepEqual(out.meta.constraints.timeSignature, [4, 4]);
  });

  it("clamps swing to [0, 0.6]", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.generate_rhythm").handler(baseCtx(makeFakeDb()), {
      deterministic: true, swing: 99,
    });
    assert.equal(out.meta.constraints.swing, 0.6);
  });
});

describe("internal validators", () => {
  it("validateNoteArray rejects non-arrays", () => {
    assert.equal(_internal.validateNoteArray("nope"), null);
    assert.equal(_internal.validateNoteArray({ tick: 0 }), null);
  });

  it("validateNoteArray filters invalid entries", () => {
    const out = _internal.validateNoteArray([
      { tick: 0, pitch: 60, velocity: 100, duration: 240 },
      { tick: -1, pitch: 60, velocity: 100, duration: 240 },   // bad tick
      { tick: 0, pitch: 200, velocity: 100, duration: 240 },   // pitch oob
      { tick: 0, pitch: 60, velocity: 100, duration: 0 },      // zero duration
    ]);
    assert.equal(out.length, 1);
  });

  it("parseJsonResult unwraps markdown-fenced JSON", () => {
    const r = _internal.parseJsonResult("```json\n[{\"tick\":0,\"pitch\":60,\"velocity\":100,\"duration\":240}]\n```");
    assert.equal(Array.isArray(r), true);
    assert.equal(r[0].pitch, 60);
  });

  it("parseJsonResult extracts JSON from surrounding prose", () => {
    const r = _internal.parseJsonResult("Sure! Here's your pattern:\n[{\"tick\":0,\"pitch\":60,\"velocity\":100,\"duration\":240}]\nLet me know if you need changes.");
    assert.equal(r[0].pitch, 60);
  });

  it("parseJsonResult returns null for non-JSON garbage", () => {
    assert.equal(_internal.parseJsonResult("Hi there friend"), null);
  });
});
