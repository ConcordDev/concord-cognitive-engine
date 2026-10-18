// server/tests/background-quality-gate.test.js
// Per-creation quality gate tests for background emergent output.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { assessCreation, maybeCritique, getCreationGateStats, _resetForTest } from "../lib/emergents/quality/creation-gate.js";
import { getGovernorStatus, _resetGovernorForTest, registerQualityStatsProvider } from "../lib/background-governor.js";
import { EmergentMinorAgent } from "../emergent/minor-agent.js";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE emergent_quality_history (
      id TEXT PRIMARY KEY,
      emergent_id TEXT NOT NULL,
      task_id TEXT,
      artifact_id TEXT,
      decision TEXT NOT NULL,
      quality_score REAL NOT NULL,
      stages_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE emergent_tasks (
      id TEXT PRIMARY KEY,
      emergent_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      task_data TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      result TEXT
    );
  `);
  return db;
}

function lastHistory(db, emergentId) {
  return db.prepare(
    "SELECT * FROM emergent_quality_history WHERE emergent_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(emergentId);
}

function taskRow(db, taskId) {
  return db.prepare("SELECT * FROM emergent_tasks WHERE id = ?").get(taskId);
}

function historyRows(db, emergentId) {
  return db.prepare(
    "SELECT * FROM emergent_quality_history WHERE emergent_id = ? ORDER BY created_at ASC"
  ).all(emergentId);
}

before(() => {
  // Ensure a clean slate for governor-dependent assertions.
  _resetGovernorForTest({});
  registerQualityStatsProvider(getCreationGateStats);
  _resetForTest();
});

describe("assessCreation", () => {
  it("accepts good communication text and records an approve history row", () => {
    const db = makeDb();
    const text = "This is a clear, useful communication from one emergent to another about the substrate.";
    const out = assessCreation({ kind: "communication", text, emergentId: "e1", db });
    assert.equal(out.status, "accepted");
    assert.deepEqual(out.reasons, []);
    assert.equal(out.score, 1);
    const row = lastHistory(db, "e1");
    assert.ok(row);
    assert.equal(row.decision, "approve");
    const stages = JSON.parse(row.stages_json);
    assert.equal(stages.kind, "communication");
    assert.deepEqual(stages.reasons, []);
  });

  it("rejects empty text", () => {
    const db = makeDb();
    const out = assessCreation({ kind: "communication", text: "", emergentId: "e1", db });
    assert.equal(out.status, "rejected");
    assert.ok(out.reasons.includes("empty"));
    const row = lastHistory(db, "e1");
    assert.equal(row.decision, "reject");
  });

  it("rejects too-short text", () => {
    const db = makeDb();
    const out = assessCreation({ kind: "communication", text: "hi", emergentId: "e1", db });
    assert.equal(out.status, "rejected");
    assert.ok(out.reasons.includes("too_short"));
    const row = lastHistory(db, "e1");
    assert.equal(row.decision, "reject");
  });

  it("rejects refusal text", () => {
    const db = makeDb();
    const out = assessCreation({
      kind: "communication",
      text: "I can't help with that request, sorry.",
      emergentId: "e1",
      db,
    });
    assert.equal(out.status, "rejected");
    assert.ok(out.reasons.includes("refusal_or_meta"));
    const row = lastHistory(db, "e1");
    assert.equal(row.decision, "reject");
  });

  it("rejects repetitive text", () => {
    const db = makeDb();
    const text = Array(20).fill("hello world").join(" ");
    const out = assessCreation({ kind: "communication", text, emergentId: "e1", db });
    assert.equal(out.status, "rejected");
    assert.ok(out.reasons.includes("repetitive"));
  });

  it("rejects near-duplicate text from the same emergent within 24h", () => {
    const db = makeDb();
    const text = "A moderately interesting message about the substrate that should be tracked.";
    const first = assessCreation({ kind: "communication", text, emergentId: "e1", db });
    assert.equal(first.status, "accepted");
    const second = assessCreation({ kind: "communication", text, emergentId: "e1", db });
    assert.equal(second.status, "rejected");
    assert.ok(second.reasons.includes("near_duplicate"));
    const rows = historyRows(db, "e1");
    assert.equal(rows.length, 2);
    assert.equal(rows[1].decision, "reject");
  });

  it("accepts identical text from a different emergent", () => {
    const db = makeDb();
    const text = "A unique note only used in this test so the cross-emergent check is isolated.";
    const first = assessCreation({ kind: "communication", text, emergentId: "e1", db });
    assert.equal(first.status, "accepted");
    const other = assessCreation({ kind: "communication", text, emergentId: "e2", db });
    assert.equal(other.status, "accepted");
    assert.deepEqual(other.reasons, []);
  });

  it("maps observation kinds to the observation task_type", () => {
    const db = makeDb();
    const text = "Short."; // under observation min 50 but over communication min 20
    const out = assessCreation({ kind: "observe", text, emergentId: "e1", db });
    assert.equal(out.status, "rejected");
    assert.ok(out.reasons.includes("length"));
  });
});

describe("maybeCritique", () => {
  let savedGovernor;

  before(() => {
    savedGovernor = process.env.CONCORD_BG_GOVERNOR;
    process.env.CONCORD_BG_GOVERNOR = "0";
  });

  after(() => {
    if (savedGovernor === undefined) delete process.env.CONCORD_BG_GOVERNOR;
    else process.env.CONCORD_BG_GOVERNOR = savedGovernor;
  });

  it("records a governor-denial critique error when sampled", async () => {
    _resetGovernorForTest({});
    const db = makeDb();
    const text = "A useful and clear communication for critique testing.";
    const { historyId } = assessCreation({ kind: "communication", text, emergentId: "e1", db });
    const before = getCreationGateStats();
    assert.equal(before.critiques.sampled, 0);

    const critique = await maybeCritique({
      kind: "communication",
      text,
      emergentId: "e1",
      historyId,
      db,
      random: () => 0,
    });

    assert.ok(critique);
    assert.ok(critique.error);
    assert.ok(critique.error.includes("bg_governor_denied"), critique.error);
    const row = db.prepare("SELECT stages_json FROM emergent_quality_history WHERE id = ?").get(historyId);
    const stages = JSON.parse(row.stages_json);
    assert.ok(stages.critique);
    assert.ok(stages.critique.error);
    assert.ok(stages.critique.error.includes("bg_governor_denied"));
    const after = getCreationGateStats();
    assert.equal(after.critiques.sampled, 1);
    assert.equal(after.critiques.failed, 1);
  });

  it("returns null when random is above the sample rate", async () => {
    const db = makeDb();
    const text = "Another clear communication.";
    const { historyId } = assessCreation({ kind: "communication", text, emergentId: "e2", db });
    const out = await maybeCritique({
      kind: "communication",
      text,
      emergentId: "e2",
      historyId,
      db,
      random: () => 0.99,
    });
    assert.equal(out, null);
  });
});

describe("minor-agent integration", () => {
  let savedGovernor;

  before(() => {
    savedGovernor = process.env.CONCORD_BG_GOVERNOR;
    process.env.CONCORD_BG_GOVERNOR = "0";
  });

  after(() => {
    if (savedGovernor === undefined) delete process.env.CONCORD_BG_GOVERNOR;
    else process.env.CONCORD_BG_GOVERNOR = savedGovernor;
  });

  it("rejects a too-short task result and marks the task rejected", async () => {
    _resetGovernorForTest({});
    const db = makeDb();
    const taskId = "t1";
    db.prepare(
      `INSERT INTO emergent_tasks
        (id, emergent_id, task_type, task_data, status, priority, created_at)
       VALUES (?, ?, ?, ?, 'pending', 1, ?)`
    ).run(taskId, "e1", "communication", "{}", Date.now());

    const ag = new EmergentMinorAgent("e1", db, null);
    ag.identity = { id: "e1", given_name: "E1" };
    ag._routeTask = async () => ({ finalText: "ok" });

    const task = ag._claimNextTask();
    assert.ok(task);
    assert.equal(task.id, taskId);

    const result = await ag.executeTask(task);
    assert.ok(result.rejected);
    assert.ok(result.rejected.includes("too_short"));

    const row = taskRow(db, taskId);
    assert.equal(row.status, "rejected");
    const payload = JSON.parse(row.result);
    assert.equal(payload.error, "quality_rejected");
    assert.ok(payload.reasons.includes("too_short"));
    assert.ok(payload.quality_history_id);
  });
});

describe("governor status", () => {
  it("includes quality stats from the creation gate", () => {
    _resetGovernorForTest({});
    _resetForTest();
    registerQualityStatsProvider(getCreationGateStats);
    const db = makeDb();
    assessCreation({ kind: "communication", text: "Good enough message here.", emergentId: "e1", db });
    assessCreation({ kind: "communication", text: "", emergentId: "e1", db });
    const status = getGovernorStatus();
    assert.ok(status.quality);
    assert.equal(status.quality.assessed, 2);
    assert.equal(status.quality.accepted, 1);
    assert.equal(status.quality.rejected, 1);
    assert.ok(status.quality.reasons.empty >= 1);
  });
});
