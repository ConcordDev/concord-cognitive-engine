// server/tests/conkay-affect.test.js
//
// ConKay Voice + Affect fusion (#15) — real lexicon VAD, persistent EMA-blended
// state, and a real prosody mapping. Deterministic → exact oracles; every value
// traces to analyzed input. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { analyzeAffect, observeTurn, getAffectState, prosodyParams, affectNote } from "../lib/conkay-affect.js";
import registerConkayMacros from "../domains/conkay.js";

describe("ConKay Voice + Affect fusion (#15)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerConkayMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("real VAD: positive text reads high valence, angry text high arousal", () => {
    const happy = analyzeAffect("this is wonderful, I love it, amazing");
    assert.ok(happy.valence > 0.7, "positive valence");
    const mad = analyzeAffect("I am furious and angry, this is awful");
    assert.ok(mad.arousal > 0.6 && mad.valence < 0.3, "angry: high arousal, low valence");
    // negation flips valence
    const neg = analyzeAffect("not good");
    assert.ok(neg.valence < 0.5, "negation handled");
  });

  it("affect state persists and blends across turns (mood carries, then fades)", () => {
    observeTurn(db, "u1", "this is wonderful and amazing");
    const s1 = getAffectState(db, "u1");
    assert.ok(s1.valence > 0.5, "moved positive");
    assert.equal(s1.turns, 1);
    // A neutral turn doesn't snap mood back to 0.5 instantly (it carries).
    observeTurn(db, "u1", "the table has four legs");
    const s2 = getAffectState(db, "u1");
    assert.ok(s2.valence > 0.5, "mood carries across a neutral turn");
    assert.ok(s2.valence <= s1.valence, "but eases toward neutral");
    assert.equal(s2.turns, 2);
  });

  it("prosody maps affect to valid ElevenLabs params", () => {
    const calm = prosodyParams({ valence: 0.5, arousal: 0.1, dominance: 0.5 });
    const excited = prosodyParams({ valence: 0.9, arousal: 0.9, dominance: 0.7 });
    assert.ok(excited.stability < calm.stability, "high arousal → less stable (more expressive)");
    assert.ok(excited.style > calm.style, "strong affect → more style");
    for (const p of [calm, excited]) {
      for (const k of ["stability", "similarity_boost", "style"]) {
        assert.ok(p[k] >= 0 && p[k] <= 1, `${k} in range`);
      }
    }
  });

  it("the persona note reflects the real state quadrant", () => {
    assert.ok(affectNote({ valence: 0.9, arousal: 0.9 }).includes("upbeat"));
    assert.ok(affectNote({ valence: 0.1, arousal: 0.1 }).includes("subdued"));
  });

  it("conkay macros round-trip", async () => {
    const obs = await macros.get("conkay.observe")({ db, actor: { userId: "u2" } }, { text: "I am so excited and happy" });
    assert.equal(obs.ok, true);
    assert.ok(obs.state.valence > 0.5);
    assert.ok(obs.prosody.stability >= 0 && obs.prosody.stability <= 1);
    const st = await macros.get("conkay.affect_state")({ db, actor: { userId: "u2" } }, {});
    assert.equal(st.state.turns, 1);
    const an = await macros.get("conkay.analyze")({}, { text: "terrible and awful" });
    assert.ok(an.vad.valence < 0.3);
  });
});
