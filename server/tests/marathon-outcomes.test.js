// server/tests/marathon-outcomes.test.js
//
// Contract tests for lib/marathon-outcomes.js — the cross-project
// procedural-memory tier (migration 390). Pins:
//   - extractOutcomeFromSession only writes for a genuinely terminal
//     session, is idempotent (re-extraction UPDATEs, never duplicates),
//     and its tool-domain histogram is a real count resolved through
//     agent-marathon.js's own domainForToolCall.
//   - findSimilarOutcomes is deterministic keyword-overlap, scoped to a
//     given userId by default, and honestly empty when nothing overlaps
//     or the table doesn't exist yet.
//
// Run: node --test server/tests/marathon-outcomes.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import { extractOutcomeFromSession, findSimilarOutcomes } from "../lib/marathon-outcomes.js";

async function setupDb() {
  const db = new Database(":memory:");
  await runMigrations(db);
  return db;
}

function insertSession(db, { id, userId = "u1", goal, title = null, status, totalTurns = 3, createdAt = 1000, completedAt = null }) {
  db.prepare(`
    INSERT INTO agent_marathon_sessions
      (id, user_id, goal, title, status, total_turns, created_at, completed_at,
       max_turns, next_tick_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 200, ?)
  `).run(id, userId, goal, title, status, totalTurns, createdAt, completedAt, createdAt);
}

let _turnIndex = 0;
function insertTurn(db, { sessionId, toolCalls }) {
  db.prepare(`
    INSERT INTO agent_marathon_turns (session_id, turn_index, role, content, tool_calls_json, created_at)
    VALUES (?, ?, 'assistant', 'turn', ?, unixepoch())
  `).run(sessionId, _turnIndex++, JSON.stringify(toolCalls));
}

describe("marathon-outcomes: extractOutcomeFromSession", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("refuses honestly for a session that doesn't exist", () => {
    const r = extractOutcomeFromSession(db, "nope");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "session_not_found");
  });

  it("refuses honestly for a non-terminal (running) session — never fabricates a post-mortem", () => {
    insertSession(db, { id: "s1", goal: "build a widget", status: "running" });
    const r = extractOutcomeFromSession(db, "s1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_terminal");
    assert.equal(r.status, "running");

    const row = db.prepare("SELECT * FROM marathon_outcomes WHERE session_id = ?").get("s1");
    assert.equal(row, undefined, "no row should be written for a non-terminal session");
  });

  it("extracts a real outcome for a completed session with a real tool-domain histogram", () => {
    insertSession(db, {
      id: "s2", goal: "refactor the auth module", title: "Auth refactor",
      status: "completed", totalTurns: 4, createdAt: 1000, completedAt: 1500,
    });
    insertTurn(db, { sessionId: "s2", toolCalls: [{ tool: "run_lens_action", params: { domain: "dtu", name: "create" } }] });
    insertTurn(db, { sessionId: "s2", toolCalls: [{ tool: "run_lens_action", params: { domain: "dtu", name: "create" } }] });
    insertTurn(db, { sessionId: "s2", toolCalls: [{ tool: "web_search" }] });

    const r = extractOutcomeFromSession(db, "s2");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.outcome.status, "completed");
    assert.equal(r.outcome.durationS, 500);
    assert.equal(r.outcome.turnCount, 4);

    const row = db.prepare("SELECT * FROM marathon_outcomes WHERE session_id = ?").get("s2");
    assert.ok(row, "a real row must exist, not just the return value");
    assert.equal(row.goal, "refactor the auth module");
    const histogram = JSON.parse(row.tool_domain_histogram_json);
    assert.equal(histogram.dtu, 2, "two run_lens_action dtu calls must be counted");
  });

  it("is idempotent — re-extracting the same session UPDATEs the row, never duplicates", () => {
    insertSession(db, { id: "s3", goal: "ship the release", status: "completed", createdAt: 1000, completedAt: 1200 });
    extractOutcomeFromSession(db, "s3");
    extractOutcomeFromSession(db, "s3");
    const rows = db.prepare("SELECT * FROM marathon_outcomes WHERE session_id = ?").all("s3");
    assert.equal(rows.length, 1, "must not accumulate a duplicate row on re-extraction");
  });

  it("stamps extraction-time as completedAt for an abandoned session with no real completed_at, never fabricating a completion moment", () => {
    insertSession(db, { id: "s4", goal: "abandoned task", status: "abandoned", createdAt: 1000, completedAt: null });
    const r = extractOutcomeFromSession(db, "s4");
    assert.equal(r.ok, true);
    assert.equal(r.outcome.durationS, null, "no real completed_at means duration must be honestly null, not guessed");
    assert.ok(r.outcome.completedAt > 0, "extraction-time stamp must still be a real timestamp");
  });
});

describe("marathon-outcomes: findSimilarOutcomes", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("is honestly empty when marathon_outcomes has no rows", () => {
    const r = findSimilarOutcomes(db, "build a widget");
    assert.equal(r.ok, true);
    assert.deepEqual(r.items, []);
  });

  it("ranks by real keyword overlap, tie-broken by recency", () => {
    insertSession(db, { id: "sa", userId: "u1", goal: "refactor the payments module", status: "completed", createdAt: 1000, completedAt: 1100 });
    insertSession(db, { id: "sb", userId: "u1", goal: "refactor the payments gateway integration", status: "completed", createdAt: 1000, completedAt: 1300 });
    insertSession(db, { id: "sc", userId: "u1", goal: "write documentation for onboarding", status: "completed", createdAt: 1000, completedAt: 1200 });
    extractOutcomeFromSession(db, "sa");
    extractOutcomeFromSession(db, "sb");
    extractOutcomeFromSession(db, "sc");

    const r = findSimilarOutcomes(db, "refactor payments", 5, { userId: "u1" });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 2, "only the two payments-related outcomes should surface");
    assert.equal(r.items[0].sessionId, "sb", "sb has more term overlap (refactor+payments) and is more recent than sa");
  });

  it("scopes to the given userId — never leaks another user's outcomes", () => {
    insertSession(db, { id: "sd", userId: "u1", goal: "build a dashboard", status: "completed", createdAt: 1000, completedAt: 1100 });
    insertSession(db, { id: "se", userId: "u2", goal: "build a dashboard", status: "completed", createdAt: 1000, completedAt: 1100 });
    extractOutcomeFromSession(db, "sd");
    extractOutcomeFromSession(db, "se");

    const r = findSimilarOutcomes(db, "build a dashboard", 5, { userId: "u1" });
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].sessionId, "sd");
  });

  it("degrades honestly (empty, not throwing) against a DB missing the marathon_outcomes table", () => {
    const bareDb = new Database(":memory:");
    const r = findSimilarOutcomes(bareDb, "anything");
    assert.equal(r.ok, true);
    assert.deepEqual(r.items, []);
  });
});
