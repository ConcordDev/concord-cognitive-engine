// server/tests/agent-runtime-reflection-traces.test.js
// Q48/A#13 — per-entity reflection tracking existed on paper only:
// migration 327's agent_reasoning_traces keys rows by `agent_id`, but
// agent-runtime's readers probed for emergent_id/entity_id/user_id
// (none exist) and always reported "no_entity_column", while the
// heartbeat writer INSERTed a nonexistent entity_id column and
// failed silently on every tick. These tests pin the repaired
// behavior against the real mig-327 schema.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { readReflection, readCognition, rtTick } from "../lib/agent-runtime.js";
import { up } from "../migrations/327_agent_reasoning_traces.js";

let db;
before(() => {
  db = new DatabaseSync(":memory:");
  up(db);
  const ins = db.prepare(`INSERT INTO agent_reasoning_traces
    (id, agent_id, world_id, attended, quale, surprise, awareness_index, reason, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run("t1", "entity-a", "w", "constraint:x", "calm", 0.25, 0.5, "dilemma", "first", 1000);
  ins.run("t2", "entity-a", "w", "spike", "tense", 0.75, 0.7, "drive_spike", "second", 2000);
  ins.run("t3", "entity-b", "w", "other", "calm", 0.1, 0.3, "dilemma", "not yours", 3000);
  globalThis._concordDB = db;
});
after(() => { delete globalThis._concordDB; db?.close(); });

describe("per-entity reflection traces (mig-327 schema)", () => {
  it("readReflection returns only the entity's own traces, newest first", async () => {
    const out = await readReflection("entity-a", {});
    assert.equal(out.reflection.status, "available");
    assert.equal(out.reflection.value.available, true);
    assert.equal(out.reflection.value.count, 2);
    assert.deepEqual(out.reflection.value.recent.map((r) => r.id), ["t2", "t1"]);
  });

  it("readCognition's reflection section summarizes the entity's traces", async () => {
    const out = await readCognition("entity-a", {});
    const refl = out.reflection.value;
    assert.equal(refl.available, true);
    assert.equal(refl.tracking, "agent_reasoning_traces");
    assert.equal(refl.trace_count, 2);
    assert.deepEqual(refl.by_reason, { dilemma: 1, drive_spike: 1 });
    assert.equal(refl.avg_surprise, 0.5);
    assert.equal(refl.avg_awareness_index, 0.6);
    assert.equal(refl.latest.id, "t2");
    // And the raw reasoning-traces section agrees.
    assert.equal(out.reasoning_traces.value.available, true);
    assert.equal(out.reasoning_traces.value.count, 2);
  });

  it("an entity with no traces reads as available with zero, not an error", async () => {
    const out = await readReflection("entity-none", {});
    assert.equal(out.reflection.value.available, true);
    assert.equal(out.reflection.value.count, 0);
  });

  it("the heartbeat writer's column list is valid against the mig-327 schema", () => {
    // Execute the writer's exact INSERT shape (agent_id only).
    db.prepare(`INSERT INTO agent_reasoning_traces
      (id, agent_id, quale, awareness_index, reason, note, world_id, attended, surprise, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "t-hb", "entity-a", "neutral", 0.4, "tick_heartbeat", "{}", "agent_runtime", "heartbeat[0hooks]", 0, 4000);
    const rows = db.prepare("SELECT id FROM agent_reasoning_traces WHERE agent_id = ? AND reason = 'tick_heartbeat'").all("entity-a");
    assert.equal(rows.length, 1);
    // And the retention delete's agent_id predicate works too.
    db.prepare("DELETE FROM agent_reasoning_traces WHERE agent_id = ? AND reason = 'tick_heartbeat' AND created_at < ?").run("entity-a", 5000);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_reasoning_traces WHERE reason = 'tick_heartbeat'").get().n, 0);
  });

  it("source: the runtime no longer references a phantom entity_id column for this table", () => {
    const src = fs.readFileSync(new URL("../lib/agent-runtime.js", import.meta.url), "utf8");
    assert.ok(!src.includes("agent_id, entity_id"), "heartbeat INSERT must not name entity_id");
    assert.ok(!src.includes("WHERE entity_id = ? AND reason = 'tick_heartbeat'"), "retention must key by agent_id");
    assert.ok(!src.includes("Per-entity tracking not implemented"), "the punt note is gone");
  });

  it("heartbeat traces are stored in SECONDS so real deliberation traces still sort first (and retention uses seconds)", async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const eightDaysAgoS = nowS - 8 * 86400;
    const ins = db.prepare(`INSERT INTO agent_reasoning_traces
      (id, agent_id, world_id, attended, quale, surprise, awareness_index, reason, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.exec("CREATE TABLE IF NOT EXISTS entity_tick_history (entity_id TEXT, tick_at INTEGER, hooks_fired INTEGER, drives_json TEXT, fingerprint_total_queries INTEGER, affect_state_json TEXT)");
    ins.run("old-hb", "entity-hb", "agent_runtime", "heartbeat[0hooks]", "neutral", 0, 0.1, "tick_heartbeat", "{}", eightDaysAgoS);
    await rtTick("entity-hb", { pruneProbability: 1 });
    const hb = db.prepare("SELECT created_at FROM agent_reasoning_traces WHERE agent_id = ? AND reason = 'tick_heartbeat' AND id != 'old-hb'").all("entity-hb");
    assert.equal(hb.length, 1, "the tick persisted exactly one heartbeat trace");
    assert.ok(hb[0].created_at < 1e11, "created_at is seconds, not milliseconds: " + hb[0].created_at);
    assert.ok(Math.abs(hb[0].created_at - nowS) < 60);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_reasoning_traces WHERE id = 'old-hb'").get().n, 0, "the 8-day-old heartbeat was pruned");
    // A deliberation trace written (seconds, as awareness-loop does) just after the heartbeat sorts above it.
    ins.run("real-1", "entity-hb", "w", "x", "calm", 0.2, 0.5, "dilemma", "real", nowS + 1);
    const out = await readReflection("entity-hb", {});
    assert.equal(out.reflection.value.recent[0].id, "real-1");
  });
});
