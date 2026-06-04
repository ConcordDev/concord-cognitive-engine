// Contract test for Wave 7 / Track D2 — token metering (the cost-story proof).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migSpans } from "../migrations/058_agent_threads.js";
import { recordInferenceSpan, aggregateInferenceCosts } from "../lib/inference-metering.js";

function setupDb() {
  const db = new Database(":memory:");
  // mig 058 needs a couple of preconditions; create inference_spans directly to isolate.
  db.exec(`
    CREATE TABLE inference_spans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, inference_id TEXT NOT NULL, span_type TEXT NOT NULL,
      brain_used TEXT, model_used TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0, step_count INTEGER DEFAULT 0, tool_name TEXT, lens_id TEXT,
      caller_id TEXT, error TEXT, recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test("Track D2 — inference metering", async (t) => {
  await t.test("recordInferenceSpan writes the previously-unwritten table", () => {
    const db = setupDb();
    const r = recordInferenceSpan(db, { spanType: "chat", brainUsed: "conscious", modelUsed: "qwen2.5", tokensIn: 100, tokensOut: 40, latencyMs: 800, callerId: "npc1" });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT * FROM inference_spans`).get();
    assert.equal(row.brain_used, "conscious");
    assert.equal(row.tokens_in, 100);
  });

  await t.test("aggregateInferenceCosts proves the cost story over a window", () => {
    const db = setupDb();
    // a "village": many NPC ticks but only a handful actually hit the LLM
    for (let i = 0; i < 5; i++) recordInferenceSpan(db, { brainUsed: "utility", modelUsed: "qwen2.5:3b", tokensIn: 50, tokensOut: 20, callerId: `npc${i}` });
    recordInferenceSpan(db, { brainUsed: "conscious", modelUsed: "qwen2.5", tokensIn: 200, tokensOut: 80, callerId: "agent" });
    const agg = aggregateInferenceCosts(db, { sinceHours: 24 });
    assert.equal(agg.calls, 6);
    assert.equal(agg.tokensIn, 5 * 50 + 200);
    assert.equal(agg.tokensOut, 5 * 20 + 80);
    assert.ok(agg.byBrain.utility.calls === 5 && agg.byBrain.conscious.calls === 1);
    assert.ok(typeof agg.costLabel === "string");
  });

  await t.test("empty window → zeros, never throws", () => {
    const db = setupDb();
    const agg = aggregateInferenceCosts(db, { sinceHours: 1 });
    assert.equal(agg.calls, 0);
    assert.equal(agg.costUsd, 0);
  });

  await t.test("totality: no db / missing table never throws (metering can't break inference)", () => {
    assert.equal(recordInferenceSpan(null, {}).ok, false);
    assert.doesNotThrow(() => aggregateInferenceCosts(null));
    const bare = new Database(":memory:");
    assert.equal(recordInferenceSpan(bare, { tokensIn: 1 }).ok, false, "missing table → no-op, not a throw");
    assert.deepEqual(aggregateInferenceCosts(bare).calls, 0);
  });
});
