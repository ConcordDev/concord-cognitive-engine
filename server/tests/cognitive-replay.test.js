// server/tests/cognitive-replay.test.js
//
// Cognitive Replay (#3) — a grounded retrospective over REAL recorded
// deliberations (agent_reasoning_traces, mig 327). It reads what actually
// happened; it never fabricates. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { replayForAgent, computeTrend } from "../lib/cognitive-replay.js";
import registerMetacogMacros from "../domains/metacog.js";

function trace(db, agentId, { attended, quale, surprise, awareness, reason, at }) {
  db.prepare(
    `INSERT INTO agent_reasoning_traces (id, agent_id, world_id, attended, quale, surprise, awareness_index, reason, note, created_at)
     VALUES (?, ?, 'w1', ?, ?, ?, ?, ?, 'n', ?)`
  ).run(`tr_${Math.random().toString(36).slice(2)}`, agentId, attended, quale, surprise, awareness, reason, at);
}

describe("Cognitive Replay (#3)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    let t = 1000;
    trace(db, "a1", { attended: "ethics gate", quale: "tension", surprise: 0.2, awareness: 0.3, reason: "dilemma", at: t++ });
    trace(db, "a1", { attended: "ethics gate", quale: "tension", surprise: 0.9, awareness: 0.5, reason: "drive_spike", at: t++ });
    trace(db, "a1", { attended: "resource scarcity", quale: "urgency", surprise: 0.4, awareness: 0.7, reason: "dilemma", at: t++ });
    trace(db, "a1", { attended: "ethics gate", quale: "calm", surprise: 0.1, awareness: 0.8, reason: "dilemma", at: t++ });
    macros = new Map();
    registerMetacogMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("aggregates real traces — totals, reasons, top themes, biggest surprise", () => {
    const r = replayForAgent(db, "a1");
    assert.equal(r.ok, true);
    assert.equal(r.total, 4);
    assert.equal(r.byReason.dilemma, 3);
    assert.equal(r.topAttended[0].theme, "ethics gate", "ethics gate is the recurring focus");
    assert.equal(r.topAttended[0].count, 3);
    assert.equal(r.surpriseMoments[0].surprise, 0.9, "highest prediction-error first");
    assert.ok(r.narrative.includes("deliberation"));
  });

  it("computes a rising awareness trend from the real series", () => {
    const r = replayForAgent(db, "a1");
    assert.equal(r.awarenessTrend, "rising", "0.3→0.8 over the window");
    assert.equal(computeTrend([0.1, 0.2, 0.9]), "rising");
    assert.equal(computeTrend([0.9, 0.5, 0.1]), "falling");
    assert.equal(computeTrend([0.5, 0.5, 0.5]), "flat");
  });

  it("an agent with no traces gets an honest empty replay (not fabricated)", () => {
    const r = replayForAgent(db, "ghost");
    assert.equal(r.ok, true);
    assert.equal(r.total, 0);
    assert.deepEqual(r.topAttended, []);
    assert.equal(r.narrative, "");
  });

  it("metacog.replay macro round-trips", async () => {
    const r = await macros.get("metacog.replay")({ db, actor: { userId: "a1" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.total, 4);
  });
});
