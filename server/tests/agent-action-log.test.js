/**
 * Phase 6 Tier 1 contract tests — agent long-term memory.
 *
 * Pins: actions persist; retrieval ranks by relevance × recency (embedding cosine
 * when available, keyword fallback offline); per-user isolation; cross-"restart"
 * recall (a fresh handle to the same DB still sees prior actions); never throws.
 * Embeddings are injected so the test is deterministic + fully offline.
 *
 * Run: node --test server/tests/agent-action-log.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate334 } from "../migrations/334_agent_action_log.js";
import { recordAction, getRecentActions, formatActionContext } from "../lib/agent-action-log.js";

// A toy deterministic "embedding": bag-of-words over a tiny vocabulary, so cosine
// similarity is meaningful without any model.
const VOCAB = ["build", "function", "calendar", "event", "math", "solve", "deploy", "connector"];
function toyEmbed(text) {
  const t = String(text || "").toLowerCase();
  const v = new Float32Array(VOCAB.length);
  VOCAB.forEach((w, i) => { v[i] = t.includes(w) ? 1 : 0; });
  return v;
}

function freshDb() {
  const db = new Database(":memory:");
  migrate334(db);
  return db;
}

describe("agent_action_log persistence", () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { db.close(); });

  it("records an action and reads it back (no query → most recent)", async () => {
    const ok = await recordAction(db, { userId: "u1", action: "code.build", input: { request: "add two numbers" }, output: "done", tool: "code.build", outcome: "ok" }, { embedImpl: toyEmbed });
    assert.equal(ok, true);
    const { actions, block } = await getRecentActions(db, { userId: "u1" }, { embedImpl: toyEmbed });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "code.build");
    assert.match(block, /code\.build/);
  });

  it("never throws when the table is absent or args are bad", async () => {
    const noTable = new Database(":memory:");
    assert.equal(await recordAction(noTable, { userId: "u", action: "x" }), false);
    assert.deepEqual((await getRecentActions(noTable, { userId: "u" })).actions, []);
    assert.equal(await recordAction(db, { action: "no-user" }), false);
    noTable.close();
  });

  it("is per-user isolated — user B can't see user A's actions", async () => {
    await recordAction(db, { userId: "ua", action: "code.build" }, { embedImpl: toyEmbed });
    const b = await getRecentActions(db, { userId: "ub" }, { embedImpl: toyEmbed });
    assert.equal(b.actions.length, 0);
  });

  it("survives a 'restart' — a fresh handle to the same DB file still recalls", async () => {
    const path = `/tmp/concord-aal-${Date.now()}.db`;
    const a = new Database(path); migrate334(a);
    await recordAction(a, { userId: "u1", action: "calendar.push-event", output: "synced" }, { embedImpl: toyEmbed });
    a.close();
    const b = new Database(path);
    const { actions } = await getRecentActions(b, { userId: "u1" }, { embedImpl: toyEmbed });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "calendar.push-event");
    b.close();
    try { (await import("node:fs")).unlinkSync(path); } catch { /* ignore */ }
  });
});

describe("relevance × recency ranking", () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { db.close(); });

  it("embedding cosine ranks the topically-relevant prior action first", async () => {
    await recordAction(db, { userId: "u1", action: "calendar.event", input: "create a calendar event" }, { embedImpl: toyEmbed });
    await recordAction(db, { userId: "u1", action: "math.solve", input: "solve the math equation" }, { embedImpl: toyEmbed });
    await recordAction(db, { userId: "u1", action: "connector.deploy", input: "deploy a connector" }, { embedImpl: toyEmbed });
    const { actions } = await getRecentActions(db, { userId: "u1", query: "build a math solver", limit: 3 }, { embedImpl: toyEmbed });
    assert.equal(actions[0].action, "math.solve", "the math-relevant action ranks first");
  });

  it("falls back to keyword overlap when no embeddings are available", async () => {
    await recordAction(db, { userId: "u1", action: "calendar.event", input: "create a calendar event" }); // no embedImpl, embeddings unavailable offline → no vector
    await recordAction(db, { userId: "u1", action: "deploy.connector", input: "deploy the connector now" });
    // query with no embedImpl → keyword path
    const { actions } = await getRecentActions(db, { userId: "u1", query: "calendar event reminder", limit: 2 });
    assert.equal(actions[0].action, "calendar.event", "keyword overlap surfaces the calendar action");
  });
});

describe("formatActionContext", () => {
  it("renders a compact prompt block, empty for no actions", () => {
    assert.equal(formatActionContext([]), "");
    const block = formatActionContext([{ action: "code.build", tool: "code.build", output: "done", createdAt: 1700000000 }]);
    assert.match(block, /long-term memory/);
    assert.match(block, /code\.build/);
  });
});
