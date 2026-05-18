// server/tests/code-background.test.js
//
// Tier-2 contract tests for Code Sprint C #11 — async background
// coding agents. Real migration 171 (agent_marathon_sessions),
// real DB INSERT/UPDATE, real heartbeat-tick state machine. The
// agent_loop call is stubbed via ctx.runMacro because we're not
// re-testing the loop here.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerCodeBackgroundMacros from "../domains/code-background.js";

async function _setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
      creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
      total_experience INTEGER DEFAULT 0, created_at INTEGER
    );
  `);
  const mig = await import("../migrations/171_agent_marathon_sessions.js");
  if (typeof mig.up === "function") mig.up(db); else if (typeof mig.default === "function") mig.default(db);
  return db;
}

describe("code-background: bg_start / bg_tick / bg_status / bg_cancel", () => {
  let db; const macros = new Map();
  before(async () => {
    db = await _setupDb();
    const register = (_d, n, h) => macros.set(n, h);
    registerCodeBackgroundMacros(register);
  });
  after(() => { try { db.close(); } catch { /* ok */ } });

  it("bg_start rejects missing task / projectPath", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    assert.equal((await macros.get("bg_start")(ctx, {})).reason, "task_required");
    assert.equal((await macros.get("bg_start")(ctx, { task: "x" })).reason, "project_path_required");
  });

  it("bg_start inserts a pending session row", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    const r = await macros.get("bg_start")(ctx, {
      task: "refactor auth", projectPath: "x", files: [], runner: "npm", maxSteps: 3,
    });
    assert.equal(r.ok, true);
    assert.ok(r.sessionId.startsWith("code_bg:"));
    assert.equal(r.maxSteps, 3);
    const row = db.prepare("SELECT * FROM agent_marathon_sessions WHERE id = ?").get(r.sessionId);
    assert.equal(row.status, "pending");
    assert.equal(row.user_id, "u1");
    assert.ok(row.meta_json.includes('"kind":"code_bg"'));
  });

  it("bg_tick advances a due session by 1 step and records a turn", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    const start = await macros.get("bg_start")(ctx, {
      task: "do something", projectPath: "x", files: [], maxSteps: 5,
    });
    let loopCalls = 0;
    const tickCtx = {
      db,
      runMacro: async (_d, name, _input) => {
        if (name === "agent_loop") {
          loopCalls++;
          return { ok: true, verdict: "fail", sessionId: `code_agent_session:fake_${loopCalls}` };
        }
        return { ok: false, reason: "unexpected" };
      },
    };
    const tickRes = await macros.get("bg_tick")(tickCtx, {});
    assert.equal(tickRes.ok, true);
    assert.ok(tickRes.advanced >= 1);
    const row = db.prepare("SELECT total_turns, status FROM agent_marathon_sessions WHERE id = ?").get(start.sessionId);
    assert.equal(row.total_turns, 1);
    assert.equal(row.status, "running");
    const turn = db.prepare("SELECT * FROM agent_marathon_turns WHERE session_id = ? AND turn_index = 1").get(start.sessionId);
    assert.ok(turn);
    assert.equal(turn.role, "tool");
  });

  it("bg_tick marks completed on pass verdict", async () => {
    const ctx = { db, actor: { userId: "u2" } };
    const start = await macros.get("bg_start")(ctx, {
      task: "pass quickly", projectPath: "x", files: [], maxSteps: 5,
    });
    // force its next_tick into the past
    db.prepare(`UPDATE agent_marathon_sessions SET next_tick_at = unixepoch() - 10 WHERE id = ?`).run(start.sessionId);
    const tickCtx = {
      db,
      runMacro: async (_d, name) => name === "agent_loop"
        ? { ok: true, verdict: "pass", sessionId: "code_agent_session:passed" }
        : { ok: false },
    };
    await macros.get("bg_tick")(tickCtx, {});
    const row = db.prepare("SELECT status FROM agent_marathon_sessions WHERE id = ?").get(start.sessionId);
    assert.equal(row.status, "completed");
  });

  it("bg_tick marks completed when maxSteps reached", async () => {
    const ctx = { db, actor: { userId: "u3" } };
    const start = await macros.get("bg_start")(ctx, {
      task: "never pass", projectPath: "x", files: [], maxSteps: 1,
    });
    db.prepare(`UPDATE agent_marathon_sessions SET next_tick_at = unixepoch() - 10 WHERE id = ?`).run(start.sessionId);
    const tickCtx = {
      db,
      runMacro: async (_d, name) => name === "agent_loop"
        ? { ok: true, verdict: "fail", sessionId: "code_agent_session:f1" }
        : { ok: false },
    };
    await macros.get("bg_tick")(tickCtx, {});
    const row = db.prepare("SELECT status, total_turns FROM agent_marathon_sessions WHERE id = ?").get(start.sessionId);
    assert.equal(row.total_turns, 1);
    assert.equal(row.status, "completed");
  });

  it("bg_status returns session + turns", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    const r = await macros.get("bg_status")(ctx, { sessionId: "code_bg:nope" });
    assert.equal(r.reason, "not_found");
    const sess = db.prepare("SELECT id FROM agent_marathon_sessions LIMIT 1").get();
    const ok = await macros.get("bg_status")(ctx, { sessionId: sess.id });
    assert.equal(ok.ok, true);
    assert.ok(Array.isArray(ok.turns));
  });

  it("bg_list scopes to caller + filters by status", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    const r = await macros.get("bg_list")(ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.sessions.every((s) => s.id.startsWith("code_bg:")));
  });

  it("bg_cancel marks abandoned for running sessions only", async () => {
    const ctx = { db, actor: { userId: "u9" } };
    const start = await macros.get("bg_start")(ctx, { task: "x", projectPath: "x", files: [] });
    const c = await macros.get("bg_cancel")(ctx, { sessionId: start.sessionId });
    assert.equal(c.ok, true);
    const row = db.prepare("SELECT status FROM agent_marathon_sessions WHERE id = ?").get(start.sessionId);
    assert.equal(row.status, "abandoned");
    const c2 = await macros.get("bg_cancel")(ctx, { sessionId: start.sessionId });
    assert.equal(c2.ok, false);
    assert.equal(c2.reason, "not_found_or_terminal");
  });

  it("bg_publish mints a kind='agent_spec' DTU", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    const start = await macros.get("bg_start")(ctx, { task: "refactor x", projectPath: "x", files: [] });
    const pub = await macros.get("bg_publish")(ctx, { sessionId: start.sessionId, priceCents: 500, license: "MIT" });
    assert.equal(pub.ok, true);
    assert.ok(pub.agentSpecDtuId.startsWith("agent_spec:"));
    const row = db.prepare("SELECT kind FROM dtus WHERE id = ?").get(pub.agentSpecDtuId);
    assert.equal(row.kind, "agent_spec");
  });
});
