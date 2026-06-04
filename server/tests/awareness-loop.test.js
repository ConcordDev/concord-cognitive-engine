// Contract test for Wave 7 / Track B6 — the awareness loop (Tier-3 quality cycle).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migTraces } from "../migrations/327_agent_reasoning_traces.js";
import { runAwarenessLoop, predictionError, readInteroception } from "../lib/awareness-loop.js";

function setupDb() {
  const db = new Database(":memory:");
  migTraces(db);
  return db;
}

test("Track B6 — awareness loop", async (t) => {
  await t.test("disabled by default → no-op", () => {
    const prev = process.env.CONCORD_AWARENESS_LOOP;
    delete process.env.CONCORD_AWARENESS_LOOP;
    const r = runAwarenessLoop({ self: { affect: { v: -0.5, a: 0.8 } } });
    assert.equal(r.ran, false);
    assert.equal(r.reason, "disabled");
    if (prev !== undefined) process.env.CONCORD_AWARENESS_LOOP = prev;
  });

  await t.test("a tier-3 wake runs the cycle once + writes a trace + self-model update + prediction-error", () => {
    const db = setupDb();
    const r = runAwarenessLoop({
      force: true,
      agentId: "agent_x",
      self: { worldId: "w", affect: { v: -0.6, a: 0.85 }, drives: { FEAR: 0.8 }, goal: { resource: "shelter" } },
      prior: { affect: { v: 0.1, a: 0.2 }, drives: { FEAR: 0.2 } },
      experience: { kind: "predator" },
      system: { llmQueueDepth: 200, memPressure: 0.4 },
      prediction: { confidence: 0.8 },
      actual: { realised: false }, // confident + wrong → strong surprise
      db,
    });
    assert.equal(r.ran, true);
    assert.ok(r.trace, "a trace was produced");
    assert.ok(r.selfModelUpdate?.quale, "the self-model read a quale");
    assert.ok(r.surprise > 0, "a confident-wrong prediction yields surprise");
    assert.ok(r.awarenessIndex > 0, "the awareness correlate is computed");
    // persisted to the durable journal
    const row = db.prepare(`SELECT * FROM agent_reasoning_traces WHERE agent_id = 'agent_x'`).get();
    assert.ok(row, "the deliberation persisted across the (would-be) restart");
    assert.ok(row.note && row.note.length > 0);
  });

  await t.test("B6 gap 4 — fires the previously-dead self-model hooks into the qualia engine", () => {
    // stub the global qualia engine the existential hooks write to
    const channelUpdates = {};
    globalThis.qualiaEngine = { batchUpdate: (_id, updates) => Object.assign(channelUpdates, updates) };
    try {
      runAwarenessLoop({
        force: true, agentId: "agent_h",
        self: { affect: { v: -0.5, a: 0.8 }, drives: { FEAR: 0.7 } },
        prior: { affect: { v: 0.1, a: 0.2 }, drives: { FEAR: 0.2 } },
        experience: { kind: "predator" },
        prediction: { confidence: 0.9 }, actual: { realised: false }, // confident + wrong
      });
      // the reflection + metacognition channels actually moved (no longer zero-call-site)
      assert.ok("reflection_os.alignment_with_core_principles" in channelUpdates, "reflection_os updated");
      assert.ok("meta_growth_os.gap_severity" in channelUpdates || "truth_os.uncertainty_score" in channelUpdates, "metacognition updated");
    } finally {
      delete globalThis.qualiaEngine;
    }
  });

  await t.test("never throws on garbage input", () => {
    assert.doesNotThrow(() => runAwarenessLoop({ force: true, self: null }));
    const r = runAwarenessLoop({ force: true, self: null });
    assert.equal(r.ok, true);
  });

  await t.test("predictionError: confident + wrong scores high; calibrated scores low", () => {
    const wrong = predictionError({ confidence: 0.9 }, { realised: false });
    const right = predictionError({ confidence: 0.9 }, { realised: true });
    assert.ok(wrong.surprise > right.surprise);
    assert.equal(wrong.confident_and_wrong, true);
    assert.equal(predictionError(null, null), null);
  });

  await t.test("interoception rises with system strain (the agent's own body)", () => {
    const calm = readInteroception({ llmQueueDepth: 0, memPressure: 0 });
    const strained = readInteroception({ llmQueueDepth: 900, memPressure: 0.9, taskBacklog: 80 });
    assert.ok(strained > calm);
    assert.ok(strained <= 1 && calm >= 0);
  });
});
