// server/tests/agent-marathon-mcp.test.js
//
// Sprint 12 acceptance — marathon sessions + MCP bridge wire-up.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  startMarathon, listMarathons, getMarathon,
  pauseMarathon, abandonMarathon, findDueMarathons,
  MARATHON_CONSTANTS,
} from "../lib/agent-marathon.js";
import {
  listConnectedMcpServers, listAllMcpTools,
  MCP_BRIDGE_CONSTANTS,
} from "../lib/mcp-bridge.js";
import { listExposedTools, MCP_HOST_CONSTANTS } from "../lib/mcp-server-host.js";

import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db);
  return db;
}

test("startMarathon creates a session + seeds the goal as turn 0", () => {
  const db = setup();
  const r = startMarathon(db, "alice", { goal: "Build a web app", title: "Web app" });
  assert.equal(r.ok, true);
  assert.ok(r.sessionId.startsWith("mar_"));

  const turn = db.prepare(`SELECT * FROM agent_marathon_turns WHERE session_id = ? AND turn_index = 0`).get(r.sessionId);
  assert.equal(turn.role, "user");
  assert.equal(turn.content, "Build a web app");
});

test("startMarathon rejects missing goal", () => {
  const db = setup();
  const r = startMarathon(db, "alice", { title: "no goal" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing_goal");
});

test("listMarathons filters by user + status", () => {
  const db = setup();
  startMarathon(db, "alice", { goal: "task A" });
  startMarathon(db, "alice", { goal: "task B" });
  startMarathon(db, "bob", { goal: "task C" });
  pauseMarathon(db, listMarathons(db, "alice")[0].id);

  assert.equal(listMarathons(db, "alice").length, 2);
  assert.equal(listMarathons(db, "bob").length, 1);
  assert.equal(listMarathons(db, "alice", { status: "paused" }).length, 1);
  assert.equal(listMarathons(db, "alice", { status: "pending" }).length, 1);
});

test("getMarathon returns full session with turns", () => {
  const db = setup();
  const r = startMarathon(db, "alice", { goal: "test goal" });
  const session = getMarathon(db, r.sessionId);
  assert.ok(session);
  assert.equal(session.goal, "test goal");
  assert.equal(session.turns.length, 1);
  assert.equal(session.turns[0].role, "user");
});

test("pauseMarathon + abandonMarathon update status", () => {
  const db = setup();
  const r = startMarathon(db, "alice", { goal: "x" });
  pauseMarathon(db, r.sessionId);
  assert.equal(getMarathon(db, r.sessionId).status, "paused");
  abandonMarathon(db, r.sessionId);
  assert.equal(getMarathon(db, r.sessionId).status, "abandoned");
});

test("findDueMarathons returns nothing when no sessions are running", () => {
  const db = setup();
  startMarathon(db, "alice", { goal: "x" });
  // Status is 'pending' not 'running' until first tick.
  assert.equal(findDueMarathons(db).length, 0);
});

test("findDueMarathons returns only running sessions whose tick is due", () => {
  const db = setup();
  const r = startMarathon(db, "alice", { goal: "x" });
  // Backdate next_tick + flip to running.
  db.prepare(`UPDATE agent_marathon_sessions SET status='running', next_tick_at = unixepoch() - 60 WHERE id = ?`).run(r.sessionId);
  assert.equal(findDueMarathons(db).length, 1);
});

test("MARATHON_CONSTANTS has sensible defaults", () => {
  assert.ok(MARATHON_CONSTANTS.DEFAULT_TICK_TURNS >= 3);
  assert.ok(MARATHON_CONSTANTS.DEFAULT_MAX_TURNS >= 100);
  assert.ok(MARATHON_CONSTANTS.DEFAULT_TICK_INTERVAL_S >= 30);
});

test("max_turns can be set on creation, capped at 2000", () => {
  const db = setup();
  const r1 = startMarathon(db, "alice", { goal: "tight", maxTurns: 50 });
  assert.equal(getMarathon(db, r1.sessionId).max_turns, 50);
  const r2 = startMarathon(db, "alice", { goal: "huge", maxTurns: 5000 });
  assert.equal(getMarathon(db, r2.sessionId).max_turns, 2000); // capped
});

test("MCP bridge: listConnectedMcpServers is empty by default", () => {
  assert.deepEqual(listConnectedMcpServers(), []);
});

test("MCP bridge: listAllMcpTools is empty by default", () => {
  assert.deepEqual(listAllMcpTools(), []);
});

test("MCP server-host: listExposedTools returns the allowlist", () => {
  const tools = listExposedTools();
  assert.ok(tools.length >= 5, "should expose at least 5 tools");
  const names = tools.map(t => t.name);
  assert.ok(names.includes("concord.expert_mode.answer"));
  assert.ok(names.includes("concord.dtu.search"));
  assert.ok(names.includes("concord.web_search"));
});

test("MCP_HOST_CONSTANTS reports exposed tool count", () => {
  assert.ok(MCP_HOST_CONSTANTS.EXPOSED_TOOL_COUNT >= 5);
});

test("MCP_BRIDGE_CONSTANTS exports client identity", () => {
  assert.equal(MCP_BRIDGE_CONSTANTS.CLIENT_NAME, "concord-mcp-client");
  assert.ok(MCP_BRIDGE_CONSTANTS.CLIENT_VERSION);
});

test("agent_marathon_sessions table has expected columns", () => {
  const db = setup();
  const cols = db.prepare(`PRAGMA table_info(agent_marathon_sessions)`).all().map(c => c.name);
  for (const expected of ["id", "user_id", "goal", "status", "total_turns", "max_turns", "next_tick_at"]) {
    assert.ok(cols.includes(expected), `missing column ${expected}`);
  }
});
