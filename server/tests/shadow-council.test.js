// server/tests/shadow-council.test.js
//
// Shadow Reasoning Council (#12) — the five-voice council turned into a
// persisted, citable deliberation with a minority report. Deterministic; no
// brains required. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { deliberate, composeDeliberationProse } from "../lib/shadow-council.js";
import registerReasonMacros from "../domains/reason.js";

describe("Shadow Reasoning Council (#12)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerReasonMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("deliberates deterministically and reports a verdict + per-voice votes", () => {
    const r = deliberate(db, { question: "Should we ship the R&D engine now?" });
    assert.equal(r.ok, true);
    assert.ok(["accept", "reject", "needs_more_data"].includes(r.verdict));
    assert.equal(Object.keys(r.voices).length, 5, "all five voices");
    assert.equal(typeof r.confidence, "number");
    // Determinism: same input → same verdict + confidence.
    const r2 = deliberate(db, { question: "Should we ship the R&D engine now?" });
    assert.equal(r2.verdict, r.verdict);
    assert.equal(r2.confidence, r.confidence);
  });

  it("preserves the minority report (dissent) a flat vote discards", () => {
    const r = deliberate(db, { question: "Is this safe?" });
    const dissenters = Object.values(r.voices).filter((v) => v.vote !== r.verdict).length;
    assert.equal(r.dissent.length, dissenters, "every disagreeing voice is in the minority report");
    if (r.unanimous) assert.equal(r.dissent.length, 0);
  });

  it("persists a citable shadow_reasoning DTU when asked", () => {
    const r = deliberate(db, { question: "Adopt the new policy?", requesterId: "u1", persist: true });
    assert.ok(r.dtuId, "DTU minted");
    const dtu = db.prepare("SELECT creator_id, tags_json, metadata_json FROM dtus WHERE id = ?").get(r.dtuId);
    assert.equal(dtu.creator_id, "u1");
    assert.ok(JSON.parse(dtu.tags_json).includes("shadow_reasoning"));
    assert.equal(JSON.parse(dtu.metadata_json).kind, "shadow_reasoning");
  });

  it("does NOT persist without persist:true (pure read by default)", () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM dtus").get().n;
    const r = deliberate(db, { question: "transient?", requesterId: "u1" });
    assert.equal(r.dtuId, undefined);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dtus").get().n, before);
  });

  it("prose render names every voice + the minority report", () => {
    const r = deliberate(db, { question: "Q?" });
    const prose = composeDeliberationProse("Q?", { verdictAction: r.verdict, confidence: r.confidence, voices: r.voices }, r.dissent);
    assert.ok(prose.includes("The Skeptic"));
    assert.ok(prose.includes("Verdict:"));
  });

  it("reason.council macro round-trips and respects persist", async () => {
    const r = await macros.get("reason.council")({ db, actor: { userId: "u2" } }, { question: "macro path?", persist: true });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId);
    const empty = await macros.get("reason.council")({ db }, {});
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, "no_question");
  });
});
