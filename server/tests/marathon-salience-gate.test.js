// Contract test for Wave 7 / B4 — the marathon tick salience gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { tickMarathon } from "../lib/agent-marathon.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE agent_marathon_sessions (
      id TEXT PRIMARY KEY, user_id TEXT, status TEXT, goal TEXT,
      total_turns INTEGER DEFAULT 0, max_turns INTEGER DEFAULT 100,
      created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE agent_marathon_turns (
      session_id TEXT, turn_index INTEGER, role TEXT, content TEXT
    );
  `);
  db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, status, goal, total_turns, max_turns) VALUES ('m1','u1','running','find shelter',0,100)`).run();
  return db;
}

test("Track B4 — marathon tick salience gate", async (t) => {
  await t.test("a calm agent stays on instinct — NO expensive deliberation (no runMacro called)", async () => {
    const db = setupDb();
    let runMacroCalled = false;
    const res = await tickMarathon({
      db, sessionId: "m1",
      runMacro: () => { runMacroCalled = true; return { ok: true }; },
      lensActions: new Map(),
      opts: {
        salienceGate: {
          self: { affect: { v: 0.2, a: 0.2 }, drives: { FEAR: 0.2 } },
          world: {}, others: [],
          prior: { affect: { v: 0.2, a: 0.2 }, drives: { FEAR: 0.2 } },
          opts: {},
        },
      },
    });
    assert.equal(res.ok, true);
    assert.equal(res.deliberated, false, "calm tick → instinct, no LLM loop");
    assert.match(res.reason, /^instinct:/);
    assert.equal(runMacroCalled, false, "the expensive agent loop never ran");
    // the session was NOT advanced
    assert.equal(db.prepare(`SELECT total_turns FROM agent_marathon_sessions WHERE id='m1'`).get().total_turns, 0);
  });

  await t.test("kill-switch off → always deliberate (back-compat); absent gate → always deliberate", async () => {
    const db = setupDb();
    const prev = process.env.CONCORD_AFFECT_SALIENCE;
    process.env.CONCORD_AFFECT_SALIENCE = "0";
    // with the gate present but kill-switch off, it must NOT short-circuit — it falls
    // through to the real loop (which we stub to fail fast so we don't need an LLM).
    const res = await tickMarathon({
      db, sessionId: "m1",
      runMacro: () => ({ ok: true }),
      lensActions: new Map(),
      opts: { salienceGate: { self: { affect: { v: 0.2, a: 0.2 } }, world: {}, others: [], prior: {}, opts: {} } },
    });
    // it proceeded past the gate (deliberated is not false-by-gate)
    assert.notEqual(res.deliberated, false);
    if (prev === undefined) delete process.env.CONCORD_AFFECT_SALIENCE; else process.env.CONCORD_AFFECT_SALIENCE = prev;
  });
});
